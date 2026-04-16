import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds, formatCurrency } from "../../utilis/notificationHelper";
import { getRequiredApprovalLevel } from "../../utilis/approvalConfigHelper";

// ── Helpers ──────────────────────────────────────────────────────────

function mustUser(req: AuthenticatedRequest) {
  const u = (req as any).user;
  if (!u?.employeeDbId) throw new Error("Unauthorized");
  return u as { employeeDbId: number; employeeID: string; name?: string; role: string; departmentId?: number };
}

async function generatePONumber(): Promise<string> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const fyStartYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEndYear = fyStartYear + 1;
  const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;

  const latest = await prisma.purchaseOrder.findFirst({
    where: { poNumber: { startsWith: `PO-${fyString}` } },
    orderBy: { id: "desc" },
  });

  let seq = 1;
  if (latest) {
    const parts = latest.poNumber.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `PO-${fyString}-${seq.toString().padStart(3, "0")}`;
}


// Status flow per approval level:
// HOD only:       DRAFT → HOD_APPROVED → SENT_TO_VENDOR
// MANAGEMENT:     DRAFT → HOD_APPROVED → MGMT_APPROVED → SENT_TO_VENDOR
// COO:            DRAFT → HOD_APPROVED → MGMT_APPROVED → COO_APPROVED → SENT_TO_VENDOR
// CFO:            DRAFT → HOD_APPROVED → MGMT_APPROVED → COO_APPROVED → CFO_APPROVED → SENT_TO_VENDOR

// ── GET / ────────────────────────────────────────────────────────────

export const getAllPurchaseOrders = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, vendorId, departmentId, page, limit: lim } = req.query;
    const user = (req as any).user;

    const where: any = {};
    if (status) where.status = String(status);
    if (vendorId) where.vendorId = Number(vendorId);
    if (departmentId) where.departmentId = Number(departmentId);

    // Department-based scoping for non-admin users
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId && !departmentId) {
      where.departmentId = Number(user.departmentId);
    }

    const pageNum = page ? parseInt(String(page)) : 1;
    const take = lim ? parseInt(String(lim)) : 20;
    const skip = (pageNum - 1) * take;

    const [total, orders] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: { id: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({ data: orders, total, page: pageNum, limit: take });
  } catch (error: any) {
    console.error("getAllPurchaseOrders error:", error);
    res.status(500).json({ message: "Failed to fetch purchase orders" });
  }
};

// ── GET /:id ─────────────────────────────────────────────────────────

export const getPurchaseOrderById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        vendor: { select: { id: true, name: true, contact: true, email: true } },
        department: { select: { id: true, name: true } },
        indent: true,
        lines: {
          orderBy: { lineNumber: "asc" },
        },
        goodsReceipts: {
          select: { id: true, grnNumber: true, grnDate: true, status: true, totalValue: true },
          orderBy: { id: "desc" },
        },
      },
    });

    if (!po) {
      res.status(404).json({ message: "Purchase order not found" });
      return;
    }
    res.json(po);
  } catch (error: any) {
    console.error("getPurchaseOrderById error:", error);
    res.status(500).json({ message: "Failed to fetch purchase order" });
  }
};

// ── POST / ───────────────────────────────────────────────────────────

export const createPurchaseOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const {
      vendorId,
      departmentId,
      indentId,
      deliveryDate,
      paymentTerms,
      shippingAddress,
      notes,
      lines,
    } = req.body;

    if (!vendorId) {
      res.status(400).json({ message: "vendorId is required" });
      return;
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ message: "At least one line is required" });
      return;
    }

    // If indentId provided, validate indent and check for duplicate PO
    if (indentId) {
      const indent = await (prisma as any).assetIndent.findUnique({ where: { id: Number(indentId) } });
      if (!indent) {
        res.status(400).json({ message: "Indent not found" });
        return;
      }
      // Check if a PO already exists for this indent (prevent duplicates)
      const existingPO = await prisma.purchaseOrder.findFirst({
        where: { indentId: Number(indentId), status: { notIn: ["CANCELLED"] } },
      });
      if (existingPO) {
        res.status(409).json({
          message: `A purchase order (${existingPO.poNumber}) already exists for this indent. Cancel the existing PO first to create a new one.`,
          existingPO: { id: existingPO.id, poNumber: existingPO.poNumber, status: existingPO.status },
        });
        return;
      }
    } else {
      // Check if indent is mandatory
      const cfg = await prisma.tenantConfig.findUnique({ where: { key: "MANDATORY_INDENT_BEFORE_PO" } });
      if (cfg && cfg.value === "true") {
        res.status(400).json({ message: "An approved indent is mandatory before creating a PO" });
        return;
      }
    }

    const poNumber = await generatePONumber();

    // Calculate line totals
    let subtotal = 0;
    let taxAmount = 0;
    const lineData = lines.map((l: any, idx: number) => {
      const qty = Number(l.quantity);
      const price = Number(l.unitPrice);
      const taxPct = l.taxPercent ? Number(l.taxPercent) : 0;
      const lineTotal = qty * price;
      const lineTax = lineTotal * (taxPct / 100);
      subtotal += lineTotal;
      taxAmount += lineTax;

      return {
        lineNumber: Number(l.lineNumber) || (idx + 1),
        itemType: l.itemType,
        description: l.description,
        assetCategoryId: l.assetCategoryId ? Number(l.assetCategoryId) : null,
        sparePartId: l.sparePartId ? Number(l.sparePartId) : null,
        consumableId: l.consumableId ? Number(l.consumableId) : null,
        storeId: l.storeId ? Number(l.storeId) : null,
        quantity: qty,
        unitPrice: price,
        taxPercent: taxPct,
        lineTotal,
        pendingQty: qty,
        hsnCode: l.hsnCode ?? null,
        specifications: l.specifications ?? null,
      };
    });

    const totalAmount = subtotal + taxAmount;

    // Determine required approval level based on amount
    const approvalLevel = await getRequiredApprovalLevel("PURCHASE_ORDER", totalAmount);

    const po = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId: Number(vendorId),
          departmentId: departmentId ? Number(departmentId) : null,
          indentId: indentId ? Number(indentId) : null,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          paymentTerms: paymentTerms ?? null,
          shippingAddress: shippingAddress ?? null,
          notes: notes ?? null,
          subtotal,
          taxAmount,
          totalAmount,
          originalAmount: totalAmount,
          approvalLevel,
          status: "DRAFT",
          createdById: user.employeeDbId,
          lines: {
            create: lineData,
          },
        },
        include: { lines: true },
      });

      return created;
    });

    logAction({ entityType: "PURCHASE_ORDER", entityId: po.id, action: "CREATE", description: `PO ${po.poNumber} created, amount ${totalAmount}`, performedById: user.employeeDbId });

    // Notify HODs about new PO pending approval
    const hodIds = await getDepartmentHODs(po.departmentId);
    notify({ type: "PO_APPROVAL", title: "New PO Pending Approval", message: `PO ${po.poNumber} (${formatCurrency(totalAmount)}) requires approval`, recipientIds: hodIds, createdById: user.employeeDbId, channel: "BOTH", templateCode: "PO_APPROVAL", templateData: { poNumber: po.poNumber, amount: formatCurrency(totalAmount) } });

    res.status(201).json(po);
  } catch (error: any) {
    console.error("createPurchaseOrder error:", error);
    res.status(400).json({ message: error.message || "Failed to create purchase order" });
  }
};

// ── PUT /:id ─────────────────────────────────────────────────────────

export const updatePurchaseOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const poId = Number(req.params.id);

    const existing = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!existing) {
      res.status(404).json({ message: "Purchase order not found" });
      return;
    }
    if (existing.status !== "DRAFT") {
      res.status(400).json({ message: "Only DRAFT purchase orders can be updated" });
      return;
    }

    const {
      vendorId,
      departmentId,
      indentId,
      deliveryDate,
      paymentTerms,
      shippingAddress,
      notes,
      lines,
    } = req.body;

    let subtotal = 0;
    let taxAmount = 0;
    let lineData: any[] = [];

    if (lines && Array.isArray(lines) && lines.length > 0) {
      lineData = lines.map((l: any, idx: number) => {
        const qty = Number(l.quantity);
        const price = Number(l.unitPrice);
        const taxPct = l.taxPercent ? Number(l.taxPercent) : 0;
        const lineTotal = qty * price;
        const lineTax = lineTotal * (taxPct / 100);
        subtotal += lineTotal;
        taxAmount += lineTax;

        return {
          lineNumber: Number(l.lineNumber) || (idx + 1),
          itemType: l.itemType,
          description: l.description,
          assetCategoryId: l.assetCategoryId ? Number(l.assetCategoryId) : null,
          sparePartId: l.sparePartId ? Number(l.sparePartId) : null,
          consumableId: l.consumableId ? Number(l.consumableId) : null,
          storeId: l.storeId ? Number(l.storeId) : null,
          quantity: qty,
          unitPrice: price,
          taxPercent: taxPct,
          lineTotal,
          pendingQty: qty,
          hsnCode: l.hsnCode ?? null,
          specifications: l.specifications ?? null,
        };
      });
    }

    const totalAmount = subtotal + taxAmount;

    const updated = await prisma.$transaction(async (tx) => {
      // Delete old lines and replace
      if (lineData.length > 0) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } });
      }

      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          vendorId: vendorId ? Number(vendorId) : undefined,
          departmentId: departmentId !== undefined ? (departmentId ? Number(departmentId) : null) : undefined,
          indentId: indentId !== undefined ? (indentId ? Number(indentId) : null) : undefined,
          deliveryDate: deliveryDate !== undefined ? (deliveryDate ? new Date(deliveryDate) : null) : undefined,
          paymentTerms: paymentTerms !== undefined ? paymentTerms : undefined,
          shippingAddress: shippingAddress !== undefined ? shippingAddress : undefined,
          notes: notes !== undefined ? notes : undefined,
          ...(lineData.length > 0 ? { subtotal, taxAmount, totalAmount } : {}),
          updatedById: user.employeeDbId,
          lines: lineData.length > 0 ? { create: lineData } : undefined,
        },
        include: { lines: true },
      });

      return po;
    });

    res.json(updated);
  } catch (error: any) {
    console.error("updatePurchaseOrder error:", error);
    res.status(400).json({ message: error.message || "Failed to update purchase order" });
  }
};

// ── PATCH /:id/approve ───────────────────────────────────────────────

export const approvePO = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const poId = Number(req.params.id);
    const { level, remarks } = req.body;
    const user = mustUser(req);

    const validLevels = ["HOD", "MANAGEMENT", "COO", "CFO"];
    if (!validLevels.includes(level)) {
      res.status(400).json({ message: "level must be HOD, MANAGEMENT, COO, or CFO" });
      return;
    }

    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) {
      res.status(404).json({ message: "Purchase order not found" });
      return;
    }

    const requiredLevel = po.approvalLevel || "HOD";
    const levelOrder = ["HOD", "MANAGEMENT", "COO", "CFO"];
    const requiredIdx = levelOrder.indexOf(requiredLevel);

    // Determine what status is expected for each approval level
    const approvalChain: Record<string, { requiredStatus: string; newStatus: string; fields: any }> = {
      HOD: {
        requiredStatus: "DRAFT",
        newStatus: requiredIdx === 0 ? "MGMT_APPROVED" : "HOD_APPROVED", // if HOD is enough, skip to approved
        fields: { hodApprovedById: user.employeeDbId, hodApprovedAt: new Date(), hodRemarks: remarks ?? null },
      },
      MANAGEMENT: {
        requiredStatus: "HOD_APPROVED",
        newStatus: requiredIdx <= 1 ? "MGMT_APPROVED" : "MGMT_APPROVED",
        fields: { mgmtApprovedById: user.employeeDbId, mgmtApprovedAt: new Date(), mgmtRemarks: remarks ?? null },
      },
      COO: {
        requiredStatus: "MGMT_APPROVED",
        newStatus: "COO_APPROVED",
        fields: { cooApprovedById: user.employeeDbId, cooApprovedAt: new Date(), cooRemarks: remarks ?? null },
      },
      CFO: {
        requiredStatus: "COO_APPROVED",
        newStatus: "CFO_APPROVED",
        fields: { cfoApprovedById: user.employeeDbId, cfoApprovedAt: new Date(), cfoRemarks: remarks ?? null },
      },
    };

    const chain = approvalChain[level];

    // Special case: if only HOD approval is needed, HOD approval → directly to MGMT_APPROVED (sendable)
    if (level === "HOD" && requiredLevel === "HOD") {
      chain.newStatus = "MGMT_APPROVED"; // skip management, go directly to sendable
    }

    if (po.status !== chain.requiredStatus) {
      res.status(400).json({
        message: `PO must be in ${chain.requiredStatus} status for ${level} approval. Current: ${po.status}`,
      });
      return;
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        ...chain.fields,
        status: chain.newStatus,
      },
    });

    // Include info about what's next
    const currentIdx = levelOrder.indexOf(level);
    const nextLevel = currentIdx < requiredIdx ? levelOrder[currentIdx + 1] : null;

    logAction({ entityType: "PURCHASE_ORDER", entityId: poId, action: "APPROVE", description: `PO ${po.poNumber} approved by ${level}`, performedById: user.employeeDbId });

    // Notify admins if next approval level needed
    if (nextLevel) {
      const adminIds = await getAdminIds();
      notify({ type: "PO_APPROVAL", title: "PO Approved by " + level, message: `PO ${po.poNumber} approved by ${level}, needs ${nextLevel} approval`, recipientIds: adminIds, createdById: user.employeeDbId });
    }

    res.json({
      ...updated,
      _approvalInfo: {
        requiredLevel,
        currentLevel: level,
        nextLevel,
        isFullyApproved: !nextLevel,
      },
    });
  } catch (error: any) {
    console.error("approvePO error:", error);
    res.status(400).json({ message: error.message || "Failed to approve purchase order" });
  }
};

// ── PATCH /:id/send ──────────────────────────────────────────────────

export const sendToVendor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const poId = Number(req.params.id);

    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) {
      res.status(404).json({ message: "Purchase order not found" });
      return;
    }
    // PO can be sent when the final required approval level is reached
    const sendableStatuses = ["MGMT_APPROVED", "COO_APPROVED", "CFO_APPROVED"];
    if (!sendableStatuses.includes(po.status)) {
      res.status(400).json({ message: `PO must be fully approved before sending to vendor. Current: ${po.status}` });
      return;
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: "SENT_TO_VENDOR" },
    });

    logAction({ entityType: "PURCHASE_ORDER", entityId: poId, action: "STATUS_CHANGE", description: `PO ${po.poNumber} sent to vendor`, performedById: (req as any).user?.employeeDbId });

    // Notify PO creator that PO has been sent to vendor
    notify({ type: "PO_APPROVAL", title: "PO Sent to Vendor", message: `PO ${po.poNumber} has been sent to vendor`, recipientIds: [po.createdById].filter(Boolean) as number[], createdById: (req as any).user?.employeeDbId, channel: "BOTH", templateCode: "PO_APPROVED", templateData: { poNumber: po.poNumber, amount: '' } });

    res.json(updated);
  } catch (error: any) {
    console.error("sendToVendor error:", error);
    res.status(400).json({ message: error.message || "Failed to send PO to vendor" });
  }
};

// ── PATCH /:id/cancel ────────────────────────────────────────────────

export const cancelPO = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const poId = Number(req.params.id);

    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) {
      res.status(404).json({ message: "Purchase order not found" });
      return;
    }
    if (["FULLY_RECEIVED", "CANCELLED", "CLOSED"].includes(po.status)) {
      res.status(400).json({ message: `Cannot cancel a PO with status ${po.status}` });
      return;
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: "CANCELLED" },
    });

    logAction({ entityType: "PURCHASE_ORDER", entityId: poId, action: "STATUS_CHANGE", description: `PO ${po.poNumber} cancelled`, performedById: (req as any).user?.employeeDbId });

    // Notify PO creator + HOD about cancellation
    const cancelPoNotifyIds: number[] = [];
    if (po.createdById) cancelPoNotifyIds.push(po.createdById);
    const cancelPoHodIds = await getDepartmentHODs(po.departmentId);
    const allCancelIds = [...new Set([...cancelPoNotifyIds, ...cancelPoHodIds])].filter(id => id !== (req as any).user?.employeeDbId);
    if (allCancelIds.length > 0) {
      notify({ type: "PO_APPROVAL", title: "PO Cancelled", message: `PO ${po.poNumber} (${formatCurrency(Number(po.totalAmount ?? 0))}) has been cancelled`, recipientIds: allCancelIds, createdById: (req as any).user?.employeeDbId });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("cancelPO error:", error);
    res.status(400).json({ message: error.message || "Failed to cancel purchase order" });
  }
};

// ── POST /from-indent/:indentId ──────────────────────────────────────

export const createPOFromIndent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const indentId = Number(req.params.indentId);

    const indent = await (prisma as any).assetIndent.findUnique({
      where: { id: indentId },
      include: {
        assetCategory: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    if (!indent) {
      res.status(404).json({ message: "Indent not found" });
      return;
    }
    if (!["HOD_APPROVED", "MANAGEMENT_APPROVED"].includes(indent.status)) {
      res.status(400).json({ message: "Indent must be approved before creating a PO" });
      return;
    }

    // Check if a PO already exists for this indent
    const existingPO = await prisma.purchaseOrder.findFirst({
      where: { indentId, status: { notIn: ["CANCELLED"] } },
    });
    if (existingPO) {
      res.status(409).json({
        message: `A purchase order (${existingPO.poNumber}) already exists for this indent.`,
        existingPO: { id: existingPO.id, poNumber: existingPO.poNumber, status: existingPO.status },
      });
      return;
    }

    const { vendorId } = req.body;
    if (!vendorId) {
      res.status(400).json({ message: "vendorId is required in body" });
      return;
    }

    const poNumber = await generatePONumber();

    const qty = indent.quantity || 1;
    const unitPrice = indent.estimatedBudget ? Number(indent.estimatedBudget) / qty : 0;
    const lineTotal = qty * unitPrice;

    const po = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId: Number(vendorId),
          departmentId: indent.departmentId ?? null,
          indentId,
          deliveryDate: indent.requiredByDate ?? null,
          notes: indent.justification ?? null,
          subtotal: lineTotal,
          taxAmount: 0,
          totalAmount: lineTotal,
          originalAmount: lineTotal,
          approvalLevel: await getRequiredApprovalLevel("PURCHASE_ORDER", lineTotal),
          status: "DRAFT",
          createdById: user.employeeDbId,
          lines: {
            create: [
              {
                lineNumber: 1,
                itemType: "ASSET",
                description: indent.assetName,
                assetCategoryId: indent.assetCategoryId ?? null,
                quantity: qty,
                unitPrice,
                taxPercent: 0,
                lineTotal,
                pendingQty: qty,
                specifications: indent.specifications ?? null,
              },
            ],
          },
        },
        include: { lines: true },
      });

      return created;
    });

    logAction({ entityType: "PURCHASE_ORDER", entityId: po.id, action: "CREATE", description: `PO ${po.poNumber} created from indent #${indentId}`, performedById: user.employeeDbId });

    res.status(201).json(po);
  } catch (error: any) {
    console.error("createPOFromIndent error:", error);
    res.status(400).json({ message: error.message || "Failed to create PO from indent" });
  }
};

// ── PATCH /:id/amend — Amend PO (cost revision) ────────────────────

export const amendPO = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const poId = Number(req.params.id);
    const { reason, lines } = req.body;

    if (!reason) {
      res.status(400).json({ message: "Reason for amendment is required" });
      return;
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ message: "Updated lines are required" });
      return;
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: true },
    });

    if (!po) {
      res.status(404).json({ message: "Purchase order not found" });
      return;
    }

    // Only allow amendments on POs that are SENT_TO_VENDOR or PARTIALLY_RECEIVED
    const amendableStatuses = ["SENT_TO_VENDOR", "PARTIALLY_RECEIVED"];
    if (!amendableStatuses.includes(po.status)) {
      res.status(400).json({
        message: `PO can only be amended in SENT_TO_VENDOR or PARTIALLY_RECEIVED status. Current: ${po.status}`,
      });
      return;
    }

    const previousAmount = Number(po.totalAmount ?? 0);

    // Calculate new totals
    let subtotal = 0;
    let taxAmount = 0;
    const lineData = lines.map((l: any, idx: number) => {
      const qty = Number(l.quantity);
      const price = Number(l.unitPrice);
      const taxPct = l.taxPercent ? Number(l.taxPercent) : 0;
      const lineTotal = qty * price;
      const lineTax = lineTotal * (taxPct / 100);
      subtotal += lineTotal;
      taxAmount += lineTax;

      return {
        lineNumber: Number(l.lineNumber) || (idx + 1),
        itemType: l.itemType,
        description: l.description,
        assetCategoryId: l.assetCategoryId ? Number(l.assetCategoryId) : null,
        sparePartId: l.sparePartId ? Number(l.sparePartId) : null,
        consumableId: l.consumableId ? Number(l.consumableId) : null,
        storeId: l.storeId ? Number(l.storeId) : null,
        quantity: qty,
        unitPrice: price,
        taxPercent: taxPct,
        lineTotal,
        pendingQty: qty - (l.receivedQty || 0),
        hsnCode: l.hsnCode ?? null,
        specifications: l.specifications ?? null,
      };
    });

    const newTotalAmount = subtotal + taxAmount;
    const changeAmount = newTotalAmount - previousAmount;

    // Determine if new amount needs higher approval
    const newApprovalLevel = await getRequiredApprovalLevel("PURCHASE_ORDER", newTotalAmount);

    const result = await prisma.$transaction(async (tx) => {
      // Create amendment record
      const amendment = await tx.purchaseOrderAmendment.create({
        data: {
          purchaseOrderId: poId,
          amendmentNumber: (po.amendmentCount ?? 0) + 1,
          reason,
          previousAmount,
          newAmount: newTotalAmount,
          changeAmount,
          changesJson: { previousLines: po.lines, newLines: lineData },
          status: "APPROVED", // auto-approved for now; can add approval flow later
          approvedById: user.employeeDbId,
          approvedAt: new Date(),
          createdById: user.employeeDbId,
        },
      });

      // Delete old lines and create new ones
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } });

      for (const ld of lineData) {
        await tx.purchaseOrderLine.create({
          data: { purchaseOrderId: poId, ...ld },
        });
      }

      // Update PO
      const updatedPO = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          subtotal,
          taxAmount,
          totalAmount: newTotalAmount,
          isAmended: true,
          amendmentCount: { increment: 1 },
          approvalLevel: newApprovalLevel,
          updatedById: user.employeeDbId,
        },
        include: { lines: true, amendments: { orderBy: { amendmentNumber: "desc" }, take: 5 } },
      });

      return { po: updatedPO, amendment };
    });

    logAction({ entityType: "PURCHASE_ORDER", entityId: poId, action: "UPDATE", description: `PO ${po.poNumber} amended (#${result.amendment.amendmentNumber}), amount ${previousAmount} -> ${newTotalAmount}`, performedById: user.employeeDbId });

    // Notify PO creator about amendment
    if (po.createdById && po.createdById !== user.employeeDbId) {
      notify({ type: "PO_APPROVAL", title: "PO Amended", message: `PO ${po.poNumber} has been amended (#${result.amendment.amendmentNumber}). New amount: ${formatCurrency(newTotalAmount)}. Reason: ${reason}`, recipientIds: [po.createdById], createdById: user.employeeDbId });
    }

    res.json({
      ...result.po,
      _amendment: {
        number: result.amendment.amendmentNumber,
        previousAmount,
        newAmount: newTotalAmount,
        change: changeAmount,
        changePercent: previousAmount > 0 ? Math.round((changeAmount / previousAmount) * 100 * 10) / 10 : null,
      },
    });
  } catch (error: any) {
    console.error("amendPO error:", error);
    res.status(400).json({ message: error.message || "Failed to amend purchase order" });
  }
};

// ── GET /:id/amendments — Get amendment history ─────────────────────

export const getPOAmendments = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const poId = Number(req.params.id);

    const amendments = await prisma.purchaseOrderAmendment.findMany({
      where: { purchaseOrderId: poId },
      orderBy: { amendmentNumber: "desc" },
    });

    res.json({ data: amendments });
  } catch (error: any) {
    console.error("getPOAmendments error:", error);
    res.status(500).json({ message: "Failed to fetch amendments" });
  }
};

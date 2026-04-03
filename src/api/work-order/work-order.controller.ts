import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";
import { generateAssetId } from "../../utilis/assetIdGenerator";

// ─── helpers ───────────────────────────────────────────────
function getFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 4
    ? `${now.getFullYear().toString().slice(2)}${(now.getFullYear() + 1).toString().slice(2)}`
    : `${(now.getFullYear() - 1).toString().slice(2)}${now.getFullYear().toString().slice(2)}`;
}

async function generateWoNumber(): Promise<string> {
  const fy = getFY();
  const prefix = `WO-FY${fy}-`;
  const last = await prisma.workOrder.findFirst({
    where: { woNumber: { startsWith: prefix } },
    orderBy: { woNumber: "desc" },
  });
  const seq = last ? parseInt(last.woNumber.replace(prefix, ""), 10) + 1 : 1;
  return `${prefix}${seq.toString().padStart(5, "0")}`;
}

async function generateWccNumber(): Promise<string> {
  const fy = getFY();
  const prefix = `WCC-FY${fy}-`;
  const last = await prisma.workCompletionCertificate.findFirst({
    where: { wccNumber: { startsWith: prefix } },
    orderBy: { wccNumber: "desc" },
  });
  const seq = last ? parseInt(last.wccNumber.replace(prefix, ""), 10) + 1 : 1;
  return `${prefix}${seq.toString().padStart(5, "0")}`;
}

// ═══════════════════════════════════════════════════════════
// GET ALL (paginated + filters)
// ═══════════════════════════════════════════════════════════
export const getAllWorkOrders = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, woType, assetId, departmentId, page = "1", limit = "20" } = req.query;
    const user = (req as any).user;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.WorkOrderWhereInput = {};
    if (status) where.status = String(status);
    if (woType) where.woType = String(woType);
    if (assetId) where.assetId = Number(assetId);
    if (departmentId) where.departmentId = Number(departmentId);

    // Department-based scoping for non-admin users
    if (user?.role !== "ADMIN" && user?.departmentId && !departmentId) {
      where.departmentId = Number(user.departmentId);
    }

    const [data, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { id: "desc" },
        include: {
          asset: { select: { id: true, assetId: true, assetName: true } },
        },
      }),
      prisma.workOrder.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET BY ID
// ═══════════════════════════════════════════════════════════
export const getWorkOrderById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, assetId: true, assetName: true, status: true } },
        ticket: { select: { id: true, ticketId: true, issueType: true, status: true } },
        materialIssues: {
          include: {
            store: { select: { id: true, name: true } },
            sparePart: { select: { id: true, name: true, partNumber: true } },
            consumable: { select: { id: true, name: true } },
          },
          orderBy: { issuedAt: "desc" },
        },
        wcc: true,
      },
    });
    if (!wo) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
    res.json(wo);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════
export const createWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      woType,
      assetId,
      ticketId,
      description,
      priority,
      departmentId,
      assignedToId,
      estimatedCost,
      budgetCode,
      capitalizeAsAsset,
      assetCategoryId,
      scheduledStart,
      scheduledEnd,
      contractorVendorId,
      contractorName,
    } = req.body;

    if (!woType || !description) {
      res.status(400).json({ message: "woType and description are required" });
      return;
    }

    const woNumber = await generateWoNumber();

    const wo = await prisma.workOrder.create({
      data: {
        woNumber,
        woType,
        assetId: assetId ? Number(assetId) : null,
        ticketId: ticketId ? Number(ticketId) : null,
        description,
        priority: priority || "MEDIUM",
        departmentId: departmentId ? Number(departmentId) : null,
        assignedToId: assignedToId ? Number(assignedToId) : null,
        estimatedCost: estimatedCost ? new Prisma.Decimal(estimatedCost) : null,
        budgetCode: budgetCode || null,
        capitalizeAsAsset: capitalizeAsAsset === true,
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : null,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        contractorVendorId: contractorVendorId ? Number(contractorVendorId) : null,
        contractorName: contractorName || null,
        status: "DRAFT",
        createdById: req.user?.employeeDbId ?? null,
      },
    });

    logAction({ entityType: "WORK_ORDER", entityId: wo.id, action: "CREATE", description: `WO ${wo.woNumber} created (${woType})`, performedById: req.user?.employeeDbId });

    // Notify HODs about new work order
    const hodIds = await getDepartmentHODs(wo.departmentId);
    notify({ type: "WO_STATUS", title: "New Work Order", message: `WO ${wo.woNumber} (${woType}) created, pending approval`, recipientIds: hodIds, assetId: wo.assetId ?? undefined, createdById: req.user?.employeeDbId });

    res.status(201).json(wo);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// UPDATE (only DRAFT / SUBMITTED)
// ═══════════════════════════════════════════════════════════
export const updateWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
    if (!["DRAFT", "SUBMITTED"].includes(existing.status)) {
      res.status(400).json({ message: `Cannot update work order in ${existing.status} status` });
      return;
    }

    const {
      woType,
      assetId,
      ticketId,
      description,
      priority,
      departmentId,
      assignedToId,
      estimatedCost,
      budgetCode,
      capitalizeAsAsset,
      assetCategoryId,
      scheduledStart,
      scheduledEnd,
      contractorVendorId,
      contractorName,
      status,
    } = req.body;

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        ...(woType !== undefined && { woType }),
        ...(assetId !== undefined && { assetId: assetId ? Number(assetId) : null }),
        ...(ticketId !== undefined && { ticketId: ticketId ? Number(ticketId) : null }),
        ...(description !== undefined && { description }),
        ...(priority !== undefined && { priority }),
        ...(departmentId !== undefined && { departmentId: departmentId ? Number(departmentId) : null }),
        ...(assignedToId !== undefined && { assignedToId: assignedToId ? Number(assignedToId) : null }),
        ...(estimatedCost !== undefined && { estimatedCost: estimatedCost ? new Prisma.Decimal(estimatedCost) : null }),
        ...(budgetCode !== undefined && { budgetCode }),
        ...(capitalizeAsAsset !== undefined && { capitalizeAsAsset }),
        ...(assetCategoryId !== undefined && { assetCategoryId: assetCategoryId ? Number(assetCategoryId) : null }),
        ...(scheduledStart !== undefined && { scheduledStart: scheduledStart ? new Date(scheduledStart) : null }),
        ...(scheduledEnd !== undefined && { scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null }),
        ...(contractorVendorId !== undefined && { contractorVendorId: contractorVendorId ? Number(contractorVendorId) : null }),
        ...(contractorName !== undefined && { contractorName }),
        ...(status !== undefined && ["DRAFT", "SUBMITTED"].includes(status) && { status }),
        updatedById: req.user?.employeeDbId ?? null,
      },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════════
export const approveWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { approvedById, approvalRemarks } = req.body;

    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (wo.status !== "SUBMITTED" && wo.status !== "DRAFT") {
      res.status(400).json({ message: `Cannot approve work order in ${wo.status} status` });
      return;
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: approvedById ? Number(approvedById) : req.user?.employeeDbId ?? null,
        approvedAt: new Date(),
        approvalRemarks: approvalRemarks || null,
      },
    });

    logAction({ entityType: "WORK_ORDER", entityId: id, action: "APPROVE", description: `WO ${wo.woNumber} approved`, performedById: req.user?.employeeDbId });

    // Notify assigned employee about approval
    if (wo.assignedToId) notify({ type: "WO_STATUS", title: "Work Order Approved", message: `WO ${wo.woNumber} approved, you can start work`, recipientIds: [wo.assignedToId], channel: "BOTH", templateCode: "WO_ASSIGNED", templateData: { woNumber: wo.woNumber, woType: wo.woType || '', assetName: '', description: wo.description || '' } });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
export const startWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (wo.status !== "APPROVED") {
      res.status(400).json({ message: `Cannot start work order in ${wo.status} status` });
      return;
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: { status: "IN_PROGRESS", actualStart: new Date() },
    });

    logAction({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} started`, performedById: req.user?.employeeDbId });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// ISSUE MATERIAL
// ═══════════════════════════════════════════════════════════
export const issueMaterial = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workOrderId = Number(req.params.id);
    const { storeId, issueType, sparePartId, consumableId, description, quantity, unitCost } = req.body;

    if (!storeId || !issueType || !quantity) {
      res.status(400).json({ message: "storeId, issueType, and quantity are required" });
      return;
    }

    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (!["IN_PROGRESS", "PENDING_MATERIAL", "APPROVED"].includes(wo.status)) {
      res.status(400).json({ message: `Cannot issue material for work order in ${wo.status} status` });
      return;
    }

    const qty = new Prisma.Decimal(quantity);
    const uCost = unitCost ? new Prisma.Decimal(unitCost) : new Prisma.Decimal(0);
    const totalCost = qty.mul(uCost);

    // Check stock availability
    const stockWhere: Prisma.StoreStockPositionWhereInput = {
      storeId: Number(storeId),
      itemType: issueType,
      ...(issueType === "SPARE_PART" ? { sparePartId: Number(sparePartId) } : {}),
      ...(issueType === "CONSUMABLE" ? { consumableId: Number(consumableId) } : {}),
    };

    const stock = await prisma.storeStockPosition.findFirst({ where: stockWhere });
    if (!stock || stock.availableQty.lessThan(qty)) {
      res.status(400).json({
        message: "Insufficient stock",
        available: stock?.availableQty?.toString() ?? "0",
        requested: qty.toString(),
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create MaterialIssue
      const materialIssue = await tx.materialIssue.create({
        data: {
          workOrderId,
          storeId: Number(storeId),
          issueType,
          sparePartId: sparePartId ? Number(sparePartId) : null,
          consumableId: consumableId ? Number(consumableId) : null,
          description: description || null,
          quantity: qty,
          unitCost: uCost,
          totalCost,
          issuedById: req.user?.employeeDbId ?? null,
        },
      });

      // Create InventoryTransaction
      const invTx = await tx.inventoryTransaction.create({
        data: {
          type: "OUT",
          sparePartId: sparePartId ? Number(sparePartId) : null,
          consumableId: consumableId ? Number(consumableId) : null,
          quantity: qty,
          referenceType: "WORK_ORDER",
          referenceId: workOrderId,
          storeId: Number(storeId),
          workOrderId,
          performedById: req.user?.employeeDbId ?? null,
          notes: `Material issued for WO ${wo.woNumber}`,
        },
      });

      // Update MaterialIssue with transaction id
      await tx.materialIssue.update({
        where: { id: materialIssue.id },
        data: { inventoryTransactionId: invTx.id },
      });

      // Decrement stock
      await tx.storeStockPosition.update({
        where: { id: stock.id },
        data: {
          currentQty: { decrement: qty },
          availableQty: { decrement: qty },
          lastUpdatedAt: new Date(),
        },
      });

      return materialIssue;
    });

    logAction({ entityType: "WORK_ORDER", entityId: workOrderId, action: "UPDATE", description: `Material issued for WO ${wo.woNumber} (${issueType}, qty ${quantity})`, performedById: req.user?.employeeDbId });

    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// COMPLETE
// ═══════════════════════════════════════════════════════════
export const completeWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: { materialIssues: true },
    });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (wo.status !== "IN_PROGRESS" && wo.status !== "PENDING_MATERIAL") {
      res.status(400).json({ message: `Cannot complete work order in ${wo.status} status` });
      return;
    }

    // Calculate actual cost
    const materialTotal = wo.materialIssues.reduce(
      (sum, mi) => sum.add(mi.totalCost ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );
    const laborCost = wo.laborCost ?? new Prisma.Decimal(0);
    const nonMaterialCost = wo.nonMaterialCost ?? new Prisma.Decimal(0);
    const actualCost = materialTotal.add(laborCost).add(nonMaterialCost);

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: "WORK_COMPLETED",
        actualEnd: new Date(),
        actualCost,
      },
    });

    logAction({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} completed, actual cost ${actualCost}`, performedById: req.user?.employeeDbId });

    // Notify HODs that work order is completed, pending WCC
    const completionHodIds = await getDepartmentHODs(wo.departmentId);
    notify({ type: "WO_STATUS", title: "Work Order Completed", message: `WO ${wo.woNumber} completed, pending WCC`, recipientIds: completionHodIds, assetId: wo.assetId ?? undefined, channel: "BOTH", templateCode: "WO_COMPLETED", templateData: { woNumber: wo.woNumber, actualCost: actualCost.toString() } });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// ISSUE WCC
// ═══════════════════════════════════════════════════════════
export const issueWCC = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workOrderId = Number(req.params.id);
    const {
      workSummary,
      materialsUsedSummary,
      totalLaborCost,
      totalMaterialCost,
      qualityCheckStatus,
      qualityRemarks,
      certifiedById,
    } = req.body;

    if (!workSummary) {
      res.status(400).json({ message: "workSummary is required" });
      return;
    }

    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (wo.status !== "WORK_COMPLETED") {
      res.status(400).json({ message: `Cannot issue WCC for work order in ${wo.status} status` });
      return;
    }

    const existingWcc = await prisma.workCompletionCertificate.findUnique({ where: { workOrderId } });
    if (existingWcc) {
      res.status(400).json({ message: "WCC already issued for this work order" });
      return;
    }

    const wccNumber = await generateWccNumber();
    const labor = totalLaborCost ? new Prisma.Decimal(totalLaborCost) : new Prisma.Decimal(0);
    const material = totalMaterialCost ? new Prisma.Decimal(totalMaterialCost) : new Prisma.Decimal(0);
    const totalCost = labor.add(material);

    const result = await prisma.$transaction(async (tx) => {
      // Create WCC
      const wcc = await tx.workCompletionCertificate.create({
        data: {
          workOrderId,
          wccNumber,
          workSummary,
          materialsUsedSummary: materialsUsedSummary || null,
          totalLaborCost: labor,
          totalMaterialCost: material,
          totalCost,
          qualityCheckStatus: qualityCheckStatus || null,
          qualityRemarks: qualityRemarks || null,
          certifiedById: certifiedById ? Number(certifiedById) : req.user?.employeeDbId ?? null,
          certifiedAt: new Date(),
          createdById: req.user?.employeeDbId ?? null,
        },
      });

      // Update WO status
      const woUpdate: any = { status: "WCC_ISSUED" };

      // CAPEX capitalization
      if (wo.woType === "CAPEX" && wo.capitalizeAsAsset === true && wo.assetCategoryId) {
        const assetId = await generateAssetId(tx);
        const newAsset = await tx.asset.create({
          data: {
            assetId,
            assetName: `Asset from ${wo.woNumber}`,
            assetType: "CAPEX",
            assetCategoryId: wo.assetCategoryId,
            serialNumber: `SN-${wo.woNumber}-${Date.now()}`,
            purchaseCost: totalCost,
            sourceType: "WORK_ORDER_CAPEX",
            sourceReference: wo.woNumber,
            status: "ACTIVE",
            workOrderCapexId: wo.id,
            createdById: req.user?.employeeDbId ?? null,
          },
        });
        woUpdate.capitalizedAssetId = newAsset.id;
      }

      await tx.workOrder.update({ where: { id: workOrderId }, data: woUpdate });

      return wcc;
    });

    logAction({ entityType: "WORK_ORDER", entityId: workOrderId, action: "STATUS_CHANGE", description: `WCC ${result.wccNumber} issued for WO ${wo.woNumber}`, performedById: req.user?.employeeDbId });

    // Notify WO creator that WCC has been issued
    notify({ type: "WO_STATUS", title: "WCC Issued", message: `WCC ${result.wccNumber} issued for WO ${wo.woNumber}`, recipientIds: [wo.createdById].filter(Boolean) as number[], channel: "BOTH", templateCode: "WCC_ISSUED", templateData: { wccNumber: result.wccNumber, woNumber: wo.woNumber, totalCost: totalCost.toString(), qualityStatus: qualityCheckStatus || '' } });

    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// CLOSE
// ═══════════════════════════════════════════════════════════
export const closeWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (wo.status !== "WCC_ISSUED" && wo.status !== "WORK_COMPLETED") {
      res.status(400).json({ message: `Cannot close work order in ${wo.status} status` });
      return;
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: { status: "CLOSED" },
    });

    logAction({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} closed`, performedById: req.user?.employeeDbId });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════════
export const cancelWorkOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) { res.status(404).json({ message: "Work order not found" }); return; }
    if (["CLOSED", "CANCELLED"].includes(wo.status)) {
      res.status(400).json({ message: `Cannot cancel work order in ${wo.status} status` });
      return;
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    logAction({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} cancelled`, performedById: req.user?.employeeDbId });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";
import { generateAssetId } from "../../utilis/assetIdGenerator";

// ── Helpers ──────────────────────────────────────────────────────────

function mustUser(req: AuthenticatedRequest) {
  const u = (req as any).user;
  if (!u?.employeeDbId) throw new Error("Unauthorized");
  return u as { employeeDbId: number; employeeID: string; name?: string; role: string; departmentId?: number };
}

async function generateGRNNumber(): Promise<string> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const fyStartYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEndYear = fyStartYear + 1;
  const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;

  const latest = await prisma.goodsReceipt.findFirst({
    where: { grnNumber: { startsWith: `GRN-${fyString}` } },
    orderBy: { id: "desc" },
  });

  let seq = 1;
  if (latest) {
    const parts = latest.grnNumber.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `GRN-${fyString}-${seq.toString().padStart(3, "0")}`;
}

// ── GET / ────────────────────────────────────────────────────────────

export const getAllGoodsReceipts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, purchaseOrderId, page, limit: lim } = req.query;
    const user = (req as any).user;

    const where: any = {};
    if (status) where.status = String(status);
    if (purchaseOrderId) where.purchaseOrderId = Number(purchaseOrderId);

    // Department-based scoping for non-admin users via linked PO
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId) {
      const deptPOs = await prisma.purchaseOrder.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      const poIds = deptPOs.map(po => po.id);
      where.purchaseOrderId = where.purchaseOrderId
        ? where.purchaseOrderId
        : { in: poIds };
    }

    const pageNum = page ? parseInt(String(page)) : 1;
    const take = lim ? parseInt(String(lim)) : 20;
    const skip = (pageNum - 1) * take;

    const [total, receipts] = await Promise.all([
      prisma.goodsReceipt.count({ where }),
      prisma.goodsReceipt.findMany({
        where,
        include: {
          purchaseOrder: { select: { id: true, poNumber: true } },
          vendor: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: { id: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({ data: receipts, total, page: pageNum, limit: take });
  } catch (error: any) {
    console.error("getAllGoodsReceipts error:", error);
    res.status(500).json({ message: "Failed to fetch goods receipts" });
  }
};

// ── GET /:id ─────────────────────────────────────────────────────────

export const getGoodsReceiptById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const gra = await prisma.goodsReceipt.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        purchaseOrder: {
          select: { id: true, poNumber: true, poDate: true, status: true, vendorId: true },
        },
        vendor: { select: { id: true, name: true, contact: true, email: true } },
        lines: {
          include: {
            poLine: { select: { id: true, lineNumber: true, description: true, quantity: true, receivedQty: true } },
          },
        },
      },
    });

    if (!gra) {
      res.status(404).json({ message: "Goods receipt not found" });
      return;
    }
    res.json(gra);
  } catch (error: any) {
    console.error("getGoodsReceiptById error:", error);
    res.status(500).json({ message: "Failed to fetch goods receipt" });
  }
};

// ── POST / ───────────────────────────────────────────────────────────

export const createGoodsReceipt = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const {
      purchaseOrderId,
      vendorId,
      deliveryChallanNo,
      deliveryDate,
      invoiceNumber,
      invoiceDate,
      invoiceValue,
      notes,
      lines,
    } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ message: "At least one line is required" });
      return;
    }

    const grnNumber = await generateGRNNumber();

    let totalValue = 0;
    const lineData = lines.map((l: any) => {
      const receivedQty = Number(l.receivedQty);
      const price = l.unitPrice ? Number(l.unitPrice) : 0;
      const lineTotal = receivedQty * price;
      totalValue += lineTotal;

      return {
        poLineId: l.poLineId ? Number(l.poLineId) : null,
        itemType: l.itemType,
        description: l.description,
        receivedQty,
        storeId: l.storeId ? Number(l.storeId) : null,
        unitPrice: l.unitPrice ? Number(l.unitPrice) : null,
        lineTotal: lineTotal || null,
        serialNumber: l.serialNumber ?? null,
        inspectionStatus: l.inspectionStatus ?? null,
        inspectionRemarks: l.inspectionRemarks ?? null,
      };
    });

    const gra = await prisma.$transaction(async (tx) => {
      const created = await tx.goodsReceipt.create({
        data: {
          grnNumber,
          purchaseOrderId: purchaseOrderId ? Number(purchaseOrderId) : null,
          vendorId: vendorId ? Number(vendorId) : null,
          deliveryChallanNo: deliveryChallanNo ?? null,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          invoiceNumber: invoiceNumber ?? null,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
          invoiceValue: invoiceValue ? Number(invoiceValue) : null,
          totalValue,
          notes: notes ?? null,
          status: "DRAFT",
          receivedById: user.employeeDbId,
          createdById: user.employeeDbId,
          lines: {
            create: lineData,
          },
        },
        include: { lines: true },
      });

      // Update PO line receivedQty if linked to a PO
      if (purchaseOrderId) {
        for (const line of lineData) {
          if (line.poLineId) {
            await tx.purchaseOrderLine.update({
              where: { id: line.poLineId },
              data: {
                receivedQty: { increment: line.receivedQty },
                pendingQty: { decrement: line.receivedQty },
              },
            });
          }
        }
      }

      return created;
    });

    logAction({ entityType: "GOODS_RECEIPT", entityId: gra.id, action: "CREATE", description: `GRA ${gra.grnNumber} created`, performedById: user.employeeDbId });

    // Notify admins about new GRA
    const adminIds = await getAdminIds();
    notify({ type: "GRA_ACCEPTED", title: "New GRA Received", message: `GRA ${gra.grnNumber} received, pending inspection`, recipientIds: adminIds, createdById: user.employeeDbId });

    res.status(201).json(gra);
  } catch (error: any) {
    console.error("createGoodsReceipt error:", error);
    res.status(400).json({ message: error.message || "Failed to create goods receipt" });
  }
};

// ── PATCH /:id/inspect ───────────────────────────────────────────────

export const inspectGRA = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const graId = Number(req.params.id);
    const { inspectedById, inspectionRemarks, lines } = req.body;

    const gra = await prisma.goodsReceipt.findUnique({
      where: { id: graId },
      include: { lines: true },
    });
    if (!gra) {
      res.status(404).json({ message: "Goods receipt not found" });
      return;
    }

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ message: "Inspection lines are required" });
      return;
    }

    let allPassed = true;
    let anyPassed = false;

    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await tx.goodsReceiptLine.update({
          where: { id: Number(line.lineId) },
          data: {
            inspectionStatus: line.inspectionStatus,
            inspectionRemarks: line.inspectionRemarks ?? null,
            acceptedQty: line.acceptedQty ? Number(line.acceptedQty) : 0,
            rejectedQty: line.rejectedQty ? Number(line.rejectedQty) : 0,
          },
        });

        if (line.inspectionStatus === "FAIL") {
          allPassed = false;
        } else {
          anyPassed = true;
        }
      }

      const newStatus = allPassed ? "INSPECTION_PASSED" : anyPassed ? "INSPECTION_PASSED" : "INSPECTION_FAILED";

      await tx.goodsReceipt.update({
        where: { id: graId },
        data: {
          inspectedById: Number(inspectedById),
          inspectedAt: new Date(),
          inspectionRemarks: inspectionRemarks ?? null,
          status: newStatus,
        },
      });
    });

    const updated = await prisma.goodsReceipt.findUnique({
      where: { id: graId },
      include: { lines: true },
    });

    logAction({ entityType: "GOODS_RECEIPT", entityId: graId, action: "UPDATE", description: `GRA ${gra.grnNumber} inspected`, performedById: (req as any).user?.employeeDbId });

    // Notify GRA creator of inspection outcome
    if (gra.createdById) {
      notify({ type: "GRA_ACCEPTED", title: `GRA Inspection ${allPassed || anyPassed ? "Passed" : "Failed"}`, message: `GRA ${gra.grnNumber} inspection ${allPassed ? "passed" : anyPassed ? "partially passed" : "failed"}${inspectionRemarks ? `. Remarks: ${inspectionRemarks}` : ""}`, recipientIds: [gra.createdById], createdById: (req as any).user?.employeeDbId });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("inspectGRA error:", error);
    res.status(400).json({ message: error.message || "Failed to inspect goods receipt" });
  }
};

// ── PATCH /:id/accept ────────────────────────────────────────────────

export const acceptGRA = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const graId = Number(req.params.id);

    const gra = await prisma.goodsReceipt.findUnique({
      where: { id: graId },
      include: {
        lines: true,
        purchaseOrder: {
          include: { lines: true },
        },
      },
    });

    if (!gra) {
      res.status(404).json({ message: "Goods receipt not found" });
      return;
    }

    // Check TenantConfig for auto-create asset
    const autoCreateCfg = await prisma.tenantConfig.findUnique({
      where: { key: "AUTO_CREATE_ASSET_ON_GRA" },
    });
    const autoCreateAsset = autoCreateCfg?.value === "true";

    await prisma.$transaction(async (tx) => {
      // 1. Set GRA status to ACCEPTED
      await tx.goodsReceipt.update({
        where: { id: graId },
        data: { status: "ACCEPTED" },
      });

      // 2. Process each line
      for (const line of gra.lines) {
        const acceptedQty = line.acceptedQty > 0 ? line.acceptedQty : line.receivedQty;

        if (line.itemType === "ASSET" && autoCreateAsset) {
          // Auto-create asset records
          const po = gra.purchaseOrder;
          const poLine = po?.lines?.find((pl: any) => pl.id === line.poLineId);

          for (let i = 0; i < acceptedQty; i++) {
            // Generate assetId
            const assetId = await generateAssetId(undefined, tx, { categoryId: poLine?.assetCategoryId ?? null });

            // Generate unique serial number if not provided
            const serialNumber = line.serialNumber && acceptedQty === 1
              ? line.serialNumber
              : `${gra.grnNumber}-L${line.id}-${(i + 1).toString().padStart(2, "0")}`;

            const asset = await tx.asset.create({
              data: {
                assetId,
                assetName: line.description,
                assetType: "EQUIPMENT",
                serialNumber,
                purchaseOrderId: gra.purchaseOrderId ?? null,
                goodsReceiptId: gra.id,
                purchaseOrderNo: po?.poNumber ?? null,
                grnNumber: gra.grnNumber,
                purchaseCost: line.unitPrice ?? null,
                vendorId: po?.vendorId ?? gra.vendorId ?? null,
                status: "IN_STORE",
                sourceType: "INTERNAL_PO_GRA",
                sourceReference: gra.grnNumber,
                assetCategoryId: poLine?.assetCategoryId ?? 1,
              },
            });

            // Set createdAssetId on the line (last created asset for multi-qty)
            if (i === acceptedQty - 1) {
              await tx.goodsReceiptLine.update({
                where: { id: line.id },
                data: { createdAssetId: asset.id },
              });
            }
          }
        } else if ((line.itemType === "SPARE_PART" || line.itemType === "CONSUMABLE") && acceptedQty > 0) {
          // 3. Create InventoryTransaction + update StoreStockPosition
          const spId = line.itemType === "SPARE_PART" && line.poLineId
            ? (gra.purchaseOrder?.lines?.find((pl: any) => pl.id === line.poLineId)?.sparePartId ?? null)
            : null;
          const conId = line.itemType === "CONSUMABLE" && line.poLineId
            ? (gra.purchaseOrder?.lines?.find((pl: any) => pl.id === line.poLineId)?.consumableId ?? null)
            : null;

          await tx.inventoryTransaction.create({
            data: {
              type: "IN",
              sparePartId: spId,
              consumableId: conId,
              quantity: acceptedQty,
              referenceType: "GRA",
              referenceId: gra.id,
              storeId: line.storeId ?? null,
              performedById: user.employeeDbId,
              notes: `Auto-created from GRA ${gra.grnNumber}, line ${line.id}`,
            },
          });

          // Update StoreStockPosition (upsert: create if not exists, increment if exists)
          if (line.storeId && (spId || conId)) {
            const existingStock = await tx.storeStockPosition.findFirst({
              where: {
                storeId: line.storeId,
                itemType: line.itemType,
                ...(spId ? { sparePartId: spId } : {}),
                ...(conId ? { consumableId: conId } : {}),
              },
            });

            if (existingStock) {
              await tx.storeStockPosition.update({
                where: { id: existingStock.id },
                data: {
                  currentQty: { increment: acceptedQty },
                  availableQty: { increment: acceptedQty },
                  lastUpdatedAt: new Date(),
                },
              });
            } else {
              await tx.storeStockPosition.create({
                data: {
                  storeId: line.storeId,
                  itemType: line.itemType,
                  sparePartId: spId,
                  consumableId: conId,
                  currentQty: acceptedQty,
                  availableQty: acceptedQty,
                },
              });
            }
          }

          // Also update SparePart.stockQuantity or Consumable.stockQuantity
          if (spId) {
            await tx.sparePart.update({
              where: { id: spId },
              data: { stockQuantity: { increment: acceptedQty } },
            });
          }
          if (conId) {
            await tx.consumable.update({
              where: { id: conId },
              data: { stockQuantity: { increment: acceptedQty } },
            });
          }
        }
      }

      // 4. Update PO status if linked
      if (gra.purchaseOrderId && gra.purchaseOrder) {
        // Update PO line receivedQty values
        for (const line of gra.lines) {
          if (line.poLineId) {
            const acceptedQty = line.acceptedQty > 0 ? line.acceptedQty : line.receivedQty;
            // receivedQty was already incremented on GRA creation; no double-count needed here
          }
        }

        // Check if all PO lines are fully received
        const poLines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: gra.purchaseOrderId },
        });

        const allFullyReceived = poLines.every((pl) => pl.receivedQty >= pl.quantity);
        const anyReceived = poLines.some((pl) => pl.receivedQty > 0);

        if (allFullyReceived) {
          await tx.purchaseOrder.update({
            where: { id: gra.purchaseOrderId },
            data: { status: "FULLY_RECEIVED" },
          });
        } else if (anyReceived) {
          await tx.purchaseOrder.update({
            where: { id: gra.purchaseOrderId },
            data: { status: "PARTIALLY_RECEIVED" },
          });
        }
      }
    });

    const result = await prisma.goodsReceipt.findUnique({
      where: { id: graId },
      include: { lines: true },
    });

    const assetLineCount = gra.lines.filter(l => l.itemType === "ASSET").reduce((sum, l) => sum + (l.acceptedQty > 0 ? l.acceptedQty : l.receivedQty), 0);
    logAction({ entityType: "GOODS_RECEIPT", entityId: graId, action: "APPROVE", description: `GRA ${gra.grnNumber} accepted${assetLineCount > 0 ? `, ${assetLineCount} asset(s) auto-created` : ""}`, performedById: user.employeeDbId });

    // ── Auto-create Purchase Voucher if accounts module is enabled ────────────
    const accountsCfg = await prisma.tenantConfig.findUnique({ where: { key: "ACCOUNTS_MODULE_ENABLED" } });
    if (accountsCfg?.value === "true") {
      try {
        const totalAmount = gra.lines.reduce((sum: number, l: any) => sum + (Number(l.unitPrice ?? 0) * (l.acceptedQty > 0 ? l.acceptedQty : l.receivedQty)), 0);
        // generate PV number
        const now = new Date();
        const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEnd = fyStart + 1;
        const fy = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
        const latestPV = await (prisma as any).purchaseVoucher.findFirst({ where: { voucherNo: { startsWith: `PV-${fy}` } }, orderBy: { id: "desc" } });
        let pvSeq = 1;
        if (latestPV) { const parts = latestPV.voucherNo.split("-"); const last = parseInt(parts[parts.length - 1], 10); if (!isNaN(last)) pvSeq = last + 1; }
        const pvNumber = `PV-${fy}-${pvSeq.toString().padStart(3, "0")}`;

        await (prisma as any).purchaseVoucher.create({
          data: {
            voucherNo: pvNumber,
            voucherDate: new Date(),
            amount: totalAmount,
            narration: `Auto-created from GRA ${gra.grnNumber}`,
            goodsReceiptId: graId,
            vendorId: (gra as any).vendorId ?? null,
            invoiceNo: (gra as any).invoiceNumber ?? null,
            status: "DRAFT",
            createdById: user.employeeDbId,
          } as any,
        });
      } catch (pvErr) {
        console.error("Auto-PV creation failed (non-blocking):", pvErr);
      }
    }

    // Notify GRA creator that GRA is accepted
    notify({ type: "GRA_ACCEPTED", title: "GRA Accepted", message: `GRA ${gra.grnNumber} accepted.${assetLineCount > 0 ? ` ${assetLineCount} asset(s) created.` : ""}`, recipientIds: [gra.createdById].filter(Boolean) as number[], createdById: user.employeeDbId, channel: "BOTH" });

    res.json(result);
  } catch (error: any) {
    console.error("acceptGRA error:", error);
    res.status(400).json({ message: error.message || "Failed to accept goods receipt" });
  }
};

// ── PATCH /:id/reject ────────────────────────────────────────────────

export const rejectGRA = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const graId = Number(req.params.id);

    const gra = await prisma.goodsReceipt.findUnique({ where: { id: graId } });
    if (!gra) {
      res.status(404).json({ message: "Goods receipt not found" });
      return;
    }

    const updated = await prisma.goodsReceipt.update({
      where: { id: graId },
      data: { status: "REJECTED" },
    });

    logAction({ entityType: "GOODS_RECEIPT", entityId: graId, action: "STATUS_CHANGE", description: `GRA ${gra.grnNumber} rejected`, performedById: (req as any).user?.employeeDbId });

    // Notify GRA creator about rejection
    if (gra.createdById) {
      notify({ type: "GRA_ACCEPTED", title: "GRA Rejected", message: `GRA ${gra.grnNumber} has been rejected`, recipientIds: [gra.createdById], createdById: (req as any).user?.employeeDbId });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("rejectGRA error:", error);
    res.status(400).json({ message: error.message || "Failed to reject goods receipt" });
  }
};

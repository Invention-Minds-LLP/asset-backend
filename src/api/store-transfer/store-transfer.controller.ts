import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

// ─── helpers ───────────────────────────────────────────────
function getFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 4
    ? `${now.getFullYear().toString().slice(2)}${(now.getFullYear() + 1).toString().slice(2)}`
    : `${(now.getFullYear() - 1).toString().slice(2)}${now.getFullYear().toString().slice(2)}`;
}

async function generateTransferNumber(): Promise<string> {
  const fy = getFY();
  const prefix = `ST-FY${fy}-`;
  const last = await prisma.storeTransfer.findFirst({
    where: { transferNumber: { startsWith: prefix } },
    orderBy: { transferNumber: "desc" },
  });
  const seq = last ? parseInt(last.transferNumber.replace(prefix, ""), 10) + 1 : 1;
  return `${prefix}${seq.toString().padStart(5, "0")}`;
}

// ═══════════════════════════════════════════════════════════
// GET ALL (paginated + filters)
// ═══════════════════════════════════════════════════════════
export const getAllTransfers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, fromStoreId, toStoreId, transferType, page = "1", limit = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.StoreTransferWhereInput = {};
    if (status) where.status = String(status);
    if (fromStoreId) where.fromStoreId = Number(fromStoreId);
    if (toStoreId) where.toStoreId = Number(toStoreId);
    if (transferType) where.transferType = String(transferType);

    const [data, total] = await Promise.all([
      prisma.storeTransfer.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { id: "desc" },
        include: {
          fromStore: { select: { id: true, name: true } },
          toStore: { select: { id: true, name: true } },
          items: true,
        },
      }),
      prisma.storeTransfer.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET BY ID
// ═══════════════════════════════════════════════════════════
export const getTransferById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const transfer = await prisma.storeTransfer.findUnique({
      where: { id },
      include: {
        fromStore: { select: { id: true, name: true, code: true } },
        toStore: { select: { id: true, name: true, code: true } },
        items: true,
      },
    });
    if (!transfer) {
      res.status(404).json({ message: "Store transfer not found" });
      return;
    }
    res.json(transfer);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════
export const createTransfer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fromStoreId, toStoreId, toDepartmentId, transferType, remarks, items } = req.body;

    if (!fromStoreId || !toStoreId || !transferType || !items?.length) {
      res.status(400).json({ message: "fromStoreId, toStoreId, transferType, and items are required" });
      return;
    }

    // Validate stock availability for each item
    for (const item of items) {
      if (item.itemType === "SPARE_PART" || item.itemType === "CONSUMABLE") {
        const stockWhere: Prisma.StoreStockPositionWhereInput = {
          storeId: Number(fromStoreId),
          itemType: item.itemType,
          ...(item.itemType === "SPARE_PART" ? { sparePartId: Number(item.sparePartId) } : {}),
          ...(item.itemType === "CONSUMABLE" ? { consumableId: Number(item.consumableId) } : {}),
        };

        const stock = await prisma.storeStockPosition.findFirst({ where: stockWhere });
        const requestedQty = new Prisma.Decimal(item.quantity);

        if (!stock || stock.availableQty.lessThan(requestedQty)) {
          res.status(400).json({
            message: `Insufficient stock for ${item.itemType} (ID: ${item.sparePartId || item.consumableId})`,
            available: stock?.availableQty?.toString() ?? "0",
            requested: requestedQty.toString(),
          });
          return;
        }
      }
    }

    const transferNumber = await generateTransferNumber();

    const transfer = await prisma.storeTransfer.create({
      data: {
        transferNumber,
        fromStoreId: Number(fromStoreId),
        toStoreId: Number(toStoreId),
        toDepartmentId: toDepartmentId ? Number(toDepartmentId) : null,
        transferType,
        status: "REQUESTED",
        requestedById: req.user?.employeeDbId ?? null,
        remarks: remarks || null,
        items: {
          create: items.map((item: any) => ({
            itemType: item.itemType,
            sparePartId: item.sparePartId ? Number(item.sparePartId) : null,
            consumableId: item.consumableId ? Number(item.consumableId) : null,
            assetId: item.assetId ? Number(item.assetId) : null,
            quantity: new Prisma.Decimal(item.quantity),
          })),
        },
      },
      include: {
        items: true,
        fromStore: { select: { id: true, name: true } },
        toStore: { select: { id: true, name: true } },
      },
    });

    logAction({ entityType: "STORE_TRANSFER", entityId: transfer.id, action: "CREATE", description: `Store transfer ${transfer.transferNumber} created (${transferType})`, performedById: req.user?.employeeDbId });

    // Notify admins about new store transfer request
    const adminIds = await getAdminIds();
    notify({ type: "TRANSFER", title: "Store Transfer Requested", message: `Store transfer ${transfer.transferNumber} (${transferType}) requested`, recipientIds: adminIds, createdById: req.user?.employeeDbId });

    res.status(201).json(transfer);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════════
export const approveTransfer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { approvedById } = req.body;

    const transfer = await prisma.storeTransfer.findUnique({ where: { id } });
    if (!transfer) { res.status(404).json({ message: "Store transfer not found" }); return; }
    if (transfer.status !== "REQUESTED") {
      res.status(400).json({ message: `Cannot approve transfer in ${transfer.status} status` });
      return;
    }

    const updated = await prisma.storeTransfer.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: approvedById ? Number(approvedById) : req.user?.employeeDbId ?? null,
        approvedAt: new Date(),
      },
    });

    logAction({ entityType: "STORE_TRANSFER", entityId: id, action: "APPROVE", description: `Store transfer ${transfer.transferNumber} approved`, performedById: req.user?.employeeDbId });

    // Notify requester that transfer is approved
    if (transfer.requestedById) notify({ type: "TRANSFER", title: "Store Transfer Approved", message: `Store transfer ${transfer.transferNumber} has been approved`, recipientIds: [transfer.requestedById] });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// MARK IN TRANSIT
// ═══════════════════════════════════════════════════════════
export const markInTransit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const transfer = await prisma.storeTransfer.findUnique({ where: { id } });
    if (!transfer) { res.status(404).json({ message: "Store transfer not found" }); return; }
    if (transfer.status !== "APPROVED") {
      res.status(400).json({ message: `Cannot mark in-transit for transfer in ${transfer.status} status` });
      return;
    }

    const updated = await prisma.storeTransfer.update({
      where: { id },
      data: { status: "IN_TRANSIT" },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// RECEIVE
// ═══════════════════════════════════════════════════════════
export const receiveTransfer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { receivedById, items: receivedItems } = req.body;

    const transfer = await prisma.storeTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!transfer) { res.status(404).json({ message: "Store transfer not found" }); return; }
    if (transfer.status !== "IN_TRANSIT" && transfer.status !== "APPROVED") {
      res.status(400).json({ message: `Cannot receive transfer in ${transfer.status} status` });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update transfer header
      await tx.storeTransfer.update({
        where: { id },
        data: {
          status: "RECEIVED",
          receivedById: receivedById ? Number(receivedById) : req.user?.employeeDbId ?? null,
          receivedAt: new Date(),
        },
      });

      for (const transferItem of transfer.items) {
        // Find matching received item for receivedQty
        const receivedItem = receivedItems?.find((ri: any) => ri.itemId === transferItem.id);
        const receivedQty = receivedItem
          ? new Prisma.Decimal(receivedItem.receivedQty)
          : transferItem.quantity;

        // Update receivedQty on transfer item
        await tx.storeTransferItem.update({
          where: { id: transferItem.id },
          data: { receivedQty },
        });

        // Create OUT transaction from source store
        await tx.inventoryTransaction.create({
          data: {
            type: "OUT",
            sparePartId: transferItem.sparePartId,
            consumableId: transferItem.consumableId,
            quantity: receivedQty,
            referenceType: "STORE_TRANSFER",
            referenceId: transfer.id,
            storeId: transfer.fromStoreId,
            storeTransferId: transfer.id,
            performedById: req.user?.employeeDbId ?? null,
            notes: `Transfer OUT - ${transfer.transferNumber}`,
          },
        });

        // Create IN transaction to destination store
        await tx.inventoryTransaction.create({
          data: {
            type: "IN",
            sparePartId: transferItem.sparePartId,
            consumableId: transferItem.consumableId,
            quantity: receivedQty,
            referenceType: "STORE_TRANSFER",
            referenceId: transfer.id,
            storeId: transfer.toStoreId,
            storeTransferId: transfer.id,
            performedById: req.user?.employeeDbId ?? null,
            notes: `Transfer IN - ${transfer.transferNumber}`,
          },
        });

        // Update StoreStockPosition for source (decrement)
        if (transferItem.itemType === "SPARE_PART" || transferItem.itemType === "CONSUMABLE") {
          const fromStock = await tx.storeStockPosition.findFirst({
            where: {
              storeId: transfer.fromStoreId,
              itemType: transferItem.itemType,
              ...(transferItem.itemType === "SPARE_PART" ? { sparePartId: transferItem.sparePartId } : {}),
              ...(transferItem.itemType === "CONSUMABLE" ? { consumableId: transferItem.consumableId } : {}),
            },
          });

          if (fromStock) {
            await tx.storeStockPosition.update({
              where: { id: fromStock.id },
              data: {
                currentQty: { decrement: receivedQty },
                availableQty: { decrement: receivedQty },
                lastUpdatedAt: new Date(),
              },
            });
          }

          // Update or create StoreStockPosition for destination (increment)
          const toStock = await tx.storeStockPosition.findFirst({
            where: {
              storeId: transfer.toStoreId,
              itemType: transferItem.itemType,
              ...(transferItem.itemType === "SPARE_PART" ? { sparePartId: transferItem.sparePartId } : {}),
              ...(transferItem.itemType === "CONSUMABLE" ? { consumableId: transferItem.consumableId } : {}),
            },
          });

          if (toStock) {
            await tx.storeStockPosition.update({
              where: { id: toStock.id },
              data: {
                currentQty: { increment: receivedQty },
                availableQty: { increment: receivedQty },
                lastUpdatedAt: new Date(),
              },
            });
          } else {
            await tx.storeStockPosition.create({
              data: {
                storeId: transfer.toStoreId,
                itemType: transferItem.itemType,
                sparePartId: transferItem.sparePartId,
                consumableId: transferItem.consumableId,
                currentQty: receivedQty,
                availableQty: receivedQty,
              },
            });
          }
        }

        // ASSET transfer: update asset status if STORE_TO_DEPARTMENT
        if (transferItem.itemType === "ASSET" && transfer.transferType === "STORE_TO_DEPARTMENT" && transferItem.assetId) {
          await tx.asset.update({
            where: { id: transferItem.assetId },
            data: { status: "ACTIVE" },
          });
        }
      }

      return tx.storeTransfer.findUnique({
        where: { id },
        include: { items: true },
      });
    });

    logAction({ entityType: "STORE_TRANSFER", entityId: id, action: "STATUS_CHANGE", description: `Store transfer ${transfer.transferNumber} received`, performedById: req.user?.employeeDbId });

    // Notify requester that transfer has been received
    if (transfer.requestedById) notify({ type: "TRANSFER", title: "Store Transfer Received", message: `Store transfer ${transfer.transferNumber} has been received`, recipientIds: [transfer.requestedById], channel: "BOTH" });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════════
export const cancelTransfer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const transfer = await prisma.storeTransfer.findUnique({ where: { id } });
    if (!transfer) { res.status(404).json({ message: "Store transfer not found" }); return; }
    if (["RECEIVED", "CANCELLED"].includes(transfer.status)) {
      res.status(400).json({ message: `Cannot cancel transfer in ${transfer.status} status` });
      return;
    }

    const updated = await prisma.storeTransfer.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

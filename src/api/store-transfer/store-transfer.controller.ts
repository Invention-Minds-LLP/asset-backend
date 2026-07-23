import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";
import { buildStoreAccessWhere } from "../store/store.controller";

const LEADERSHIP = ["ADMIN", "CEO_COO", "OPERATIONS"];

async function userIsStoreDept(user: any): Promise<boolean> {
  const deptId = user?.departmentId ? Number(user.departmentId) : null;
  if (!deptId) return false;
  const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { name: true } });
  return !!dept?.name?.toUpperCase().includes("STORE");
}

// Who may APPROVE a requested transfer = the custodian (HOD) of the SOURCE store.
async function canApproveTransfer(user: any, fromStoreId: number): Promise<boolean> {
  const role = user?.role;
  if (LEADERSHIP.includes(role)) return true;
  if (role !== "HOD") return false;
  const deptId = user?.departmentId ? Number(user.departmentId) : null;
  const src = await prisma.store.findUnique({ where: { id: fromStoreId }, select: { departmentId: true } });
  if (!src) return false;
  if (src.departmentId != null) return src.departmentId === deptId;        // HOD of source dept
  return await userIsStoreDept(user);                                       // main store → store-dept HOD
}

// Who may RECEIVE = the custodian (HOD/Supervisor) of the DESTINATION store/department.
async function canReceiveTransfer(user: any, t: { transferType: string; toStoreId: number | null; toDepartmentId: number | null }): Promise<boolean> {
  const role = user?.role;
  if (LEADERSHIP.includes(role)) return true;
  const deptId = user?.departmentId ? Number(user.departmentId) : null;
  if (!deptId) return false;
  const deptCustodian = role === "HOD" || role === "SUPERVISOR";
  if (t.transferType === "STORE_TO_DEPARTMENT") {
    return deptCustodian && t.toDepartmentId === deptId;                    // only the destination department's people
  }
  if (!t.toStoreId) return false;
  const dest = await prisma.store.findUnique({ where: { id: t.toStoreId }, select: { departmentId: true } });
  if (!dest) return false;
  if (dest.departmentId != null) return deptCustodian && dest.departmentId === deptId;
  return await userIsStoreDept(user);                                       // main store dest → store-dept
}

// ─── helpers ───────────────────────────────────────────────
class InsufficientStockError extends Error {
  available: string;
  requested: string;
  constructor(message: string, available: string, requested: string) {
    super(message);
    this.name = "InsufficientStockError";
    this.available = available;
    this.requested = requested;
  }
}

function getFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 4
    ? `${now.getFullYear().toString().slice(2)}${(now.getFullYear() + 1).toString().slice(2)}`
    : `${(now.getFullYear() - 1).toString().slice(2)}${now.getFullYear().toString().slice(2)}`;
}

export async function generateTransferNumber(): Promise<string> {
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

    // Scope: a dept user sees a transfer only when THEIR OWN store or department
    // is directly involved — not every transfer out of the (shared) main store.
    // So we match on the user's own department stores + their department id,
    // deliberately excluding main stores from the "involved" test.
    const access = await buildStoreAccessWhere(req.user);
    const seeAll = Object.keys(access).length === 0;
    if (!seeAll) {
      const deptId = (req.user as any)?.departmentId ? Number((req.user as any).departmentId) : null;
      if (!deptId) {
        where.id = -1; // no department → nothing
      } else {
        const ownStores = await prisma.store.findMany({ where: { departmentId: deptId }, select: { id: true } });
        const ownIds = ownStores.map((s) => s.id);
        where.OR = [
          { fromStoreId: { in: ownIds } },
          { toStoreId: { in: ownIds } },
          { toDepartmentId: deptId },
        ];
      }
    }

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

    // Attach destination department name for STORE_TO_DEPARTMENT rows (no relation
    // on the client yet, so resolve names in one extra query).
    const deptIds = [...new Set(data.map((t) => t.toDepartmentId).filter((x): x is number => x != null))];
    if (deptIds.length) {
      const depts = await prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } });
      const deptMap = new Map(depts.map((d) => [d.id, d]));
      for (const t of data as any[]) {
        t.toDepartment = t.toDepartmentId != null ? deptMap.get(t.toDepartmentId) ?? null : null;
      }
    }

    // Per-row action flags — computed here (full data + user context) so the UI
    // shows Approve/Receive only to the right custodian, matching the API guards.
    const meRole = (req.user as any)?.role;
    const meDept = (req.user as any)?.departmentId ? Number((req.user as any).departmentId) : null;
    const meIsStoreDept = await userIsStoreDept(req.user);
    const isLeader = LEADERSHIP.includes(meRole);
    const storeIds = [...new Set(data.flatMap((t) => [t.fromStoreId, t.toStoreId]).filter((x): x is number => x != null))];
    const storeDeptMap = new Map(
      (await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, departmentId: true } })).map((s) => [s.id, s.departmentId])
    );
    for (const t of data as any[]) {
      let canApprove = false;
      if (t.status === "REQUESTED") {
        if (isLeader) canApprove = true;
        else if (meRole === "HOD") {
          const srcDept = storeDeptMap.get(t.fromStoreId) ?? null;
          canApprove = srcDept != null ? srcDept === meDept : meIsStoreDept;
        }
      }
      let canReceive = false;
      if (t.status === "APPROVED" || t.status === "IN_TRANSIT") {
        if (isLeader) canReceive = true;
        else {
          const deptCustodian = meRole === "HOD" || meRole === "SUPERVISOR";
          if (t.transferType === "STORE_TO_DEPARTMENT") {
            canReceive = deptCustodian && t.toDepartmentId === meDept;
          } else {
            const destDept = t.toStoreId != null ? (storeDeptMap.get(t.toStoreId) ?? null) : null;
            canReceive = destDept != null ? (deptCustodian && destDept === meDept) : meIsStoreDept;
          }
        }
      }
      // Cancel: requester or source custodian, while not yet received/cancelled.
      let canCancel = false;
      if (!["RECEIVED", "CANCELLED"].includes(t.status)) {
        const isRequester = t.requestedById != null && t.requestedById === (req.user as any)?.employeeDbId;
        if (isRequester || isLeader) canCancel = true;
        else if (meRole === "HOD") {
          const srcDept = storeDeptMap.get(t.fromStoreId) ?? null;
          canCancel = srcDept != null ? srcDept === meDept : meIsStoreDept;
        }
      }
      t.canApprove = canApprove;
      t.canReceive = canReceive;
      t.canCancel = canCancel;
    }

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

    // Enrich each line item with a readable name + destination department name.
    const spIds = transfer.items.filter((i) => i.sparePartId).map((i) => i.sparePartId!);
    const cIds = transfer.items.filter((i) => i.consumableId).map((i) => i.consumableId!);
    const aIds = transfer.items.filter((i) => i.assetId).map((i) => i.assetId!);
    const [spares, consumables, assets, toDept] = await Promise.all([
      spIds.length ? prisma.sparePart.findMany({ where: { id: { in: spIds } }, select: { id: true, name: true, partNumber: true } }) : [],
      cIds.length ? prisma.consumable.findMany({ where: { id: { in: cIds } }, select: { id: true, name: true, unit: true } }) : [],
      aIds.length ? prisma.asset.findMany({ where: { id: { in: aIds } }, select: { id: true, assetName: true, assetId: true, manufacturer: true, modelNumber: true } }) : [],
      transfer.toDepartmentId ? prisma.department.findUnique({ where: { id: transfer.toDepartmentId }, select: { id: true, name: true } }) : null,
    ]);
    const spMap = new Map(spares.map((s) => [s.id, s]));
    const cMap = new Map(consumables.map((c) => [c.id, c]));
    const aMap = new Map(assets.map((a) => [a.id, a]));
    const items = transfer.items.map((i) => {
      let itemName = "";
      // Make / Model / Asset Number for traceability — only assets carry these.
      let make: string | null = null;
      let model: string | null = null;
      let assetNumber: string | null = null;
      if (i.itemType === "SPARE_PART" && i.sparePartId) {
        const sp = spMap.get(i.sparePartId);
        itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
      } else if (i.itemType === "CONSUMABLE" && i.consumableId) {
        const c = cMap.get(i.consumableId);
        itemName = c ? `${c.name}${c.unit ? ` (${c.unit})` : ""}` : "";
      } else if (i.itemType === "ASSET" && i.assetId) {
        const a = aMap.get(i.assetId);
        itemName = a ? `${a.assetName} (${a.assetId})` : "";
        make = a?.manufacturer ?? null;
        model = a?.modelNumber ?? null;
        assetNumber = a?.assetId ?? null;
      }
      return { ...i, itemName, make, model, assetNumber };
    });

    res.json({ ...transfer, items, toDepartment: toDept });
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

    if (!fromStoreId || !transferType || !items?.length) {
      res.status(400).json({ message: "fromStoreId, transferType, and items are required" });
      return;
    }

    // Enforce source ownership: admins/store-keepers can source from any store,
    // but a department user may only transfer FROM their own department's store.
    const access = await buildStoreAccessWhere(req.user);
    const canSourceAny = Object.keys(access).length === 0;
    if (!canSourceAny) {
      const deptId = (req.user as any)?.departmentId ? Number((req.user as any).departmentId) : null;
      const src = await prisma.store.findUnique({ where: { id: Number(fromStoreId) }, select: { departmentId: true } });
      if (!deptId || !src || src.departmentId !== deptId) {
        res.status(403).json({ message: "You can only transfer from your own department's store" });
        return;
      }
    }
    if (transferType === "STORE_TO_DEPARTMENT") {
      if (!toDepartmentId) {
        res.status(400).json({ message: "toDepartmentId is required for a Store-to-Department transfer" });
        return;
      }
    } else if (!toStoreId) {
      res.status(400).json({ message: "toStoreId is required for a Store-to-Store transfer" });
      return;
    }

    const transferNumber = await generateTransferNumber();

    // Auto-approve when raised by a HOD/admin (they own or control the source).
    // A supervisor's request stays REQUESTED until the source HOD approves it.
    const role = (req.user as any)?.role;
    const autoApprove = LEADERSHIP.includes(role) || role === "HOD";
    const meId = req.user?.employeeDbId ?? undefined;

    // Validate availability and reserve stock atomically so concurrent
    // transfers cannot oversell the same source stock.
    const transfer = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.itemType === "SPARE_PART" || item.itemType === "CONSUMABLE") {
          const stockWhere: Prisma.StoreStockPositionWhereInput = {
            storeId: Number(fromStoreId),
            itemType: item.itemType,
            ...(item.itemType === "SPARE_PART" ? { sparePartId: Number(item.sparePartId) } : {}),
            ...(item.itemType === "CONSUMABLE" ? { consumableId: Number(item.consumableId) } : {}),
          };

          const stock = await tx.storeStockPosition.findFirst({ where: stockWhere });
          const requestedQty = new Prisma.Decimal(item.quantity);

          if (!stock || stock.availableQty.lessThan(requestedQty)) {
            throw new InsufficientStockError(
              `Insufficient stock for ${item.itemType} (ID: ${item.sparePartId || item.consumableId})`,
              stock?.availableQty?.toString() ?? "0",
              requestedQty.toString()
            );
          }

          // Reserve: hold the quantity out of available until receive/cancel.
          // currentQty is untouched — goods are still physically in the source store.
          await tx.storeStockPosition.update({
            where: { id: stock.id },
            data: {
              reservedQty: { increment: requestedQty },
              availableQty: { decrement: requestedQty },
              lastUpdatedAt: new Date(),
            },
          });
        }
      }

      return tx.storeTransfer.create({
        data: {
          transferNumber,
          fromStoreId: Number(fromStoreId),
          toStoreId: toStoreId ? Number(toStoreId) : null,
          toDepartmentId: toDepartmentId ? Number(toDepartmentId) : null,
          transferType,
          status: autoApprove ? "APPROVED" : "REQUESTED",
          requestedById: meId,
          approvedById: autoApprove ? meId : null,
          approvedAt: autoApprove ? new Date() : null,
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
    }, { timeout: 20000, maxWait: 10000 });

    logAction({ entityType: "STORE_TRANSFER", entityId: transfer.id, action: autoApprove ? "APPROVE" : "CREATE", description: `Store transfer ${transfer.transferNumber} created (${transferType})${autoApprove ? " — auto-approved" : ""}`, performedById: meId });

    const adminIds = await getAdminIds();
    if (autoApprove) {
      // Already approved → tell the destination's people to receive it.
      let destHods: number[] = [];
      if (transferType === "STORE_TO_DEPARTMENT" && toDepartmentId) {
        destHods = await getDepartmentHODs(Number(toDepartmentId));
      } else if (toStoreId) {
        const dest = await prisma.store.findUnique({ where: { id: Number(toStoreId) }, select: { departmentId: true } });
        if (dest?.departmentId) destHods = await getDepartmentHODs(dest.departmentId);
      }
      notify({ type: "TRANSFER", title: "Store Transfer Ready to Receive", message: `Store transfer ${transfer.transferNumber} (${transferType}) is approved and ready to receive.`, recipientIds: [...new Set([...destHods, ...adminIds])], createdById: meId });
    } else {
      // Needs approval → notify the source store's HOD.
      const src = await prisma.store.findUnique({ where: { id: Number(fromStoreId) }, select: { departmentId: true } });
      const srcHods = src?.departmentId ? await getDepartmentHODs(src.departmentId) : [];
      notify({ type: "TRANSFER", title: "Store Transfer Needs Approval", message: `Store transfer ${transfer.transferNumber} (${transferType}) is awaiting your approval.`, recipientIds: [...new Set([...srcHods, ...adminIds])], createdById: meId });
    }

    res.status(201).json(transfer);
  } catch (e: any) {
    if (e instanceof InsufficientStockError) {
      res.status(400).json({ message: e.message, available: e.available, requested: e.requested });
      return;
    }
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

    // Only the source store's HOD (or admin) may approve.
    if (!(await canApproveTransfer(req.user, transfer.fromStoreId))) {
      res.status(403).json({ message: "Only the source store's HOD can approve this transfer" });
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
    const { receivedById } = req.body;
    // Accept either key: the web app sends "receivedItems", older callers send "items".
    const receivedItems = req.body.receivedItems ?? req.body.items;

    const transfer = await prisma.storeTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!transfer) { res.status(404).json({ message: "Store transfer not found" }); return; }
    if (transfer.status !== "IN_TRANSIT" && transfer.status !== "APPROVED") {
      res.status(400).json({ message: `Cannot receive transfer in ${transfer.status} status` });
      return;
    }

    // Only the destination's HOD/Supervisor (or store-keeper for a main store) may receive.
    if (!(await canReceiveTransfer(req.user, transfer))) {
      res.status(403).json({ message: "Only the destination store/department's staff can receive this transfer" });
      return;
    }

    // Validate received quantities — you can't receive more than was sent.
    if (receivedItems?.length) {
      for (const ri of receivedItems) {
        const ti = transfer.items.find((t) => t.id === ri.itemId);
        if (!ti) continue;
        const rq = Number(ri.receivedQty);
        if (isNaN(rq) || rq < 0 || rq > Number(ti.quantity)) {
          res.status(400).json({ message: `Received quantity must be between 0 and the sent quantity (${ti.quantity}).` });
          return;
        }
      }
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

        // Create IN transaction to destination store (only for store-to-store;
        // a store-to-department transfer has no destination store — items are issued out).
        if (transfer.toStoreId) {
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
        }

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
            // Goods physically leave the source: drop currentQty by what shipped,
            // and release the reservation made at create. availableQty was already
            // reduced at create, so only return the reserved-but-unshipped remainder.
            await tx.storeStockPosition.update({
              where: { id: fromStock.id },
              data: {
                currentQty: { decrement: receivedQty },
                reservedQty: { decrement: transferItem.quantity },
                availableQty: { increment: transferItem.quantity.minus(receivedQty) },
                lastUpdatedAt: new Date(),
              },
            });
          }

          // Update or create StoreStockPosition for destination (store-to-store only;
          // a department transfer issues items out, with no destination store stock).
          if (transfer.toStoreId) {
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
        }

        // ASSET transfer: relocate within the store network, or deploy into a department.
        if (transferItem.itemType === "ASSET" && transferItem.assetId) {
          if (transfer.transferType === "STORE_TO_DEPARTMENT") {
            // Handed to the department but NOT activated — stays IN_STORE until the
            // end user acknowledges or the installed date is reached.
            await tx.asset.update({
              where: { id: transferItem.assetId },
              data: {
                currentStoreId: null,
                currentStoreSince: null,
                ...(transfer.toDepartmentId ? { departmentId: transfer.toDepartmentId } : {}),
              },
            });
          } else {
            // STORE_TO_STORE: still staged (IN_STORE), just sitting in a different store now.
            await tx.asset.update({
              where: { id: transferItem.assetId },
              data: { currentStoreId: transfer.toStoreId, currentStoreSince: new Date() },
            });
          }
        }
      }

      return tx.storeTransfer.findUnique({
        where: { id },
        include: { items: true },
      });
    }, { timeout: 20000, maxWait: 10000 });

    logAction({ entityType: "STORE_TRANSFER", entityId: id, action: "STATUS_CHANGE", description: `Store transfer ${transfer.transferNumber} received`, performedById: req.user?.employeeDbId });

    // Notify requester that transfer has been received
    if (transfer.requestedById) notify({ type: "TRANSFER", title: "Store Transfer Received", message: `Store transfer ${transfer.transferNumber} has been received`, recipientIds: [transfer.requestedById], channel: "BOTH" });

    // Discrepancy alert — any line received short of what was sent (shortfall was
    // already returned to the source's Available). Notify the source HOD + admins.
    const shortLines = transfer.items
      .map((ti) => {
        const ri = receivedItems?.find((r: any) => r.itemId === ti.id);
        const received = ri ? Number(ri.receivedQty) : Number(ti.quantity);
        return { sent: Number(ti.quantity), received };
      })
      .filter((d) => d.received < d.sent);

    if (shortLines.length) {
      const src = await prisma.store.findUnique({ where: { id: transfer.fromStoreId }, select: { departmentId: true } });
      let srcHods: number[] = [];
      if (src?.departmentId) {
        srcHods = await getDepartmentHODs(src.departmentId);
      } else {
        // Main store has no department → its custodians are the store-department HODs.
        const storeDepts = await prisma.department.findMany({ where: { name: { contains: "STORE" } }, select: { id: true } });
        srcHods = (await Promise.all(storeDepts.map((d) => getDepartmentHODs(d.id)))).flat();
      }
      const admins = await getAdminIds();
      const shortTotal = shortLines.reduce((s, d) => s + (d.sent - d.received), 0);
      notify({
        type: "TRANSFER",
        title: "Transfer Discrepancy",
        message: `Store transfer ${transfer.transferNumber} was received short on ${shortLines.length} item(s) (${shortTotal} unit(s) not received). The shortfall was returned to the source store — please investigate.`,
        recipientIds: [...new Set([...srcHods, ...admins])],
        priority: "HIGH",
        channel: "BOTH",
        createdById: req.user?.employeeDbId,
      });
    }

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
    const transfer = await prisma.storeTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!transfer) { res.status(404).json({ message: "Store transfer not found" }); return; }
    if (["RECEIVED", "CANCELLED"].includes(transfer.status)) {
      res.status(400).json({ message: `Cannot cancel transfer in ${transfer.status} status` });
      return;
    }

    // Only the requester or the source store's HOD/admin may cancel.
    const isRequester = transfer.requestedById != null && transfer.requestedById === req.user?.employeeDbId;
    if (!isRequester && !(await canApproveTransfer(req.user, transfer.fromStoreId))) {
      res.status(403).json({ message: "Only the requester or the source store's HOD can cancel this transfer" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Release the reservation held at create — currentQty untouched, nothing shipped.
      for (const transferItem of transfer.items) {
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
                reservedQty: { decrement: transferItem.quantity },
                availableQty: { increment: transferItem.quantity },
                lastUpdatedAt: new Date(),
              },
            });
          }
        }
      }

      return tx.storeTransfer.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    }, { timeout: 20000, maxWait: 10000 });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

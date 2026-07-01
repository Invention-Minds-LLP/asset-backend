import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../prismaClient";
import { notify, getAdminIds } from "../../utilis/notificationHelper";

// ================= CREATE =================
export const createSparePart = async (req: Request, res: Response) => {
    try {
        const {
            name,
            partNumber,
            model,
            category,
            vendorId,
            stockQuantity,
            reorderLevel,
            cost
        } = req.body;

        if (!name) {
            res.status(400).json({ message: "Name is required" });
            return;
        }

        const dup = await prisma.sparePart.findFirst({ where: { name: String(name).trim() } });
        if (dup) {
            res.status(409).json({ message: `A spare part named "${name}" already exists.` });
            return;
        }

        const spare = await prisma.sparePart.create({
            data: {
                name,
                partNumber: partNumber || null,
                model: model || null,
                category: category || null,
                vendorId: vendorId ? Number(vendorId) : null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: Number(reorderLevel || 0),
                cost: cost ? Number(cost) : null
            }
        });

        res.json(spare);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= GET ALL =================
export const getAllSpareParts = async (_: Request, res: Response) => {
    try {
        const list = await prisma.sparePart.findMany({
            orderBy: { id: "desc" },
            include: {
                vendor: true
            }
        });

        res.json(list);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= UPDATE =================
export const updateSparePart = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        const {
            name,
            partNumber,
            model,
            category,
            vendorId,
            stockQuantity,
            reorderLevel,
            cost
        } = req.body;

        if (stockQuantity < 0) {
            res.status(400).json({ message: "Stock cannot be negative" });
            return;
        }

        if (name) {
            const dup = await prisma.sparePart.findFirst({
                where: { name: String(name).trim(), NOT: { id } },
            });
            if (dup) {
                res.status(409).json({ message: `Another spare part named "${name}" already exists.` });
                return;
            }
        }

        const updated = await prisma.sparePart.update({
            where: { id },
            data: {
                name,
                partNumber: partNumber || null,
                model: model || null,
                category: category || null,
                vendorId: vendorId ? Number(vendorId) : null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: Number(reorderLevel || 0),
                cost: cost ? Number(cost) : null
            }
        });

        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= DELETE =================
export const deleteSparePart = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        // Block deletion if the part is referenced anywhere — otherwise we'd hit a
        // foreign-key error or orphan its history.
        const [usage, txn, replacement, issue, position] = await Promise.all([
            prisma.sparePartUsage.findFirst({ where: { sparePartId: id } }),
            prisma.inventoryTransaction.findFirst({ where: { sparePartId: id } }),
            prisma.subAssetReplacement.findFirst({ where: { sparePartId: id } }),
            prisma.materialIssue.findFirst({ where: { sparePartId: id } }),
            prisma.storeStockPosition.findFirst({ where: { sparePartId: id } }),
        ]);

        const blockers: string[] = [];
        if (usage) blockers.push("maintenance usage");
        if (txn) blockers.push("stock transactions");
        if (replacement) blockers.push("sub-asset replacements");
        if (issue) blockers.push("work-order issues");
        if (position) blockers.push("store stock");

        if (blockers.length) {
            res.status(409).json({
                message: `Cannot delete this spare part — it is referenced by ${blockers.join(", ")}. Remove those records or keep it for history.`,
            });
            return;
        }

        await prisma.sparePart.delete({
            where: { id }
        });

        res.json({ message: "Deleted successfully" });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};


// ================= CREATE =================
export const createConsumable = async (req: Request, res: Response) => {
    try {
        const { name, unit, stockQuantity, reorderLevel, cost } = req.body;

        if (!name) {
            res.status(400).json({ message: "Name is required" });
            return;
        }

        // Consumable.name is unique — return a friendly message instead of a raw P2002.
        const dup = await prisma.consumable.findFirst({ where: { name: String(name).trim() } });
        if (dup) {
            res.status(409).json({ message: `A consumable named "${name}" already exists.` });
            return;
        }

        const consumable = await prisma.consumable.create({
            data: {
                name,
                unit: unit || null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: reorderLevel ? Number(reorderLevel) : null,
                cost: cost ? Number(cost) : null
            }
        });

        res.json(consumable);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= GET ALL =================
export const getAllConsumables = async (_: Request, res: Response) => {
    try {
        const list = await prisma.consumable.findMany({
            orderBy: { id: "desc" }
        });

        res.json(list);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= UPDATE =================
export const updateConsumable = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        const { name, unit, stockQuantity, reorderLevel, cost } = req.body;

        if (name) {
            const dup = await prisma.consumable.findFirst({
                where: { name: String(name).trim(), NOT: { id } },
            });
            if (dup) {
                res.status(409).json({ message: `Another consumable named "${name}" already exists.` });
                return;
            }
        }

        const updated = await prisma.consumable.update({
            where: { id },
            data: {
                name,
                unit: unit || null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: reorderLevel ? Number(reorderLevel) : null,
                cost: cost !== undefined && cost !== null && cost !== '' ? Number(cost) : null
            }
        });

        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= DELETE =================
export const deleteConsumable = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        const [batch, txn, issue, position] = await Promise.all([
            prisma.consumableBatch.findFirst({ where: { consumableId: id } }),
            prisma.inventoryTransaction.findFirst({ where: { consumableId: id } }),
            prisma.materialIssue.findFirst({ where: { consumableId: id } }),
            prisma.storeStockPosition.findFirst({ where: { consumableId: id } }),
        ]);

        const blockers: string[] = [];
        if (batch) blockers.push("stock batches");
        if (txn) blockers.push("stock transactions");
        if (issue) blockers.push("work-order issues");
        if (position) blockers.push("store stock");

        if (blockers.length) {
            res.status(409).json({
                message: `Cannot delete this consumable — it is referenced by ${blockers.join(", ")}. Remove those records or keep it for history.`,
            });
            return;
        }

        await prisma.consumable.delete({
            where: { id }
        });

        res.json({ message: "Deleted successfully" });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};
// ================= STOCK MOVEMENT HISTORY =================
export const getSparePartTransactions = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const txns = await prisma.inventoryTransaction.findMany({
            where: { sparePartId: id },
            orderBy: { createdAt: "desc" },
            take: 200,
            include: { performedBy: { select: { name: true } } },
        });
        res.json(txns);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

export const getConsumableTransactions = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const txns = await prisma.inventoryTransaction.findMany({
            where: { consumableId: id },
            orderBy: { createdAt: "desc" },
            take: 200,
            include: { performedBy: { select: { name: true } } },
        });
        res.json(txns);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= STOCK ADJUST / RECEIVE / ISSUE =================
// mode: "set"     → correct the master total to an exact count
//       "receive" → add stock (goods received)
//       "issue"   → move stock from the central master out to a store (master −, store +)
// The Inventory Master number is the central pool; per-store positions are downstream.
type AdjustPlan = { masterDelta: number; storeDelta: number; txType: string; verb: string; qty: number };
function buildAdjustPlan(mode: string, quantity: number, current: number): AdjustPlan | { error: string } {
    const q = Number(quantity);
    if (!["set", "receive", "issue"].includes(mode) || isNaN(q) || q < 0) {
        return { error: "A valid mode (set/receive/issue) and quantity (>= 0) are required" };
    }
    if (mode === "set") {
        const masterDelta = q - current;
        return { masterDelta, storeDelta: masterDelta, txType: "ADJUSTMENT", verb: `Set to ${q}`, qty: Math.abs(masterDelta) };
    }
    if (mode === "receive") {
        return { masterDelta: q, storeDelta: q, txType: "IN", verb: `Received ${q}`, qty: q };
    }
    // issue: leaves the central master, arrives at the store
    if (current - q < 0) return { error: "Not enough stock in the master inventory to issue" };
    return { masterDelta: -q, storeDelta: q, txType: "OUT", verb: `Issued ${q} to store`, qty: q };
}

export const adjustSparePartStock = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { mode = "set", quantity, reason, storeId } = req.body;
        const user = (req as any).user;
        const sid = storeId ? Number(storeId) : null;

        if (mode === "issue" && !sid) { res.status(400).json({ message: "Select a store to issue to" }); return; }

        const part = await prisma.sparePart.findUnique({ where: { id } });
        if (!part) { res.status(404).json({ message: "Spare part not found" }); return; }

        const plan = buildAdjustPlan(mode, Math.round(Number(quantity)), part.stockQuantity);
        if ("error" in plan) { res.status(400).json({ message: plan.error }); return; }

        const masterTarget = part.stockQuantity + plan.masterDelta;
        if (masterTarget < 0) { res.status(400).json({ message: "Resulting stock cannot be negative" }); return; }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.sparePart.update({ where: { id }, data: { stockQuantity: masterTarget } });
            if (plan.masterDelta !== 0 || plan.storeDelta !== 0) {
                await tx.inventoryTransaction.create({
                    data: {
                        type: plan.txType,
                        sparePartId: id,
                        quantity: plan.qty,
                        referenceType: "MANUAL",
                        storeId: sid,
                        performedById: user?.employeeDbId ?? null,
                        notes: reason ? `${plan.verb}: ${reason}` : plan.verb,
                    },
                });

                if (sid && plan.storeDelta !== 0) {
                    const pos = await tx.storeStockPosition.findFirst({
                        where: { storeId: sid, itemType: "SPARE_PART", sparePartId: id },
                    });
                    if (pos) {
                        await tx.storeStockPosition.update({
                            where: { id: pos.id },
                            data: { currentQty: { increment: plan.storeDelta }, availableQty: { increment: plan.storeDelta }, lastUpdatedAt: new Date() },
                        });
                    } else if (plan.storeDelta > 0) {
                        await tx.storeStockPosition.create({
                            data: { storeId: sid, itemType: "SPARE_PART", sparePartId: id, currentQty: plan.storeDelta, availableQty: plan.storeDelta },
                        });
                    }
                }
            }
            return updated;
        });

        res.json(result);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

export const adjustConsumableStock = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { mode = "set", quantity, reason, storeId } = req.body;
        const user = (req as any).user;
        const sid = storeId ? Number(storeId) : null;

        if (mode === "issue" && !sid) { res.status(400).json({ message: "Select a store to issue to" }); return; }

        const item = await prisma.consumable.findUnique({ where: { id } });
        if (!item) { res.status(404).json({ message: "Consumable not found" }); return; }

        const plan = buildAdjustPlan(mode, Number(quantity), Number(item.stockQuantity));
        if ("error" in plan) { res.status(400).json({ message: plan.error }); return; }

        const masterTarget = new Prisma.Decimal(item.stockQuantity).plus(plan.masterDelta);
        if (masterTarget.lessThan(0)) { res.status(400).json({ message: "Resulting stock cannot be negative" }); return; }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.consumable.update({ where: { id }, data: { stockQuantity: masterTarget } });
            if (plan.masterDelta !== 0 || plan.storeDelta !== 0) {
                await tx.inventoryTransaction.create({
                    data: {
                        type: plan.txType,
                        consumableId: id,
                        quantity: plan.qty,
                        referenceType: "MANUAL",
                        storeId: sid,
                        performedById: user?.employeeDbId ?? null,
                        notes: reason ? `${plan.verb}: ${reason}` : plan.verb,
                    },
                });

                if (sid && plan.storeDelta !== 0) {
                    const pos = await tx.storeStockPosition.findFirst({
                        where: { storeId: sid, itemType: "CONSUMABLE", consumableId: id },
                    });
                    if (pos) {
                        await tx.storeStockPosition.update({
                            where: { id: pos.id },
                            data: { currentQty: { increment: plan.storeDelta }, availableQty: { increment: plan.storeDelta }, lastUpdatedAt: new Date() },
                        });
                    } else if (plan.storeDelta > 0) {
                        await tx.storeStockPosition.create({
                            data: { storeId: sid, itemType: "CONSUMABLE", consumableId: id, currentQty: plan.storeDelta, availableQty: plan.storeDelta },
                        });
                    }
                }
            }
            return updated;
        });

        res.json(result);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= PER-STORE BREAKDOWN =================
export const getSparePartStores = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const positions = await prisma.storeStockPosition.findMany({
            where: { itemType: "SPARE_PART", sparePartId: id },
            include: { store: { select: { name: true, code: true } } },
            orderBy: { currentQty: "desc" },
        });
        res.json(positions);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

export const getConsumableStores = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const positions = await prisma.storeStockPosition.findMany({
            where: { itemType: "CONSUMABLE", consumableId: id },
            include: { store: { select: { name: true, code: true } } },
            orderBy: { currentQty: "desc" },
        });
        res.json(positions);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= CONSUMABLE BATCHES (expiry tracking) =================
export const getConsumableBatches = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const batches = await prisma.consumableBatch.findMany({
            where: { consumableId: id },
            orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
        });
        res.json(batches);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// Add a new batch and increase the consumable's stock by the batch quantity.
export const addConsumableBatch = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { batchNumber, expiryDate, quantity } = req.body;
        const user = (req as any).user;

        const qty = Number(quantity);
        if (!quantity || isNaN(qty) || qty <= 0) {
            res.status(400).json({ message: "A positive batch quantity is required" });
            return;
        }

        const consumable = await prisma.consumable.findUnique({ where: { id } });
        if (!consumable) { res.status(404).json({ message: "Consumable not found" }); return; }

        const result = await prisma.$transaction(async (tx) => {
            const batch = await tx.consumableBatch.create({
                data: {
                    consumableId: id,
                    batchNumber: batchNumber || null,
                    expiryDate: expiryDate ? new Date(expiryDate) : null,
                    quantity: qty,
                    remainingQuantity: qty,
                },
            });

            await tx.consumable.update({
                where: { id },
                data: { stockQuantity: { increment: qty } },
            });

            await tx.inventoryTransaction.create({
                data: {
                    type: "IN",
                    consumableId: id,
                    quantity: qty,
                    referenceType: "MANUAL",
                    referenceId: batch.id,
                    performedById: user?.employeeDbId ?? null,
                    notes: `Batch added${batchNumber ? ` (${batchNumber})` : ""}`,
                },
            });

            return batch;
        });

        res.json(result);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// Batches expiring within `days` (default 30), across all consumables.
export const getExpiringBatches = async (req: Request, res: Response) => {
    try {
        const days = Number(req.query.days) || 30;
        const now = new Date();
        const horizon = new Date();
        horizon.setDate(now.getDate() + days);

        const batches = await prisma.consumableBatch.findMany({
            where: {
                expiryDate: { not: null, lte: horizon },
                remainingQuantity: { gt: 0 },
            },
            include: { consumable: { select: { name: true, unit: true } } },
            orderBy: { expiryDate: "asc" },
        });
        res.json(batches);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= REORDER REQUEST =================
// Sends a reorder request notification to admins (material requests are ticket-scoped,
// so a standalone reorder is modelled as an alert to procurement/admin).
export const requestSparePartReorder = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { quantity } = req.body;
        const user = (req as any).user;

        const part = await prisma.sparePart.findUnique({ where: { id }, include: { vendor: { select: { name: true } } } });
        if (!part) { res.status(404).json({ message: "Spare part not found" }); return; }

        const admins = await getAdminIds();
        if (!admins.length) { res.status(200).json({ message: "No admins to notify" }); return; }

        const suggested = quantity ?? part.reorderLevel ?? "";
        await notify({
            type: "OTHER",
            title: "Reorder Requested — Spare Part",
            message: `Reorder requested for "${part.name}"${part.vendor?.name ? ` (vendor: ${part.vendor.name})` : ""}. Current stock ${part.stockQuantity}${part.reorderLevel != null ? `, reorder level ${part.reorderLevel}` : ""}. Suggested qty ${suggested}.`,
            recipientIds: admins,
            priority: "MEDIUM",
            channel: "BOTH",
            createdById: user?.employeeDbId,
        });

        res.json({ message: "Reorder request sent" });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

export const requestConsumableReorder = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { quantity } = req.body;
        const user = (req as any).user;

        const item = await prisma.consumable.findUnique({ where: { id } });
        if (!item) { res.status(404).json({ message: "Consumable not found" }); return; }

        const admins = await getAdminIds();
        if (!admins.length) { res.status(200).json({ message: "No admins to notify" }); return; }

        const suggested = quantity ?? item.reorderLevel ?? "";
        await notify({
            type: "OTHER",
            title: "Reorder Requested — Consumable",
            message: `Reorder requested for "${item.name}". Current stock ${item.stockQuantity}${item.unit ? ` ${item.unit}` : ""}${item.reorderLevel != null ? `, reorder level ${item.reorderLevel}` : ""}. Suggested qty ${suggested}.`,
            recipientIds: admins,
            priority: "MEDIUM",
            channel: "BOTH",
            createdById: user?.employeeDbId,
        });

        res.json({ message: "Reorder request sent" });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

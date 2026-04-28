"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockMovements = exports.adjustStock = exports.getLowStockAlerts = exports.getStockSummary = exports.getStockByStore = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const client_1 = require("@prisma/client");
// ═══════════════════════════════════════════════════════════
// GET STOCK BY STORE
// ═══════════════════════════════════════════════════════════
const getStockByStore = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const storeId = Number(req.params.storeId);
        const stock = yield prismaClient_1.default.storeStockPosition.findMany({
            where: { storeId },
            orderBy: { id: "desc" },
        });
        // Enrich with item names
        const enriched = yield Promise.all(stock.map((s) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            let itemName = "";
            if (s.itemType === "SPARE_PART" && s.sparePartId) {
                const sp = yield prismaClient_1.default.sparePart.findUnique({
                    where: { id: s.sparePartId },
                    select: { name: true, partNumber: true },
                });
                itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
            }
            else if (s.itemType === "CONSUMABLE" && s.consumableId) {
                const c = yield prismaClient_1.default.consumable.findUnique({
                    where: { id: s.consumableId },
                    select: { name: true },
                });
                itemName = (_a = c === null || c === void 0 ? void 0 : c.name) !== null && _a !== void 0 ? _a : "";
            }
            return Object.assign(Object.assign({}, s), { itemName });
        })));
        res.json(enriched);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getStockByStore = getStockByStore;
// ═══════════════════════════════════════════════════════════
// GET STOCK SUMMARY (aggregate across all stores)
// ═══════════════════════════════════════════════════════════
const getStockSummary = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const summary = yield prismaClient_1.default.storeStockPosition.groupBy({
            by: ["itemType", "sparePartId", "consumableId"],
            _sum: {
                currentQty: true,
                reservedQty: true,
                availableQty: true,
            },
        });
        // Enrich with item names
        const enriched = yield Promise.all(summary.map((s) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            let itemName = "";
            if (s.itemType === "SPARE_PART" && s.sparePartId) {
                const sp = yield prismaClient_1.default.sparePart.findUnique({
                    where: { id: s.sparePartId },
                    select: { name: true, partNumber: true },
                });
                itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
            }
            else if (s.itemType === "CONSUMABLE" && s.consumableId) {
                const c = yield prismaClient_1.default.consumable.findUnique({
                    where: { id: s.consumableId },
                    select: { name: true },
                });
                itemName = (_a = c === null || c === void 0 ? void 0 : c.name) !== null && _a !== void 0 ? _a : "";
            }
            return {
                itemType: s.itemType,
                sparePartId: s.sparePartId,
                consumableId: s.consumableId,
                itemName,
                totalCurrentQty: s._sum.currentQty,
                totalReservedQty: s._sum.reservedQty,
                totalAvailableQty: s._sum.availableQty,
            };
        })));
        res.json(enriched);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getStockSummary = getStockSummary;
// ═══════════════════════════════════════════════════════════
// GET LOW STOCK ALERTS
// ═══════════════════════════════════════════════════════════
const getLowStockAlerts = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Prisma doesn't support field-to-field comparison directly, so filter in application code
        const allWithReorder = yield prismaClient_1.default.storeStockPosition.findMany({
            where: { reorderLevel: { not: null } },
            include: {
                store: { select: { id: true, name: true } },
            },
        });
        const lowStock = allWithReorder.filter((s) => s.reorderLevel && s.currentQty.lessThanOrEqualTo(s.reorderLevel));
        // Enrich with names
        const enriched = yield Promise.all(lowStock.map((s) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            let itemName = "";
            if (s.itemType === "SPARE_PART" && s.sparePartId) {
                const sp = yield prismaClient_1.default.sparePart.findUnique({
                    where: { id: s.sparePartId },
                    select: { name: true, partNumber: true },
                });
                itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
            }
            else if (s.itemType === "CONSUMABLE" && s.consumableId) {
                const c = yield prismaClient_1.default.consumable.findUnique({
                    where: { id: s.consumableId },
                    select: { name: true },
                });
                itemName = (_a = c === null || c === void 0 ? void 0 : c.name) !== null && _a !== void 0 ? _a : "";
            }
            return Object.assign(Object.assign({}, s), { itemName });
        })));
        res.json(enriched);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getLowStockAlerts = getLowStockAlerts;
// ═══════════════════════════════════════════════════════════
// ADJUST STOCK
// ═══════════════════════════════════════════════════════════
const adjustStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const storeId = Number(req.params.storeId);
        const { itemType, sparePartId, consumableId, adjustmentQty, reason } = req.body;
        if (!itemType || adjustmentQty === undefined || adjustmentQty === null) {
            res.status(400).json({ message: "itemType and adjustmentQty are required" });
            return;
        }
        const adjQty = new client_1.Prisma.Decimal(adjustmentQty);
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            // Find or create stock position
            const stockWhere = Object.assign(Object.assign({ storeId,
                itemType }, (itemType === "SPARE_PART" ? { sparePartId: Number(sparePartId) } : {})), (itemType === "CONSUMABLE" ? { consumableId: Number(consumableId) } : {}));
            let stock = yield tx.storeStockPosition.findFirst({ where: stockWhere });
            if (!stock) {
                // Negative adjustment with no existing stock not allowed
                if (adjQty.lessThan(0)) {
                    throw new Error("Cannot apply negative adjustment: no stock position exists");
                }
                stock = yield tx.storeStockPosition.create({
                    data: {
                        storeId,
                        itemType,
                        sparePartId: sparePartId ? Number(sparePartId) : null,
                        consumableId: consumableId ? Number(consumableId) : null,
                        currentQty: adjQty,
                        availableQty: adjQty,
                    },
                });
            }
            else {
                // Prevent going negative
                const newQty = stock.currentQty.add(adjQty);
                if (newQty.lessThan(0)) {
                    throw new Error(`Adjustment would result in negative stock. Current: ${stock.currentQty}, Adjustment: ${adjQty}`);
                }
                stock = yield tx.storeStockPosition.update({
                    where: { id: stock.id },
                    data: {
                        currentQty: { increment: adjQty },
                        availableQty: { increment: adjQty },
                        lastUpdatedAt: new Date(),
                    },
                });
            }
            // Create inventory transaction
            const invTx = yield tx.inventoryTransaction.create({
                data: {
                    type: "ADJUSTMENT",
                    sparePartId: sparePartId ? Number(sparePartId) : null,
                    consumableId: consumableId ? Number(consumableId) : null,
                    quantity: adjQty,
                    referenceType: "MANUAL",
                    storeId,
                    performedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                    notes: reason || "Stock adjustment",
                },
            });
            return { stockPosition: stock, transaction: invTx };
        }));
        res.json(result);
    }
    catch (e) {
        const statusCode = ((_a = e.message) === null || _a === void 0 ? void 0 : _a.includes("negative")) ? 400 : 500;
        res.status(statusCode).json({ message: e.message });
    }
});
exports.adjustStock = adjustStock;
// ═══════════════════════════════════════════════════════════
// GET STOCK MOVEMENTS
// ═══════════════════════════════════════════════════════════
const getStockMovements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const storeId = Number(req.params.storeId);
        const { page = "1", limit = "20" } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const where = { storeId };
        const [data, total] = yield Promise.all([
            prismaClient_1.default.inventoryTransaction.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { createdAt: "desc" },
                include: {
                    sparePart: { select: { id: true, name: true, partNumber: true } },
                    consumable: { select: { id: true, name: true } },
                    performedBy: { select: { id: true, employeeID: true, name: true } },
                },
            }),
            prismaClient_1.default.inventoryTransaction.count({ where }),
        ]);
        res.json({ data, total, page: Number(page), limit: Number(limit) });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getStockMovements = getStockMovements;

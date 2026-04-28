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
exports.cancelTransfer = exports.receiveTransfer = exports.markInTransit = exports.approveTransfer = exports.createTransfer = exports.getTransferById = exports.getAllTransfers = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const client_1 = require("@prisma/client");
const audit_trail_controller_1 = require("../audit-trail/audit-trail.controller");
const notificationHelper_1 = require("../../utilis/notificationHelper");
// ─── helpers ───────────────────────────────────────────────
function getFY() {
    const now = new Date();
    const month = now.getMonth() + 1;
    return month >= 4
        ? `${now.getFullYear().toString().slice(2)}${(now.getFullYear() + 1).toString().slice(2)}`
        : `${(now.getFullYear() - 1).toString().slice(2)}${now.getFullYear().toString().slice(2)}`;
}
function generateTransferNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const fy = getFY();
        const prefix = `ST-FY${fy}-`;
        const last = yield prismaClient_1.default.storeTransfer.findFirst({
            where: { transferNumber: { startsWith: prefix } },
            orderBy: { transferNumber: "desc" },
        });
        const seq = last ? parseInt(last.transferNumber.replace(prefix, ""), 10) + 1 : 1;
        return `${prefix}${seq.toString().padStart(5, "0")}`;
    });
}
// ═══════════════════════════════════════════════════════════
// GET ALL (paginated + filters)
// ═══════════════════════════════════════════════════════════
const getAllTransfers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, fromStoreId, toStoreId, transferType, page = "1", limit = "20" } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const where = {};
        if (status)
            where.status = String(status);
        if (fromStoreId)
            where.fromStoreId = Number(fromStoreId);
        if (toStoreId)
            where.toStoreId = Number(toStoreId);
        if (transferType)
            where.transferType = String(transferType);
        const [data, total] = yield Promise.all([
            prismaClient_1.default.storeTransfer.findMany({
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
            prismaClient_1.default.storeTransfer.count({ where }),
        ]);
        res.json({ data, total, page: Number(page), limit: Number(limit) });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllTransfers = getAllTransfers;
// ═══════════════════════════════════════════════════════════
// GET BY ID
// ═══════════════════════════════════════════════════════════
const getTransferById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const transfer = yield prismaClient_1.default.storeTransfer.findUnique({
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
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getTransferById = getTransferById;
// ═══════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════
const createTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const { fromStoreId, toStoreId, toDepartmentId, transferType, remarks, items } = req.body;
        if (!fromStoreId || !toStoreId || !transferType || !(items === null || items === void 0 ? void 0 : items.length)) {
            res.status(400).json({ message: "fromStoreId, toStoreId, transferType, and items are required" });
            return;
        }
        // Validate stock availability for each item
        for (const item of items) {
            if (item.itemType === "SPARE_PART" || item.itemType === "CONSUMABLE") {
                const stockWhere = Object.assign(Object.assign({ storeId: Number(fromStoreId), itemType: item.itemType }, (item.itemType === "SPARE_PART" ? { sparePartId: Number(item.sparePartId) } : {})), (item.itemType === "CONSUMABLE" ? { consumableId: Number(item.consumableId) } : {}));
                const stock = yield prismaClient_1.default.storeStockPosition.findFirst({ where: stockWhere });
                const requestedQty = new client_1.Prisma.Decimal(item.quantity);
                if (!stock || stock.availableQty.lessThan(requestedQty)) {
                    res.status(400).json({
                        message: `Insufficient stock for ${item.itemType} (ID: ${item.sparePartId || item.consumableId})`,
                        available: (_b = (_a = stock === null || stock === void 0 ? void 0 : stock.availableQty) === null || _a === void 0 ? void 0 : _a.toString()) !== null && _b !== void 0 ? _b : "0",
                        requested: requestedQty.toString(),
                    });
                    return;
                }
            }
        }
        const transferNumber = yield generateTransferNumber();
        const transfer = yield prismaClient_1.default.storeTransfer.create({
            data: {
                transferNumber,
                fromStoreId: Number(fromStoreId),
                toStoreId: Number(toStoreId),
                toDepartmentId: toDepartmentId ? Number(toDepartmentId) : null,
                transferType,
                status: "REQUESTED",
                requestedById: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null,
                remarks: remarks || null,
                items: {
                    create: items.map((item) => ({
                        itemType: item.itemType,
                        sparePartId: item.sparePartId ? Number(item.sparePartId) : null,
                        consumableId: item.consumableId ? Number(item.consumableId) : null,
                        assetId: item.assetId ? Number(item.assetId) : null,
                        quantity: new client_1.Prisma.Decimal(item.quantity),
                    })),
                },
            },
            include: {
                items: true,
                fromStore: { select: { id: true, name: true } },
                toStore: { select: { id: true, name: true } },
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "STORE_TRANSFER", entityId: transfer.id, action: "CREATE", description: `Store transfer ${transfer.transferNumber} created (${transferType})`, performedById: (_e = req.user) === null || _e === void 0 ? void 0 : _e.employeeDbId });
        // Notify admins about new store transfer request
        const adminIds = yield (0, notificationHelper_1.getAdminIds)();
        (0, notificationHelper_1.notify)({ type: "TRANSFER", title: "Store Transfer Requested", message: `Store transfer ${transfer.transferNumber} (${transferType}) requested`, recipientIds: adminIds, createdById: (_f = req.user) === null || _f === void 0 ? void 0 : _f.employeeDbId });
        res.status(201).json(transfer);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createTransfer = createTransfer;
// ═══════════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════════
const approveTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = Number(req.params.id);
        const { approvedById } = req.body;
        const transfer = yield prismaClient_1.default.storeTransfer.findUnique({ where: { id } });
        if (!transfer) {
            res.status(404).json({ message: "Store transfer not found" });
            return;
        }
        if (transfer.status !== "REQUESTED") {
            res.status(400).json({ message: `Cannot approve transfer in ${transfer.status} status` });
            return;
        }
        const updated = yield prismaClient_1.default.storeTransfer.update({
            where: { id },
            data: {
                status: "APPROVED",
                approvedById: approvedById ? Number(approvedById) : (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                approvedAt: new Date(),
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "STORE_TRANSFER", entityId: id, action: "APPROVE", description: `Store transfer ${transfer.transferNumber} approved`, performedById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        // Notify requester that transfer is approved
        if (transfer.requestedById)
            (0, notificationHelper_1.notify)({ type: "TRANSFER", title: "Store Transfer Approved", message: `Store transfer ${transfer.transferNumber} has been approved`, recipientIds: [transfer.requestedById] });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.approveTransfer = approveTransfer;
// ═══════════════════════════════════════════════════════════
// MARK IN TRANSIT
// ═══════════════════════════════════════════════════════════
const markInTransit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const transfer = yield prismaClient_1.default.storeTransfer.findUnique({ where: { id } });
        if (!transfer) {
            res.status(404).json({ message: "Store transfer not found" });
            return;
        }
        if (transfer.status !== "APPROVED") {
            res.status(400).json({ message: `Cannot mark in-transit for transfer in ${transfer.status} status` });
            return;
        }
        const updated = yield prismaClient_1.default.storeTransfer.update({
            where: { id },
            data: { status: "IN_TRANSIT" },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.markInTransit = markInTransit;
// ═══════════════════════════════════════════════════════════
// RECEIVE
// ═══════════════════════════════════════════════════════════
const receiveTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = Number(req.params.id);
        const { receivedById, items: receivedItems } = req.body;
        const transfer = yield prismaClient_1.default.storeTransfer.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!transfer) {
            res.status(404).json({ message: "Store transfer not found" });
            return;
        }
        if (transfer.status !== "IN_TRANSIT" && transfer.status !== "APPROVED") {
            res.status(400).json({ message: `Cannot receive transfer in ${transfer.status} status` });
            return;
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            // Update transfer header
            yield tx.storeTransfer.update({
                where: { id },
                data: {
                    status: "RECEIVED",
                    receivedById: receivedById ? Number(receivedById) : (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                    receivedAt: new Date(),
                },
            });
            for (const transferItem of transfer.items) {
                // Find matching received item for receivedQty
                const receivedItem = receivedItems === null || receivedItems === void 0 ? void 0 : receivedItems.find((ri) => ri.itemId === transferItem.id);
                const receivedQty = receivedItem
                    ? new client_1.Prisma.Decimal(receivedItem.receivedQty)
                    : transferItem.quantity;
                // Update receivedQty on transfer item
                yield tx.storeTransferItem.update({
                    where: { id: transferItem.id },
                    data: { receivedQty },
                });
                // Create OUT transaction from source store
                yield tx.inventoryTransaction.create({
                    data: {
                        type: "OUT",
                        sparePartId: transferItem.sparePartId,
                        consumableId: transferItem.consumableId,
                        quantity: receivedQty,
                        referenceType: "STORE_TRANSFER",
                        referenceId: transfer.id,
                        storeId: transfer.fromStoreId,
                        storeTransferId: transfer.id,
                        performedById: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null,
                        notes: `Transfer OUT - ${transfer.transferNumber}`,
                    },
                });
                // Create IN transaction to destination store
                yield tx.inventoryTransaction.create({
                    data: {
                        type: "IN",
                        sparePartId: transferItem.sparePartId,
                        consumableId: transferItem.consumableId,
                        quantity: receivedQty,
                        referenceType: "STORE_TRANSFER",
                        referenceId: transfer.id,
                        storeId: transfer.toStoreId,
                        storeTransferId: transfer.id,
                        performedById: (_f = (_e = req.user) === null || _e === void 0 ? void 0 : _e.employeeDbId) !== null && _f !== void 0 ? _f : null,
                        notes: `Transfer IN - ${transfer.transferNumber}`,
                    },
                });
                // Update StoreStockPosition for source (decrement)
                if (transferItem.itemType === "SPARE_PART" || transferItem.itemType === "CONSUMABLE") {
                    const fromStock = yield tx.storeStockPosition.findFirst({
                        where: Object.assign(Object.assign({ storeId: transfer.fromStoreId, itemType: transferItem.itemType }, (transferItem.itemType === "SPARE_PART" ? { sparePartId: transferItem.sparePartId } : {})), (transferItem.itemType === "CONSUMABLE" ? { consumableId: transferItem.consumableId } : {})),
                    });
                    if (fromStock) {
                        yield tx.storeStockPosition.update({
                            where: { id: fromStock.id },
                            data: {
                                currentQty: { decrement: receivedQty },
                                availableQty: { decrement: receivedQty },
                                lastUpdatedAt: new Date(),
                            },
                        });
                    }
                    // Update or create StoreStockPosition for destination (increment)
                    const toStock = yield tx.storeStockPosition.findFirst({
                        where: Object.assign(Object.assign({ storeId: transfer.toStoreId, itemType: transferItem.itemType }, (transferItem.itemType === "SPARE_PART" ? { sparePartId: transferItem.sparePartId } : {})), (transferItem.itemType === "CONSUMABLE" ? { consumableId: transferItem.consumableId } : {})),
                    });
                    if (toStock) {
                        yield tx.storeStockPosition.update({
                            where: { id: toStock.id },
                            data: {
                                currentQty: { increment: receivedQty },
                                availableQty: { increment: receivedQty },
                                lastUpdatedAt: new Date(),
                            },
                        });
                    }
                    else {
                        yield tx.storeStockPosition.create({
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
                    yield tx.asset.update({
                        where: { id: transferItem.assetId },
                        data: { status: "ACTIVE" },
                    });
                }
            }
            return tx.storeTransfer.findUnique({
                where: { id },
                include: { items: true },
            });
        }));
        (0, audit_trail_controller_1.logAction)({ entityType: "STORE_TRANSFER", entityId: id, action: "STATUS_CHANGE", description: `Store transfer ${transfer.transferNumber} received`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify requester that transfer has been received
        if (transfer.requestedById)
            (0, notificationHelper_1.notify)({ type: "TRANSFER", title: "Store Transfer Received", message: `Store transfer ${transfer.transferNumber} has been received`, recipientIds: [transfer.requestedById], channel: "BOTH" });
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.receiveTransfer = receiveTransfer;
// ═══════════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════════
const cancelTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const transfer = yield prismaClient_1.default.storeTransfer.findUnique({ where: { id } });
        if (!transfer) {
            res.status(404).json({ message: "Store transfer not found" });
            return;
        }
        if (["RECEIVED", "CANCELLED"].includes(transfer.status)) {
            res.status(400).json({ message: `Cannot cancel transfer in ${transfer.status} status` });
            return;
        }
        const updated = yield prismaClient_1.default.storeTransfer.update({
            where: { id },
            data: { status: "CANCELLED" },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.cancelTransfer = cancelTransfer;

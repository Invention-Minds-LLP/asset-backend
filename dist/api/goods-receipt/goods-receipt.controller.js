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
exports.rejectGRA = exports.acceptGRA = exports.inspectGRA = exports.createGoodsReceipt = exports.getGoodsReceiptById = exports.getAllGoodsReceipts = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const audit_trail_controller_1 = require("../audit-trail/audit-trail.controller");
const notificationHelper_1 = require("../../utilis/notificationHelper");
const assetIdGenerator_1 = require("../../utilis/assetIdGenerator");
// ── Helpers ──────────────────────────────────────────────────────────
function mustUser(req) {
    const u = req.user;
    if (!(u === null || u === void 0 ? void 0 : u.employeeDbId))
        throw new Error("Unauthorized");
    return u;
}
function generateGRNNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const month = now.getMonth() + 1;
        const fyStartYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEndYear = fyStartYear + 1;
        const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;
        const latest = yield prismaClient_1.default.goodsReceipt.findFirst({
            where: { grnNumber: { startsWith: `GRN-${fyString}` } },
            orderBy: { id: "desc" },
        });
        let seq = 1;
        if (latest) {
            const parts = latest.grnNumber.split("-");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last))
                seq = last + 1;
        }
        return `GRN-${fyString}-${seq.toString().padStart(3, "0")}`;
    });
}
// ── GET / ────────────────────────────────────────────────────────────
const getAllGoodsReceipts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, purchaseOrderId, page, limit: lim } = req.query;
        const user = req.user;
        const where = {};
        if (status)
            where.status = String(status);
        if (purchaseOrderId)
            where.purchaseOrderId = Number(purchaseOrderId);
        // Department-based scoping for non-admin users via linked PO
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            const deptPOs = yield prismaClient_1.default.purchaseOrder.findMany({
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
        const [total, receipts] = yield Promise.all([
            prismaClient_1.default.goodsReceipt.count({ where }),
            prismaClient_1.default.goodsReceipt.findMany({
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
    }
    catch (error) {
        console.error("getAllGoodsReceipts error:", error);
        res.status(500).json({ message: "Failed to fetch goods receipts" });
    }
});
exports.getAllGoodsReceipts = getAllGoodsReceipts;
// ── GET /:id ─────────────────────────────────────────────────────────
const getGoodsReceiptById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const gra = yield prismaClient_1.default.goodsReceipt.findUnique({
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
    }
    catch (error) {
        console.error("getGoodsReceiptById error:", error);
        res.status(500).json({ message: "Failed to fetch goods receipt" });
    }
});
exports.getGoodsReceiptById = getGoodsReceiptById;
// ── POST / ───────────────────────────────────────────────────────────
const createGoodsReceipt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { purchaseOrderId, vendorId, deliveryChallanNo, deliveryDate, invoiceNumber, invoiceDate, invoiceValue, notes, lines, } = req.body;
        if (!lines || !Array.isArray(lines) || lines.length === 0) {
            res.status(400).json({ message: "At least one line is required" });
            return;
        }
        const grnNumber = yield generateGRNNumber();
        let totalValue = 0;
        const lineData = lines.map((l) => {
            var _a, _b, _c;
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
                serialNumber: (_a = l.serialNumber) !== null && _a !== void 0 ? _a : null,
                inspectionStatus: (_b = l.inspectionStatus) !== null && _b !== void 0 ? _b : null,
                inspectionRemarks: (_c = l.inspectionRemarks) !== null && _c !== void 0 ? _c : null,
            };
        });
        const gra = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const created = yield tx.goodsReceipt.create({
                data: {
                    grnNumber,
                    purchaseOrderId: purchaseOrderId ? Number(purchaseOrderId) : null,
                    vendorId: vendorId ? Number(vendorId) : null,
                    deliveryChallanNo: deliveryChallanNo !== null && deliveryChallanNo !== void 0 ? deliveryChallanNo : null,
                    deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
                    invoiceNumber: invoiceNumber !== null && invoiceNumber !== void 0 ? invoiceNumber : null,
                    invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
                    invoiceValue: invoiceValue ? Number(invoiceValue) : null,
                    totalValue,
                    notes: notes !== null && notes !== void 0 ? notes : null,
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
                        yield tx.purchaseOrderLine.update({
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
        }));
        (0, audit_trail_controller_1.logAction)({ entityType: "GOODS_RECEIPT", entityId: gra.id, action: "CREATE", description: `GRA ${gra.grnNumber} created`, performedById: user.employeeDbId });
        // Notify admins about new GRA
        const adminIds = yield (0, notificationHelper_1.getAdminIds)();
        (0, notificationHelper_1.notify)({ type: "GRA_ACCEPTED", title: "New GRA Received", message: `GRA ${gra.grnNumber} received, pending inspection`, recipientIds: adminIds, createdById: user.employeeDbId });
        res.status(201).json(gra);
    }
    catch (error) {
        console.error("createGoodsReceipt error:", error);
        res.status(400).json({ message: error.message || "Failed to create goods receipt" });
    }
});
exports.createGoodsReceipt = createGoodsReceipt;
// ── PATCH /:id/inspect ───────────────────────────────────────────────
const inspectGRA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const graId = Number(req.params.id);
        const { inspectedById, inspectionRemarks, lines } = req.body;
        const gra = yield prismaClient_1.default.goodsReceipt.findUnique({
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
        yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            for (const line of lines) {
                yield tx.goodsReceiptLine.update({
                    where: { id: Number(line.lineId) },
                    data: {
                        inspectionStatus: line.inspectionStatus,
                        inspectionRemarks: (_a = line.inspectionRemarks) !== null && _a !== void 0 ? _a : null,
                        acceptedQty: line.acceptedQty ? Number(line.acceptedQty) : 0,
                        rejectedQty: line.rejectedQty ? Number(line.rejectedQty) : 0,
                    },
                });
                if (line.inspectionStatus === "FAIL") {
                    allPassed = false;
                }
                else {
                    anyPassed = true;
                }
            }
            const newStatus = allPassed ? "INSPECTION_PASSED" : anyPassed ? "INSPECTION_PASSED" : "INSPECTION_FAILED";
            yield tx.goodsReceipt.update({
                where: { id: graId },
                data: {
                    inspectedById: Number(inspectedById),
                    inspectedAt: new Date(),
                    inspectionRemarks: inspectionRemarks !== null && inspectionRemarks !== void 0 ? inspectionRemarks : null,
                    status: newStatus,
                },
            });
        }));
        const updated = yield prismaClient_1.default.goodsReceipt.findUnique({
            where: { id: graId },
            include: { lines: true },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "GOODS_RECEIPT", entityId: graId, action: "UPDATE", description: `GRA ${gra.grnNumber} inspected`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify GRA creator of inspection outcome
        if (gra.createdById) {
            (0, notificationHelper_1.notify)({ type: "GRA_ACCEPTED", title: `GRA Inspection ${allPassed || anyPassed ? "Passed" : "Failed"}`, message: `GRA ${gra.grnNumber} inspection ${allPassed ? "passed" : anyPassed ? "partially passed" : "failed"}${inspectionRemarks ? `. Remarks: ${inspectionRemarks}` : ""}`, recipientIds: [gra.createdById], createdById: (_b = req.user) === null || _b === void 0 ? void 0 : _b.employeeDbId });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("inspectGRA error:", error);
        res.status(400).json({ message: error.message || "Failed to inspect goods receipt" });
    }
});
exports.inspectGRA = inspectGRA;
// ── PATCH /:id/accept ────────────────────────────────────────────────
const acceptGRA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const user = mustUser(req);
        const graId = Number(req.params.id);
        const gra = yield prismaClient_1.default.goodsReceipt.findUnique({
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
        const autoCreateCfg = yield prismaClient_1.default.tenantConfig.findUnique({
            where: { key: "AUTO_CREATE_ASSET_ON_GRA" },
        });
        const autoCreateAsset = (autoCreateCfg === null || autoCreateCfg === void 0 ? void 0 : autoCreateCfg.value) === "true";
        yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            // 1. Set GRA status to ACCEPTED
            yield tx.goodsReceipt.update({
                where: { id: graId },
                data: { status: "ACCEPTED" },
            });
            // 2. Process each line
            for (const line of gra.lines) {
                const acceptedQty = line.acceptedQty > 0 ? line.acceptedQty : line.receivedQty;
                if (line.itemType === "ASSET" && autoCreateAsset) {
                    // Auto-create asset records
                    const po = gra.purchaseOrder;
                    const poLine = (_a = po === null || po === void 0 ? void 0 : po.lines) === null || _a === void 0 ? void 0 : _a.find((pl) => pl.id === line.poLineId);
                    for (let i = 0; i < acceptedQty; i++) {
                        // Generate assetId
                        const assetId = yield (0, assetIdGenerator_1.generateAssetId)(undefined, tx, { categoryId: (_b = poLine === null || poLine === void 0 ? void 0 : poLine.assetCategoryId) !== null && _b !== void 0 ? _b : null });
                        // Generate unique serial number if not provided
                        const serialNumber = line.serialNumber && acceptedQty === 1
                            ? line.serialNumber
                            : `${gra.grnNumber}-L${line.id}-${(i + 1).toString().padStart(2, "0")}`;
                        const asset = yield tx.asset.create({
                            data: {
                                assetId,
                                assetName: line.description,
                                assetType: "EQUIPMENT",
                                serialNumber,
                                purchaseOrderId: (_c = gra.purchaseOrderId) !== null && _c !== void 0 ? _c : null,
                                goodsReceiptId: gra.id,
                                purchaseOrderNo: (_d = po === null || po === void 0 ? void 0 : po.poNumber) !== null && _d !== void 0 ? _d : null,
                                grnNumber: gra.grnNumber,
                                purchaseCost: (_e = line.unitPrice) !== null && _e !== void 0 ? _e : null,
                                vendorId: (_g = (_f = po === null || po === void 0 ? void 0 : po.vendorId) !== null && _f !== void 0 ? _f : gra.vendorId) !== null && _g !== void 0 ? _g : null,
                                status: "IN_STORE",
                                sourceType: "INTERNAL_PO_GRA",
                                sourceReference: gra.grnNumber,
                                assetCategoryId: (_h = poLine === null || poLine === void 0 ? void 0 : poLine.assetCategoryId) !== null && _h !== void 0 ? _h : 1,
                            },
                        });
                        // Set createdAssetId on the line (last created asset for multi-qty)
                        if (i === acceptedQty - 1) {
                            yield tx.goodsReceiptLine.update({
                                where: { id: line.id },
                                data: { createdAssetId: asset.id },
                            });
                        }
                    }
                }
                else if ((line.itemType === "SPARE_PART" || line.itemType === "CONSUMABLE") && acceptedQty > 0) {
                    // 3. Create InventoryTransaction + update StoreStockPosition
                    const spId = line.itemType === "SPARE_PART" && line.poLineId
                        ? ((_m = (_l = (_k = (_j = gra.purchaseOrder) === null || _j === void 0 ? void 0 : _j.lines) === null || _k === void 0 ? void 0 : _k.find((pl) => pl.id === line.poLineId)) === null || _l === void 0 ? void 0 : _l.sparePartId) !== null && _m !== void 0 ? _m : null)
                        : null;
                    const conId = line.itemType === "CONSUMABLE" && line.poLineId
                        ? ((_r = (_q = (_p = (_o = gra.purchaseOrder) === null || _o === void 0 ? void 0 : _o.lines) === null || _p === void 0 ? void 0 : _p.find((pl) => pl.id === line.poLineId)) === null || _q === void 0 ? void 0 : _q.consumableId) !== null && _r !== void 0 ? _r : null)
                        : null;
                    yield tx.inventoryTransaction.create({
                        data: {
                            type: "IN",
                            sparePartId: spId,
                            consumableId: conId,
                            quantity: acceptedQty,
                            referenceType: "GRA",
                            referenceId: gra.id,
                            storeId: (_s = line.storeId) !== null && _s !== void 0 ? _s : null,
                            performedById: user.employeeDbId,
                            notes: `Auto-created from GRA ${gra.grnNumber}, line ${line.id}`,
                        },
                    });
                    // Update StoreStockPosition (upsert: create if not exists, increment if exists)
                    if (line.storeId && (spId || conId)) {
                        const existingStock = yield tx.storeStockPosition.findFirst({
                            where: Object.assign(Object.assign({ storeId: line.storeId, itemType: line.itemType }, (spId ? { sparePartId: spId } : {})), (conId ? { consumableId: conId } : {})),
                        });
                        if (existingStock) {
                            yield tx.storeStockPosition.update({
                                where: { id: existingStock.id },
                                data: {
                                    currentQty: { increment: acceptedQty },
                                    availableQty: { increment: acceptedQty },
                                    lastUpdatedAt: new Date(),
                                },
                            });
                        }
                        else {
                            yield tx.storeStockPosition.create({
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
                        yield tx.sparePart.update({
                            where: { id: spId },
                            data: { stockQuantity: { increment: acceptedQty } },
                        });
                    }
                    if (conId) {
                        yield tx.consumable.update({
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
                const poLines = yield tx.purchaseOrderLine.findMany({
                    where: { purchaseOrderId: gra.purchaseOrderId },
                });
                const allFullyReceived = poLines.every((pl) => pl.receivedQty >= pl.quantity);
                const anyReceived = poLines.some((pl) => pl.receivedQty > 0);
                if (allFullyReceived) {
                    yield tx.purchaseOrder.update({
                        where: { id: gra.purchaseOrderId },
                        data: { status: "FULLY_RECEIVED" },
                    });
                }
                else if (anyReceived) {
                    yield tx.purchaseOrder.update({
                        where: { id: gra.purchaseOrderId },
                        data: { status: "PARTIALLY_RECEIVED" },
                    });
                }
            }
        }));
        const result = yield prismaClient_1.default.goodsReceipt.findUnique({
            where: { id: graId },
            include: { lines: true },
        });
        const assetLineCount = gra.lines.filter(l => l.itemType === "ASSET").reduce((sum, l) => sum + (l.acceptedQty > 0 ? l.acceptedQty : l.receivedQty), 0);
        (0, audit_trail_controller_1.logAction)({ entityType: "GOODS_RECEIPT", entityId: graId, action: "APPROVE", description: `GRA ${gra.grnNumber} accepted${assetLineCount > 0 ? `, ${assetLineCount} asset(s) auto-created` : ""}`, performedById: user.employeeDbId });
        // ── Auto-create Purchase Voucher if accounts module is enabled ────────────
        const accountsCfg = yield prismaClient_1.default.tenantConfig.findUnique({ where: { key: "ACCOUNTS_MODULE_ENABLED" } });
        if ((accountsCfg === null || accountsCfg === void 0 ? void 0 : accountsCfg.value) === "true") {
            try {
                const totalAmount = gra.lines.reduce((sum, l) => { var _a; return sum + (Number((_a = l.unitPrice) !== null && _a !== void 0 ? _a : 0) * (l.acceptedQty > 0 ? l.acceptedQty : l.receivedQty)); }, 0);
                // generate PV number
                const now = new Date();
                const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                const fyEnd = fyStart + 1;
                const fy = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
                const latestPV = yield prismaClient_1.default.purchaseVoucher.findFirst({ where: { voucherNo: { startsWith: `PV-${fy}` } }, orderBy: { id: "desc" } });
                let pvSeq = 1;
                if (latestPV) {
                    const parts = latestPV.voucherNo.split("-");
                    const last = parseInt(parts[parts.length - 1], 10);
                    if (!isNaN(last))
                        pvSeq = last + 1;
                }
                const pvNumber = `PV-${fy}-${pvSeq.toString().padStart(3, "0")}`;
                yield prismaClient_1.default.purchaseVoucher.create({
                    data: {
                        voucherNo: pvNumber,
                        voucherDate: new Date(),
                        amount: totalAmount,
                        narration: `Auto-created from GRA ${gra.grnNumber}`,
                        goodsReceiptId: graId,
                        vendorId: (_a = gra.vendorId) !== null && _a !== void 0 ? _a : null,
                        invoiceNo: (_b = gra.invoiceNumber) !== null && _b !== void 0 ? _b : null,
                        status: "DRAFT",
                        createdById: user.employeeDbId,
                    },
                });
            }
            catch (pvErr) {
                console.error("Auto-PV creation failed (non-blocking):", pvErr);
            }
        }
        // Notify GRA creator that GRA is accepted
        (0, notificationHelper_1.notify)({ type: "GRA_ACCEPTED", title: "GRA Accepted", message: `GRA ${gra.grnNumber} accepted.${assetLineCount > 0 ? ` ${assetLineCount} asset(s) created.` : ""}`, recipientIds: [gra.createdById].filter(Boolean), createdById: user.employeeDbId, channel: "BOTH" });
        res.json(result);
    }
    catch (error) {
        console.error("acceptGRA error:", error);
        res.status(400).json({ message: error.message || "Failed to accept goods receipt" });
    }
});
exports.acceptGRA = acceptGRA;
// ── PATCH /:id/reject ────────────────────────────────────────────────
const rejectGRA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const graId = Number(req.params.id);
        const gra = yield prismaClient_1.default.goodsReceipt.findUnique({ where: { id: graId } });
        if (!gra) {
            res.status(404).json({ message: "Goods receipt not found" });
            return;
        }
        const updated = yield prismaClient_1.default.goodsReceipt.update({
            where: { id: graId },
            data: { status: "REJECTED" },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "GOODS_RECEIPT", entityId: graId, action: "STATUS_CHANGE", description: `GRA ${gra.grnNumber} rejected`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify GRA creator about rejection
        if (gra.createdById) {
            (0, notificationHelper_1.notify)({ type: "GRA_ACCEPTED", title: "GRA Rejected", message: `GRA ${gra.grnNumber} has been rejected`, recipientIds: [gra.createdById], createdById: (_b = req.user) === null || _b === void 0 ? void 0 : _b.employeeDbId });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("rejectGRA error:", error);
        res.status(400).json({ message: error.message || "Failed to reject goods receipt" });
    }
});
exports.rejectGRA = rejectGRA;

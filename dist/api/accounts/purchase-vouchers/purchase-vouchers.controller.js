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
exports.cancelPurchaseVoucher = exports.postPurchaseVoucher = exports.approvePurchaseVoucher = exports.updatePurchaseVoucher = exports.createPurchaseVoucher = exports.getPurchaseVoucherById = exports.getAllPurchaseVouchers = void 0;
const prismaClient_1 = __importDefault(require("../../../prismaClient"));
const audit_trail_controller_1 = require("../../audit-trail/audit-trail.controller");
// ── Number generator ─────────────────────────────────────────────────────────
function generatePVNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const month = now.getMonth() + 1;
        const fyStart = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEnd = fyStart + 1;
        const fy = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
        const latest = yield prismaClient_1.default.purchaseVoucher.findFirst({
            where: { voucherNo: { startsWith: `PV-${fy}` } },
            orderBy: { id: "desc" },
        });
        let seq = 1;
        if (latest) {
            const parts = latest.voucherNo.split("-");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last))
                seq = last + 1;
        }
        return `PV-${fy}-${seq.toString().padStart(3, "0")}`;
    });
}
// GET /
const getAllPurchaseVouchers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, vendorId, page, limit: lim } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (vendorId)
            where.vendorId = Number(vendorId);
        const pageNum = page ? parseInt(String(page)) : 1;
        const take = lim ? parseInt(String(lim)) : 20;
        const skip = (pageNum - 1) * take;
        const [total, vouchers] = yield Promise.all([
            prismaClient_1.default.purchaseVoucher.count({ where }),
            prismaClient_1.default.purchaseVoucher.findMany({
                where,
                include: {
                    vendor: { select: { id: true, name: true } },
                    asset: { select: { id: true, assetId: true, assetName: true } },
                    goodsReceipt: { select: { id: true, grnNumber: true } },
                    createdBy: { select: { id: true, name: true } },
                    approvedBy: { select: { id: true, name: true } },
                    _count: { select: { paymentVouchers: true } },
                },
                orderBy: { id: "desc" },
                skip,
                take,
            }),
        ]);
        res.json({ data: vouchers, total, page: pageNum, limit: take });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch purchase vouchers" });
    }
});
exports.getAllPurchaseVouchers = getAllPurchaseVouchers;
// GET /:id
const getPurchaseVoucherById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const voucher = yield prismaClient_1.default.purchaseVoucher.findUnique({
            where: { id },
            include: {
                vendor: true,
                asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true } },
                goodsReceipt: { select: { id: true, grnNumber: true, grnDate: true } },
                createdBy: { select: { id: true, name: true, employeeID: true } },
                approvedBy: { select: { id: true, name: true, employeeID: true } },
                paymentVouchers: { select: { id: true, voucherNo: true, amount: true, status: true, voucherDate: true } },
                journalEntries: { select: { id: true, entryNo: true, entryDate: true, totalAmount: true } },
            },
        });
        if (!voucher) {
            res.status(404).json({ message: "Purchase voucher not found" });
            return;
        }
        res.json(voucher);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch purchase voucher" });
    }
});
exports.getPurchaseVoucherById = getPurchaseVoucherById;
// POST /
const createPurchaseVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        const { voucherDate, amount, narration, assetId, goodsReceiptId, vendorId, invoiceNo, invoiceDate, invoiceAmount, attachmentUrl } = req.body;
        if (!voucherDate || !amount) {
            res.status(400).json({ message: "voucherDate and amount are required" });
            return;
        }
        const voucherNo = yield generatePVNumber();
        const voucher = yield prismaClient_1.default.purchaseVoucher.create({
            data: {
                voucherNo,
                voucherDate: new Date(voucherDate),
                amount: parseFloat(amount),
                narration: narration !== null && narration !== void 0 ? narration : null,
                assetId: assetId ? Number(assetId) : null,
                goodsReceiptId: goodsReceiptId ? Number(goodsReceiptId) : null,
                vendorId: vendorId ? Number(vendorId) : null,
                invoiceNo: invoiceNo !== null && invoiceNo !== void 0 ? invoiceNo : null,
                invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
                invoiceAmount: invoiceAmount ? parseFloat(invoiceAmount) : null,
                attachmentUrl: attachmentUrl !== null && attachmentUrl !== void 0 ? attachmentUrl : null,
                createdById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
                status: "DRAFT",
            },
        });
        // If linked to an asset, update the asset's purchaseVoucherNo/Date/Id
        if (assetId) {
            yield prismaClient_1.default.asset.update({
                where: { id: Number(assetId) },
                data: {
                    purchaseVoucherNo: voucherNo,
                    purchaseVoucherDate: new Date(voucherDate),
                    purchaseVoucherId: voucher.id,
                },
            });
        }
        (0, audit_trail_controller_1.logAction)({ entityType: "PURCHASE_VOUCHER", entityId: voucher.id, action: "CREATE", description: `Purchase voucher ${voucherNo} created`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.status(201).json(voucher);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create purchase voucher" });
    }
});
exports.createPurchaseVoucher = createPurchaseVoucher;
// PUT /:id
const updatePurchaseVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const existing = yield prismaClient_1.default.purchaseVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Purchase voucher not found" });
            return;
        }
        if (existing.status === "POSTED") {
            res.status(400).json({ message: "Cannot edit a posted voucher" });
            return;
        }
        const { voucherDate, amount, narration, vendorId, invoiceNo, invoiceDate, invoiceAmount, attachmentUrl } = req.body;
        const updated = yield prismaClient_1.default.purchaseVoucher.update({
            where: { id },
            data: {
                voucherDate: voucherDate ? new Date(voucherDate) : undefined,
                amount: amount ? parseFloat(amount) : undefined,
                narration: narration !== null && narration !== void 0 ? narration : undefined,
                vendorId: vendorId ? Number(vendorId) : undefined,
                invoiceNo: invoiceNo !== null && invoiceNo !== void 0 ? invoiceNo : undefined,
                invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
                invoiceAmount: invoiceAmount ? parseFloat(invoiceAmount) : undefined,
                attachmentUrl: attachmentUrl !== null && attachmentUrl !== void 0 ? attachmentUrl : undefined,
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "UPDATE", description: `Purchase voucher ${updated.voucherNo} updated`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update purchase voucher" });
    }
});
exports.updatePurchaseVoucher = updatePurchaseVoucher;
// PATCH /:id/approve
const approvePurchaseVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const { remarks } = req.body;
        const existing = yield prismaClient_1.default.purchaseVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (!["DRAFT", "PENDING_APPROVAL"].includes(existing.status)) {
            res.status(400).json({ message: "Voucher is not in an approvable state" });
            return;
        }
        const updated = yield prismaClient_1.default.purchaseVoucher.update({
            where: { id },
            data: { status: "APPROVED", approvedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null, approvedAt: new Date(), approvalRemarks: remarks !== null && remarks !== void 0 ? remarks : null },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "APPROVE", description: `Purchase voucher ${updated.voucherNo} approved`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to approve purchase voucher" });
    }
});
exports.approvePurchaseVoucher = approvePurchaseVoucher;
// PATCH /:id/post
const postPurchaseVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const existing = yield prismaClient_1.default.purchaseVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (existing.status !== "APPROVED") {
            res.status(400).json({ message: "Only approved vouchers can be posted" });
            return;
        }
        const updated = yield prismaClient_1.default.purchaseVoucher.update({ where: { id }, data: { status: "POSTED" } });
        (0, audit_trail_controller_1.logAction)({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "POST", description: `Purchase voucher ${updated.voucherNo} posted to ledger`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to post purchase voucher" });
    }
});
exports.postPurchaseVoucher = postPurchaseVoucher;
// PATCH /:id/cancel
const cancelPurchaseVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const existing = yield prismaClient_1.default.purchaseVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (existing.status === "POSTED") {
            res.status(400).json({ message: "Cannot cancel a posted voucher" });
            return;
        }
        const updated = yield prismaClient_1.default.purchaseVoucher.update({ where: { id }, data: { status: "CANCELLED" } });
        (0, audit_trail_controller_1.logAction)({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "CANCEL", description: `Purchase voucher ${updated.voucherNo} cancelled`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to cancel purchase voucher" });
    }
});
exports.cancelPurchaseVoucher = cancelPurchaseVoucher;

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
exports.cancelPaymentVoucher = exports.postPaymentVoucher = exports.approvePaymentVoucher = exports.updatePaymentVoucher = exports.createPaymentVoucher = exports.getPaymentVoucherById = exports.getAllPaymentVouchers = void 0;
const prismaClient_1 = __importDefault(require("../../../prismaClient"));
const audit_trail_controller_1 = require("../../audit-trail/audit-trail.controller");
function generatePMTNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const month = now.getMonth() + 1;
        const fyStart = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEnd = fyStart + 1;
        const fy = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
        const latest = yield prismaClient_1.default.paymentVoucher.findFirst({
            where: { voucherNo: { startsWith: `PMT-${fy}` } },
            orderBy: { id: "desc" },
        });
        let seq = 1;
        if (latest) {
            const parts = latest.voucherNo.split("-");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last))
                seq = last + 1;
        }
        return `PMT-${fy}-${seq.toString().padStart(3, "0")}`;
    });
}
// GET /
const getAllPaymentVouchers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, vendorId, purchaseVoucherId, page, limit: lim } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (vendorId)
            where.vendorId = Number(vendorId);
        if (purchaseVoucherId)
            where.purchaseVoucherId = Number(purchaseVoucherId);
        const pageNum = page ? parseInt(String(page)) : 1;
        const take = lim ? parseInt(String(lim)) : 20;
        const skip = (pageNum - 1) * take;
        const [total, vouchers] = yield Promise.all([
            prismaClient_1.default.paymentVoucher.count({ where }),
            prismaClient_1.default.paymentVoucher.findMany({
                where,
                include: {
                    vendor: { select: { id: true, name: true } },
                    purchaseVoucher: { select: { id: true, voucherNo: true, amount: true } },
                    createdBy: { select: { id: true, name: true } },
                    approvedBy: { select: { id: true, name: true } },
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
        res.status(500).json({ message: "Failed to fetch payment vouchers" });
    }
});
exports.getAllPaymentVouchers = getAllPaymentVouchers;
// GET /:id
const getPaymentVoucherById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const voucher = yield prismaClient_1.default.paymentVoucher.findUnique({
            where: { id },
            include: {
                vendor: true,
                purchaseVoucher: { select: { id: true, voucherNo: true, amount: true, invoiceNo: true } },
                createdBy: { select: { id: true, name: true, employeeID: true } },
                approvedBy: { select: { id: true, name: true, employeeID: true } },
                journalEntries: { select: { id: true, entryNo: true, entryDate: true, totalAmount: true } },
            },
        });
        if (!voucher) {
            res.status(404).json({ message: "Payment voucher not found" });
            return;
        }
        res.json(voucher);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch payment voucher" });
    }
});
exports.getPaymentVoucherById = getPaymentVoucherById;
// POST /
const createPaymentVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        const { voucherDate, amount, paymentMode, bankReference, bankName, narration, purchaseVoucherId, vendorId } = req.body;
        if (!voucherDate || !amount || !paymentMode) {
            res.status(400).json({ message: "voucherDate, amount and paymentMode are required" });
            return;
        }
        const voucherNo = yield generatePMTNumber();
        const voucher = yield prismaClient_1.default.paymentVoucher.create({
            data: {
                voucherNo,
                voucherDate: new Date(voucherDate),
                amount: parseFloat(amount),
                paymentMode,
                bankReference: bankReference !== null && bankReference !== void 0 ? bankReference : null,
                bankName: bankName !== null && bankName !== void 0 ? bankName : null,
                narration: narration !== null && narration !== void 0 ? narration : null,
                purchaseVoucherId: purchaseVoucherId ? Number(purchaseVoucherId) : null,
                vendorId: vendorId ? Number(vendorId) : null,
                createdById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
                status: "DRAFT",
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "PAYMENT_VOUCHER", entityId: voucher.id, action: "CREATE", description: `Payment voucher ${voucherNo} created`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.status(201).json(voucher);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create payment voucher" });
    }
});
exports.createPaymentVoucher = createPaymentVoucher;
// PUT /:id
const updatePaymentVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const existing = yield prismaClient_1.default.paymentVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (existing.status === "POSTED") {
            res.status(400).json({ message: "Cannot edit a posted voucher" });
            return;
        }
        const { voucherDate, amount, paymentMode, bankReference, bankName, narration } = req.body;
        const updated = yield prismaClient_1.default.paymentVoucher.update({
            where: { id },
            data: {
                voucherDate: voucherDate ? new Date(voucherDate) : undefined,
                amount: amount ? parseFloat(amount) : undefined,
                paymentMode: paymentMode !== null && paymentMode !== void 0 ? paymentMode : undefined,
                bankReference: bankReference !== null && bankReference !== void 0 ? bankReference : undefined,
                bankName: bankName !== null && bankName !== void 0 ? bankName : undefined,
                narration: narration !== null && narration !== void 0 ? narration : undefined,
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "UPDATE", description: `Payment voucher ${updated.voucherNo} updated`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update payment voucher" });
    }
});
exports.updatePaymentVoucher = updatePaymentVoucher;
// PATCH /:id/approve
const approvePaymentVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const { remarks } = req.body;
        const existing = yield prismaClient_1.default.paymentVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (!["DRAFT", "PENDING_APPROVAL"].includes(existing.status)) {
            res.status(400).json({ message: "Voucher is not approvable" });
            return;
        }
        const updated = yield prismaClient_1.default.paymentVoucher.update({
            where: { id },
            data: { status: "APPROVED", approvedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null, approvedAt: new Date(), approvalRemarks: remarks !== null && remarks !== void 0 ? remarks : null },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "APPROVE", description: `Payment voucher ${updated.voucherNo} approved`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to approve payment voucher" });
    }
});
exports.approvePaymentVoucher = approvePaymentVoucher;
// PATCH /:id/post
const postPaymentVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const existing = yield prismaClient_1.default.paymentVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (existing.status !== "APPROVED") {
            res.status(400).json({ message: "Only approved vouchers can be posted" });
            return;
        }
        const updated = yield prismaClient_1.default.paymentVoucher.update({ where: { id }, data: { status: "POSTED" } });
        (0, audit_trail_controller_1.logAction)({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "POST", description: `Payment voucher ${updated.voucherNo} posted`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to post payment voucher" });
    }
});
exports.postPaymentVoucher = postPaymentVoucher;
// PATCH /:id/cancel
const cancelPaymentVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const user = req.user;
        const existing = yield prismaClient_1.default.paymentVoucher.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        if (existing.status === "POSTED") {
            res.status(400).json({ message: "Cannot cancel a posted voucher" });
            return;
        }
        const updated = yield prismaClient_1.default.paymentVoucher.update({ where: { id }, data: { status: "CANCELLED" } });
        (0, audit_trail_controller_1.logAction)({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "CANCEL", description: `Payment voucher ${updated.voucherNo} cancelled`, performedById: user === null || user === void 0 ? void 0 : user.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to cancel payment voucher" });
    }
});
exports.cancelPaymentVoucher = cancelPaymentVoucher;

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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVouchers = listVouchers;
exports.getVoucher = getVoucher;
exports.createVoucher = createVoucher;
exports.approveVoucher = approveVoucher;
exports.rejectVoucher = rejectVoucher;
exports.voidVoucher = voidVoucher;
exports.createAutoVoucher = createAutoVoucher;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const voucherInclude = {
    lines: { include: { account: true, costCentre: true } },
    department: true,
    batchRun: true,
    createdBy: { select: { id: true, name: true } },
    approvedBy: { select: { id: true, name: true } },
};
// ─── Sequence generator ────────────────────────────────────────────────
function nextVoucherNo() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const prefix = `FV-FY${fy}-`;
        const last = yield prisma.financeVoucher.findFirst({
            where: { voucherNo: { startsWith: prefix } },
            orderBy: { voucherNo: "desc" },
        });
        const seq = last ? parseInt(last.voucherNo.split("-").pop() || "0") + 1 : 1;
        return `${prefix}${String(seq).padStart(4, "0")}`;
    });
}
// GET /api/finance/vouchers
function listVouchers(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { status, sourceType, from, to, page = "1", limit = "20" } = req.query;
        const where = {};
        if (status)
            where.status = status;
        if (sourceType)
            where.sourceType = sourceType;
        if (from || to)
            where.voucherDate = Object.assign(Object.assign({}, (from ? { gte: new Date(from) } : {})), (to ? { lte: new Date(to) } : {}));
        const skip = (parseInt(page) - 1) * parseInt(limit);
        try {
            const [data, total] = yield Promise.all([
                prisma.financeVoucher.findMany({ where, include: voucherInclude, orderBy: { voucherDate: "desc" }, skip, take: parseInt(limit) }),
                prisma.financeVoucher.count({ where }),
            ]);
            res.json({ data, total, page: parseInt(page), limit: parseInt(limit) });
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load vouchers" });
        }
    });
}
// GET /api/finance/vouchers/:id
function getVoucher(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const v = yield prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) }, include: voucherInclude });
            if (!v) {
                res.status(404).json({ error: "Voucher not found" });
                return;
            }
            res.json(v);
        }
        catch (err) {
            res.status(500).json({ error: "Failed to load voucher" });
        }
    });
}
// POST /api/finance/vouchers  (manual entry)
function createVoucher(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const { voucherDate, narration, sourceType = "MANUAL", departmentId, lines } = req.body;
        if (!lines || !Array.isArray(lines) || lines.length < 2) {
            res.status(400).json({ error: "Minimum 2 lines required" });
            return;
        }
        const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
        const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            res.status(400).json({ error: "Debit and Credit must balance" });
            return;
        }
        try {
            const voucherNo = yield nextVoucherNo();
            const config = yield prisma.financeConfig.findFirst();
            const status = (config === null || config === void 0 ? void 0 : config.requireApproval) ? "DRAFT" : "POSTED";
            const voucher = yield prisma.financeVoucher.create({
                data: {
                    voucherNo,
                    voucherDate: new Date(voucherDate),
                    narration,
                    sourceType,
                    totalDebit,
                    totalCredit,
                    status,
                    departmentId: departmentId || null,
                    createdById: req.user.employeeDbId,
                    lines: {
                        create: lines.map((l) => ({
                            accountId: l.accountId,
                            debit: l.debit || 0,
                            credit: l.credit || 0,
                            narration: l.narration || null,
                            costCentreId: l.costCentreId || null,
                        })),
                    },
                },
                include: voucherInclude,
            });
            res.status(201).json(voucher);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to create voucher" });
        }
    });
}
// POST /api/finance/vouchers/:id/approve
function approveVoucher(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        try {
            const v = yield prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) } });
            if (!v) {
                res.status(404).json({ error: "Voucher not found" });
                return;
            }
            if (v.status !== "DRAFT" && v.status !== "PENDING_APPROVAL") {
                res.status(400).json({ error: `Cannot approve voucher in ${v.status} status` });
                return;
            }
            const updated = yield prisma.financeVoucher.update({
                where: { id: v.id },
                data: { status: "POSTED", approvedById: req.user.employeeDbId, approvedAt: new Date() },
                include: voucherInclude,
            });
            res.json(updated);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to approve voucher" });
        }
    });
}
// POST /api/finance/vouchers/:id/reject
function rejectVoucher(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const { reason } = req.body;
        try {
            const v = yield prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) } });
            if (!v) {
                res.status(404).json({ error: "Voucher not found" });
                return;
            }
            const updated = yield prisma.financeVoucher.update({
                where: { id: v.id },
                data: { status: "REJECTED", rejectionReason: reason || null, approvedById: req.user.employeeDbId, approvedAt: new Date() },
                include: voucherInclude,
            });
            res.json(updated);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to reject voucher" });
        }
    });
}
// POST /api/finance/vouchers/:id/void
function voidVoucher(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        try {
            const v = yield prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) } });
            if (!v) {
                res.status(404).json({ error: "Voucher not found" });
                return;
            }
            if (v.status === "VOID") {
                res.status(400).json({ error: "Already voided" });
                return;
            }
            const updated = yield prisma.financeVoucher.update({
                where: { id: v.id },
                data: { status: "VOID" },
                include: voucherInclude,
            });
            res.json(updated);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to void voucher" });
        }
    });
}
// ─── Auto-Voucher helper (called internally from other controllers) ─────────
function createAutoVoucher(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield prisma.financeConfig.findFirst();
        if (!(config === null || config === void 0 ? void 0 : config.autoVoucher))
            return;
        const totalDebit = params.lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = params.lines.reduce((s, l) => s + l.credit, 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01)
            return;
        const voucherNo = yield nextVoucherNo();
        const status = config.requireApproval ? "DRAFT" : "POSTED";
        yield prisma.financeVoucher.create({
            data: {
                voucherNo,
                voucherDate: params.voucherDate,
                narration: params.narration,
                sourceType: params.sourceType,
                sourceId: params.sourceId,
                totalDebit,
                totalCredit,
                status,
                departmentId: params.departmentId || null,
                batchRunId: params.batchRunId || null,
                createdById: params.createdById || null,
                lines: { create: params.lines },
            },
        });
    });
}

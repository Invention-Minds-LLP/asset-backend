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
exports.getAccountsSummary = void 0;
const prismaClient_1 = __importDefault(require("../../../prismaClient"));
// GET /api/accounts/summary  — dashboard KPIs
const getAccountsSummary = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const [totalPV, postedPV, pendingPV, draftPV, totalPMT, postedPMT, pendingPMT, totalJE, totalCOA,] = yield Promise.all([
            prismaClient_1.default.purchaseVoucher.count(),
            prismaClient_1.default.purchaseVoucher.count({ where: { status: "POSTED" } }),
            prismaClient_1.default.purchaseVoucher.count({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } } }),
            prismaClient_1.default.purchaseVoucher.count({ where: { status: "DRAFT" } }),
            prismaClient_1.default.paymentVoucher.count(),
            prismaClient_1.default.paymentVoucher.count({ where: { status: "POSTED" } }),
            prismaClient_1.default.paymentVoucher.count({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } } }),
            prismaClient_1.default.journalEntry.count(),
            prismaClient_1.default.chartOfAccount.count({ where: { isActive: true } }),
        ]);
        const pvAmounts = yield prismaClient_1.default.purchaseVoucher.aggregate({
            _sum: { amount: true },
            where: { status: "POSTED" },
        });
        const pmtAmounts = yield prismaClient_1.default.paymentVoucher.aggregate({
            _sum: { amount: true },
            where: { status: "POSTED" },
        });
        // Recent purchase vouchers (last 10)
        const recentPV = yield prismaClient_1.default.purchaseVoucher.findMany({
            orderBy: { id: "desc" },
            take: 10,
            select: { id: true, voucherNo: true, voucherDate: true, amount: true, status: true, vendor: { select: { name: true } } },
        });
        // Recent payments
        const recentPMT = yield prismaClient_1.default.paymentVoucher.findMany({
            orderBy: { id: "desc" },
            take: 10,
            select: { id: true, voucherNo: true, voucherDate: true, amount: true, paymentMode: true, status: true, vendor: { select: { name: true } } },
        });
        res.json({
            purchaseVouchers: { total: totalPV, posted: postedPV, pending: pendingPV, draft: draftPV, postedAmount: (_a = pvAmounts._sum.amount) !== null && _a !== void 0 ? _a : 0 },
            paymentVouchers: { total: totalPMT, posted: postedPMT, pending: pendingPMT, postedAmount: (_b = pmtAmounts._sum.amount) !== null && _b !== void 0 ? _b : 0 },
            journalEntries: { total: totalJE },
            chartOfAccounts: { total: totalCOA },
            recentPurchaseVouchers: recentPV,
            recentPaymentVouchers: recentPMT,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch accounts summary" });
    }
});
exports.getAccountsSummary = getAccountsSummary;

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
exports.getTrialBalance = getTrialBalance;
exports.getAssetCostLedger = getAssetCostLedger;
exports.getDepartmentCostSummary = getDepartmentCostSummary;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// GET /api/finance/trial-balance?from=&to=
function getTrialBalance(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { from, to } = req.query;
        try {
            const dateFilter = {};
            if (from)
                dateFilter.gte = new Date(from);
            if (to)
                dateFilter.lte = new Date(to);
            const lines = yield prisma.financeVoucherLine.findMany({
                where: {
                    voucher: Object.assign({ status: "POSTED" }, (Object.keys(dateFilter).length ? { voucherDate: dateFilter } : {})),
                },
                include: { account: true },
            });
            const accountMap = {};
            for (const line of lines) {
                const id = line.accountId;
                if (!accountMap[id]) {
                    accountMap[id] = { code: line.account.code, name: line.account.name, type: line.account.type, debit: 0, credit: 0 };
                }
                accountMap[id].debit += Number(line.debit);
                accountMap[id].credit += Number(line.credit);
            }
            const rows = Object.values(accountMap).sort((a, b) => a.code.localeCompare(b.code));
            const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
            const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
            res.json({ rows, totalDebit, totalCredit });
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to generate trial balance" });
        }
    });
}
// GET /api/finance/asset-cost-ledger/:assetId
function getAssetCostLedger(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const assetId = Number(req.params.assetId);
        try {
            const asset = yield prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, assetId: true, assetName: true, purchaseCost: true } });
            if (!asset) {
                res.status(404).json({ error: "Asset not found" });
                return;
            }
            const vouchers = yield prisma.financeVoucher.findMany({
                where: { sourceId: assetId, status: "POSTED" },
                include: { lines: { include: { account: true } } },
                orderBy: { voucherDate: "asc" },
            });
            res.json({ asset, vouchers });
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load asset cost ledger" });
        }
    });
}
// GET /api/finance/department-cost-summary?fiscalYear=
function getDepartmentCostSummary(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const now = new Date();
        const fy = parseInt(req.query.fiscalYear || String(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1));
        const fyStart = new Date(`${fy}-04-01`);
        const fyEnd = new Date(`${fy + 1}-03-31`);
        try {
            const lines = yield prisma.financeVoucherLine.findMany({
                where: {
                    costCentreId: { not: null },
                    voucher: { status: "POSTED", voucherDate: { gte: fyStart, lte: fyEnd } },
                },
                include: { costCentre: true, voucher: { select: { sourceType: true, voucherDate: true } } },
            });
            const deptMap = {};
            for (const line of lines) {
                const id = line.costCentreId;
                if (!deptMap[id])
                    deptMap[id] = { deptName: ((_a = line.costCentre) === null || _a === void 0 ? void 0 : _a.name) || "", totalDebit: 0, totalCredit: 0, bySource: {} };
                deptMap[id].totalDebit += Number(line.debit);
                deptMap[id].totalCredit += Number(line.credit);
                const src = line.voucher.sourceType;
                deptMap[id].bySource[src] = (deptMap[id].bySource[src] || 0) + Number(line.debit);
            }
            res.json(Object.values(deptMap).sort((a, b) => b.totalDebit - a.totalDebit));
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load department cost summary" });
        }
    });
}

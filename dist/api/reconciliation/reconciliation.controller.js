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
exports.exportSnapshot = exports.resolveSnapshot = exports.getSnapshotDetail = exports.getVarianceReport = exports.runReconciliation = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ── POST /reconciliation/run — generate snapshots for an as-of date ───────────
// Body: { asOfDate, scope: "ASSET"|"CATEGORY"|"POOL", scopeIds?: number[], booksData?: {...} }
const runReconciliation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const { asOfDate, scope = "CATEGORY", scopeIds, booksData } = req.body;
        if (!asOfDate) {
            res.status(400).json({ message: "asOfDate is required" });
            return;
        }
        if (!["ASSET", "CATEGORY", "POOL"].includes(scope)) {
            res.status(400).json({ message: "scope must be ASSET, CATEGORY, or POOL" });
            return;
        }
        const asOf = new Date(asOfDate);
        const employeeId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null;
        const snapshots = [];
        if (scope === "CATEGORY") {
            const categories = (scopeIds === null || scopeIds === void 0 ? void 0 : scopeIds.length)
                ? yield prismaClient_1.default.assetCategory.findMany({ where: { id: { in: scopeIds.map(Number) } } })
                : yield prismaClient_1.default.assetCategory.findMany();
            for (const cat of categories) {
                const assets = yield prismaClient_1.default.asset.findMany({
                    where: { assetCategoryId: cat.id },
                    include: { depreciation: true },
                });
                const sysGross = assets.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
                const sysAccDep = assets.reduce((s, a) => { var _a, _b; return s + Number((_b = (_a = a.depreciation) === null || _a === void 0 ? void 0 : _a.accumulatedDepreciation) !== null && _b !== void 0 ? _b : 0); }, 0);
                const sysNet = sysGross - sysAccDep;
                const audited = assets.reduce((s, a) => { var _a; return s + Number((_a = a.auditedBookValueAtMigration) !== null && _a !== void 0 ? _a : 0); }, 0);
                const books = (_c = booksData === null || booksData === void 0 ? void 0 : booksData[`category_${cat.id}`]) !== null && _c !== void 0 ? _c : null;
                const snap = yield persistSnapshot({
                    asOfDate: asOf,
                    scope: "CATEGORY",
                    scopeId: cat.id,
                    scopeLabel: cat.name,
                    system: { gross: sysGross, accDep: sysAccDep, net: sysNet },
                    audit: { gross: null, accDep: null, net: audited > 0 ? audited : null },
                    books: books ? { gross: books.gross, accDep: books.accDep, net: books.net } : null,
                    createdById: employeeId,
                });
                snapshots.push(snap);
            }
        }
        if (scope === "POOL") {
            const pools = (scopeIds === null || scopeIds === void 0 ? void 0 : scopeIds.length)
                ? yield prismaClient_1.default.assetPool.findMany({
                    where: { id: { in: scopeIds.map(Number) } },
                    include: { depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 } },
                })
                : yield prismaClient_1.default.assetPool.findMany({
                    include: { depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 } },
                });
            for (const pool of pools) {
                const assets = yield prismaClient_1.default.asset.findMany({
                    where: { assetPoolId: pool.id },
                    include: { depreciation: true },
                });
                const sysGross = assets.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
                const sysAccDep = assets.reduce((s, a) => { var _a, _b; return s + Number((_b = (_a = a.depreciation) === null || _a === void 0 ? void 0 : _a.accumulatedDepreciation) !== null && _b !== void 0 ? _b : 0); }, 0);
                const sysNet = sysGross - sysAccDep;
                const latest = (_e = (_d = pool.depreciationSchedules) === null || _d === void 0 ? void 0 : _d[0]) !== null && _e !== void 0 ? _e : null;
                const audit = latest ? {
                    gross: Number(latest.closingGrossBlock),
                    accDep: Number(latest.closingAccumulatedDep),
                    net: Number(latest.closingNetBlock),
                } : null;
                const books = (_f = booksData === null || booksData === void 0 ? void 0 : booksData[`pool_${pool.id}`]) !== null && _f !== void 0 ? _f : null;
                const snap = yield persistSnapshot({
                    asOfDate: asOf,
                    scope: "POOL",
                    scopeId: pool.id,
                    scopeLabel: `${pool.poolCode} (${pool.financialYear})`,
                    system: { gross: sysGross, accDep: sysAccDep, net: sysNet },
                    audit,
                    books: books ? { gross: books.gross, accDep: books.accDep, net: books.net } : null,
                    createdById: employeeId,
                });
                snapshots.push(snap);
            }
        }
        if (scope === "ASSET") {
            const assets = (scopeIds === null || scopeIds === void 0 ? void 0 : scopeIds.length)
                ? yield prismaClient_1.default.asset.findMany({
                    where: { id: { in: scopeIds.map(Number) } },
                    include: { depreciation: true },
                })
                : yield prismaClient_1.default.asset.findMany({ include: { depreciation: true } });
            for (const a of assets) {
                const sysGross = Number((_g = a.purchaseCost) !== null && _g !== void 0 ? _g : 0);
                const sysAccDep = Number((_j = (_h = a.depreciation) === null || _h === void 0 ? void 0 : _h.accumulatedDepreciation) !== null && _j !== void 0 ? _j : 0);
                const sysNet = Number((_l = (_k = a.depreciation) === null || _k === void 0 ? void 0 : _k.currentBookValue) !== null && _l !== void 0 ? _l : sysGross - sysAccDep);
                const auditedNB = Number((_m = a.auditedBookValueAtMigration) !== null && _m !== void 0 ? _m : 0);
                const snap = yield persistSnapshot({
                    asOfDate: asOf,
                    scope: "ASSET",
                    scopeId: a.id,
                    scopeLabel: `${a.assetId} — ${a.assetName}`,
                    system: { gross: sysGross, accDep: sysAccDep, net: sysNet },
                    audit: auditedNB > 0 ? { gross: null, accDep: null, net: auditedNB } : null,
                    books: null,
                    createdById: employeeId,
                });
                snapshots.push(snap);
            }
        }
        const flagged = snapshots.filter(s => s.varianceFlagged).length;
        res.json({
            message: `Reconciliation snapshot generated for ${snapshots.length} ${scope.toLowerCase()}(s)`,
            total: snapshots.length,
            flagged,
            snapshots,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Reconciliation run failed", error: err.message });
    }
});
exports.runReconciliation = runReconciliation;
// ── GET /reconciliation — variance report ─────────────────────────────────────
const getVarianceReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { asOf, scope, status, flaggedOnly, page = "1", limit = "50" } = req.query;
        const where = {};
        if (asOf)
            where.asOfDate = new Date(String(asOf));
        if (scope)
            where.scope = String(scope);
        if (status)
            where.status = String(status);
        if (String(flaggedOnly) === "true")
            where.varianceFlagged = true;
        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const [total, records] = yield Promise.all([
            prismaClient_1.default.reconciliationSnapshot.count({ where }),
            prismaClient_1.default.reconciliationSnapshot.findMany({
                where,
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
                orderBy: [{ varianceFlagged: "desc" }, { asOfDate: "desc" }],
                include: {
                    createdBy: { select: { id: true, name: true } },
                    resolvedBy: { select: { id: true, name: true } },
                },
            }),
        ]);
        res.json({ data: records, pagination: { total, page: pageNum, limit: limitNum } });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load variance report", error: err.message });
    }
});
exports.getVarianceReport = getVarianceReport;
// ── GET /reconciliation/:id — drill-down detail ───────────────────────────────
const getSnapshotDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const snap = yield prismaClient_1.default.reconciliationSnapshot.findUnique({
            where: { id },
            include: {
                createdBy: { select: { id: true, name: true } },
                resolvedBy: { select: { id: true, name: true } },
            },
        });
        if (!snap) {
            res.status(404).json({ message: "Snapshot not found" });
            return;
        }
        // Drill-down: fetch underlying assets for the scope
        let drilldown = [];
        if (snap.scope === "CATEGORY") {
            const assets = yield prismaClient_1.default.asset.findMany({
                where: { assetCategoryId: snap.scopeId },
                select: {
                    id: true, assetId: true, assetName: true,
                    purchaseCost: true,
                    depreciation: { select: { accumulatedDepreciation: true, currentBookValue: true } },
                    auditedBookValueAtMigration: true,
                },
            });
            drilldown = assets.map((a) => {
                var _a, _b, _c, _d, _e;
                return ({
                    assetId: a.assetId, assetName: a.assetName,
                    gross: Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0),
                    accDep: Number((_c = (_b = a.depreciation) === null || _b === void 0 ? void 0 : _b.accumulatedDepreciation) !== null && _c !== void 0 ? _c : 0),
                    net: Number((_e = (_d = a.depreciation) === null || _d === void 0 ? void 0 : _d.currentBookValue) !== null && _e !== void 0 ? _e : 0),
                    auditedNB: a.auditedBookValueAtMigration != null ? Number(a.auditedBookValueAtMigration) : null,
                });
            });
        }
        else if (snap.scope === "POOL") {
            const assets = yield prismaClient_1.default.asset.findMany({
                where: { assetPoolId: snap.scopeId },
                select: {
                    id: true, assetId: true, assetName: true, purchaseCost: true,
                    depreciation: { select: { accumulatedDepreciation: true, currentBookValue: true } },
                },
            });
            drilldown = assets.map((a) => {
                var _a, _b, _c, _d, _e;
                return ({
                    assetId: a.assetId, assetName: a.assetName,
                    gross: Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0),
                    accDep: Number((_c = (_b = a.depreciation) === null || _b === void 0 ? void 0 : _b.accumulatedDepreciation) !== null && _c !== void 0 ? _c : 0),
                    net: Number((_e = (_d = a.depreciation) === null || _d === void 0 ? void 0 : _d.currentBookValue) !== null && _e !== void 0 ? _e : 0),
                });
            });
        }
        res.json({ snapshot: snap, drilldown });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load snapshot detail", error: err.message });
    }
});
exports.getSnapshotDetail = getSnapshotDetail;
// ── PUT /reconciliation/:id/resolve — mark variance accepted/resolved ─────────
const resolveSnapshot = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const id = Number(req.params.id);
        const { status, resolutionNotes } = req.body;
        if (!["RESOLVED", "ACCEPTED"].includes(status)) {
            res.status(400).json({ message: "status must be RESOLVED or ACCEPTED" });
            return;
        }
        const updated = yield prismaClient_1.default.reconciliationSnapshot.update({
            where: { id },
            data: {
                status,
                resolutionNotes: resolutionNotes || null,
                resolvedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                resolvedAt: new Date(),
            },
        });
        res.json({ message: `Marked as ${status}`, snapshot: updated });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to resolve snapshot", error: err.message });
    }
});
exports.resolveSnapshot = resolveSnapshot;
// ── GET /reconciliation/:id/export — Excel export for auditor sign-off ────────
// Lightweight CSV (Excel-openable) — no extra deps
const exportSnapshot = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = Number(req.params.id);
        const snap = yield prismaClient_1.default.reconciliationSnapshot.findUnique({ where: { id } });
        if (!snap) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        let assets = [];
        if (snap.scope === "CATEGORY") {
            assets = yield prismaClient_1.default.asset.findMany({
                where: { assetCategoryId: snap.scopeId },
                include: { depreciation: true },
            });
        }
        else if (snap.scope === "POOL") {
            assets = yield prismaClient_1.default.asset.findMany({
                where: { assetPoolId: snap.scopeId },
                include: { depreciation: true },
            });
        }
        const headers = [
            "Asset Code", "Asset Name", "Gross (System)", "Acc Dep (System)",
            "Net (System)", "Net (Audit)", "Variance",
        ].join(",");
        const rows = assets.map((a) => {
            var _a, _b, _c, _d, _e, _f;
            const sysGross = Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0);
            const sysAccDep = Number((_c = (_b = a.depreciation) === null || _b === void 0 ? void 0 : _b.accumulatedDepreciation) !== null && _c !== void 0 ? _c : 0);
            const sysNet = Number((_e = (_d = a.depreciation) === null || _d === void 0 ? void 0 : _d.currentBookValue) !== null && _e !== void 0 ? _e : sysGross - sysAccDep);
            const auditNB = Number((_f = a.auditedBookValueAtMigration) !== null && _f !== void 0 ? _f : 0);
            const variance = auditNB > 0 ? sysNet - auditNB : 0;
            return [
                a.assetId, `"${a.assetName.replace(/"/g, '""')}"`,
                sysGross.toFixed(2), sysAccDep.toFixed(2), sysNet.toFixed(2),
                auditNB > 0 ? auditNB.toFixed(2) : "", variance.toFixed(2),
            ].join(",");
        });
        const summary = [
            "", "TOTAL",
            Number((_a = snap.systemGrossBlock) !== null && _a !== void 0 ? _a : 0).toFixed(2),
            Number((_b = snap.systemAccDep) !== null && _b !== void 0 ? _b : 0).toFixed(2),
            Number((_c = snap.systemNetBlock) !== null && _c !== void 0 ? _c : 0).toFixed(2),
            snap.auditNetBlock != null ? Number(snap.auditNetBlock).toFixed(2) : "",
            Number(snap.varianceVsAudit).toFixed(2),
        ].join(",");
        const csv = [headers, ...rows, summary].join("\n");
        const filename = `reconciliation_${snap.scope}_${snap.scopeId}_${snap.asOfDate.toISOString().split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Export failed", error: err.message });
    }
});
exports.exportSnapshot = exportSnapshot;
// ── Persistence helper ───────────────────────────────────────────────────────
function persistSnapshot(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { asOfDate, scope, scopeId, scopeLabel, system, audit, books, createdById } = params;
        const auditNet = (_a = audit === null || audit === void 0 ? void 0 : audit.net) !== null && _a !== void 0 ? _a : null;
        const booksNet = (_b = books === null || books === void 0 ? void 0 : books.net) !== null && _b !== void 0 ? _b : null;
        const varVsBooks = booksNet != null ? Number((system.net - booksNet).toFixed(2)) : 0;
        const varVsAudit = auditNet != null ? Number((system.net - auditNet).toFixed(2)) : 0;
        const pctVsBooks = booksNet && booksNet !== 0 ? Number(((varVsBooks / booksNet) * 100).toFixed(2)) : null;
        const pctVsAudit = auditNet && auditNet !== 0 ? Number(((varVsAudit / auditNet) * 100).toFixed(2)) : null;
        // Flag if either variance exceeds ₹1 OR 0.5%
        const flagged = (Math.abs(varVsBooks) > 1 || Math.abs(varVsAudit) > 1) ||
            (pctVsBooks != null && Math.abs(pctVsBooks) > 0.5) ||
            (pctVsAudit != null && Math.abs(pctVsAudit) > 0.5);
        return prismaClient_1.default.reconciliationSnapshot.create({
            data: {
                asOfDate, scope, scopeId, scopeLabel,
                systemGrossBlock: system.gross.toFixed(2),
                systemAccDep: system.accDep.toFixed(2),
                systemNetBlock: system.net.toFixed(2),
                booksGrossBlock: (books === null || books === void 0 ? void 0 : books.gross) != null ? books.gross.toFixed(2) : null,
                booksAccDep: (books === null || books === void 0 ? void 0 : books.accDep) != null ? books.accDep.toFixed(2) : null,
                booksNetBlock: (books === null || books === void 0 ? void 0 : books.net) != null ? books.net.toFixed(2) : null,
                auditGrossBlock: (audit === null || audit === void 0 ? void 0 : audit.gross) != null ? audit.gross.toFixed(2) : null,
                auditAccDep: (audit === null || audit === void 0 ? void 0 : audit.accDep) != null ? audit.accDep.toFixed(2) : null,
                auditNetBlock: (audit === null || audit === void 0 ? void 0 : audit.net) != null ? audit.net.toFixed(2) : null,
                varianceVsBooks: varVsBooks.toFixed(2),
                varianceVsAudit: varVsAudit.toFixed(2),
                variancePctVsBooks: pctVsBooks != null ? pctVsBooks.toFixed(2) : null,
                variancePctVsAudit: pctVsAudit != null ? pctVsAudit.toFixed(2) : null,
                varianceFlagged: flagged,
                createdById,
            },
        });
    });
}

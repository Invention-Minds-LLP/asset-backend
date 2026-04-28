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
exports.runPreAuditSnapshot = exports.runQuarterlyPreview = exports.runYearEndDepreciation = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const depreciationEngine_1 = require("../../utilis/depreciationEngine");
// ── POST /cron-jobs/year-end-depreciation ─────────────────────────────────
const runYearEndDepreciation = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield yearEndDepreciationCore({ preview: false });
        res.json(Object.assign({ message: "Year-end depreciation draft generated" }, result));
    }
    catch (err) {
        console.error("[Year-end Dep] error:", err);
        res.status(500).json({ message: "Year-end depreciation failed", error: err.message });
    }
});
exports.runYearEndDepreciation = runYearEndDepreciation;
// ── POST /cron-jobs/quarterly-preview ─────────────────────────────────────
const runQuarterlyPreview = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield yearEndDepreciationCore({ preview: true });
        res.json(Object.assign({ message: "Quarterly preview generated" }, result));
    }
    catch (err) {
        console.error("[Quarterly Preview] error:", err);
        res.status(500).json({ message: "Quarterly preview failed", error: err.message });
    }
});
exports.runQuarterlyPreview = runQuarterlyPreview;
// ── POST /cron-jobs/pre-audit-snapshot ────────────────────────────────────
const runPreAuditSnapshot = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const today = new Date();
        const fyEnd = today.getMonth() >= 3
            ? new Date(today.getFullYear() + 1, 2, 31)
            : new Date(today.getFullYear(), 2, 31);
        const categories = yield prismaClient_1.default.assetCategory.findMany();
        let count = 0;
        let flagged = 0;
        for (const cat of categories) {
            const assets = yield prismaClient_1.default.asset.findMany({
                where: { assetCategoryId: cat.id },
                include: { depreciation: true },
            });
            const sysGross = assets.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
            const sysAccDep = assets.reduce((s, a) => { var _a, _b; return s + Number((_b = (_a = a.depreciation) === null || _a === void 0 ? void 0 : _a.accumulatedDepreciation) !== null && _b !== void 0 ? _b : 0); }, 0);
            const sysNet = sysGross - sysAccDep;
            const audited = assets.reduce((s, a) => { var _a; return s + Number((_a = a.auditedBookValueAtMigration) !== null && _a !== void 0 ? _a : 0); }, 0);
            const variance = audited > 0 ? sysNet - audited : 0;
            const isFlagged = Math.abs(variance) > 1;
            yield prismaClient_1.default.reconciliationSnapshot.create({
                data: {
                    asOfDate: fyEnd, scope: "CATEGORY", scopeId: cat.id, scopeLabel: cat.name,
                    systemGrossBlock: sysGross.toFixed(2),
                    systemAccDep: sysAccDep.toFixed(2),
                    systemNetBlock: sysNet.toFixed(2),
                    auditNetBlock: audited > 0 ? audited.toFixed(2) : null,
                    varianceVsAudit: variance.toFixed(2),
                    varianceFlagged: isFlagged,
                },
            });
            count++;
            if (isFlagged)
                flagged++;
        }
        console.log("[Pre-Audit Snapshot] " + count + " category snapshots, " + flagged + " flagged");
        res.json({
            message: "Pre-audit reconciliation snapshot generated",
            asOfDate: fyEnd, total: count, flagged,
        });
    }
    catch (err) {
        console.error("[Pre-Audit Snapshot] error:", err);
        res.status(500).json({ message: "Pre-audit snapshot failed", error: err.message });
    }
});
exports.runPreAuditSnapshot = runPreAuditSnapshot;
/* ── Core year-end / preview helper ──────────────────────────────────── */
function yearEndDepreciationCore(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const today = new Date();
        // Target = the FY that has already ended and is most recent
        const targetFYEnd = (0, depreciationEngine_1.getFYContext)(new Date(today.getTime() - 86400000));
        const depreciations = yield prismaClient_1.default.assetDepreciation.findMany({
            where: { isActive: true },
            include: {
                asset: {
                    select: {
                        id: true, assetId: true, assetName: true, purchaseCost: true,
                        estimatedValue: true, purchaseDate: true,
                        isLegacyAsset: true, migrationMode: true, migrationDate: true,
                        originalPurchaseDate: true, originalCost: true,
                        accDepAtMigration: true, openingWdvAtMigration: true,
                    },
                },
            },
        });
        const eligible = [];
        for (const dep of depreciations) {
            const cost = Number((_b = (_a = dep.asset.purchaseCost) !== null && _a !== void 0 ? _a : dep.asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
            const salvage = (0, depreciationEngine_1.effectiveResidualValue)(cost, Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0));
            if (dep.lastCalculatedAt && new Date(dep.lastCalculatedAt) >= targetFYEnd.fyEnd)
                continue;
            const a = {
                id: dep.asset.id, assetId: dep.asset.assetId,
                purchaseCost: cost, estimatedValue: Number((_d = dep.asset.estimatedValue) !== null && _d !== void 0 ? _d : 0),
                purchaseDate: dep.asset.purchaseDate, installedAt: null,
                isLegacyAsset: dep.asset.isLegacyAsset,
                migrationMode: dep.asset.migrationMode,
                migrationDate: dep.asset.migrationDate,
                originalPurchaseDate: dep.asset.originalPurchaseDate,
                originalCost: dep.asset.originalCost,
                accDepAtMigration: dep.asset.accDepAtMigration,
                openingWdvAtMigration: dep.asset.openingWdvAtMigration,
            };
            const cfg = {
                method: dep.depreciationMethod, rate: Number((_e = dep.depreciationRate) !== null && _e !== void 0 ? _e : 0),
                lifeYears: dep.expectedLifeYears, salvage,
                depreciationStart: new Date(dep.depreciationStart),
                frequency: dep.depreciationFrequency || "YEARLY",
                roundOff: (_f = dep.roundOff) !== null && _f !== void 0 ? _f : false, decimalPlaces: (_g = dep.decimalPlaces) !== null && _g !== void 0 ? _g : 2,
            };
            const result = yield (0, depreciationEngine_1.calculateAssetFYDepreciation)(a, cfg, targetFYEnd);
            if (result.preMigrationSkipped || result.depreciationAmount <= 0)
                continue;
            eligible.push({ dep, result });
        }
        if (!eligible.length) {
            return {
                fyLabel: targetFYEnd.fyLabel, totalAssets: 0,
                totalDepreciation: 0, status: "NO_OP",
            };
        }
        const totalDep = eligible.reduce((s, e) => s + e.result.depreciationAmount, 0);
        if (opts.preview) {
            return {
                fyLabel: targetFYEnd.fyLabel,
                totalAssets: eligible.length,
                totalDepreciation: Number(totalDep.toFixed(2)),
                status: "PREVIEW",
                note: "Preview only — no records persisted",
            };
        }
        // Find a system user (first SUPERADMIN or first employee) for the run
        const sysUser = yield prismaClient_1.default.employee.findFirst({ orderBy: { id: "asc" } });
        const runById = (_h = sysUser === null || sysUser === void 0 ? void 0 : sysUser.id) !== null && _h !== void 0 ? _h : 1;
        const runNumber = "BDR-CRON-" + targetFYEnd.fyLabel + "-" + Date.now();
        const run = yield prismaClient_1.default.batchDepreciationRun.create({
            data: {
                runNumber, status: "DRAFT",
                fiscalYear: targetFYEnd.fyStart.getFullYear(),
                periodLabel: "Year-End " + targetFYEnd.fyLabel,
                totalAssets: eligible.length,
                totalDepreciation: totalDep.toFixed(2),
                runById,
            },
        });
        for (const e of eligible) {
            yield prismaClient_1.default.depreciationLog.create({
                data: {
                    assetId: e.dep.asset.id,
                    periodStart: e.result.periodStart,
                    periodEnd: e.result.periodEnd,
                    depreciationAmount: e.result.depreciationAmount.toFixed(2),
                    bookValueAfter: e.result.closingWdv.toFixed(2),
                    fyLabel: e.result.fyLabel,
                    openingWdv: e.result.openingWdv.toFixed(2),
                    depOnOpening: e.result.depOnOpening.toFixed(2),
                    depOnAdditions: e.result.depOnAdditions.toFixed(2),
                    additionsAmount: e.result.additionsAmount.toFixed(2),
                    effectiveRate: e.result.effectiveRate.toFixed(4),
                    halfYearApplied: e.result.halfYearApplied,
                    isFirstFY: e.result.isFirstFY,
                    openingWdvSource: e.result.openingWdvSource,
                    reason: "CRON_YEAR_END_DRAFT",
                    batchRunId: run.id,
                },
            });
        }
        console.log("[Year-End Dep] Draft " + runNumber + ": " + eligible.length + " assets, total " + totalDep.toFixed(2));
        return {
            runNumber, runId: run.id,
            fyLabel: targetFYEnd.fyLabel,
            totalAssets: eligible.length,
            totalDepreciation: Number(totalDep.toFixed(2)),
            status: "DRAFT",
            note: "Pending CFO approval to commit values",
        };
    });
}

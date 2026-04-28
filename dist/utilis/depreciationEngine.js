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
exports.isSecondHalfOfIndianFY = isSecondHalfOfIndianFY;
exports.getFYContext = getFYContext;
exports.applyRoundOff = applyRoundOff;
exports.effectiveResidualValue = effectiveResidualValue;
exports.resolveOpeningWdv = resolveOpeningWdv;
exports.calculateAssetFYDepreciation = calculateAssetFYDepreciation;
exports.persistDepreciationResult = persistDepreciationResult;
exports.backfillHistoricalDepreciation = backfillHistoricalDepreciation;
/**
 * ────────────────────────────────────────────────────────────────────────────
 *  Depreciation Engine — Indian IT Act compliant
 *  - Half-year rule: assets purchased Apr-Sep get 100% rate; Oct-Mar get 50%
 *    in the year of acquisition only. From Y2 onwards, full rate on opening WDV.
 *  - Split logic: opening WDV (full rate) + additions in FY (full or half rate)
 *  - Legacy assets: engine NEVER computes for periods before migrationDate.
 * ────────────────────────────────────────────────────────────────────────────
 */
const prismaClient_1 = __importDefault(require("../prismaClient"));
/* ── Helpers ─────────────────────────────────────────────────────────────── */
function isSecondHalfOfIndianFY(date) {
    const m = date.getMonth(); // 0=Jan
    return m >= 9 || m <= 2; // Oct, Nov, Dec, Jan, Feb, Mar
}
/** Return the Indian FY context (Apr 1 – Mar 31) that contains the given date. */
function getFYContext(date) {
    const m = date.getMonth();
    const y = date.getFullYear();
    const fyStartYear = m >= 3 ? y : y - 1; // Apr (3) onwards = current year
    const fyStart = new Date(fyStartYear, 3, 1); // Apr 1
    const fyEnd = new Date(fyStartYear + 1, 2, 31, 23, 59, 59); // Mar 31 next year
    const fyLabel = `FY${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
    return { fyStart, fyEnd, fyLabel };
}
/** Round a number per asset's round-off settings. */
function applyRoundOff(value, roundOff, decimalPlaces) {
    if (!roundOff)
        return Number(value.toFixed(2));
    return Number(value.toFixed(decimalPlaces));
}
/** Effective residual value (defaults to 5% of cost if not explicitly stored). */
function effectiveResidualValue(cost, storedSalvage) {
    if (storedSalvage != null && Number(storedSalvage) > 0)
        return Number(storedSalvage);
    return Number((cost * 0.05).toFixed(2));
}
/* ── Opening WDV resolver ────────────────────────────────────────────────── */
/**
 * Resolve the opening WDV for the given FY.
 *  Priority:
 *   1. PRIOR_LOG     — bookValueAfter from the most recent log whose periodEnd ≤ fyStart
 *   2. MIGRATION     — openingWdvAtMigration (if asset is legacy and we're in/after migration FY)
 *   3. PURCHASE_COST — fallback for the asset's first FY of dep
 */
function resolveOpeningWdv(asset, cost, fy) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // 1. Try prior log — find the most recent log whose periodEnd is on/before this FY's start
        const priorLog = yield prismaClient_1.default.depreciationLog.findFirst({
            where: { assetId: asset.id, periodEnd: { lte: fy.fyStart } },
            orderBy: { periodEnd: "desc" },
            select: { bookValueAfter: true, periodEnd: true },
        });
        if (priorLog) {
            // Sum of all dep amounts so far = cost − bookValueAfter
            const accDepBefore = Number(cost) - Number(priorLog.bookValueAfter);
            return {
                openingWdv: Number(priorLog.bookValueAfter),
                source: "PRIOR_LOG",
                accDepBefore: Math.max(0, accDepBefore),
            };
        }
        // 2. Legacy migration path
        if (asset.isLegacyAsset && asset.migrationDate && asset.openingWdvAtMigration != null) {
            const migrationFY = getFYContext(new Date(asset.migrationDate));
            if (fy.fyStart.getTime() === migrationFY.fyStart.getTime()) {
                return {
                    openingWdv: Number(asset.openingWdvAtMigration),
                    source: "MIGRATION",
                    accDepBefore: Number((_a = asset.accDepAtMigration) !== null && _a !== void 0 ? _a : 0),
                };
            }
        }
        // 3. Fallback — first FY ever for this asset
        return { openingWdv: cost, source: "PURCHASE_COST", accDepBefore: 0 };
    });
}
/* ── Core split-method calculation ───────────────────────────────────────── */
/**
 * Compute one FY's depreciation for one asset using split-method:
 *  - Opening WDV  → full rate
 *  - Additions    → full rate if Apr-Sep, half rate if Oct-Mar (in year of acquisition)
 *
 * For our model (one Asset = one purchase), the "addition" only happens in the
 * asset's first FY. Subsequent years run at full rate on the carried-forward WDV.
 */
function calculateAssetFYDepreciation(asset, cfg, fy) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        // ── Legacy guard: skip periods before migrationDate ─────────────────────
        if (asset.isLegacyAsset && asset.migrationDate) {
            const migration = new Date(asset.migrationDate);
            if (fy.fyEnd < migration) {
                return emptyResult(fy, 0, 0, true);
            }
        }
        // ── Resolve opening WDV ──────────────────────────────────────────────────
        const { openingWdv, source, accDepBefore } = yield resolveOpeningWdv(asset, cost, fy);
        // ── Determine if THIS FY is the asset's first FY of depreciation ────────
        const acquisitionDate = new Date((_d = (_c = asset.originalPurchaseDate) !== null && _c !== void 0 ? _c : asset.purchaseDate) !== null && _d !== void 0 ? _d : cfg.depreciationStart);
        const acquisitionFY = getFYContext(acquisitionDate);
        const isFirstFY = (fy.fyStart.getTime() === acquisitionFY.fyStart.getTime() &&
            source === "PURCHASE_COST");
        // For legacy CARRY_AS_NEW mode → treat migrationDate as the addition date
        let additionsAmount = 0;
        let halfYearApplied = false;
        if (isFirstFY) {
            additionsAmount = cost;
            halfYearApplied = isSecondHalfOfIndianFY(acquisitionDate);
        }
        // ── Compute depreciation ─────────────────────────────────────────────────
        const fullRate = cfg.rate / 100;
        let depOnOpening = 0;
        let depOnAdditions = 0;
        if (cfg.method === "SL") {
            // SL: simple annual = (cost − salvage) / lifeYears, evenly distributed
            const annual = (cost - cfg.salvage) / Math.max(1, cfg.lifeYears);
            if (isFirstFY) {
                depOnAdditions = halfYearApplied ? annual / 2 : annual;
            }
            else {
                depOnOpening = annual;
            }
        }
        else if (cfg.method === "DB") {
            // DB split: opening WDV at full rate, additions at full/half
            if (!isFirstFY) {
                depOnOpening = openingWdv * fullRate;
            }
            else {
                const effRate = halfYearApplied ? fullRate / 2 : fullRate;
                depOnAdditions = additionsAmount * effRate;
            }
        }
        // ── Cap at salvage floor ─────────────────────────────────────────────────
        const grossWdv = openingWdv + (isFirstFY && source !== "PURCHASE_COST" ? additionsAmount : 0);
        const totalDep = depOnOpening + depOnAdditions;
        const maxAllowed = Math.max(0, grossWdv - cfg.salvage);
        let capped = Math.min(totalDep, maxAllowed);
        capped = applyRoundOff(capped, cfg.roundOff, cfg.decimalPlaces);
        // Re-distribute the cap proportionally
        if (totalDep > 0 && capped < totalDep) {
            const ratio = capped / totalDep;
            depOnOpening = Number((depOnOpening * ratio).toFixed(2));
            depOnAdditions = Number((depOnAdditions * ratio).toFixed(2));
        }
        else {
            depOnOpening = applyRoundOff(depOnOpening, cfg.roundOff, cfg.decimalPlaces);
            depOnAdditions = applyRoundOff(depOnAdditions, cfg.roundOff, cfg.decimalPlaces);
        }
        const depreciationAmount = Number((depOnOpening + depOnAdditions).toFixed(2));
        const closingWdv = applyRoundOff(grossWdv - depreciationAmount, cfg.roundOff, cfg.decimalPlaces);
        const effectiveRate = isFirstFY ? (halfYearApplied ? cfg.rate / 2 : cfg.rate) : cfg.rate;
        return {
            fyLabel: fy.fyLabel,
            periodStart: fy.fyStart,
            periodEnd: fy.fyEnd,
            openingWdv,
            openingWdvSource: source,
            additionsAmount,
            isFirstFY,
            halfYearApplied,
            effectiveRate,
            depOnOpening,
            depOnAdditions,
            depreciationAmount,
            closingWdv,
            accDepBefore,
            accDepAfter: Number((accDepBefore + depreciationAmount).toFixed(2)),
            preMigrationSkipped: false,
        };
    });
}
function emptyResult(fy, openingWdv, accDep, skipped) {
    return {
        fyLabel: fy.fyLabel,
        periodStart: fy.fyStart,
        periodEnd: fy.fyEnd,
        openingWdv,
        openingWdvSource: "MIGRATION",
        additionsAmount: 0,
        isFirstFY: false,
        halfYearApplied: false,
        effectiveRate: 0,
        depOnOpening: 0,
        depOnAdditions: 0,
        depreciationAmount: 0,
        closingWdv: openingWdv,
        accDepBefore: accDep,
        accDepAfter: accDep,
        preMigrationSkipped: skipped,
    };
}
/* ── Persistence helper ──────────────────────────────────────────────────── */
function persistDepreciationResult(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const { assetId, depRecordId, result, doneById, reason, batchRunId } = params;
        return prismaClient_1.default.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            const log = yield tx.depreciationLog.create({
                data: {
                    assetId,
                    periodStart: result.periodStart,
                    periodEnd: result.periodEnd,
                    depreciationAmount: result.depreciationAmount.toFixed(2),
                    bookValueAfter: result.closingWdv.toFixed(2),
                    fyLabel: result.fyLabel,
                    openingWdv: result.openingWdv.toFixed(2),
                    depOnOpening: result.depOnOpening.toFixed(2),
                    depOnAdditions: result.depOnAdditions.toFixed(2),
                    additionsAmount: result.additionsAmount.toFixed(2),
                    effectiveRate: result.effectiveRate.toFixed(4),
                    halfYearApplied: result.halfYearApplied,
                    isFirstFY: result.isFirstFY,
                    openingWdvSource: result.openingWdvSource,
                    doneById: doneById !== null && doneById !== void 0 ? doneById : null,
                    reason,
                    batchRunId: batchRunId !== null && batchRunId !== void 0 ? batchRunId : null,
                },
            });
            const updated = yield tx.assetDepreciation.update({
                where: { id: depRecordId },
                data: {
                    accumulatedDepreciation: result.accDepAfter.toFixed(2),
                    currentBookValue: result.closingWdv.toFixed(2),
                    lastCalculatedAt: result.periodEnd,
                    updatedById: doneById !== null && doneById !== void 0 ? doneById : null,
                },
            });
            return { log, updated };
        }));
    });
}
/* ── Backfill historical logs ─────────────────────────────────────────── */
/**
 * Generate one DepreciationLog entry per completed FY between the asset's
 * effective start date and today. Used at import / manual creation time to
 * ensure historical FA Schedule reports show the correct per-FY values.
 *
 * Effective start date priority:
 *   1. asset.financialYearAdded (pool-individualized assets)
 *   2. asset.migrationDate (legacy migration assets)
 *   3. cfg.depreciationStart (regular assets)
 *
 * Skips if logs already exist for the asset (prevents duplicate generation).
 */
function backfillHistoricalDepreciation(assetId_1, depRecordId_1, asset_1, cfg_1) {
    return __awaiter(this, arguments, void 0, function* (assetId, depRecordId, asset, cfg, doneById = null) {
        // Skip if any logs already exist
        const existingLogCount = yield prismaClient_1.default.depreciationLog.count({ where: { assetId } });
        if (existingLogCount > 0) {
            return { created: 0, skipped: existingLogCount, latestFy: null };
        }
        // Determine the effective start FY
        let startDate = null;
        // Priority 1: pool-individualized → start from financialYearAdded FY end (handover point)
        if (asset.assetPoolId && asset.financialYearAdded) {
            // Parse FY string like "FY2024-25" → start year = 2024
            const m = asset.financialYearAdded.match(/FY(\d{4})/);
            if (m) {
                const fyStartYear = Number(m[1]);
                // Use first day of next FY (handover happened at end of pool's FY)
                startDate = new Date(fyStartYear + 1, 3, 1); // Apr 1 of next year
            }
        }
        // Priority 2: legacy migration → start from migrationDate FY
        if (!startDate && asset.isLegacyAsset && asset.migrationDate) {
            const migDate = new Date(asset.migrationDate);
            const migFY = getFYContext(migDate);
            startDate = new Date(migFY.fyEnd.getTime() + 86400000); // day after migration FY end
        }
        // Priority 3: regular asset → start from depreciationStart
        if (!startDate) {
            startDate = new Date(cfg.depreciationStart);
        }
        if (!startDate || isNaN(startDate.getTime())) {
            return { created: 0, skipped: 0, latestFy: null };
        }
        const today = new Date();
        let fy = getFYContext(startDate);
        let created = 0;
        let latestFy = null;
        // Loop through each completed FY up to (but not including) the current FY
        while (fy.fyEnd < today) {
            const result = yield calculateAssetFYDepreciation(asset, cfg, fy);
            if (!result.preMigrationSkipped && result.depreciationAmount >= 0) {
                yield persistDepreciationResult({
                    assetId,
                    depRecordId,
                    result,
                    doneById,
                    reason: "BACKFILL",
                });
                created++;
                latestFy = result.fyLabel;
            }
            // Advance to next FY
            fy = getFYContext(new Date(fy.fyEnd.getTime() + 86400000));
        }
        return { created, skipped: 0, latestFy };
    });
}

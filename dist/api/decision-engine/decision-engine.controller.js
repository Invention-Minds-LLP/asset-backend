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
exports.getDashboardSummary = exports.upsertConfig = exports.getConfigs = exports.getAssetHistory = exports.evaluateAllAssets = exports.evaluateSingleAsset = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const DEFAULT_CONFIG = {
    weightMaintenanceRatio: 30,
    weightAgeFactor: 20,
    weightBreakdownFreq: 20,
    weightDowntimeImpact: 15,
    weightCostTrend: 15,
    thresholdMonitor: 36,
    thresholdReview: 56,
    thresholdReplace: 76,
    maintenanceRatioCeiling: 1.5,
    breakdownHighPerYear: 6,
    downtimeHighHours: 720,
    costTrendHighPct: 50,
};
// Clamp a value between 0 and 100
function clamp(val) {
    return Math.min(100, Math.max(0, val));
}
function mapDecision(score, config) {
    if (score >= config.thresholdReplace)
        return "REPLACE_IMMEDIATELY";
    if (score >= config.thresholdReview)
        return "REVIEW_FOR_REPLACEMENT";
    if (score >= config.thresholdMonitor)
        return "MONITOR";
    return "CONTINUE_MAINTENANCE";
}
function evaluateCapExTriggers(maintRatio, config, breakdownCount12m, downtimeHours12m, ageYears, expectedLifeYears, slaLimitHours) {
    // Threshold_X = maintenanceRatioCeiling (the ratio where score hits 100)
    const thresholdX = config.maintenanceRatioCeiling;
    const triggers = [];
    // Condition 1: Maintenance Ratio ≥ Threshold_X
    const c1 = maintRatio >= thresholdX;
    triggers.push({
        id: "MAINT_RATIO_EXCEEDED",
        label: "Maintenance Ratio ≥ Threshold",
        fired: c1,
        detail: `Maintenance Ratio: ${round1(maintRatio)} ${c1 ? "≥" : "<"} Threshold: ${thresholdX}`,
    });
    // Condition 2: Maintenance Ratio ≥ (Threshold_X - 10%) AND Breakdowns ≥ 3
    const c2Ratio = maintRatio >= thresholdX * 0.9;
    const c2Breakdown = breakdownCount12m >= 3;
    const c2 = c2Ratio && c2Breakdown;
    triggers.push({
        id: "MAINT_PLUS_BREAKDOWNS",
        label: "High Ratio + Frequent Breakdowns",
        fired: c2,
        detail: `Ratio: ${round1(maintRatio)} ${c2Ratio ? "≥" : "<"} ${round1(thresholdX * 0.9)} (90% of threshold) AND Breakdowns: ${breakdownCount12m} ${c2Breakdown ? "≥" : "<"} 3`,
    });
    // Condition 3: Maintenance Ratio ≥ (Threshold_X - 5%) AND Downtime > SLA limit
    const slaLimit = slaLimitHours !== null && slaLimitHours !== void 0 ? slaLimitHours : config.downtimeHighHours * 0.5; // fallback: 50% of high threshold
    const c3Ratio = maintRatio >= thresholdX * 0.95;
    const c3Downtime = downtimeHours12m > slaLimit;
    const c3 = c3Ratio && c3Downtime;
    triggers.push({
        id: "MAINT_PLUS_DOWNTIME",
        label: "High Ratio + Excessive Downtime",
        fired: c3,
        detail: `Ratio: ${round1(maintRatio)} ${c3Ratio ? "≥" : "<"} ${round1(thresholdX * 0.95)} (95% of threshold) AND Downtime: ${round1(downtimeHours12m)}h ${c3Downtime ? ">" : "≤"} SLA limit: ${round1(slaLimit)}h`,
    });
    // Condition 4: Asset Age ≥ 70% of Useful Life AND Maintenance Ratio ≥ (Threshold_X - 10%)
    const lifeUsed = expectedLifeYears > 0 ? ageYears / expectedLifeYears : 0;
    const c4Age = lifeUsed >= 0.7;
    const c4Ratio = maintRatio >= thresholdX * 0.9;
    const c4 = c4Age && c4Ratio;
    triggers.push({
        id: "AGING_PLUS_MAINT",
        label: "Aging Asset + Rising Maintenance",
        fired: c4,
        detail: `Life used: ${round1(lifeUsed * 100)}% ${c4Age ? "≥" : "<"} 70% AND Ratio: ${round1(maintRatio)} ${c4Ratio ? "≥" : "<"} ${round1(thresholdX * 0.9)}`,
    });
    return {
        triggered: triggers.some((t) => t.fired),
        triggers,
    };
}
function buildReasons(signals, data) {
    const reasons = [];
    if (signals.maintenanceRatio >= 70) {
        reasons.push(`Maintenance cost (₹${fmt(data.maintenanceCost)}) has reached ${Math.round((data.maintenanceCost / Math.max(data.bookValue, 1)) * 100)}% of current book value (₹${fmt(data.bookValue)}) — it will cost more to maintain than the asset is worth.`);
    }
    else if (signals.maintenanceRatio >= 40) {
        reasons.push(`Maintenance cost is approaching ${Math.round((data.maintenanceCost / Math.max(data.bookValue, 1)) * 100)}% of book value — monitor closely.`);
    }
    if (signals.ageFactor >= 80) {
        reasons.push(`Asset has exceeded its expected useful life (${round1(data.ageYears)} yrs used of ${data.expectedLifeYears} yr expected).`);
    }
    else if (signals.ageFactor >= 50) {
        const remaining = Math.max(0, data.expectedLifeYears - data.ageYears);
        reasons.push(`Asset is ${round1(data.ageYears)} years old with only ~${round1(remaining)} years of useful life remaining.`);
    }
    if (signals.breakdownFreq >= 70) {
        reasons.push(`High breakdown frequency: ${data.breakdownCount12m} corrective repairs in the last 12 months — reliability is degrading.`);
    }
    else if (signals.breakdownFreq >= 40) {
        reasons.push(`Moderate breakdown activity: ${data.breakdownCount12m} repairs in the last 12 months.`);
    }
    if (signals.downtimeImpact >= 70) {
        reasons.push(`Significant downtime: ${round1(data.downtimeHours12m)} hours lost in the last 12 months — operational impact is high.`);
    }
    else if (signals.downtimeImpact >= 40) {
        reasons.push(`${round1(data.downtimeHours12m)} hours of downtime recorded in the last 12 months.`);
    }
    if (data.costTrendPct != null && signals.costTrend >= 60) {
        reasons.push(`Maintenance costs are accelerating — ${round1(data.costTrendPct)}% increase year-over-year.`);
    }
    if (data.replacementEstimate != null && data.maintenanceCost > data.replacementEstimate * 0.5) {
        reasons.push(`Total maintenance cost has reached ${Math.round((data.maintenanceCost / data.replacementEstimate) * 100)}% of the estimated replacement cost (₹${fmt(data.replacementEstimate)}).`);
    }
    if (reasons.length === 0) {
        reasons.push("Asset is healthy — within acceptable maintenance cost and useful life parameters.");
    }
    return reasons;
}
function fmt(n) {
    return Math.round(n).toLocaleString("en-IN");
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
// ─── Helper: load config (per-category or global default) ─────────────────────
function loadConfig(categoryId) {
    return __awaiter(this, void 0, void 0, function* () {
        let config = null;
        if (categoryId) {
            config = yield prismaClient_1.default.decisionEngineConfig.findUnique({
                where: { categoryId },
            });
        }
        // Fall back to global default (categoryId = null)
        if (!config) {
            config = yield prismaClient_1.default.decisionEngineConfig.findFirst({
                where: { categoryId: null },
            });
        }
        if (!config)
            return Object.assign({}, DEFAULT_CONFIG);
        return {
            weightMaintenanceRatio: config.weightMaintenanceRatio,
            weightAgeFactor: config.weightAgeFactor,
            weightBreakdownFreq: config.weightBreakdownFreq,
            weightDowntimeImpact: config.weightDowntimeImpact,
            weightCostTrend: config.weightCostTrend,
            thresholdMonitor: config.thresholdMonitor,
            thresholdReview: config.thresholdReview,
            thresholdReplace: config.thresholdReplace,
            maintenanceRatioCeiling: config.maintenanceRatioCeiling,
            breakdownHighPerYear: config.breakdownHighPerYear,
            downtimeHighHours: config.downtimeHighHours,
            costTrendHighPct: config.costTrendHighPct,
        };
    });
}
// ─── Helper: compute signals for a single asset ──────────────────────────────
function evaluateAsset(assetDbId, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetDbId },
            include: {
                depreciation: true,
                assetCategory: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
            },
        });
        if (!asset)
            return null;
        const now = Date.now();
        const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
        const msPerHour = 1000 * 60 * 60;
        const oneYearAgo = new Date(now - msPerYear);
        // ── Age ────────────────────────────────────────────────────────────────────
        const dep = asset.depreciation;
        const ageBasisDate = (_c = (_b = (_a = asset.purchaseDate) !== null && _a !== void 0 ? _a : asset.installedAt) !== null && _b !== void 0 ? _b : dep === null || dep === void 0 ? void 0 : dep.depreciationStart) !== null && _c !== void 0 ? _c : null;
        const ageYears = ageBasisDate ? (now - new Date(ageBasisDate).getTime()) / msPerYear : 0;
        const expectedLifeYears = (_e = (_d = dep === null || dep === void 0 ? void 0 : dep.expectedLifeYears) !== null && _d !== void 0 ? _d : asset.expectedLifetime) !== null && _e !== void 0 ? _e : 0;
        // ── Book value ────────────────────────────────────────────────────────────
        const originalCost = Number((_g = (_f = asset.purchaseCost) !== null && _f !== void 0 ? _f : asset.estimatedValue) !== null && _g !== void 0 ? _g : 0);
        const currentBookValue = (dep === null || dep === void 0 ? void 0 : dep.currentBookValue) != null ? Number(dep.currentBookValue) : originalCost;
        // ── Collect sub-asset IDs for cost rollup ────────────────────────────────
        const subAssets = yield prismaClient_1.default.asset.findMany({
            where: { parentAssetId: assetDbId },
            select: { id: true },
        });
        const allAssetIds = [assetDbId, ...subAssets.map((s) => s.id)];
        // ── Maintenance cost (all time) ───────────────────────────────────────────
        // MaintenanceHistory.ticketId links a maintenance record back to the ticket
        // that triggered it. To avoid double-counting, ticket costs are only included
        // for tickets that do NOT already have a linked MaintenanceHistory record.
        const [maintenanceAgg, spareAgg, linkedTicketIds] = yield Promise.all([
            prismaClient_1.default.maintenanceHistory.aggregate({
                where: { assetId: { in: allAssetIds } },
                _sum: { totalCost: true },
            }),
            prismaClient_1.default.sparePartUsage
                ? prismaClient_1.default.sparePartUsage.aggregate({
                    where: { assetId: { in: allAssetIds } },
                    _sum: { costAtUse: true },
                }).catch(() => ({ _sum: { costAtUse: null } }))
                : Promise.resolve({ _sum: { costAtUse: null } }),
            // IDs of tickets that already have a MaintenanceHistory entry (internal fix)
            prismaClient_1.default.maintenanceHistory.findMany({
                where: { assetId: { in: allAssetIds }, ticketId: { not: null } },
                select: { ticketId: true },
            }).then((rows) => rows.map((r) => r.ticketId)),
        ]);
        // Sum only ticket costs for tickets NOT covered by a MaintenanceHistory record
        const ticketAgg = yield prismaClient_1.default.ticket.aggregate({
            where: Object.assign({ assetId: { in: allAssetIds } }, (linkedTicketIds.length > 0 ? { id: { notIn: linkedTicketIds } } : {})),
            _sum: { totalCost: true },
        });
        const totalMaintenanceCost = Number((_h = maintenanceAgg._sum.totalCost) !== null && _h !== void 0 ? _h : 0) +
            Number((_j = ticketAgg._sum.totalCost) !== null && _j !== void 0 ? _j : 0) +
            Number((_l = (_k = spareAgg._sum) === null || _k === void 0 ? void 0 : _k.costAtUse) !== null && _l !== void 0 ? _l : 0);
        // ── Breakdown count (last 12 months) ──────────────────────────────────────
        const breakdownCount12m = yield prismaClient_1.default.ticket.count({
            where: {
                assetId: { in: allAssetIds },
                workCategory: { in: ["BREAKDOWN", "CORRECTIVE"] },
                createdAt: { gte: oneYearAgo },
            },
        });
        // ── Downtime hours (last 12 months) ──────────────────────────────────────
        const downtimeTickets = yield prismaClient_1.default.ticket.findMany({
            where: {
                assetId: { in: allAssetIds },
                downtimeStart: { not: null },
                createdAt: { gte: oneYearAgo },
            },
            select: { downtimeStart: true, downtimeEnd: true },
        });
        let downtimeHours12m = 0;
        for (const t of downtimeTickets) {
            if (t.downtimeStart) {
                const start = new Date(t.downtimeStart).getTime();
                const end = t.downtimeEnd ? new Date(t.downtimeEnd).getTime() : now;
                downtimeHours12m += (end - start) / msPerHour;
            }
        }
        // ── Cost trend: compare last 12 months vs prior 12 months ────────────────
        const twoYearsAgo = new Date(now - 2 * msPerYear);
        const [costRecent, costPrior] = yield Promise.all([
            prismaClient_1.default.ticket.aggregate({
                where: {
                    assetId: { in: allAssetIds },
                    createdAt: { gte: oneYearAgo },
                },
                _sum: { totalCost: true },
            }),
            prismaClient_1.default.ticket.aggregate({
                where: {
                    assetId: { in: allAssetIds },
                    createdAt: { gte: twoYearsAgo, lt: oneYearAgo },
                },
                _sum: { totalCost: true },
            }),
        ]);
        const recentCost = Number((_m = costRecent._sum.totalCost) !== null && _m !== void 0 ? _m : 0);
        const priorCost = Number((_o = costPrior._sum.totalCost) !== null && _o !== void 0 ? _o : 0);
        const costTrendPct = priorCost > 0
            ? ((recentCost - priorCost) / priorCost) * 100
            : null;
        // ── Replacement estimate ─────────────────────────────────────────────────
        const inflationRate = 0.10;
        const replacementEstimate = originalCost > 0
            ? Math.round(originalCost * Math.pow(1 + inflationRate, Math.round(ageYears)))
            : null;
        // ═══════════════════════════════════════════════════════════════════════════
        // SIGNAL SCORING (each 0–100)
        // ═══════════════════════════════════════════════════════════════════════════
        // 1. Maintenance Ratio — maintenance cost vs book value
        const maintRatio = currentBookValue > 0 ? totalMaintenanceCost / currentBookValue : 0;
        const scoreMaintenanceRatio = clamp((maintRatio / config.maintenanceRatioCeiling) * 100);
        // 2. Age Factor — how far past useful life
        let scoreAgeFactor = 0;
        if (expectedLifeYears > 0) {
            const lifeUsed = ageYears / expectedLifeYears;
            if (lifeUsed >= 1.0) {
                // Past expected life — score 80 minimum, rising to 100 at 1.5x
                scoreAgeFactor = clamp(80 + ((lifeUsed - 1.0) / 0.5) * 20);
            }
            else {
                // Score rises more steeply after 60% life used
                scoreAgeFactor = clamp(lifeUsed <= 0.6 ? lifeUsed * 40 : 24 + ((lifeUsed - 0.6) / 0.4) * 56);
            }
        }
        // 3. Breakdown Frequency — normalized per year
        const breakdownsPerYear = ageYears > 0
            ? breakdownCount12m // already 12-month window
            : breakdownCount12m;
        const scoreBreakdownFreq = clamp((breakdownsPerYear / config.breakdownHighPerYear) * 100);
        // 4. Downtime Impact
        const scoreDowntimeImpact = clamp((downtimeHours12m / config.downtimeHighHours) * 100);
        // 5. Cost Trend
        let scoreCostTrend = 0;
        if (costTrendPct != null && costTrendPct > 0) {
            scoreCostTrend = clamp((costTrendPct / config.costTrendHighPct) * 100);
        }
        const signals = {
            maintenanceRatio: round1(scoreMaintenanceRatio),
            ageFactor: round1(scoreAgeFactor),
            breakdownFreq: round1(scoreBreakdownFreq),
            downtimeImpact: round1(scoreDowntimeImpact),
            costTrend: round1(scoreCostTrend),
        };
        // ═══════════════════════════════════════════════════════════════════════════
        // COMPOSITE SCORE (weighted average)
        // ═══════════════════════════════════════════════════════════════════════════
        const totalWeight = config.weightMaintenanceRatio +
            config.weightAgeFactor +
            config.weightBreakdownFreq +
            config.weightDowntimeImpact +
            config.weightCostTrend;
        const compositeScore = round1((signals.maintenanceRatio * config.weightMaintenanceRatio +
            signals.ageFactor * config.weightAgeFactor +
            signals.breakdownFreq * config.weightBreakdownFreq +
            signals.downtimeImpact * config.weightDowntimeImpact +
            signals.costTrend * config.weightCostTrend) /
            totalWeight);
        const decision = mapDecision(compositeScore, config);
        // ═══════════════════════════════════════════════════════════════════════════
        // CapEx TRIGGER EVALUATION — compound conditions independent of score
        // ═══════════════════════════════════════════════════════════════════════════
        // SLA limit from asset (convert to hours)
        const slaVal = asset.slaExpectedValue;
        const slaUnit = ((_p = asset.slaExpectedUnit) !== null && _p !== void 0 ? _p : "").toUpperCase();
        const slaLimitHours = slaVal != null
            ? (slaUnit === "DAYS" ? slaVal * 24 : slaVal)
            : null;
        const capex = evaluateCapExTriggers(maintRatio, config, breakdownCount12m, downtimeHours12m, ageYears, expectedLifeYears, slaLimitHours);
        const reasons = buildReasons(signals, {
            maintenanceCost: totalMaintenanceCost,
            bookValue: currentBookValue,
            ageYears,
            expectedLifeYears,
            breakdownCount12m,
            downtimeHours12m,
            costTrendPct,
            replacementEstimate,
        });
        // ═══════════════════════════════════════════════════════════════════════════
        // CALCULATION DETAILS — formula + real inputs + result for each signal
        // ═══════════════════════════════════════════════════════════════════════════
        const maintenanceHistoryCost = Number((_q = maintenanceAgg._sum.totalCost) !== null && _q !== void 0 ? _q : 0);
        const ticketCost = Number((_r = ticketAgg._sum.totalCost) !== null && _r !== void 0 ? _r : 0);
        const spareCost = Number((_t = (_s = spareAgg._sum) === null || _s === void 0 ? void 0 : _s.costAtUse) !== null && _t !== void 0 ? _t : 0);
        const lifeUsed = expectedLifeYears > 0 ? round1(ageYears / expectedLifeYears) : 0;
        const calc = {
            compositeScore: {
                formula: "(Signal₁ × Weight₁ + Signal₂ × Weight₂ + ... + Signal₅ × Weight₅) ÷ Total Weight",
                inputs: {
                    maintenanceRatio: { score: signals.maintenanceRatio, weight: config.weightMaintenanceRatio, product: round1(signals.maintenanceRatio * config.weightMaintenanceRatio) },
                    ageFactor: { score: signals.ageFactor, weight: config.weightAgeFactor, product: round1(signals.ageFactor * config.weightAgeFactor) },
                    breakdownFreq: { score: signals.breakdownFreq, weight: config.weightBreakdownFreq, product: round1(signals.breakdownFreq * config.weightBreakdownFreq) },
                    downtimeImpact: { score: signals.downtimeImpact, weight: config.weightDowntimeImpact, product: round1(signals.downtimeImpact * config.weightDowntimeImpact) },
                    costTrend: { score: signals.costTrend, weight: config.weightCostTrend, product: round1(signals.costTrend * config.weightCostTrend) },
                },
                totalWeight,
                weightedSum: round1(signals.maintenanceRatio * config.weightMaintenanceRatio +
                    signals.ageFactor * config.weightAgeFactor +
                    signals.breakdownFreq * config.weightBreakdownFreq +
                    signals.downtimeImpact * config.weightDowntimeImpact +
                    signals.costTrend * config.weightCostTrend),
                result: compositeScore,
            },
            maintenanceRatio: {
                formula: "(Maintenance Cost ÷ Book Value) ÷ Ceiling × 100, clamped 0–100",
                maintenanceHistoryCost: round1(maintenanceHistoryCost),
                ticketCost: round1(ticketCost),
                spareCost: round1(spareCost),
                totalMaintenanceCost: round1(totalMaintenanceCost),
                bookValue: round1(currentBookValue),
                ratio: round1(maintRatio),
                ceiling: config.maintenanceRatioCeiling,
                rawScore: round1((maintRatio / config.maintenanceRatioCeiling) * 100),
                result: signals.maintenanceRatio,
            },
            ageFactor: {
                formula: expectedLifeYears > 0
                    ? (ageYears / expectedLifeYears >= 1.0
                        ? "Past useful life → 80 + ((lifeUsed − 1.0) ÷ 0.5) × 20"
                        : (ageYears / expectedLifeYears <= 0.6
                            ? "lifeUsed × 40 (gentle rise before 60%)"
                            : "24 + ((lifeUsed − 0.6) ÷ 0.4) × 56 (steep rise after 60%)"))
                    : "No expected life defined → score = 0",
                purchaseDate: ageBasisDate,
                ageYears: round1(ageYears),
                expectedLifeYears,
                lifeUsedRatio: lifeUsed,
                lifeUsedPct: round1(lifeUsed * 100),
                result: signals.ageFactor,
            },
            breakdownFreq: {
                formula: "Breakdowns (last 12m) ÷ High Threshold × 100, clamped 0–100",
                breakdownCount12m,
                highThreshold: config.breakdownHighPerYear,
                rawScore: round1((breakdownCount12m / config.breakdownHighPerYear) * 100),
                result: signals.breakdownFreq,
            },
            downtimeImpact: {
                formula: "Downtime Hours (last 12m) ÷ High Threshold × 100, clamped 0–100",
                downtimeHours12m: round1(downtimeHours12m),
                downtimeTicketCount: downtimeTickets.length,
                highThreshold: config.downtimeHighHours,
                rawScore: round1((downtimeHours12m / config.downtimeHighHours) * 100),
                result: signals.downtimeImpact,
            },
            costTrend: {
                formula: "((Recent 12m Cost − Prior 12m Cost) ÷ Prior 12m Cost) ÷ High Threshold × 100",
                recentCost: round1(recentCost),
                priorCost: round1(priorCost),
                trendPct: costTrendPct != null ? round1(costTrendPct) : null,
                highThreshold: config.costTrendHighPct,
                result: signals.costTrend,
            },
            replacementEstimate: {
                formula: "Original Cost × (1 + 10%)^Age",
                originalCost,
                inflationRate: 10,
                ageRounded: Math.round(ageYears),
                result: replacementEstimate,
            },
            decision: {
                formula: "Score ≥ Replace threshold → REPLACE | ≥ Review → REVIEW | ≥ Monitor → MONITOR | else CONTINUE",
                compositeScore,
                thresholds: {
                    continueMaintenance: `0 – ${config.thresholdMonitor - 1}`,
                    monitor: `${config.thresholdMonitor} – ${config.thresholdReview - 1}`,
                    reviewForReplacement: `${config.thresholdReview} – ${config.thresholdReplace - 1}`,
                    replaceImmediately: `${config.thresholdReplace} – 100`,
                },
                result: decision,
            },
        };
        return {
            asset: {
                id: asset.id,
                assetId: asset.assetId,
                assetName: asset.assetName,
                category: (_u = asset.assetCategory) === null || _u === void 0 ? void 0 : _u.name,
                categoryId: (_v = asset.assetCategory) === null || _v === void 0 ? void 0 : _v.id,
                department: (_w = asset.department) === null || _w === void 0 ? void 0 : _w.name,
                departmentId: (_x = asset.department) === null || _x === void 0 ? void 0 : _x.id,
                status: asset.status,
                criticalityLevel: asset.criticalityLevel,
                originalCost,
                currentBookValue,
                ageYears: round1(ageYears),
                expectedLifeYears,
                remainingLifeYears: round1(Math.max(0, expectedLifeYears - ageYears)),
            },
            signals,
            compositeScore,
            decision,
            reasons,
            capex,
            calc,
            data: {
                totalMaintenanceCost: round1(totalMaintenanceCost),
                breakdownCount12m,
                downtimeHours12m: round1(downtimeHours12m),
                costTrendPct: costTrendPct != null ? round1(costTrendPct) : null,
                replacementEstimate,
            },
        };
    });
}
// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
// GET /decision-engine/evaluate/:id — Evaluate a single asset
const evaluateSingleAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const assetDbId = Number(req.params.id);
        if (isNaN(assetDbId)) {
            res.status(400).json({ message: "Invalid asset id" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetDbId },
            select: { assetCategoryId: true },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const config = yield loadConfig(asset.assetCategoryId);
        const result = yield evaluateAsset(assetDbId, config);
        if (!result) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        // Persist to log
        const user = req.user;
        yield prismaClient_1.default.decisionEngineLog.create({
            data: {
                assetId: assetDbId,
                scoreMaintenanceRatio: result.signals.maintenanceRatio,
                scoreAgeFactor: result.signals.ageFactor,
                scoreBreakdownFreq: result.signals.breakdownFreq,
                scoreDowntimeImpact: result.signals.downtimeImpact,
                scoreCostTrend: result.signals.costTrend,
                compositeScore: result.compositeScore,
                decision: result.decision,
                maintenanceCost: result.data.totalMaintenanceCost,
                bookValue: result.asset.currentBookValue,
                assetAgeYears: result.asset.ageYears,
                expectedLifeYears: result.asset.expectedLifeYears,
                breakdownCount12m: result.data.breakdownCount12m,
                downtimeHours12m: result.data.downtimeHours12m,
                costTrendPct: result.data.costTrendPct,
                reasons: result.reasons,
                evaluatedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
            },
        });
        res.json(Object.assign(Object.assign({}, result), { config }));
    }
    catch (error) {
        console.error("Decision engine evaluate error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.evaluateSingleAsset = evaluateSingleAsset;
// GET /decision-engine/evaluate-all — Bulk evaluate all active assets
const evaluateAllAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        // Build where clause
        const where = {
            status: { notIn: ["DISPOSED", "SCRAPPED"] },
        };
        // Role-based filtering: scope non-ADMIN users to their department
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            where.departmentId = Number(user.departmentId);
        }
        // Query filters
        if (query.categoryId)
            where.assetCategoryId = Number(query.categoryId);
        if (query.departmentId)
            where.departmentId = Number(query.departmentId);
        if (query.criticalityLevel)
            where.criticalityLevel = query.criticalityLevel;
        const assets = yield prismaClient_1.default.asset.findMany({
            where,
            select: { id: true, assetCategoryId: true },
        });
        // Load configs per category (cache)
        const configCache = new Map();
        const getConfigCached = (catId) => __awaiter(void 0, void 0, void 0, function* () {
            const key = catId !== null && catId !== void 0 ? catId : "default";
            if (configCache.has(key))
                return configCache.get(key);
            const cfg = yield loadConfig(catId);
            configCache.set(key, cfg);
            return cfg;
        });
        // Evaluate all assets in parallel (batched)
        const batchSize = 20;
        const results = [];
        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize);
            const batchResults = yield Promise.all(batch.map((a) => __awaiter(void 0, void 0, void 0, function* () {
                const cfg = yield getConfigCached(a.assetCategoryId);
                return evaluateAsset(a.id, cfg);
            })));
            results.push(...batchResults.filter(Boolean));
        }
        // Sort by composite score descending (worst first)
        results.sort((a, b) => b.compositeScore - a.compositeScore);
        // Summary stats
        const summary = {
            total: results.length,
            continueMaintenance: results.filter((r) => r.decision === "CONTINUE_MAINTENANCE").length,
            monitor: results.filter((r) => r.decision === "MONITOR").length,
            reviewForReplacement: results.filter((r) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
            replaceImmediately: results.filter((r) => r.decision === "REPLACE_IMMEDIATELY").length,
        };
        // Optional: filter by decision
        let filtered = results;
        if (query.decision) {
            filtered = results.filter((r) => r.decision === query.decision);
        }
        // Pagination
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 25;
        const start = (page - 1) * limit;
        const paginated = filtered.slice(start, start + limit);
        res.json({
            summary,
            data: paginated,
            total: filtered.length,
            page,
            limit,
        });
    }
    catch (error) {
        console.error("Decision engine evaluate-all error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.evaluateAllAssets = evaluateAllAssets;
// GET /decision-engine/history/:assetId — Get evaluation history for an asset
const getAssetHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        if (isNaN(assetId)) {
            res.status(400).json({ message: "Invalid asset id" });
            return;
        }
        const logs = yield prismaClient_1.default.decisionEngineLog.findMany({
            where: { assetId },
            orderBy: { evaluatedAt: "desc" },
            take: 20,
            include: {
                evaluatedBy: { select: { id: true, name: true, employeeID: true } },
            },
        });
        res.json({ data: logs });
    }
    catch (error) {
        console.error("Decision engine history error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAssetHistory = getAssetHistory;
// GET /decision-engine/config — Get all configs
const getConfigs = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const configs = yield prismaClient_1.default.decisionEngineConfig.findMany({
            include: { category: { select: { id: true, name: true } } },
            orderBy: { categoryId: "asc" },
        });
        res.json({ data: configs });
    }
    catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getConfigs = getConfigs;
// POST /decision-engine/config — Create or update config
const upsertConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const body = req.body;
        const categoryId = body.categoryId != null ? Number(body.categoryId) : null;
        const data = {
            weightMaintenanceRatio: (_a = body.weightMaintenanceRatio) !== null && _a !== void 0 ? _a : 30,
            weightAgeFactor: (_b = body.weightAgeFactor) !== null && _b !== void 0 ? _b : 20,
            weightBreakdownFreq: (_c = body.weightBreakdownFreq) !== null && _c !== void 0 ? _c : 20,
            weightDowntimeImpact: (_d = body.weightDowntimeImpact) !== null && _d !== void 0 ? _d : 15,
            weightCostTrend: (_e = body.weightCostTrend) !== null && _e !== void 0 ? _e : 15,
            thresholdMonitor: (_f = body.thresholdMonitor) !== null && _f !== void 0 ? _f : 36,
            thresholdReview: (_g = body.thresholdReview) !== null && _g !== void 0 ? _g : 56,
            thresholdReplace: (_h = body.thresholdReplace) !== null && _h !== void 0 ? _h : 76,
            maintenanceRatioCeiling: (_j = body.maintenanceRatioCeiling) !== null && _j !== void 0 ? _j : 1.5,
            breakdownHighPerYear: (_k = body.breakdownHighPerYear) !== null && _k !== void 0 ? _k : 6,
            downtimeHighHours: (_l = body.downtimeHighHours) !== null && _l !== void 0 ? _l : 720,
            costTrendHighPct: (_m = body.costTrendHighPct) !== null && _m !== void 0 ? _m : 50,
        };
        let config;
        if (categoryId != null) {
            // Per-category config
            config = yield prismaClient_1.default.decisionEngineConfig.upsert({
                where: { categoryId },
                update: data,
                create: Object.assign(Object.assign({}, data), { categoryId }),
            });
        }
        else {
            // Global default — find or create
            const existing = yield prismaClient_1.default.decisionEngineConfig.findFirst({
                where: { categoryId: null },
            });
            if (existing) {
                config = yield prismaClient_1.default.decisionEngineConfig.update({
                    where: { id: existing.id },
                    data,
                });
            }
            else {
                config = yield prismaClient_1.default.decisionEngineConfig.create({
                    data: Object.assign(Object.assign({}, data), { categoryId: null }),
                });
            }
        }
        res.json(config);
    }
    catch (error) {
        console.error("Decision engine config error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.upsertConfig = upsertConfig;
// GET /decision-engine/dashboard-summary — KPI summary for dashboard
const getDashboardSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const where = {
            status: { notIn: ["DISPOSED", "SCRAPPED"] },
        };
        // Scope non-ADMIN users to their department
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            where.departmentId = Number(user.departmentId);
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where,
            select: { id: true, assetCategoryId: true },
        });
        const configCache = new Map();
        const getConfigCached = (catId) => __awaiter(void 0, void 0, void 0, function* () {
            const key = catId !== null && catId !== void 0 ? catId : "default";
            if (configCache.has(key))
                return configCache.get(key);
            const cfg = yield loadConfig(catId);
            configCache.set(key, cfg);
            return cfg;
        });
        // Evaluate all
        const results = [];
        const batchSize = 20;
        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize);
            const batchResults = yield Promise.all(batch.map((a) => __awaiter(void 0, void 0, void 0, function* () {
                const cfg = yield getConfigCached(a.assetCategoryId);
                return evaluateAsset(a.id, cfg);
            })));
            results.push(...batchResults.filter(Boolean));
        }
        const summary = {
            total: results.length,
            continueMaintenance: results.filter((r) => r.decision === "CONTINUE_MAINTENANCE").length,
            monitor: results.filter((r) => r.decision === "MONITOR").length,
            reviewForReplacement: results.filter((r) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
            replaceImmediately: results.filter((r) => r.decision === "REPLACE_IMMEDIATELY").length,
            avgCompositeScore: results.length > 0
                ? round1(results.reduce((s, r) => s + r.compositeScore, 0) / results.length)
                : 0,
            totalMaintenanceCost: round1(results.reduce((s, r) => s + r.data.totalMaintenanceCost, 0)),
            totalBookValue: round1(results.reduce((s, r) => s + r.asset.currentBookValue, 0)),
        };
        // Top 5 critical (highest composite score)
        const topCritical = results
            .sort((a, b) => b.compositeScore - a.compositeScore)
            .slice(0, 5)
            .map((r) => ({
            id: r.asset.id,
            assetId: r.asset.assetId,
            assetName: r.asset.assetName,
            category: r.asset.category,
            department: r.asset.department,
            compositeScore: r.compositeScore,
            decision: r.decision,
            criticalityLevel: r.asset.criticalityLevel,
        }));
        // By category breakdown
        const byCategory = new Map();
        for (const r of results) {
            const cat = r.asset.category || "Uncategorized";
            const entry = byCategory.get(cat) || { count: 0, replace: 0, review: 0 };
            entry.count++;
            if (r.decision === "REPLACE_IMMEDIATELY")
                entry.replace++;
            if (r.decision === "REVIEW_FOR_REPLACEMENT")
                entry.review++;
            byCategory.set(cat, entry);
        }
        // By criticality breakdown — with full asset lists per level
        const criticalityLevels = ["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"];
        const byCriticality = [];
        for (const level of criticalityLevels) {
            const assetsAtLevel = results.filter((r) => (r.asset.criticalityLevel || "").toUpperCase() === level);
            if (assetsAtLevel.length === 0)
                continue;
            // Sort by composite score descending (worst first)
            assetsAtLevel.sort((a, b) => b.compositeScore - a.compositeScore);
            const capexTriggeredCount = assetsAtLevel.filter((r) => { var _a; return (_a = r.capex) === null || _a === void 0 ? void 0 : _a.triggered; }).length;
            byCriticality.push({
                level,
                count: assetsAtLevel.length,
                avgScore: round1(assetsAtLevel.reduce((s, r) => s + r.compositeScore, 0) / assetsAtLevel.length),
                replaceImmediately: assetsAtLevel.filter((r) => r.decision === "REPLACE_IMMEDIATELY").length,
                reviewForReplacement: assetsAtLevel.filter((r) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
                monitor: assetsAtLevel.filter((r) => r.decision === "MONITOR").length,
                continueMaintenance: assetsAtLevel.filter((r) => r.decision === "CONTINUE_MAINTENANCE").length,
                capexTriggered: capexTriggeredCount,
                assets: assetsAtLevel.map((r) => {
                    var _a, _b, _c, _d, _e;
                    return ({
                        id: r.asset.id,
                        assetId: r.asset.assetId,
                        assetName: r.asset.assetName,
                        category: r.asset.category,
                        department: r.asset.department,
                        compositeScore: r.compositeScore,
                        decision: r.decision,
                        capexTriggered: (_b = (_a = r.capex) === null || _a === void 0 ? void 0 : _a.triggered) !== null && _b !== void 0 ? _b : false,
                        capexTriggerCount: (_e = (_d = (_c = r.capex) === null || _c === void 0 ? void 0 : _c.triggers) === null || _d === void 0 ? void 0 : _d.filter((t) => t.fired).length) !== null && _e !== void 0 ? _e : 0,
                        totalMaintenanceCost: r.data.totalMaintenanceCost,
                        currentBookValue: r.asset.currentBookValue,
                        ageYears: r.asset.ageYears,
                        expectedLifeYears: r.asset.expectedLifeYears,
                        breakdownCount12m: r.data.breakdownCount12m,
                    });
                }),
            });
        }
        // Also include assets with no criticality level set
        const unsetAssets = results.filter((r) => !r.asset.criticalityLevel);
        if (unsetAssets.length > 0) {
            unsetAssets.sort((a, b) => b.compositeScore - a.compositeScore);
            byCriticality.push({
                level: "UNSET",
                count: unsetAssets.length,
                avgScore: round1(unsetAssets.reduce((s, r) => s + r.compositeScore, 0) / unsetAssets.length),
                replaceImmediately: unsetAssets.filter((r) => r.decision === "REPLACE_IMMEDIATELY").length,
                reviewForReplacement: unsetAssets.filter((r) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
                monitor: unsetAssets.filter((r) => r.decision === "MONITOR").length,
                continueMaintenance: unsetAssets.filter((r) => r.decision === "CONTINUE_MAINTENANCE").length,
                capexTriggered: unsetAssets.filter((r) => { var _a; return (_a = r.capex) === null || _a === void 0 ? void 0 : _a.triggered; }).length,
                assets: unsetAssets.map((r) => {
                    var _a, _b, _c, _d, _e;
                    return ({
                        id: r.asset.id,
                        assetId: r.asset.assetId,
                        assetName: r.asset.assetName,
                        category: r.asset.category,
                        department: r.asset.department,
                        compositeScore: r.compositeScore,
                        decision: r.decision,
                        capexTriggered: (_b = (_a = r.capex) === null || _a === void 0 ? void 0 : _a.triggered) !== null && _b !== void 0 ? _b : false,
                        capexTriggerCount: (_e = (_d = (_c = r.capex) === null || _c === void 0 ? void 0 : _c.triggers) === null || _d === void 0 ? void 0 : _d.filter((t) => t.fired).length) !== null && _e !== void 0 ? _e : 0,
                        totalMaintenanceCost: r.data.totalMaintenanceCost,
                        currentBookValue: r.asset.currentBookValue,
                        ageYears: r.asset.ageYears,
                        expectedLifeYears: r.asset.expectedLifeYears,
                        breakdownCount12m: r.data.breakdownCount12m,
                    });
                }),
            });
        }
        // Total CapEx triggered across all assets
        const totalCapexTriggered = results.filter((r) => { var _a; return (_a = r.capex) === null || _a === void 0 ? void 0 : _a.triggered; }).length;
        res.json({
            summary: Object.assign(Object.assign({}, summary), { capexTriggered: totalCapexTriggered }),
            topCritical,
            byCategory: Array.from(byCategory.entries()).map(([category, data]) => (Object.assign({ category }, data))),
            byCriticality,
        });
    }
    catch (error) {
        console.error("Decision engine dashboard error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getDashboardSummary = getDashboardSummary;

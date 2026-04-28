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
exports.deleteRevenueEntry = exports.deleteAllocation = exports.updateAllocation = exports.addAllocation = exports.getAllocations = exports.addRevenueEntry = exports.getRevenueEntries = exports.getDepreciationAlerts = exports.getAssetCostAnalysis = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// GET /cost-analysis/:id
const getAssetCostAnalysis = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
    try {
        const assetDbId = Number(req.params.id);
        if (isNaN(assetDbId)) {
            res.status(400).json({ message: "Invalid asset id" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetDbId },
            include: {
                depreciation: true,
                assetCategory: { select: { name: true } },
            },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        // ── Sub-assets (children) — collect their IDs for cost rollup ───────────
        const subAssets = yield prismaClient_1.default.asset.findMany({
            where: { parentAssetId: assetDbId },
            select: { id: true, assetId: true, assetName: true, purchaseCost: true, status: true },
        });
        const subAssetIds = subAssets.map((s) => s.id);
        // Sum of sub-asset purchase costs (components bought new)
        const subAssetPurchaseCost = subAssets.reduce((sum, s) => { var _a; return sum + Number((_a = s.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
        // Replacement costs from SubAssetReplacement table
        const replacements = yield prismaClient_1.default.subAssetReplacement.findMany({
            where: { parentAssetId: assetDbId },
            select: { cost: true },
        });
        const subAssetReplacementCost = replacements.reduce((sum, r) => { var _a; return sum + Number((_a = r.cost) !== null && _a !== void 0 ? _a : 0); }, 0);
        // All asset IDs to aggregate costs (parent + all sub-assets)
        const allAssetIds = [assetDbId, ...subAssetIds];
        // ── Repair / corrective tickets (parent + sub-assets) ────────────────────
        const repairTickets = yield prismaClient_1.default.ticket.findMany({
            where: {
                assetId: { in: allAssetIds },
                status: { in: ["RESOLVED", "CLOSED"] },
                workCategory: { in: ["BREAKDOWN", "CORRECTIVE"] },
            },
            select: {
                id: true, totalCost: true, serviceCost: true, partsCost: true,
                serviceType: true, createdAt: true, assetId: true,
            },
        });
        const repairCount = repairTickets.length;
        let repairLabourCost = 0;
        let repairPartsCost = 0;
        for (const t of repairTickets) {
            repairLabourCost += Number((_a = t.serviceCost) !== null && _a !== void 0 ? _a : 0);
            repairPartsCost += Number((_b = t.partsCost) !== null && _b !== void 0 ? _b : 0);
        }
        const repairCost = repairLabourCost + repairPartsCost;
        // ── PM / maintenance history (parent + sub-assets) ───────────────────────
        const pmHistory = yield prismaClient_1.default.maintenanceHistory.findMany({
            where: { assetId: { in: allAssetIds } },
            select: {
                id: true, totalCost: true, serviceCost: true, partsCost: true,
                serviceType: true, actualDoneAt: true,
            },
        });
        const pmCount = pmHistory.length;
        // Group PM cost by contract type
        let pmAmcCmcCost = 0;
        let pmPaidCost = 0;
        let pmInternalCost = 0;
        for (const h of pmHistory) {
            const cost = Number((_c = h.totalCost) !== null && _c !== void 0 ? _c : (Number((_d = h.serviceCost) !== null && _d !== void 0 ? _d : 0) + Number((_e = h.partsCost) !== null && _e !== void 0 ? _e : 0)));
            const type = ((_f = h.serviceType) !== null && _f !== void 0 ? _f : "").toUpperCase();
            if (type === "AMC" || type === "CMC")
                pmAmcCmcCost += cost;
            else if (type === "PAID")
                pmPaidCost += cost;
            else
                pmInternalCost += cost;
        }
        const pmCost = pmAmcCmcCost + pmPaidCost + pmInternalCost;
        const totalMaintenanceCost = repairCost + pmCost + subAssetPurchaseCost + subAssetReplacementCost;
        // ── Depreciation / book value ────────────────────────────────────────────
        const dep = asset.depreciation;
        const originalCost = Number((_h = (_g = asset.purchaseCost) !== null && _g !== void 0 ? _g : asset.estimatedValue) !== null && _h !== void 0 ? _h : 0);
        // Book value: use stored currentBookValue, else fall back to original cost
        const bookValueSource = (dep === null || dep === void 0 ? void 0 : dep.currentBookValue) != null ? "depreciation_record" : "original_cost";
        const currentBookValue = (dep === null || dep === void 0 ? void 0 : dep.currentBookValue) != null
            ? Number(dep.currentBookValue)
            : originalCost;
        const accumulatedDepreciation = (dep === null || dep === void 0 ? void 0 : dep.accumulatedDepreciation) != null
            ? Number(dep.accumulatedDepreciation)
            : (originalCost - currentBookValue);
        const depreciationMethod = (_j = dep === null || dep === void 0 ? void 0 : dep.depreciationMethod) !== null && _j !== void 0 ? _j : "N/A";
        const depreciationRate = (dep === null || dep === void 0 ? void 0 : dep.depreciationRate) != null ? Number(dep.depreciationRate) : null;
        const expectedLifeYears = (_k = dep === null || dep === void 0 ? void 0 : dep.expectedLifeYears) !== null && _k !== void 0 ? _k : 0;
        const depreciationStart = (_o = (_m = (_l = dep === null || dep === void 0 ? void 0 : dep.depreciationStart) !== null && _l !== void 0 ? _l : asset.purchaseDate) !== null && _m !== void 0 ? _m : asset.installedAt) !== null && _o !== void 0 ? _o : null;
        // ── Age ──────────────────────────────────────────────────────────────────
        // Priority: purchaseDate > installedAt > depreciationStart
        const ageBasisDate = (_r = (_q = (_p = asset.purchaseDate) !== null && _p !== void 0 ? _p : asset.installedAt) !== null && _q !== void 0 ? _q : dep === null || dep === void 0 ? void 0 : dep.depreciationStart) !== null && _r !== void 0 ? _r : null;
        let ageYears = 0;
        if (ageBasisDate) {
            ageYears = (Date.now() - new Date(ageBasisDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
        }
        const remainingLifeYears = Math.max(0, expectedLifeYears - ageYears);
        // ── Historical (legacy) opening balance ──────────────────────────────────
        const historicalMaintenanceCost = Number((_s = asset.historicalMaintenanceCost) !== null && _s !== void 0 ? _s : 0);
        const historicalSparePartsCost = Number((_t = asset.historicalSparePartsCost) !== null && _t !== void 0 ? _t : 0);
        const historicalOtherCost = Number((_u = asset.historicalOtherCost) !== null && _u !== void 0 ? _u : 0);
        const totalHistoricalCost = historicalMaintenanceCost + historicalSparePartsCost + historicalOtherCost;
        // Lifetime TCO includes pre-system spend
        const lifetimeTotalMaintenanceCost = totalMaintenanceCost + totalHistoricalCost;
        // ── Avg cost per year ────────────────────────────────────────────────────
        // totalMaintenanceCost ÷ ageYears (since first recorded use)
        const costPerYear = ageYears > 0 ? totalMaintenanceCost / ageYears : 0;
        // ── Replacement cost estimate ────────────────────────────────────────────
        // Base = originalCost, escalated at 10% per year (medical equipment inflation proxy)
        const inflationRate = 0.10;
        const roundedAge = Math.round(ageYears);
        const replacementCostEstimate = originalCost > 0
            ? Math.round(originalCost * Math.pow(1 + inflationRate, roundedAge))
            : null;
        // ── Revenue (from daily usage logs — actual + estimated) ─────────────────
        const revenueAgg = yield prismaClient_1.default.assetDailyUsageLog.aggregate({
            where: { assetId: assetDbId },
            _sum: { revenueGenerated: true, estimatedRevenue: true },
        });
        const actualRevenue = Number((_v = revenueAgg._sum.revenueGenerated) !== null && _v !== void 0 ? _v : 0);
        const estimatedRevenue = Number((_w = revenueAgg._sum.estimatedRevenue) !== null && _w !== void 0 ? _w : 0);
        // Use actual if available, fall back to estimated
        const totalRevenue = actualRevenue > 0 ? actualRevenue : estimatedRevenue;
        const roi = totalRevenue > 0 && originalCost > 0
            ? ((totalRevenue - totalMaintenanceCost) / originalCost) * 100
            : null;
        // ── Recommendation ───────────────────────────────────────────────────────
        let recommendation = "MONITOR";
        const reasons = [];
        const maintenanceToPurchaseRatio = originalCost > 0 ? lifetimeTotalMaintenanceCost / originalCost : 0;
        const bookValueToPurchaseRatio = originalCost > 0 ? currentBookValue / originalCost : 1;
        if (expectedLifeYears > 0 && ageYears >= expectedLifeYears) {
            recommendation = "REPLACE";
            reasons.push("Asset has exceeded its expected useful life.");
        }
        if (maintenanceToPurchaseRatio >= 0.75) {
            recommendation = "REPLACE";
            reasons.push(`Total maintenance cost is ≥75% of original cost.`);
        }
        else if (maintenanceToPurchaseRatio >= 0.5) {
            if (recommendation !== "REPLACE")
                recommendation = "REPAIR";
            reasons.push("Total maintenance cost is ≥50% of original cost — consider replacement soon.");
        }
        if (bookValueToPurchaseRatio <= 0.1 && originalCost > 0) {
            if (recommendation !== "REPLACE")
                recommendation = "REPLACE";
            reasons.push("Current book value is ≤10% of original cost (fully depreciated).");
        }
        if (repairCount >= 5) {
            if (recommendation === "MONITOR")
                recommendation = "REPAIR";
            reasons.push(`High breakdown frequency: ${repairCount} corrective repairs recorded.`);
        }
        if (reasons.length === 0) {
            reasons.push("Asset is within acceptable maintenance cost range and useful life.");
        }
        res.json({
            asset: {
                id: asset.id,
                assetId: asset.assetId,
                assetName: asset.assetName,
                category: (_x = asset.assetCategory) === null || _x === void 0 ? void 0 : _x.name,
                purchaseDate: asset.purchaseDate,
                installedAt: asset.installedAt,
                originalCost,
                ageYears: Math.round(ageYears * 10) / 10,
                expectedLifeYears,
                remainingLifeYears: Math.round(remainingLifeYears * 10) / 10,
                currentBookValue,
                accumulatedDepreciation,
                depreciationMethod,
                depreciationRate,
                depreciationStart,
            },
            // Calculation breakdowns (shown in info tooltips on frontend)
            calc: {
                bookValue: {
                    formula: "Original Cost − Accumulated Depreciation",
                    originalCost,
                    accumulatedDepreciation,
                    result: currentBookValue,
                    source: bookValueSource, // "depreciation_record" | "original_cost"
                    method: depreciationMethod,
                    rate: depreciationRate,
                },
                age: {
                    formula: "Today − Purchase/Install Date (in years)",
                    basisDate: ageBasisDate,
                    basisField: asset.purchaseDate ? "purchaseDate" : asset.installedAt ? "installedAt" : "depreciationStart",
                    result: Math.round(ageYears * 10) / 10,
                },
                maintenanceCost: {
                    formula: "PM Cost (AMC/CMC + Paid + Internal) + Repair Cost (Labour + Parts) + Sub-Asset Costs",
                    pmBreakdown: { amcCmc: pmAmcCmcCost, paid: pmPaidCost, internal: pmInternalCost, total: pmCost },
                    repairBreakdown: { labour: repairLabourCost, parts: repairPartsCost, total: repairCost },
                    subAssetBreakdown: {
                        componentPurchaseCost: subAssetPurchaseCost,
                        replacementCost: subAssetReplacementCost,
                        total: subAssetPurchaseCost + subAssetReplacementCost,
                        count: subAssets.length,
                    },
                    total: totalMaintenanceCost,
                },
                avgCostPerYear: {
                    formula: "Total Maintenance Cost ÷ Asset Age (years)",
                    totalMaintenanceCost,
                    ageYears: Math.round(ageYears * 10) / 10,
                    result: Math.round(costPerYear),
                },
                replacementCost: {
                    formula: `Original Cost × (1 + ${inflationRate * 100}%)^Age`,
                    originalCost,
                    inflationRate,
                    ageYearsRounded: roundedAge,
                    result: replacementCostEstimate,
                },
                revenue: {
                    formula: "Sum of actual revenue from daily usage logs (falls back to estimated if actual is zero)",
                    totalRevenue,
                    roi: roi != null ? Math.round(roi * 10) / 10 : null,
                    roiFormula: "(Total Revenue − Total Maintenance Cost) ÷ Original Cost × 100",
                },
            },
            subAssets: subAssets.map((s) => {
                var _a;
                return ({
                    id: s.id,
                    assetId: s.assetId,
                    assetName: s.assetName,
                    purchaseCost: Number((_a = s.purchaseCost) !== null && _a !== void 0 ? _a : 0),
                    status: s.status,
                });
            }),
            legacy: asset.isLegacyAsset ? {
                isLegacyAsset: true,
                dataAvailableSince: asset.dataAvailableSince,
                historicalCostAsOf: asset.historicalCostAsOf,
                historicalMaintenanceCost,
                historicalSparePartsCost,
                historicalOtherCost,
                totalHistoricalCost,
                historicalCostNote: asset.historicalCostNote,
            } : null,
            summary: {
                repairCount,
                repairCost,
                repairLabourCost,
                repairPartsCost,
                pmCount,
                pmCost,
                pmAmcCmcCost,
                pmPaidCost,
                pmInternalCost,
                subAssetPurchaseCost,
                subAssetReplacementCost,
                totalMaintenanceCost,
                totalHistoricalCost,
                lifetimeTotalMaintenanceCost,
                costPerYear: Math.round(costPerYear),
                maintenanceToPurchaseRatio: Math.round(maintenanceToPurchaseRatio * 100),
                replacementCostEstimate,
                totalRevenue,
                roi,
            },
            recommendation,
            reasons,
        });
    }
    catch (error) {
        console.error("Error in cost analysis:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAssetCostAnalysis = getAssetCostAnalysis;
// GET /cost-analysis/alerts
const getDepreciationAlerts = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const assets = yield prismaClient_1.default.asset.findMany({
            where: {
                status: { notIn: ["DISPOSED", "SCRAPPED"] },
                depreciation: { isNot: null },
            },
            include: {
                depreciation: true,
                assetCategory: { select: { name: true } },
            },
        });
        const alerts = [];
        for (const asset of assets) {
            const dep = asset.depreciation;
            if (!dep)
                continue;
            const originalCost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
            const currentBookValue = dep.currentBookValue != null ? Number(dep.currentBookValue) : null;
            const expectedLifeYears = (_c = dep.expectedLifeYears) !== null && _c !== void 0 ? _c : 0;
            const startDate = (_e = (_d = asset.purchaseDate) !== null && _d !== void 0 ? _d : asset.installedAt) !== null && _e !== void 0 ? _e : dep.depreciationStart;
            const ageYears = startDate
                ? (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
                : 0;
            const alertTypes = [];
            if (expectedLifeYears > 0 && ageYears > expectedLifeYears)
                alertTypes.push("PAST_LIFE");
            if (expectedLifeYears > 0 && ageYears >= expectedLifeYears - 1 && ageYears < expectedLifeYears)
                alertTypes.push("NEARING_END_OF_LIFE");
            if (currentBookValue != null && originalCost > 0 && currentBookValue / originalCost <= 0.2)
                alertTypes.push("LOW_BOOK_VALUE");
            if (alertTypes.length > 0) {
                alerts.push({
                    assetDbId: asset.id,
                    assetId: asset.assetId,
                    assetName: asset.assetName,
                    category: (_f = asset.assetCategory) === null || _f === void 0 ? void 0 : _f.name,
                    originalCost,
                    currentBookValue,
                    ageYears: Math.round(ageYears * 10) / 10,
                    expectedLifeYears,
                    alertTypes,
                });
            }
        }
        const priority = (a) => a.alertTypes.includes("PAST_LIFE") ? 0 :
            a.alertTypes.includes("NEARING_END_OF_LIFE") ? 1 : 2;
        alerts.sort((a, b) => priority(a) - priority(b));
        res.json({ data: alerts, total: alerts.length });
    }
    catch (error) {
        console.error("Error fetching depreciation alerts:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getDepreciationAlerts = getDepreciationAlerts;
// GET /cost-analysis/:id/revenue — list revenue entries
const getRevenueEntries = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetDbId = Number(req.params.id);
        const entries = yield prismaClient_1.default.assetRevenueEntry.findMany({
            where: { assetId: assetDbId },
            orderBy: { entryDate: "desc" },
        });
        const total = entries.reduce((s, e) => s + Number(e.totalRevenue), 0);
        res.json({ data: entries, total });
    }
    catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getRevenueEntries = getRevenueEntries;
// POST /cost-analysis/:id/revenue — add a revenue entry
const addRevenueEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const assetDbId = Number(req.params.id);
        const { entryDate, revenueType, description, quantity = 1, unitRate, referenceNo } = req.body;
        if (!entryDate || !revenueType || unitRate == null) {
            res.status(400).json({ message: "entryDate, revenueType, and unitRate are required" });
            return;
        }
        const qty = Number(quantity) || 1;
        const rate = Number(unitRate);
        const total = qty * rate;
        const entry = yield prismaClient_1.default.assetRevenueEntry.create({
            data: {
                assetId: assetDbId,
                entryDate: new Date(entryDate),
                revenueType,
                description: description || null,
                quantity: qty,
                unitRate: rate,
                totalRevenue: total,
                referenceNo: referenceNo || null,
                recordedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            },
        });
        res.status(201).json({ data: entry, message: "Revenue entry added" });
    }
    catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.addRevenueEntry = addRevenueEntry;
// ─── Cost Allocation CRUD ────────────────────────────────────────────────────
// GET /cost-analysis/:id/allocations
const getAllocations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetDbId = Number(req.params.id);
        const entries = yield prismaClient_1.default.assetCostAllocation.findMany({
            where: { assetId: assetDbId },
            orderBy: { entryDate: 'desc' },
        });
        const total = entries.reduce((s, e) => s + Number(e.amount), 0);
        res.json({ data: entries, total: Number(total.toFixed(2)) });
    }
    catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});
exports.getAllocations = getAllocations;
// POST /cost-analysis/:id/allocations
const addAllocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const assetDbId = Number(req.params.id);
        const { costType, amount, period, description, referenceType, referenceId, entryDate } = req.body;
        if (!costType || amount == null) {
            res.status(400).json({ message: 'costType and amount are required' });
            return;
        }
        const validTypes = ['LABOR', 'UTILITY_POWER', 'SPACE_FACILITY', 'OUTSOURCED_SERVICE', 'CONSUMABLE', 'OTHER'];
        if (!validTypes.includes(costType)) {
            res.status(400).json({ message: `costType must be one of: ${validTypes.join(', ')}` });
            return;
        }
        const entry = yield prismaClient_1.default.assetCostAllocation.create({
            data: {
                assetId: assetDbId,
                costType,
                amount: Number(amount),
                period: period || null,
                description: description || null,
                referenceType: referenceType || null,
                referenceId: referenceId ? Number(referenceId) : null,
                entryDate: entryDate ? new Date(entryDate) : new Date(),
                createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            },
        });
        res.status(201).json({ data: entry, message: 'Cost allocation added' });
    }
    catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});
exports.addAllocation = addAllocation;
// PUT /cost-analysis/allocations/:entryId
const updateAllocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const entryId = Number(req.params.entryId);
        const { costType, amount, period, description, referenceType, referenceId, entryDate } = req.body;
        const updated = yield prismaClient_1.default.assetCostAllocation.update({
            where: { id: entryId },
            data: {
                costType: costType !== null && costType !== void 0 ? costType : undefined,
                amount: amount != null ? Number(amount) : undefined,
                period: period !== null && period !== void 0 ? period : undefined,
                description: description !== null && description !== void 0 ? description : undefined,
                referenceType: referenceType !== null && referenceType !== void 0 ? referenceType : undefined,
                referenceId: referenceId != null ? Number(referenceId) : undefined,
                entryDate: entryDate ? new Date(entryDate) : undefined,
            },
        });
        res.json({ data: updated, message: 'Cost allocation updated' });
    }
    catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});
exports.updateAllocation = updateAllocation;
// DELETE /cost-analysis/allocations/:entryId
const deleteAllocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const entryId = Number(req.params.entryId);
        yield prismaClient_1.default.assetCostAllocation.delete({ where: { id: entryId } });
        res.json({ message: 'Cost allocation deleted' });
    }
    catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});
exports.deleteAllocation = deleteAllocation;
// DELETE /cost-analysis/revenue/:entryId
const deleteRevenueEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const entryId = Number(req.params.entryId);
        yield prismaClient_1.default.assetRevenueEntry.delete({ where: { id: entryId } });
        res.json({ message: "Revenue entry deleted" });
    }
    catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.deleteRevenueEntry = deleteRevenueEntry;

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
exports.backfillDepreciationLogs = exports.getDepreciationLogs = exports.getAllDepreciations = exports.rejectBatchRun = exports.approveBatchRun = exports.getDepreciableAssets = exports.runAssetDepreciation = exports.getBatchRuns = exports.runBatchDepreciation = exports.batchDepreciationPreview = exports.getDepreciationSchedule = exports.getRoundOffImpact = exports.runDepreciationForAsset = exports.calculateDepreciation = exports.updateDepreciation = exports.addDepreciation = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const finance_voucher_controller_1 = require("../finance/finance-voucher.controller");
const depreciationEngine_1 = require("../../utilis/depreciationEngine");
const addDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
        //    res.status(403).json({ message: "Not allowed" });
        //    return;
        // }
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const { assetId, depreciationMethod, depreciationRate, expectedLifeYears, salvageValue, depreciationStart, depreciationFrequency, } = req.body;
        if (!assetId || !depreciationMethod || !expectedLifeYears || !depreciationStart) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: Number(assetId) },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        // Rental assets are not owned — depreciation does not apply
        if (asset.modeOfProcurement === "RENTAL") {
            res.status(400).json({ message: "Depreciation is not applicable for RENTAL assets. Rental payments are operating expenses." });
            return;
        }
        const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        // Legacy assets may not have a purchase cost — allow if they have a historical opening balance note
        if ((!cost || cost <= 0) && !asset.isLegacyAsset) {
            res.status(400).json({ message: "Asset cost is missing. For DONATION/LEASE assets, enter Estimated Value / ROU Value in the asset form." });
            return;
        }
        const existing = yield prismaClient_1.default.assetDepreciation.findUnique({
            where: { assetId: Number(assetId) }
        });
        if (existing) {
            res.status(400).json({ message: "Depreciation already exists for asset" });
            return;
        }
        // Residual value defaults to 5% of cost if not explicitly provided
        const resolvedSalvage = (salvageValue != null && salvageValue !== "" && Number(salvageValue) > 0)
            ? Number(salvageValue)
            : Number((cost * 0.05).toFixed(2));
        const depreciation = yield prismaClient_1.default.assetDepreciation.create({
            data: {
                assetId: Number(assetId),
                depreciationMethod,
                depreciationRate: depreciationRate != null ? String(depreciationRate) : "0",
                expectedLifeYears: Number(expectedLifeYears),
                salvageValue: String(resolvedSalvage),
                depreciationStart: new Date(depreciationStart),
                depreciationFrequency: depreciationFrequency || "YEARLY",
                // Legacy assets: accept opening accumulated depreciation from req.body so book value is correct from day 1
                accumulatedDepreciation: req.body.openingAccumulatedDepreciation != null
                    ? String(req.body.openingAccumulatedDepreciation)
                    : "0",
                currentBookValue: req.body.openingAccumulatedDepreciation != null
                    ? String(Math.max(0, cost - Number(req.body.openingAccumulatedDepreciation)))
                    : String(cost),
                lastCalculatedAt: null,
                roundOff: req.body.roundOff === true || req.body.roundOff === "true",
                decimalPlaces: req.body.decimalPlaces != null ? Number(req.body.decimalPlaces) : 2,
                createdById: employeeId,
                updatedById: employeeId,
                isActive: true,
            }
        });
        res.status(201).json(depreciation);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to add depreciation" });
    }
});
exports.addDepreciation = addDepreciation;
const updateDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // if (req.user.role !== "superadmin") {
        //    res.status(403).json({ message: "Admins only" });
        //    return;
        // }
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const id = parseInt(req.params.id);
        const data = req.body;
        const updated = yield prismaClient_1.default.assetDepreciation.update({
            where: { id },
            data: {
                depreciationMethod: data.depreciationMethod,
                depreciationRate: data.depreciationRate != null ? String(data.depreciationRate) : undefined,
                expectedLifeYears: data.expectedLifeYears != null ? Number(data.expectedLifeYears) : undefined,
                salvageValue: data.salvageValue != null && data.salvageValue !== "" ? String(data.salvageValue) : null,
                depreciationStart: data.depreciationStart ? new Date(data.depreciationStart) : undefined,
                depreciationFrequency: (_a = data.depreciationFrequency) !== null && _a !== void 0 ? _a : undefined,
                isActive: (_b = data.isActive) !== null && _b !== void 0 ? _b : undefined,
                roundOff: data.roundOff != null ? Boolean(data.roundOff) : undefined,
                decimalPlaces: data.decimalPlaces != null ? Number(data.decimalPlaces) : undefined,
                updatedById: employeeId,
            }
        });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed updating depreciation" });
    }
});
exports.updateDepreciation = updateDepreciation;
const calculateDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { assetId } = req.params;
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: parseInt(assetId) },
            include: { depreciation: true }
        });
        if (!asset || !asset.depreciation) {
            res.status(404).json({ message: "Depreciation not found" });
            return;
        }
        const dep = asset.depreciation;
        // ✅ Convert Decimal → number safely
        const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        const salvage = effectiveResidualValue(cost, Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0));
        const life = dep.expectedLifeYears || 1; // avoid divide by 0
        const rate = Number((_d = dep.depreciationRate) !== null && _d !== void 0 ? _d : 0);
        const method = dep.depreciationMethod;
        const start = new Date(dep.depreciationStart);
        const today = new Date();
        const diffYears = (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365);
        let depreciationTillDate = 0;
        let bookValue = cost;
        // =========================
        // STRAIGHT LINE (SL)
        // =========================
        if (method === "SL") {
            const annual = (cost - salvage) / life;
            depreciationTillDate = Math.min(annual * diffYears, cost - salvage);
            bookValue = cost - depreciationTillDate;
        }
        // =========================
        // DECLINING BALANCE (DB)
        // =========================
        else if (method === "DB") {
            bookValue = cost * Math.pow((1 - rate / 100), diffYears);
            depreciationTillDate = cost - bookValue;
        }
        // =========================
        // SAFETY FIXES
        // =========================
        if (bookValue < salvage) {
            bookValue = salvage;
        }
        if (depreciationTillDate < 0) {
            depreciationTillDate = 0;
        }
        yield prismaClient_1.default.assetDepreciation.update({
            where: { assetId: asset.id },
            data: {
                accumulatedDepreciation: depreciationTillDate,
                currentBookValue: bookValue,
                lastCalculatedAt: new Date()
            }
        });
        res.json({
            assetId,
            depreciationMethod: method,
            purchaseCost: cost,
            salvageValue: salvage,
            depreciationTillDate: Number(depreciationTillDate.toFixed(2)),
            bookValue: Number(bookValue.toFixed(2)),
            yearsUsed: Number(diffYears.toFixed(2))
        });
        return;
    }
    catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Error calculating depreciation",
            error: err.message
        });
        return;
    }
});
exports.calculateDepreciation = calculateDepreciation;
function monthsDiff(a, b) {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
const runDepreciationForAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = (_a = req.user.employeeDbId) !== null && _a !== void 0 ? _a : null;
        const assetId = Number(req.params.assetId);
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetId },
            include: { depreciation: true },
        });
        if (!asset || !asset.depreciation) {
            res.status(404).json({ message: "Depreciation not found" });
            return;
        }
        const dep = asset.depreciation;
        if (!dep.isActive) {
            res.status(400).json({ message: "Depreciation is inactive" });
            return;
        }
        const cost = Number((_c = (_b = asset.purchaseCost) !== null && _b !== void 0 ? _b : asset.estimatedValue) !== null && _c !== void 0 ? _c : 0);
        const salvage = (0, depreciationEngine_1.effectiveResidualValue)(cost, Number((_d = dep.salvageValue) !== null && _d !== void 0 ? _d : 0));
        const start = new Date(dep.depreciationStart);
        const today = new Date();
        // ── Determine the next FY due ─────────────────────────────────────────
        // Use Indian FY (Apr-Mar). Walk forward from depreciationStart until we
        // find a FY whose end is ≤ today and is after lastCalculatedAt.
        const lastCalc = dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : null;
        let fy = (0, depreciationEngine_1.getFYContext)(lastCalc ? new Date(lastCalc.getTime() + 86400000) : start);
        while (fy.fyEnd <= (lastCalc !== null && lastCalc !== void 0 ? lastCalc : new Date(0))) {
            fy = (0, depreciationEngine_1.getFYContext)(new Date(fy.fyEnd.getTime() + 86400000));
        }
        if (fy.fyEnd > today) {
            res.status(400).json({ message: `Next depreciation period (${fy.fyLabel}) has not ended yet` });
            return;
        }
        // ── Build engine inputs ───────────────────────────────────────────────
        const assetForDep = {
            id: asset.id,
            assetId: asset.assetId,
            purchaseCost: cost,
            estimatedValue: Number((_e = asset.estimatedValue) !== null && _e !== void 0 ? _e : 0),
            purchaseDate: (_f = asset.purchaseDate) !== null && _f !== void 0 ? _f : null,
            installedAt: (_g = asset.installedAt) !== null && _g !== void 0 ? _g : null,
            isLegacyAsset: (_h = asset.isLegacyAsset) !== null && _h !== void 0 ? _h : false,
            migrationMode: (_j = asset.migrationMode) !== null && _j !== void 0 ? _j : null,
            migrationDate: (_k = asset.migrationDate) !== null && _k !== void 0 ? _k : null,
            originalPurchaseDate: (_l = asset.originalPurchaseDate) !== null && _l !== void 0 ? _l : null,
            originalCost: (_m = asset.originalCost) !== null && _m !== void 0 ? _m : null,
            accDepAtMigration: (_o = asset.accDepAtMigration) !== null && _o !== void 0 ? _o : null,
            openingWdvAtMigration: (_p = asset.openingWdvAtMigration) !== null && _p !== void 0 ? _p : null,
        };
        const cfg = {
            method: dep.depreciationMethod,
            rate: Number((_q = dep.depreciationRate) !== null && _q !== void 0 ? _q : 0),
            lifeYears: dep.expectedLifeYears,
            salvage,
            depreciationStart: start,
            frequency: dep.depreciationFrequency || "YEARLY",
            roundOff: (_r = dep.roundOff) !== null && _r !== void 0 ? _r : false,
            decimalPlaces: (_s = dep.decimalPlaces) !== null && _s !== void 0 ? _s : 2,
        };
        const result = yield (0, depreciationEngine_1.calculateAssetFYDepreciation)(assetForDep, cfg, fy);
        if (result.preMigrationSkipped) {
            res.status(400).json({ message: `Skipped — ${fy.fyLabel} is before migration date` });
            return;
        }
        if (result.depreciationAmount <= 0) {
            res.status(400).json({ message: "No depreciation due (asset at salvage value or below)" });
            return;
        }
        const persisted = yield (0, depreciationEngine_1.persistDepreciationResult)({
            assetId,
            depRecordId: dep.id,
            result,
            doneById: employeeId,
            reason: "SYSTEM_RUN",
        });
        res.json(Object.assign({ message: "Depreciation applied", breakdown: result }, persisted));
        return;
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to run depreciation" });
        return;
    }
});
exports.runDepreciationForAsset = runDepreciationForAsset;
// ─── Round-off helper ────────────────────────────────────────────────────────
function applyRoundOff(value, roundOff, decimalPlaces) {
    if (!roundOff)
        return Number(value.toFixed(2));
    return Number(value.toFixed(decimalPlaces));
}
// ─── Residual Value helper ────────────────────────────────────────────────────
// Residual (salvage) value defaults to 5% of asset cost per standard practice.
// If an explicit value > 0 was stored on the record, that takes precedence.
function effectiveResidualValue(cost, storedSalvage) {
    if (storedSalvage != null && Number(storedSalvage) > 0)
        return Number(storedSalvage);
    return Number((cost * 0.05).toFixed(2));
}
// ─── Indian IT Act 180-day convention ────────────────────────────────────────
// Assets purchased on or after 1-Oct (second half of Indian FY Apr-Mar) get
// only 50% of the annual depreciation rate in their first year.
// Months 9-11 = Oct-Dec, months 0-2 = Jan-Mar (all in second half of FY).
function isSecondHalfOfIndianFY(date) {
    const m = date.getMonth(); // 0 = Jan … 11 = Dec
    return m >= 9 || m <= 2; // Oct(9), Nov(10), Dec(11), Jan(0), Feb(1), Mar(2)
}
// ─── WDV Schedule generator ──────────────────────────────────────────────────
// Builds a full period-by-period projection until salvage value is reached
function buildDepreciationSchedule(params) {
    const { cost, salvage, rate, method, lifeYears, frequency, depreciationStart, lastCalculatedAt, roundOff, decimalPlaces } = params;
    const isMonthly = frequency === "MONTHLY";
    const today = new Date();
    const schedule = [];
    // How many periods total?
    const totalPeriods = isMonthly ? lifeYears * 12 : lifeYears;
    // Fixed annual/period depreciation for SL
    const slPeriodDep = method === "SL"
        ? (isMonthly ? (cost - salvage) / (lifeYears * 12) : (cost - salvage) / lifeYears)
        : 0;
    // Reconstruct full schedule from start (so period numbers are correct)
    let wdv = cost;
    let accumulated = 0;
    for (let p = 1; p <= totalPeriods; p++) {
        // Period date window
        const periodStart = new Date(depreciationStart);
        if (isMonthly) {
            periodStart.setMonth(periodStart.getMonth() + (p - 1));
        }
        else {
            periodStart.setFullYear(periodStart.getFullYear() + (p - 1));
        }
        const periodEnd = new Date(periodStart);
        if (isMonthly) {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
        }
        else {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        }
        const openingWDV = Number(wdv.toFixed(2));
        if (openingWDV <= salvage)
            break;
        let depAmt = 0;
        if (method === "SL") {
            depAmt = slPeriodDep;
        }
        else if (method === "DB") {
            const periodRate = isMonthly ? (rate / 100) / 12 : (rate / 100);
            // Indian IT Act 180-day rule: first year only, yearly only
            const effectiveRate = (!isMonthly && p === 1 && isSecondHalfOfIndianFY(depreciationStart))
                ? periodRate / 2
                : periodRate;
            depAmt = openingWDV * effectiveRate;
        }
        else {
            break; // OTHER method not projectable
        }
        // Cap at salvage floor
        depAmt = Math.min(depAmt, openingWDV - salvage);
        depAmt = applyRoundOff(depAmt, roundOff, decimalPlaces);
        const closingWDV = applyRoundOff(openingWDV - depAmt, roundOff, decimalPlaces);
        accumulated = Number((accumulated + depAmt).toFixed(2));
        const isCompleted = lastCalculatedAt ? periodEnd <= new Date(lastCalculatedAt) : false;
        const isFuture = !isCompleted && periodEnd > today;
        const isCurrent = !isCompleted && !isFuture;
        schedule.push({
            period: p,
            label: isMonthly
                ? `Month ${p} (${periodStart.toLocaleString('en-IN', { month: 'short', year: 'numeric' })})`
                : `Year ${p} (FY ${periodStart.getFullYear()}-${String(periodEnd.getFullYear()).slice(-2)})`,
            periodStart: periodStart.toISOString().split('T')[0],
            periodEnd: periodEnd.toISOString().split('T')[0],
            openingWDV,
            depreciation: depAmt,
            closingWDV,
            accumulated,
            isCompleted,
            isCurrent,
            isFuture,
        });
        wdv = closingWDV;
        if (wdv <= salvage)
            break;
    }
    return schedule;
}
function computeEligibleDepreciations() {
    return __awaiter(this, arguments, void 0, function* (filters = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
        // Build asset-level where clause from filters
        const assetWhere = {};
        if (filters.departmentId)
            assetWhere.departmentId = filters.departmentId;
        if (filters.categoryId)
            assetWhere.assetCategoryId = filters.categoryId;
        if (filters.assetId)
            assetWhere.id = filters.assetId;
        const depreciations = yield prismaClient_1.default.assetDepreciation.findMany({
            where: Object.assign({ isActive: true }, (Object.keys(assetWhere).length ? { asset: assetWhere } : {})),
            include: {
                asset: {
                    select: {
                        id: true, assetId: true, assetName: true,
                        purchaseCost: true, estimatedValue: true,
                        departmentId: true, assetCategoryId: true,
                        department: { select: { id: true, name: true } },
                        assetCategory: { select: { id: true, name: true } },
                    }
                }
            },
        });
        const today = new Date();
        const eligible = [];
        for (const dep of depreciations) {
            const cost = Number((_b = (_a = dep.asset.purchaseCost) !== null && _a !== void 0 ? _a : dep.asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
            const salvage = effectiveResidualValue(cost, Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0));
            const lifeYears = dep.expectedLifeYears;
            const rate = Number((_d = dep.depreciationRate) !== null && _d !== void 0 ? _d : 0);
            const method = dep.depreciationMethod;
            const depStart = new Date(dep.depreciationStart);
            // ── Determine next due FY using shared helper ──────────────────────────
            const lastCalc = dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : null;
            let fy = (0, depreciationEngine_1.getFYContext)(lastCalc ? new Date(lastCalc.getTime() + 86400000) : depStart);
            while (fy.fyEnd <= (lastCalc !== null && lastCalc !== void 0 ? lastCalc : new Date(0))) {
                fy = (0, depreciationEngine_1.getFYContext)(new Date(fy.fyEnd.getTime() + 86400000));
            }
            // Not yet due — skip unless forceOverride
            if (fy.fyEnd > today && !filters.forceOverride)
                continue;
            // ── Run split-method engine ────────────────────────────────────────────
            const assetForDep = {
                id: dep.asset.id,
                assetId: dep.asset.assetId,
                purchaseCost: cost,
                estimatedValue: Number((_e = dep.asset.estimatedValue) !== null && _e !== void 0 ? _e : 0),
                purchaseDate: (_f = dep.asset.purchaseDate) !== null && _f !== void 0 ? _f : null,
                installedAt: (_g = dep.asset.installedAt) !== null && _g !== void 0 ? _g : null,
                isLegacyAsset: (_h = dep.asset.isLegacyAsset) !== null && _h !== void 0 ? _h : false,
                migrationMode: (_j = dep.asset.migrationMode) !== null && _j !== void 0 ? _j : null,
                migrationDate: (_k = dep.asset.migrationDate) !== null && _k !== void 0 ? _k : null,
                originalPurchaseDate: (_l = dep.asset.originalPurchaseDate) !== null && _l !== void 0 ? _l : null,
                originalCost: (_m = dep.asset.originalCost) !== null && _m !== void 0 ? _m : null,
                accDepAtMigration: (_o = dep.asset.accDepAtMigration) !== null && _o !== void 0 ? _o : null,
                openingWdvAtMigration: (_p = dep.asset.openingWdvAtMigration) !== null && _p !== void 0 ? _p : null,
            };
            const cfg = {
                method,
                rate,
                lifeYears,
                salvage,
                depreciationStart: depStart,
                frequency: dep.depreciationFrequency || "YEARLY",
                roundOff: (_q = dep.roundOff) !== null && _q !== void 0 ? _q : false,
                decimalPlaces: (_r = dep.decimalPlaces) !== null && _r !== void 0 ? _r : 2,
            };
            const result = yield (0, depreciationEngine_1.calculateAssetFYDepreciation)(assetForDep, cfg, fy);
            if (result.preMigrationSkipped)
                continue;
            if (result.depreciationAmount <= 0)
                continue;
            eligible.push({
                depId: dep.id,
                assetDbId: dep.asset.id,
                assetCode: dep.asset.assetId,
                assetName: dep.asset.assetName,
                department: ((_s = dep.asset.department) === null || _s === void 0 ? void 0 : _s.name) || null,
                category: ((_t = dep.asset.assetCategory) === null || _t === void 0 ? void 0 : _t.name) || null,
                method,
                frequency: dep.depreciationFrequency || "YEARLY",
                roundOff: (_u = dep.roundOff) !== null && _u !== void 0 ? _u : false,
                decimalPlaces: (_v = dep.decimalPlaces) !== null && _v !== void 0 ? _v : 2,
                overridden: filters.forceOverride && fy.fyEnd > today,
                previousBookValue: result.openingWdv,
                previousAccumulated: result.accDepBefore,
                depreciationAmount: result.depreciationAmount,
                newBookValue: result.closingWdv,
                newAccumulated: result.accDepAfter,
                salvageValue: salvage,
                periodStart: fy.fyStart,
                periodEnd: fy.fyEnd,
                // Split breakdown — for UI display
                fyLabel: result.fyLabel,
                depOnOpening: result.depOnOpening,
                depOnAdditions: result.depOnAdditions,
                additionsAmount: result.additionsAmount,
                effectiveRate: result.effectiveRate,
                halfYearApplied: result.halfYearApplied,
                isFirstFY: result.isFirstFY,
                openingWdvSource: result.openingWdvSource,
            });
        }
        return eligible;
    });
}
// ─── Round-off Impact Analysis ───────────────────────────────────────────────
// GET /depreciation/roundoff-impact
// For every active AssetDepreciation, computes the NEXT period's raw amount
// then shows what happens at 0 dp (rupee), 2 dp, and the asset's current setting.
// Helps the manager see total variance before committing round-off per asset.
const getRoundOffImpact = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const deps = yield prismaClient_1.default.assetDepreciation.findMany({
            where: { isActive: true },
            include: {
                asset: {
                    select: {
                        id: true, assetId: true, assetName: true,
                        purchaseCost: true, estimatedValue: true,
                        department: { select: { name: true } },
                        assetCategory: { select: { name: true } },
                    }
                }
            }
        });
        const rows = [];
        for (const dep of deps) {
            const cost = Number((_b = (_a = dep.asset.purchaseCost) !== null && _a !== void 0 ? _a : dep.asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
            const salvage = effectiveResidualValue(cost, Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0));
            const rate = Number((_d = dep.depreciationRate) !== null && _d !== void 0 ? _d : 0);
            const life = dep.expectedLifeYears;
            const method = dep.depreciationMethod;
            if (!cost || !["SL", "DB"].includes(method))
                continue;
            const prevBook = Number((_e = dep.currentBookValue) !== null && _e !== void 0 ? _e : cost);
            const isMonthly = (dep.depreciationFrequency || "YEARLY") === "MONTHLY";
            // Compute raw (full precision) next-period depreciation
            let rawAmount = 0;
            if (method === "SL") {
                rawAmount = isMonthly ? (cost - salvage) / (life * 12) : (cost - salvage) / life;
            }
            else {
                const periodRate = isMonthly ? (rate / 100) / 12 : rate / 100;
                rawAmount = prevBook * periodRate;
            }
            const maxAllowed = Math.max(0, prevBook - salvage);
            rawAmount = Math.min(rawAmount, maxAllowed);
            if (rawAmount <= 0)
                continue;
            // Three scenarios
            const rounded0dp = Number(rawAmount.toFixed(0)); // nearest rupee
            const rounded2dp = Number(rawAmount.toFixed(2)); // 2 decimal places (standard)
            const currentRoundOff = (_f = dep.roundOff) !== null && _f !== void 0 ? _f : false;
            const currentDecimalPlaces = (_g = dep.decimalPlaces) !== null && _g !== void 0 ? _g : 2;
            const activeSetting = applyRoundOff(rawAmount, currentRoundOff, currentDecimalPlaces);
            const delta0dp = Number((rounded0dp - rawAmount).toFixed(4));
            const delta2dp = Number((rounded2dp - rawAmount).toFixed(4));
            const deltaActive = Number((activeSetting - rawAmount).toFixed(4));
            rows.push({
                assetDbId: dep.asset.id,
                assetCode: dep.asset.assetId,
                assetName: dep.asset.assetName,
                department: ((_h = dep.asset.department) === null || _h === void 0 ? void 0 : _h.name) || null,
                category: ((_j = dep.asset.assetCategory) === null || _j === void 0 ? void 0 : _j.name) || null,
                method,
                frequency: dep.depreciationFrequency || "YEARLY",
                currentBookValue: prevBook,
                // Amounts
                rawAmount: Number(rawAmount.toFixed(6)),
                rounded0dp,
                rounded2dp,
                activeSetting,
                // Deltas (positive = rounds UP = more depreciation; negative = rounds DOWN)
                delta0dp,
                delta2dp,
                deltaActive,
                // Settings
                roundOffEnabled: currentRoundOff,
                decimalPlaces: currentDecimalPlaces,
                // Risk indicator: how significant is the 0dp rounding for this asset?
                absImpact0dp: Math.abs(delta0dp),
            });
        }
        // Sort by absolute impact descending so high-variance assets appear first
        rows.sort((a, b) => b.absImpact0dp - a.absImpact0dp);
        // Aggregate totals
        const totalRaw = rows.reduce((s, r) => s + r.rawAmount, 0);
        const total0dp = rows.reduce((s, r) => s + r.rounded0dp, 0);
        const total2dp = rows.reduce((s, r) => s + r.rounded2dp, 0);
        const totalActive = rows.reduce((s, r) => s + r.activeSetting, 0);
        const variance0dp = Number((total0dp - totalRaw).toFixed(4));
        const variance2dp = Number((total2dp - totalRaw).toFixed(4));
        const varianceActive = Number((totalActive - totalRaw).toFixed(4));
        // Count assets rounding up vs down at 0dp
        const roundingUpCount = rows.filter(r => r.delta0dp > 0).length;
        const roundingDownCount = rows.filter(r => r.delta0dp < 0).length;
        const exactCount = rows.filter(r => r.delta0dp === 0).length;
        res.json({
            summary: {
                totalAssets: rows.length,
                totalRaw: Number(totalRaw.toFixed(2)),
                total0dp: Number(total0dp.toFixed(2)),
                total2dp: Number(total2dp.toFixed(2)),
                totalActiveSetting: Number(totalActive.toFixed(2)),
                variance0dp,
                variance2dp,
                varianceActive,
                roundingUpCount,
                roundingDownCount,
                exactCount,
                // Human-readable risk level
                riskLevel: Math.abs(variance0dp) < 1 ? "LOW" : Math.abs(variance0dp) < 10 ? "MEDIUM" : "HIGH",
            },
            rows,
        });
    }
    catch (error) {
        console.error("getRoundOffImpact error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getRoundOffImpact = getRoundOffImpact;
// ─── WDV Depreciation Schedule ───────────────────────────────────────────────
// GET /depreciation/schedule/:assetId
const getDepreciationSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    try {
        const assetId = Number(req.params.assetId);
        const dep = yield prismaClient_1.default.assetDepreciation.findUnique({
            where: { assetId },
            include: {
                asset: {
                    select: {
                        id: true, assetId: true, assetName: true,
                        purchaseCost: true, estimatedValue: true,
                        assetCategory: { select: { name: true } },
                        department: { select: { name: true } },
                    }
                }
            }
        });
        if (!dep) {
            res.status(404).json({ message: "No depreciation setup found for this asset" });
            return;
        }
        const cost = Number((_b = (_a = dep.asset.purchaseCost) !== null && _a !== void 0 ? _a : dep.asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        const salvage = effectiveResidualValue(cost, Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0));
        const rate = Number((_d = dep.depreciationRate) !== null && _d !== void 0 ? _d : 0);
        const roundOff = (_e = dep.roundOff) !== null && _e !== void 0 ? _e : false;
        const decimalPlaces = (_f = dep.decimalPlaces) !== null && _f !== void 0 ? _f : 2;
        if (!cost) {
            res.status(400).json({ message: "Asset has no purchase cost set" });
            return;
        }
        const schedule = buildDepreciationSchedule({
            cost,
            salvage,
            rate,
            method: dep.depreciationMethod,
            lifeYears: dep.expectedLifeYears,
            frequency: dep.depreciationFrequency || "YEARLY",
            depreciationStart: new Date(dep.depreciationStart),
            lastCalculatedAt: dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : null,
            roundOff,
            decimalPlaces,
        });
        const totalDepreciation = Number((cost - salvage).toFixed(2));
        const completedPeriods = schedule.filter(s => s.isCompleted).length;
        const currentPeriod = schedule.find(s => s.isCurrent);
        const remainingPeriods = schedule.filter(s => s.isFuture).length;
        const finalWDV = schedule.length ? schedule[schedule.length - 1].closingWDV : cost;
        res.json({
            asset: {
                id: dep.asset.id,
                assetId: dep.asset.assetId,
                assetName: dep.asset.assetName,
                category: (_g = dep.asset.assetCategory) === null || _g === void 0 ? void 0 : _g.name,
                department: (_h = dep.asset.department) === null || _h === void 0 ? void 0 : _h.name,
            },
            config: {
                method: dep.depreciationMethod,
                rate: rate,
                frequency: dep.depreciationFrequency || "YEARLY",
                lifeYears: dep.expectedLifeYears,
                originalCost: cost,
                salvageValue: salvage,
                startDate: dep.depreciationStart,
                roundOff,
                decimalPlaces,
                currentBookValue: Number((_j = dep.currentBookValue) !== null && _j !== void 0 ? _j : cost),
                accumulatedDepreciation: Number((_k = dep.accumulatedDepreciation) !== null && _k !== void 0 ? _k : 0),
            },
            summary: {
                totalDepreciation,
                completedPeriods,
                remainingPeriods,
                totalPeriods: schedule.length,
                finalWDV,
                currentPeriodLabel: (_l = currentPeriod === null || currentPeriod === void 0 ? void 0 : currentPeriod.label) !== null && _l !== void 0 ? _l : null,
            },
            schedule,
        });
    }
    catch (error) {
        console.error("getDepreciationSchedule error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getDepreciationSchedule = getDepreciationSchedule;
// ─── Batch Depreciation Preview ──────────────────────────────────────────────
const batchDepreciationPreview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (req.user.role !== "FINANCE") {
            res.status(403).json({ message: "Only FINANCE role can access batch depreciation" });
            return;
        }
        const filters = {
            departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
            categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
        };
        const eligible = yield computeEligibleDepreciations(filters);
        res.json({
            message: `${eligible.length} assets eligible for depreciation`,
            totalDepreciation: Number(eligible.reduce((sum, p) => sum + p.depreciationAmount, 0).toFixed(2)),
            preview: eligible,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to generate preview" });
    }
});
exports.batchDepreciationPreview = batchDepreciationPreview;
// ─── Batch Depreciation Run → creates a DRAFT run (no values committed yet) ──
const runBatchDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (req.user.role !== "FINANCE") {
            res.status(403).json({ message: "Only FINANCE role can run batch depreciation" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const filters = {
            departmentId: req.body.departmentId ? Number(req.body.departmentId) : undefined,
            categoryId: req.body.categoryId ? Number(req.body.categoryId) : undefined,
        };
        const eligible = yield computeEligibleDepreciations(filters);
        if (eligible.length === 0) {
            res.json({ message: "No assets eligible for depreciation at this time", processed: 0 });
            return;
        }
        const totalDepreciation = Number(eligible.reduce((sum, e) => sum + e.depreciationAmount, 0).toFixed(2));
        // Generate run number
        const runCount = yield prismaClient_1.default.batchDepreciationRun.count();
        const runNumber = `BDR-${new Date().getFullYear()}-${String(runCount + 1).padStart(3, "0")}`;
        const now = new Date();
        const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        let periodLabel = `FY ${fy}-${String(fy + 1).slice(2)}`;
        if (filters.departmentId || filters.categoryId) {
            const parts = [];
            if (filters.departmentId)
                parts.push(`Dept#${filters.departmentId}`);
            if (filters.categoryId)
                parts.push(`Cat#${filters.categoryId}`);
            periodLabel += ` (${parts.join(", ")})`;
        }
        // Create draft run + log entries (no AssetDepreciation updated yet)
        const batchRun = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const run = yield tx.batchDepreciationRun.create({
                data: {
                    runNumber,
                    status: "DRAFT",
                    fiscalYear: fy,
                    periodLabel,
                    totalAssets: eligible.length,
                    totalDepreciation: String(totalDepreciation),
                    runById: employeeId,
                },
            });
            // Create draft log entries linked to this batch run — with split breakdown
            for (const e of eligible) {
                yield tx.depreciationLog.create({
                    data: {
                        assetId: e.assetDbId,
                        periodStart: e.periodStart,
                        periodEnd: e.periodEnd,
                        depreciationAmount: String(e.depreciationAmount.toFixed(2)),
                        bookValueAfter: String(e.newBookValue.toFixed(2)),
                        fyLabel: (_a = e.fyLabel) !== null && _a !== void 0 ? _a : null,
                        openingWdv: e.previousBookValue != null ? String(e.previousBookValue) : null,
                        depOnOpening: e.depOnOpening != null ? String(e.depOnOpening) : null,
                        depOnAdditions: e.depOnAdditions != null ? String(e.depOnAdditions) : null,
                        additionsAmount: e.additionsAmount != null ? String(e.additionsAmount) : null,
                        effectiveRate: e.effectiveRate != null ? String(e.effectiveRate) : null,
                        halfYearApplied: (_b = e.halfYearApplied) !== null && _b !== void 0 ? _b : false,
                        isFirstFY: (_c = e.isFirstFY) !== null && _c !== void 0 ? _c : false,
                        openingWdvSource: (_d = e.openingWdvSource) !== null && _d !== void 0 ? _d : null,
                        doneById: employeeId,
                        reason: "BATCH_DRAFT",
                        batchRunId: run.id,
                    },
                });
            }
            return run;
        }));
        res.json({
            message: `Draft batch run created: ${runNumber}. Pending FINANCE approval to commit values.`,
            runId: batchRun.id,
            runNumber,
            status: "DRAFT",
            totalAssets: eligible.length,
            totalDepreciation,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create batch depreciation draft" });
    }
});
exports.runBatchDepreciation = runBatchDepreciation;
// ─── Get All Batch Runs ───────────────────────────────────────────────────────
const getBatchRuns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const runs = yield prismaClient_1.default.batchDepreciationRun.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                runBy: { select: { name: true, employeeID: true } },
                approvedBy: { select: { name: true, employeeID: true } },
            },
        });
        res.json({ data: runs });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch batch runs" });
    }
});
exports.getBatchRuns = getBatchRuns;
// ─── Per-Asset Run → creates a DRAFT run for a single asset ──────────────────
// POST /depreciation/asset-run
// Body: { assetId, forceOverride? }
// forceOverride=true bypasses the "not yet due" check — useful for partial-year adjustments
const runAssetDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (req.user.role !== "FINANCE") {
            res.status(403).json({ message: "Only FINANCE role can run per-asset depreciation" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const { assetId, forceOverride = false } = req.body;
        if (!assetId) {
            res.status(400).json({ message: "assetId is required" });
            return;
        }
        const filters = { assetId: Number(assetId), forceOverride: Boolean(forceOverride) };
        const eligible = yield computeEligibleDepreciations(filters);
        if (eligible.length === 0) {
            res.json({
                message: forceOverride
                    ? "Asset has no depreciation configured or is fully depreciated."
                    : "Asset is not due for depreciation yet. Use forceOverride:true to run it anyway.",
                eligible: false,
            });
            return;
        }
        const e = eligible[0];
        const now = new Date();
        const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const runCount = yield prismaClient_1.default.batchDepreciationRun.count();
        const runNumber = `ADR-${new Date().getFullYear()}-${String(runCount + 1).padStart(3, "0")}`;
        const notes = forceOverride && e.overridden ? "Manual override — period not yet complete" : undefined;
        const batchRun = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const run = yield tx.batchDepreciationRun.create({
                data: {
                    runNumber,
                    status: "DRAFT",
                    fiscalYear: fy,
                    periodLabel: `Asset Run — ${e.assetName}${forceOverride ? " (Override)" : ""}`,
                    totalAssets: 1,
                    totalDepreciation: String(e.depreciationAmount.toFixed(2)),
                    notes: notes || null,
                    runById: employeeId,
                },
            });
            yield tx.depreciationLog.create({
                data: {
                    assetId: e.assetDbId,
                    periodStart: e.periodStart,
                    periodEnd: e.periodEnd,
                    depreciationAmount: String(e.depreciationAmount.toFixed(2)),
                    bookValueAfter: String(e.newBookValue.toFixed(2)),
                    fyLabel: (_a = e.fyLabel) !== null && _a !== void 0 ? _a : null,
                    openingWdv: e.previousBookValue != null ? String(e.previousBookValue) : null,
                    depOnOpening: e.depOnOpening != null ? String(e.depOnOpening) : null,
                    depOnAdditions: e.depOnAdditions != null ? String(e.depOnAdditions) : null,
                    additionsAmount: e.additionsAmount != null ? String(e.additionsAmount) : null,
                    effectiveRate: e.effectiveRate != null ? String(e.effectiveRate) : null,
                    halfYearApplied: (_b = e.halfYearApplied) !== null && _b !== void 0 ? _b : false,
                    isFirstFY: (_c = e.isFirstFY) !== null && _c !== void 0 ? _c : false,
                    openingWdvSource: (_d = e.openingWdvSource) !== null && _d !== void 0 ? _d : null,
                    doneById: employeeId,
                    reason: "BATCH_DRAFT",
                    batchRunId: run.id,
                },
            });
            return run;
        }));
        res.json({
            message: `Asset draft run created: ${runNumber}. Pending FINANCE approval to commit.`,
            runId: batchRun.id,
            runNumber,
            status: "DRAFT",
            assetName: e.assetName,
            depreciationAmount: e.depreciationAmount,
            overridden: e.overridden,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create per-asset depreciation run" });
    }
});
exports.runAssetDepreciation = runAssetDepreciation;
// ─── Get All Depreciable Assets (for asset-run tab) ──────────────────────────
// GET /depreciation/depreciable-assets
const getDepreciableAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, categoryId, search } = req.query;
        const where = { isActive: true };
        const assetWhere = {};
        if (departmentId)
            assetWhere.departmentId = Number(departmentId);
        if (categoryId)
            assetWhere.assetCategoryId = Number(categoryId);
        if (search)
            assetWhere.assetName = { contains: search };
        if (Object.keys(assetWhere).length)
            where.asset = assetWhere;
        const depreciations = yield prismaClient_1.default.assetDepreciation.findMany({
            where,
            include: {
                asset: {
                    select: {
                        id: true, assetId: true, assetName: true, purchaseCost: true, estimatedValue: true,
                        department: { select: { id: true, name: true } },
                        assetCategory: { select: { id: true, name: true } },
                    }
                }
            },
            orderBy: { createdAt: "desc" },
        });
        const today = new Date();
        const result = depreciations.map((dep) => {
            var _a, _b;
            // Check if due
            const depStart = new Date(dep.depreciationStart);
            const isMonthly = (dep.depreciationFrequency || "YEARLY") === "MONTHLY";
            let periodStart = depStart;
            let periodEnd = new Date(depStart);
            if (isMonthly)
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            else
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            if (dep.lastCalculatedAt) {
                const lastCalc = new Date(dep.lastCalculatedAt);
                while (periodEnd <= lastCalc) {
                    periodStart = new Date(periodEnd);
                    if (isMonthly) {
                        periodEnd = new Date(periodStart);
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    }
                    else {
                        periodEnd = new Date(periodStart);
                        periodEnd.setFullYear(periodStart.getFullYear() + 1);
                    }
                }
            }
            const isDue = periodEnd <= today;
            const daysUntilDue = isDue ? 0 : Math.ceil((periodEnd.getTime() - today.getTime()) / 86400000);
            return {
                depId: dep.id,
                assetDbId: dep.asset.id,
                assetCode: dep.asset.assetId,
                assetName: dep.asset.assetName,
                department: ((_a = dep.asset.department) === null || _a === void 0 ? void 0 : _a.name) || null,
                category: ((_b = dep.asset.assetCategory) === null || _b === void 0 ? void 0 : _b.name) || null,
                currentBookValue: Number(dep.currentBookValue),
                accumulatedDepreciation: Number(dep.accumulatedDepreciation),
                method: dep.depreciationMethod,
                frequency: dep.depreciationFrequency || "YEARLY",
                lastCalculatedAt: dep.lastCalculatedAt,
                nextPeriodEnd: periodEnd,
                isDue,
                daysUntilDue,
            };
        });
        res.json({ data: result, total: result.length });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to load depreciable assets" });
    }
});
exports.getDepreciableAssets = getDepreciableAssets;
// ─── Approve Batch Run → commits values to AssetDepreciation ─────────────────
const approveBatchRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (req.user.role !== "FINANCE") {
            res.status(403).json({ message: "Only FINANCE role can approve batch depreciation" });
            return;
        }
        const runId = Number(req.params.runId);
        const employeeId = req.user.employeeDbId;
        const run = yield prismaClient_1.default.batchDepreciationRun.findUnique({
            where: { id: runId },
            include: {
                logs: {
                    include: {
                        asset: {
                            select: {
                                id: true,
                                depreciation: { select: { id: true, accumulatedDepreciation: true, currentBookValue: true, lastCalculatedAt: true } }
                            }
                        }
                    }
                }
            },
        });
        if (!run) {
            res.status(404).json({ message: "Batch run not found" });
            return;
        }
        if (run.status !== "DRAFT") {
            res.status(400).json({ message: `Cannot approve a run with status: ${run.status}` });
            return;
        }
        // Commit depreciation values to AssetDepreciation
        yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            for (const log of run.logs) {
                const dep = (_a = log.asset) === null || _a === void 0 ? void 0 : _a.depreciation;
                if (!dep)
                    continue;
                const prevAccum = Number((_b = dep.accumulatedDepreciation) !== null && _b !== void 0 ? _b : 0);
                const depAmount = Number(log.depreciationAmount);
                const newAccum = Number((prevAccum + depAmount).toFixed(2));
                const newBook = Number(log.bookValueAfter);
                yield tx.assetDepreciation.update({
                    where: { id: dep.id },
                    data: {
                        accumulatedDepreciation: String(newAccum),
                        currentBookValue: String(newBook),
                        lastCalculatedAt: log.periodEnd,
                        updatedById: employeeId,
                    },
                });
                // Update log reason from DRAFT to BATCH_RUN
                yield tx.depreciationLog.update({
                    where: { id: log.id },
                    data: { reason: "BATCH_RUN" },
                });
            }
            yield tx.batchDepreciationRun.update({
                where: { id: runId },
                data: {
                    status: "APPROVED",
                    approvedById: employeeId,
                    approvedAt: new Date(),
                },
            });
        }));
        // Auto-voucher: DR Depreciation Expense / CR Accumulated Depreciation (per GL mappings)
        // We fire-and-forget — a missing GL mapping just skips the voucher gracefully
        try {
            const totalDepAmount = run.logs.reduce((s, l) => s + Number(l.depreciationAmount), 0);
            if (totalDepAmount > 0) {
                // Collect GL accounts from category mappings for each log
                const mappingCache = new Map();
                const lines = [];
                for (const log of run.logs) {
                    const catId = (_a = log.asset) === null || _a === void 0 ? void 0 : _a.assetCategoryId;
                    if (!catId)
                        continue;
                    if (!mappingCache.has(catId)) {
                        const m = yield prismaClient_1.default.assetGLMapping.findUnique({ where: { assetCategoryId: catId } });
                        mappingCache.set(catId, m);
                    }
                    const mapping = mappingCache.get(catId);
                    if (!(mapping === null || mapping === void 0 ? void 0 : mapping.depExpenseAccountId) || !(mapping === null || mapping === void 0 ? void 0 : mapping.accDepAccountId))
                        continue;
                    const amt = Number(log.depreciationAmount);
                    lines.push({ accountId: mapping.depExpenseAccountId, debit: amt, credit: 0, narration: `Dep. ${((_b = log.asset) === null || _b === void 0 ? void 0 : _b.assetName) || ""}` });
                    lines.push({ accountId: mapping.accDepAccountId, debit: 0, credit: amt, narration: `Acc. Dep. ${((_c = log.asset) === null || _c === void 0 ? void 0 : _c.assetName) || ""}` });
                }
                if (lines.length >= 2) {
                    yield (0, finance_voucher_controller_1.createAutoVoucher)({
                        sourceType: "DEPRECIATION_BATCH",
                        sourceId: runId,
                        voucherDate: new Date(),
                        narration: `Depreciation batch ${run.runNumber} — FY${run.fiscalYear}`,
                        batchRunId: runId,
                        createdById: employeeId,
                        lines,
                    });
                }
            }
        }
        catch (voucherErr) {
            console.warn("Auto-voucher creation skipped (GL mapping may be incomplete):", voucherErr);
        }
        res.json({ message: `Batch run ${run.runNumber} approved and depreciation values committed.`, runId });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to approve batch run" });
    }
});
exports.approveBatchRun = approveBatchRun;
// ─── Reject Batch Run ─────────────────────────────────────────────────────────
const rejectBatchRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        if (req.user.role !== "FINANCE") {
            res.status(403).json({ message: "Only FINANCE role can reject batch depreciation" });
            return;
        }
        const runId = Number(req.params.runId);
        const { reason } = req.body;
        const run = yield prismaClient_1.default.batchDepreciationRun.findUnique({ where: { id: runId } });
        if (!run) {
            res.status(404).json({ message: "Batch run not found" });
            return;
        }
        if (run.status !== "DRAFT") {
            res.status(400).json({ message: `Cannot reject a run with status: ${run.status}` });
            return;
        }
        yield prismaClient_1.default.batchDepreciationRun.update({
            where: { id: runId },
            data: {
                status: "REJECTED",
                rejectionReason: reason || "Rejected by FINANCE",
                approvedById: req.user.employeeDbId,
                approvedAt: new Date(),
            },
        });
        res.json({ message: `Batch run ${run.runNumber} rejected.` });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to reject batch run" });
    }
});
exports.rejectBatchRun = rejectBatchRun;
// ─── Get All Depreciations (standalone page) ─────────────────────────────────
const getAllDepreciations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { method, frequency, page = "1", limit = "25", search, exportCsv } = req.query;
        const where = {};
        if (method)
            where.depreciationMethod = String(method);
        if (frequency)
            where.depreciationFrequency = String(frequency);
        if (search) {
            where.asset = {
                OR: [
                    { assetId: { contains: String(search) } },
                    { assetName: { contains: String(search) } },
                ],
            };
        }
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, depreciations] = yield Promise.all([
            prismaClient_1.default.assetDepreciation.count({ where }),
            prismaClient_1.default.assetDepreciation.findMany(Object.assign({ where, include: {
                    asset: { select: { id: true, assetId: true, assetName: true, purchaseCost: true, estimatedValue: true, status: true } },
                }, orderBy: { createdAt: "desc" } }, (exportCsv !== "true" ? { skip, take } : {}))),
        ]);
        if (exportCsv === "true") {
            const csvRows = depreciations.map((d) => {
                var _a, _b;
                return ({
                    AssetId: ((_a = d.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    AssetName: ((_b = d.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    Method: d.depreciationMethod,
                    Rate: Number(d.depreciationRate),
                    LifeYears: d.expectedLifeYears,
                    SalvageValue: d.salvageValue ? Number(d.salvageValue) : "",
                    AccumulatedDepreciation: d.accumulatedDepreciation ? Number(d.accumulatedDepreciation) : "",
                    CurrentBookValue: d.currentBookValue ? Number(d.currentBookValue) : "",
                    Frequency: d.depreciationFrequency || "",
                    LastCalculated: d.lastCalculatedAt ? new Date(d.lastCalculatedAt).toISOString().split("T")[0] : "",
                    IsActive: d.isActive ? "Yes" : "No",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=depreciations.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json({ data: depreciations, total, page: parseInt(String(page)), limit: take });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch depreciations" });
    }
});
exports.getAllDepreciations = getAllDepreciations;
// ─── Get Depreciation Logs ───────────────────────────────────────────────────
const getDepreciationLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, page = "1", limit = "25" } = req.query;
        const where = {};
        if (assetId)
            where.assetId = Number(assetId);
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, logs] = yield Promise.all([
            prismaClient_1.default.depreciationLog.count({ where }),
            prismaClient_1.default.depreciationLog.findMany({
                where,
                include: {
                    asset: { select: { assetId: true, assetName: true } },
                    doneBy: { select: { name: true, employeeID: true } },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
        ]);
        res.json({ data: logs, total, page: parseInt(String(page)), limit: take });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch depreciation logs" });
    }
});
exports.getDepreciationLogs = getDepreciationLogs;
// ─── POST /depreciation/backfill-logs ────────────────────────────────────────
// Generates DepreciationLog entries for all completed FYs between each asset's
// depreciation start date and today. Idempotent — skips assets that already
// have logs. Useful for assets imported before backfill was wired into import.
//
// Body (all optional):
//   assetIds: number[]    — limit to specific asset IDs
//   categoryId: number    — limit to one category
//   resetExisting: boolean — if true, deletes existing logs first then re-generates
//   dryRun: boolean       — calculate but don't persist (for preview)
const depreciationEngine_2 = require("../../utilis/depreciationEngine");
const backfillDepreciationLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const { assetIds, categoryId, resetExisting, dryRun } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
        const where = { isActive: true };
        if (assetIds && Array.isArray(assetIds) && assetIds.length > 0) {
            where.assetId = { in: assetIds.map((n) => Number(n)) };
        }
        if (categoryId) {
            where.asset = { assetCategoryId: Number(categoryId) };
        }
        const depreciations = yield prismaClient_1.default.assetDepreciation.findMany({
            where,
            include: {
                asset: {
                    select: {
                        id: true, assetId: true, assetName: true,
                        purchaseCost: true, estimatedValue: true, purchaseDate: true,
                        isLegacyAsset: true, migrationMode: true, migrationDate: true,
                        originalPurchaseDate: true, originalCost: true,
                        accDepAtMigration: true, openingWdvAtMigration: true,
                        financialYearAdded: true, assetPoolId: true,
                    },
                },
            },
        });
        if (!depreciations.length) {
            res.json({ message: "No matching assets found", processed: 0 });
            return;
        }
        const employeeId = (_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.employeeDbId) !== null && _c !== void 0 ? _c : null;
        const results = [];
        let totalCreated = 0, totalSkipped = 0, totalErrors = 0;
        for (const dep of depreciations) {
            const a = dep.asset;
            try {
                // If resetExisting → wipe existing logs + reset cumulative values first
                if (resetExisting && !dryRun) {
                    yield prismaClient_1.default.depreciationLog.deleteMany({ where: { assetId: a.id } });
                    const cost = Number((_e = (_d = a.purchaseCost) !== null && _d !== void 0 ? _d : a.estimatedValue) !== null && _e !== void 0 ? _e : 0);
                    yield prismaClient_1.default.assetDepreciation.update({
                        where: { id: dep.id },
                        data: {
                            accumulatedDepreciation: "0",
                            currentBookValue: String(cost),
                            lastCalculatedAt: null,
                        },
                    });
                }
                const cost = Number((_g = (_f = a.purchaseCost) !== null && _f !== void 0 ? _f : a.estimatedValue) !== null && _g !== void 0 ? _g : 0);
                const assetForDep = {
                    id: a.id,
                    assetId: a.assetId,
                    purchaseCost: cost,
                    estimatedValue: Number((_h = a.estimatedValue) !== null && _h !== void 0 ? _h : 0),
                    purchaseDate: a.purchaseDate,
                    installedAt: null,
                    isLegacyAsset: a.isLegacyAsset,
                    migrationMode: a.migrationMode,
                    migrationDate: a.migrationDate,
                    originalPurchaseDate: a.originalPurchaseDate,
                    originalCost: a.originalCost,
                    accDepAtMigration: a.accDepAtMigration,
                    openingWdvAtMigration: a.openingWdvAtMigration,
                    financialYearAdded: a.financialYearAdded,
                    assetPoolId: a.assetPoolId,
                };
                const cfg = {
                    method: dep.depreciationMethod,
                    rate: Number((_j = dep.depreciationRate) !== null && _j !== void 0 ? _j : 0),
                    lifeYears: dep.expectedLifeYears,
                    salvage: Number((_k = dep.salvageValue) !== null && _k !== void 0 ? _k : 0),
                    depreciationStart: dep.depreciationStart ? new Date(dep.depreciationStart) : new Date(),
                    frequency: dep.depreciationFrequency || "YEARLY",
                    roundOff: (_l = dep.roundOff) !== null && _l !== void 0 ? _l : false,
                    decimalPlaces: (_m = dep.decimalPlaces) !== null && _m !== void 0 ? _m : 2,
                };
                if (dryRun) {
                    // Just count what WOULD be created (don't persist)
                    const existingCount = yield prismaClient_1.default.depreciationLog.count({ where: { assetId: a.id } });
                    results.push({
                        assetId: a.id, assetCode: a.assetId, assetName: a.assetName,
                        existingLogs: existingCount,
                        wouldGenerate: "(dry run — actual count requires execution)",
                    });
                    continue;
                }
                const result = yield (0, depreciationEngine_2.backfillHistoricalDepreciation)(a.id, dep.id, assetForDep, cfg, employeeId);
                results.push({
                    assetId: a.id, assetCode: a.assetId, assetName: a.assetName,
                    created: result.created, skipped: result.skipped, latestFy: result.latestFy,
                });
                totalCreated += result.created;
                totalSkipped += result.skipped;
            }
            catch (err) {
                console.error(`Backfill failed for asset ${a.id}:`, err.message);
                results.push({
                    assetId: a.id, assetCode: a.assetId, assetName: a.assetName,
                    error: err.message,
                });
                totalErrors++;
            }
        }
        res.json({
            message: dryRun
                ? `Dry run complete — ${depreciations.length} assets analysed`
                : `Backfill complete — ${totalCreated} log(s) created, ${totalSkipped} asset(s) skipped (already had logs), ${totalErrors} error(s)`,
            processed: depreciations.length,
            totalLogsCreated: totalCreated,
            totalSkipped,
            totalErrors,
            dryRun: !!dryRun,
            details: results,
        });
    }
    catch (err) {
        console.error("backfillDepreciationLogs error:", err);
        res.status(500).json({ message: "Backfill failed", error: err.message });
    }
});
exports.backfillDepreciationLogs = backfillDepreciationLogs;

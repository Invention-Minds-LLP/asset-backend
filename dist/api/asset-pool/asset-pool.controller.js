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
exports.importIndividualAssets = exports.downloadIndividualAssetsTemplate = exports.resetAllPools = exports.importFaRegister = exports.downloadFaRegisterTemplate = exports.getPoolActivity = exports.getProportionalDep = exports.listDepreciationSchedules = exports.addDepreciationSchedule = exports.addAdjustment = exports.updatePool = exports.getPool = exports.getPoolSummary = exports.createPool = exports.listPools = void 0;
const fs_1 = __importDefault(require("fs"));
const xlsx_1 = __importDefault(require("xlsx"));
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const assetIdGenerator_1 = require("../../utilis/assetIdGenerator");
// ─── Helpers ─────────────────────────────────────────────────────────────────
function generatePoolCode(financialYear, departmentId) {
    return __awaiter(this, void 0, void 0, function* () {
        let deptCode = "GEN";
        if (departmentId) {
            const dept = yield prismaClient_1.default.department.findUnique({ where: { id: departmentId } });
            if (dept === null || dept === void 0 ? void 0 : dept.code)
                deptCode = dept.code.toUpperCase();
            else if (dept === null || dept === void 0 ? void 0 : dept.name)
                deptCode = dept.name.slice(0, 6).toUpperCase().replace(/\s+/g, "");
        }
        const prefix = `POOL-${deptCode}-${financialYear}-`;
        const existing = yield prismaClient_1.default.assetPool.findMany({
            where: { poolCode: { startsWith: prefix } },
            select: { poolCode: true },
        });
        let maxSeq = 0;
        for (const row of existing) {
            const seq = parseInt(row.poolCode.slice(prefix.length), 10);
            if (!isNaN(seq) && seq > maxSeq)
                maxSeq = seq;
        }
        return `${prefix}${(maxSeq + 1).toString().padStart(3, "0")}`;
    });
}
/** Fetch linked assets with depreciation for a pool — used in multiple endpoints */
function getLinkedAssets(poolId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prismaClient_1.default.asset.findMany({
            where: { assetPoolId: poolId },
            select: {
                id: true, assetId: true, assetName: true, purchaseCost: true,
                status: true, financialYearAdded: true, createdAt: true,
                depreciation: { select: { accumulatedDepreciation: true } },
            },
        });
    });
}
/** Latest depreciation schedule for a pool */
function getLatestSchedule(poolId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const schedules = yield prismaClient_1.default.assetPoolDepreciationSchedule.findMany({
            where: { poolId },
            orderBy: { financialYearEnd: "desc" },
            take: 1,
        });
        return (_a = schedules[0]) !== null && _a !== void 0 ? _a : null;
    });
}
// ─── GET /asset-pool ──────────────────────────────────────────────────────────
const listPools = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const pools = yield prismaClient_1.default.assetPool.findMany({
            include: {
                category: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
                depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 },
            },
            orderBy: { createdAt: "desc" },
        });
        const result = yield Promise.all(pools.map((pool) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            const linked = yield getLinkedAssets(pool.id);
            const individualizedCount = linked.length;
            const allocatedCost = linked.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
            const totalPoolCost = Number((_a = pool.totalPoolCost) !== null && _a !== void 0 ? _a : 0);
            const latestSched = (_c = (_b = pool.depreciationSchedules) === null || _b === void 0 ? void 0 : _b[0]) !== null && _c !== void 0 ? _c : null;
            return {
                id: pool.id,
                poolCode: pool.poolCode,
                financialYear: pool.financialYear,
                category: (_e = (_d = pool.category) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : null,
                categoryId: pool.categoryId,
                department: (_g = (_f = pool.department) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : null,
                departmentId: pool.departmentId,
                description: pool.description,
                originalQuantity: pool.originalQuantity,
                individualizedCount,
                remainingQuantity: Math.max(0, pool.originalQuantity - individualizedCount),
                digitizationPct: pool.originalQuantity > 0
                    ? Math.round((individualizedCount / pool.originalQuantity) * 100)
                    : 0,
                totalPoolCost,
                allocatedCost,
                unallocatedCost: totalPoolCost - allocatedCost,
                // Latest FA schedule rollforward (per-FY breakdown)
                latestFY: (_h = latestSched === null || latestSched === void 0 ? void 0 : latestSched.financialYear) !== null && _h !== void 0 ? _h : null,
                latestOpeningGrossBlock: latestSched ? Number(latestSched.openingGrossBlock) : null,
                latestAdditions: latestSched ? Number(latestSched.additions) : null,
                latestAdditions1H: latestSched ? Number((_j = latestSched.additionsFirstHalf) !== null && _j !== void 0 ? _j : 0) : null,
                latestAdditions2H: latestSched ? Number((_k = latestSched.additionsSecondHalf) !== null && _k !== void 0 ? _k : 0) : null,
                latestDeletions: latestSched ? Number(latestSched.deletions) : null,
                latestDeletions1H: latestSched ? Number((_l = latestSched.deletionsFirstHalf) !== null && _l !== void 0 ? _l : 0) : null,
                latestDeletions2H: latestSched ? Number((_m = latestSched.deletionsSecondHalf) !== null && _m !== void 0 ? _m : 0) : null,
                latestClosingGrossBlock: latestSched ? Number(latestSched.closingGrossBlock) : null,
                latestOpeningAccDep: latestSched ? Number(latestSched.openingAccumulatedDep) : null,
                latestDepOnOpening: latestSched ? Number((_o = latestSched.depOnOpeningBlock) !== null && _o !== void 0 ? _o : 0) : null,
                latestDepOnAdditions: latestSched ? Number((_p = latestSched.depOnAdditions) !== null && _p !== void 0 ? _p : 0) : null,
                latestDepForPeriod: latestSched ? Number(latestSched.depreciationForPeriod) : null,
                latestClosingAccDep: latestSched ? Number(latestSched.closingAccumulatedDep) : null,
                latestDepRate: latestSched ? Number(latestSched.depreciationRate) : null,
                latestOpeningNetBlock: latestSched ? Number(latestSched.openingNetBlock) : null,
                latestClosingNetBlock: latestSched ? Number(latestSched.closingNetBlock) : null,
                // Backward-compat aliases (still used by some places)
                latestNetBlock: latestSched ? Number(latestSched.closingNetBlock) : null,
                latestGrossBlock: latestSched ? Number(latestSched.closingGrossBlock) : null,
                status: pool.status,
                notes: pool.notes,
                createdAt: pool.createdAt,
                updatedAt: pool.updatedAt,
            };
        })));
        res.json(result);
    }
    catch (err) {
        console.error("listPools error:", err);
        res.status(500).json({ message: "Failed to fetch asset pools" });
    }
});
exports.listPools = listPools;
// ─── POST /asset-pool ─────────────────────────────────────────────────────────
const createPool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { financialYear, categoryId, categoryName, departmentId, departmentName, description, originalQuantity, totalPoolCost, notes, } = req.body;
        if (!financialYear) {
            res.status(400).json({ message: "financialYear is required" });
            return;
        }
        // Resolve category — by ID or by name (create if missing)
        let resolvedCategoryId = categoryId ? Number(categoryId) : null;
        if (!resolvedCategoryId && categoryName) {
            const trimmed = String(categoryName).trim();
            let cat = yield prismaClient_1.default.assetCategory.findFirst({
                where: { name: trimmed },
            });
            if (!cat)
                cat = yield prismaClient_1.default.assetCategory.create({ data: { name: trimmed } });
            resolvedCategoryId = cat.id;
        }
        // Resolve department — by ID or by name
        let resolvedDepartmentId = departmentId ? Number(departmentId) : null;
        if (!resolvedDepartmentId && departmentName) {
            const dept = yield prismaClient_1.default.department.findFirst({
                where: { name: String(departmentName).trim() },
            });
            if (dept)
                resolvedDepartmentId = dept.id;
        }
        const poolCode = yield generatePoolCode(String(financialYear).trim(), resolvedDepartmentId);
        const pool = yield prismaClient_1.default.assetPool.create({
            data: {
                poolCode,
                financialYear: String(financialYear).trim(),
                categoryId: resolvedCategoryId,
                departmentId: resolvedDepartmentId,
                description: description !== null && description !== void 0 ? description : null,
                originalQuantity: Number(originalQuantity !== null && originalQuantity !== void 0 ? originalQuantity : 0),
                totalPoolCost: totalPoolCost != null ? totalPoolCost : null,
                status: "PENDING",
                notes: notes !== null && notes !== void 0 ? notes : null,
                createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
            },
        });
        res.status(201).json(pool);
    }
    catch (err) {
        console.error("createPool error:", err);
        res.status(500).json({ message: "Failed to create asset pool" });
    }
});
exports.createPool = createPool;
// ─── GET /asset-pool/summary ──────────────────────────────────────────────────
const getPoolSummary = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const pools = yield prismaClient_1.default.assetPool.findMany({
            select: { id: true, status: true, originalQuantity: true, totalPoolCost: true },
        });
        let totalPools = pools.length, completePools = 0, partialPools = 0, pendingPools = 0;
        let totalUndigitizedAssets = 0, totalUnallocatedCost = 0;
        let totalPoolGrossBlock = 0, totalPoolNetBlock = 0;
        for (const pool of pools) {
            if (pool.status === "COMPLETE")
                completePools++;
            else if (pool.status === "PARTIAL")
                partialPools++;
            else
                pendingPools++;
            const linked = yield prismaClient_1.default.asset.findMany({
                where: { assetPoolId: pool.id },
                select: { purchaseCost: true },
            });
            const linkedCount = linked.length;
            const allocatedCost = linked.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
            totalUndigitizedAssets += Math.max(0, pool.originalQuantity - linkedCount);
            totalUnallocatedCost += Math.max(0, Number((_a = pool.totalPoolCost) !== null && _a !== void 0 ? _a : 0) - allocatedCost);
            // Latest schedule for pool-level balance sheet totals
            const latestSched = yield getLatestSchedule(pool.id);
            if (latestSched) {
                const remaining = pool.originalQuantity > 0
                    ? Math.max(0, pool.originalQuantity - linkedCount) / pool.originalQuantity
                    : 0;
                totalPoolGrossBlock += Number(latestSched.closingGrossBlock) * remaining;
                totalPoolNetBlock += Number(latestSched.closingNetBlock) * remaining;
            }
        }
        const totalOriginal = pools.reduce((s, p) => s + p.originalQuantity, 0);
        const digitizationPct = totalOriginal > 0
            ? Math.round((1 - totalUndigitizedAssets / totalOriginal) * 100)
            : (totalPools > 0 ? 100 : 0);
        res.json({
            totalPools, completePools, partialPools, pendingPools,
            totalUndigitizedAssets, totalUnallocatedCost,
            totalPoolGrossBlock: Math.round(totalPoolGrossBlock),
            totalPoolNetBlock: Math.round(totalPoolNetBlock),
            digitizationPct,
        });
    }
    catch (err) {
        console.error("getPoolSummary error:", err);
        res.status(500).json({ message: "Failed to fetch pool summary" });
    }
});
exports.getPoolSummary = getPoolSummary;
// ─── GET /asset-pool/:id ──────────────────────────────────────────────────────
const getPool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const pool = yield prismaClient_1.default.assetPool.findUnique({
            where: { id },
            include: {
                category: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
                adjustments: { orderBy: { createdAt: "desc" } },
                depreciationSchedules: { orderBy: { financialYearEnd: "asc" } },
            },
        });
        if (!pool) {
            res.status(404).json({ message: "Asset pool not found" });
            return;
        }
        const linkedAssets = yield getLinkedAssets(id);
        const individualizedCount = linkedAssets.length;
        const allocatedCost = linkedAssets.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
        const allocatedAccDep = linkedAssets.reduce((s, a) => { var _a, _b; return s + Number((_b = (_a = a.depreciation) === null || _a === void 0 ? void 0 : _a.accumulatedDepreciation) !== null && _b !== void 0 ? _b : 0); }, 0);
        const totalPoolCost = Number((_a = pool.totalPoolCost) !== null && _a !== void 0 ? _a : 0);
        const latestSched = (_c = (_b = pool.depreciationSchedules) === null || _b === void 0 ? void 0 : _b.slice(-1)[0]) !== null && _c !== void 0 ? _c : null;
        const remainingRatio = latestSched && Number(latestSched.closingGrossBlock) > 0
            ? Math.max(0, Number(latestSched.closingGrossBlock) - allocatedCost) / Number(latestSched.closingGrossBlock)
            : 0;
        // ─── Per-FY allocation breakdown ──────────────────────────────────
        // For each FY in the schedule, compute:
        //   - additions (from the schedule)
        //   - sum of individualized assets that were added in that FY (by financialYearAdded)
        //   - pending (additions − individualized in that FY)
        const schedules = (_d = pool.depreciationSchedules) !== null && _d !== void 0 ? _d : [];
        const perFYAllocation = schedules.map((s) => {
            const fy = s.financialYear;
            const assetsInFY = linkedAssets.filter((a) => a.financialYearAdded === fy);
            const individualizedCost = assetsInFY.reduce((sum, a) => { var _a; return sum + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
            const additions = Number(s.additions);
            return {
                financialYear: fy,
                additions,
                individualizedCount: assetsInFY.length,
                individualizedCost,
                pendingCost: Number((additions - individualizedCost).toFixed(2)),
                pendingPct: additions > 0
                    ? Math.round(((additions - individualizedCost) / additions) * 1000) / 10
                    : 0,
                isOverAllocated: individualizedCost > additions,
            };
        });
        res.json({
            id: pool.id,
            poolCode: pool.poolCode,
            financialYear: pool.financialYear,
            category: (_f = (_e = pool.category) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : null,
            categoryId: pool.categoryId,
            department: (_h = (_g = pool.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null,
            departmentId: pool.departmentId,
            description: pool.description,
            originalQuantity: pool.originalQuantity,
            individualizedCount,
            remainingQuantity: Math.max(0, pool.originalQuantity - individualizedCount),
            digitizationPct: pool.originalQuantity > 0
                ? Math.round((individualizedCount / pool.originalQuantity) * 100) : 0,
            totalPoolCost,
            allocatedCost,
            allocatedAccDep,
            unallocatedCost: totalPoolCost - allocatedCost,
            // Remaining balance from latest FA schedule (auditor-certified)
            remainingGrossBlock: latestSched ? Math.max(0, Number(latestSched.closingGrossBlock) - allocatedCost) : null,
            remainingNetBlock: latestSched ? Math.max(0, Number(latestSched.closingNetBlock) - (allocatedCost - allocatedAccDep)) : null,
            remainingAccDep: latestSched ? Math.max(0, Number(latestSched.closingAccumulatedDep) * remainingRatio - allocatedAccDep) : null,
            status: pool.status,
            notes: pool.notes,
            createdAt: pool.createdAt,
            updatedAt: pool.updatedAt,
            adjustments: pool.adjustments,
            depreciationSchedules: pool.depreciationSchedules,
            perFYAllocation,
            assets: linkedAssets,
        });
    }
    catch (err) {
        console.error("getPool error:", err);
        res.status(500).json({ message: "Failed to fetch asset pool" });
    }
});
exports.getPool = getPool;
// ─── PUT /asset-pool/:id ──────────────────────────────────────────────────────
const updatePool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const { description, notes, status, totalPoolCost } = req.body;
        const pool = yield prismaClient_1.default.assetPool.findUnique({ where: { id } });
        if (!pool) {
            res.status(404).json({ message: "Asset pool not found" });
            return;
        }
        const updated = yield prismaClient_1.default.assetPool.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign({}, (description !== undefined && { description })), (notes !== undefined && { notes })), (status !== undefined && { status })), (totalPoolCost !== undefined && { totalPoolCost })),
        });
        res.json(updated);
    }
    catch (err) {
        console.error("updatePool error:", err);
        res.status(500).json({ message: "Failed to update asset pool" });
    }
});
exports.updatePool = updatePool;
// ─── POST /asset-pool/:id/adjustment ─────────────────────────────────────────
const addAdjustment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const { adjustmentType, amount, financialYear, reason } = req.body;
        if (!adjustmentType || amount == null) {
            res.status(400).json({ message: "adjustmentType and amount are required" });
            return;
        }
        const validTypes = ["COST_RECONCILIATION", "WRITE_OFF", "DISTRIBUTE", "OTHER"];
        if (!validTypes.includes(adjustmentType)) {
            res.status(400).json({ message: `adjustmentType must be one of: ${validTypes.join(", ")}` });
            return;
        }
        const pool = yield prismaClient_1.default.assetPool.findUnique({ where: { id: poolId } });
        if (!pool) {
            res.status(404).json({ message: "Asset pool not found" });
            return;
        }
        const adjustment = yield prismaClient_1.default.assetPoolAdjustment.create({
            data: {
                poolId, adjustmentType, amount,
                financialYear: financialYear !== null && financialYear !== void 0 ? financialYear : null,
                reason: reason !== null && reason !== void 0 ? reason : null,
                createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
            },
        });
        // DISTRIBUTE — spread amount proportionally across all linked assets
        if (adjustmentType === "DISTRIBUTE") {
            const linked = yield prismaClient_1.default.asset.findMany({
                where: { assetPoolId: poolId },
                select: { id: true, historicalOtherCost: true },
            });
            if (linked.length > 0) {
                const perAsset = Number(amount) / linked.length;
                yield Promise.all(linked.map((a) => {
                    var _a;
                    return prismaClient_1.default.asset.update({
                        where: { id: a.id },
                        data: { historicalOtherCost: String(Number((_a = a.historicalOtherCost) !== null && _a !== void 0 ? _a : 0) + perAsset) },
                    });
                }));
            }
        }
        res.status(201).json(adjustment);
    }
    catch (err) {
        console.error("addAdjustment error:", err);
        res.status(500).json({ message: "Failed to add adjustment" });
    }
});
exports.addAdjustment = addAdjustment;
// ─── POST /asset-pool/:id/depreciation-schedule ───────────────────────────────
// Upload one FY row from the audited FA register for this pool.
const addDepreciationSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const pool = yield prismaClient_1.default.assetPool.findUnique({ where: { id: poolId } });
        if (!pool) {
            res.status(404).json({ message: "Asset pool not found" });
            return;
        }
        const { financialYear, financialYearEnd, openingGrossBlock, additions, deletions, closingGrossBlock, openingAccumulatedDep, depreciationRate, depreciationForPeriod, closingAccumulatedDep, openingNetBlock, closingNetBlock, } = req.body;
        if (!financialYear || !financialYearEnd || closingGrossBlock == null || closingNetBlock == null) {
            res.status(400).json({ message: "financialYear, financialYearEnd, closingGrossBlock, closingNetBlock are required" });
            return;
        }
        // Upsert — one row per pool per FY
        const existing = yield prismaClient_1.default.assetPoolDepreciationSchedule.findFirst({
            where: { poolId, financialYear: String(financialYear) },
        });
        const data = {
            poolId,
            financialYear: String(financialYear),
            financialYearEnd: new Date(financialYearEnd),
            openingGrossBlock: Number(openingGrossBlock !== null && openingGrossBlock !== void 0 ? openingGrossBlock : 0),
            additions: Number(additions !== null && additions !== void 0 ? additions : 0),
            deletions: Number(deletions !== null && deletions !== void 0 ? deletions : 0),
            closingGrossBlock: Number(closingGrossBlock),
            openingAccumulatedDep: Number(openingAccumulatedDep !== null && openingAccumulatedDep !== void 0 ? openingAccumulatedDep : 0),
            depreciationRate: Number(depreciationRate !== null && depreciationRate !== void 0 ? depreciationRate : 0),
            depreciationForPeriod: Number(depreciationForPeriod !== null && depreciationForPeriod !== void 0 ? depreciationForPeriod : 0),
            closingAccumulatedDep: Number(closingAccumulatedDep !== null && closingAccumulatedDep !== void 0 ? closingAccumulatedDep : 0),
            openingNetBlock: Number(openingNetBlock !== null && openingNetBlock !== void 0 ? openingNetBlock : 0),
            closingNetBlock: Number(closingNetBlock),
            createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
        };
        let schedule;
        if (existing) {
            schedule = yield prismaClient_1.default.assetPoolDepreciationSchedule.update({
                where: { id: existing.id },
                data,
            });
        }
        else {
            schedule = yield prismaClient_1.default.assetPoolDepreciationSchedule.create({ data });
        }
        // Auto-update pool totalPoolCost to match latest schedule closingGrossBlock if not set
        if (!pool.totalPoolCost) {
            yield prismaClient_1.default.assetPool.update({
                where: { id: poolId },
                data: { totalPoolCost: Number(closingGrossBlock) },
            });
        }
        res.status(201).json(schedule);
    }
    catch (err) {
        console.error("addDepreciationSchedule error:", err);
        res.status(500).json({ message: "Failed to add depreciation schedule" });
    }
});
exports.addDepreciationSchedule = addDepreciationSchedule;
// ─── GET /asset-pool/:id/depreciation-schedule ───────────────────────────────
const listDepreciationSchedules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const schedules = yield prismaClient_1.default.assetPoolDepreciationSchedule.findMany({
            where: { poolId },
            orderBy: { financialYearEnd: "asc" },
        });
        res.json(schedules);
    }
    catch (err) {
        console.error("listDepreciationSchedules error:", err);
        res.status(500).json({ message: "Failed to fetch depreciation schedules" });
    }
});
exports.listDepreciationSchedules = listDepreciationSchedules;
// ─── GET /asset-pool/:id/proportional-dep ────────────────────────────────────
// Given an asset's purchase cost, calculate proportional opening accumulated
// depreciation from the pool's latest FA schedule.
// Query: ?assetCost=500000
const getProportionalDep = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const assetCost = Number(req.query.assetCost);
        if (!assetCost || assetCost <= 0) {
            res.status(400).json({ message: "assetCost query param required and must be > 0" });
            return;
        }
        const latestSched = yield getLatestSchedule(poolId);
        if (!latestSched) {
            res.json({
                openingAccumulatedDep: 0,
                openingBookValue: assetCost,
                note: "No FA schedule uploaded for this pool yet. Depreciation will start from zero.",
            });
            return;
        }
        const poolGrossBlock = Number(latestSched.closingGrossBlock);
        const poolAccDep = Number(latestSched.closingAccumulatedDep);
        const depRate = Number(latestSched.depreciationRate);
        const financialYear = latestSched.financialYear;
        if (poolGrossBlock <= 0) {
            res.json({ openingAccumulatedDep: 0, openingBookValue: assetCost, note: "Pool gross block is zero." });
            return;
        }
        // Asset's proportional share
        const shareRatio = assetCost / poolGrossBlock;
        const openingAccumulatedDep = Math.round(poolAccDep * shareRatio);
        const openingBookValue = Math.max(0, assetCost - openingAccumulatedDep);
        res.json({
            assetCost,
            poolGrossBlock,
            poolAccDep,
            shareRatio: +shareRatio.toFixed(6),
            openingAccumulatedDep,
            openingBookValue,
            depreciationRate: depRate,
            basedOnFY: financialYear,
            financialYearEnd: latestSched.financialYearEnd,
        });
    }
    catch (err) {
        console.error("getProportionalDep error:", err);
        res.status(500).json({ message: "Failed to calculate proportional depreciation" });
    }
});
exports.getProportionalDep = getProportionalDep;
// ─── GET /asset-pool/:id/activity ────────────────────────────────────────────
// Chronological activity log: pool created, schedules uploaded,
// assets individualized, adjustments made.
const getPoolActivity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) {
            res.status(400).json({ message: "Invalid pool id" });
            return;
        }
        const pool = yield prismaClient_1.default.assetPool.findUnique({
            where: { id: poolId },
            select: { id: true, poolCode: true, financialYear: true, createdAt: true, originalQuantity: true },
        });
        if (!pool) {
            res.status(404).json({ message: "Asset pool not found" });
            return;
        }
        const events = [];
        // 1. Pool created
        events.push({
            type: "POOL_CREATED",
            date: pool.createdAt,
            description: `Pool ${pool.poolCode} created for ${pool.financialYear} with ${pool.originalQuantity} assets`,
        });
        // 2. FA schedule uploads
        const schedules = yield prismaClient_1.default.assetPoolDepreciationSchedule.findMany({
            where: { poolId },
            orderBy: { createdAt: "asc" },
        });
        for (const s of schedules) {
            events.push({
                type: "SCHEDULE_UPLOADED",
                date: s.createdAt,
                description: `FA schedule uploaded for ${s.financialYear} — Gross Block: ₹${Number(s.closingGrossBlock).toLocaleString("en-IN")}, Net Block: ₹${Number(s.closingNetBlock).toLocaleString("en-IN")}`,
                data: { financialYear: s.financialYear, closingGrossBlock: Number(s.closingGrossBlock), closingNetBlock: Number(s.closingNetBlock) },
            });
        }
        // 3. Individual assets extracted from this pool
        const assets = yield prismaClient_1.default.asset.findMany({
            where: { assetPoolId: poolId },
            select: {
                assetId: true, assetName: true, purchaseCost: true,
                financialYearAdded: true, createdAt: true,
                depreciation: { select: { accumulatedDepreciation: true, currentBookValue: true } },
            },
            orderBy: { createdAt: "asc" },
        });
        for (const a of assets) {
            const dep = a.depreciation;
            events.push({
                type: "ASSET_INDIVIDUALIZED",
                date: a.createdAt,
                description: `${a.assetId} — ${a.assetName} individualized (Cost: ₹${Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0).toLocaleString("en-IN")}${dep ? `, Opening Acc. Dep: ₹${Number(dep.accumulatedDepreciation).toLocaleString("en-IN")}, Book Value: ₹${Number(dep.currentBookValue).toLocaleString("en-IN")}` : ""})`,
                data: {
                    assetId: a.assetId, assetName: a.assetName,
                    purchaseCost: Number((_b = a.purchaseCost) !== null && _b !== void 0 ? _b : 0),
                    financialYearAdded: a.financialYearAdded,
                    openingAccDep: dep ? Number(dep.accumulatedDepreciation) : null,
                    openingBookValue: dep ? Number(dep.currentBookValue) : null,
                },
            });
        }
        // 4. Adjustments
        const adjustments = yield prismaClient_1.default.assetPoolAdjustment.findMany({
            where: { poolId },
            orderBy: { createdAt: "asc" },
        });
        for (const adj of adjustments) {
            events.push({
                type: "ADJUSTMENT",
                date: adj.createdAt,
                description: `${adj.adjustmentType} adjustment of ₹${Number(adj.amount).toLocaleString("en-IN")}${adj.reason ? ` — ${adj.reason}` : ""}`,
                data: { adjustmentType: adj.adjustmentType, amount: Number(adj.amount), reason: adj.reason },
            });
        }
        // Sort all events chronologically
        events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        // Running balance summary at end
        const totalIndividualizedCost = assets.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
        const latestSched = schedules[schedules.length - 1];
        const remainingGrossBlock = latestSched
            ? Math.max(0, Number(latestSched.closingGrossBlock) - totalIndividualizedCost)
            : null;
        res.json({
            poolCode: pool.poolCode,
            events,
            summary: {
                totalEvents: events.length,
                assetsIndividualized: assets.length,
                totalIndividualizedCost,
                remainingGrossBlock,
                latestFY: (_c = latestSched === null || latestSched === void 0 ? void 0 : latestSched.financialYear) !== null && _c !== void 0 ? _c : null,
            },
        });
    }
    catch (err) {
        console.error("getPoolActivity error:", err);
        res.status(500).json({ message: "Failed to fetch pool activity" });
    }
});
exports.getPoolActivity = getPoolActivity;
// ─── GET /asset-pool/fa-register-template ────────────────────────────────────
// Download blank Excel template matching the FA register format
const downloadFaRegisterTemplate = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const wb = xlsx_1.default.utils.book_new();
        // Instructions sheet
        const instructions = [
            ["FA Register Import Template — Instructions"],
            [""],
            ["This template contains DEMO DATA with small values to understand the depreciation calculation."],
            [""],
            ["DEPRECIATION RULE (Indian Income Tax Act — Half-Year Rule):"],
            ["  - Assets purchased Apr 1 to Sep 30 (1st half of FY) → FULL depreciation rate in Year 1"],
            ["  - Assets purchased Oct 1 to Mar 31 (2nd half of FY) → HALF depreciation rate in Year 1"],
            ["  - From Year 2 onwards → FULL rate on Opening WDV (carried from prior year closing)"],
            ["  - If new additions in Year 2+, depreciation is SPLIT:"],
            ["      (a) Opening WDV × Full Rate"],
            ["      (b) New Addition × Full or Half Rate (based on purchase date)"],
            ["      Total Dep = (a) + (b)"],
            [""],
            ["EXAMPLE (see MEDICAL EQUIPMENTS in FY2023-24):"],
            ["  Opening WDV = 18,500 (from FY2022-23 closing NB)"],
            ["  New Addition = 10,000 (bought in 1st half → full 15%)"],
            ["  Dep on Opening = 18,500 × 15% = 2,775"],
            ["  Dep on Addition = 10,000 × 15% = 1,500"],
            ["  Total Dep = 2,775 + 1,500 = 4,275"],
            ["  Closing NB = (18,500 + 10,000) - 4,275 = 24,225"],
            [""],
            ["HOW TO USE:"],
            ["  1. Replace the demo data with your audited FA register figures"],
            ["  2. One row per category per financial year"],
            ["  3. financialYear format: FY2022-23"],
            ["  4. financialYearEnd: last date of FY in YYYY-MM-DD format (e.g. 2023-03-31)"],
            ["  5. All monetary values in Indian Rupees (no commas)"],
            ["  6. The 'notes' column explains each calculation — useful for demo, optional for real data"],
        ];
        xlsx_1.default.utils.book_append_sheet(wb, xlsx_1.default.utils.aoa_to_sheet(instructions), "Instructions");
        // Data sheet — column headers matching FA register layout
        const headers = [
            "financialYear", // e.g. FY2022-23
            "category", // e.g. BUILDING, MACHINERY & EQUIPMENTS
            "department", // optional
            "originalQuantity", // total assets in this pool (0 if unknown)
            "financialYearEnd", // e.g. 2023-03-31
            "openingGrossBlock", // AS ON 01.04.XXXX
            "additions", // Total additions during FY
            "additionsFirstHalf", // Apr-Sep additions (full dep rate)
            "additionsSecondHalf", // Oct-Mar additions (half dep rate)
            "deletions", // Total deletions during FY
            "deletionsFirstHalf", // Apr-Sep deletions
            "deletionsSecondHalf", // Oct-Mar deletions
            "closingGrossBlock", // UPTO 31.03.XXXX
            "openingAccumulatedDep", // UP TO previous year
            "depreciationRate", // RATE % (e.g. 15)
            "depOnOpeningBlock", // Dep on opening WDV at full rate
            "depOnAdditions", // Dep on additions (full + half)
            "depreciationForPeriod", // Total = depOnOpening + depOnAdditions
            "closingAccumulatedDep", // UPTO 31.03.XXXX (dep column)
            "closingNetBlock", // NET BLOCK current year
            "previousYearNetBlock", // NET BLOCK previous year (reference only)
            "notes", // optional remarks
        ];
        // ── Demo FA Register — 3 years × 4 categories ─────────────────────────
        // Small values so the calculation is easy to verify manually.
        //
        // DEPRECIATION RULE (Indian IT Act — Half-Year Rule):
        //   Apr-Sep purchase → FULL rate in Year 1
        //   Oct-Mar purchase → HALF rate in Year 1
        //   Year 2 onwards  → FULL rate on Opening WDV + half/full on new additions
        //
        // Each row: [financialYear, category, department, qty, fyEnd,
        //            openGB, additions, addns1stHalf, addns2ndHalf,
        //            deletions, del1stHalf, del2ndHalf, closeGB,
        //            openAccDep, rate%, depOnOpening, depOnAdditions, depForPeriod, closeAccDep,
        //            closeNB, prevYearNB, notes]
        const rows = [
            // ══════════════════════════════════════════════════════════════════
            //  FY2022-23 (YEAR 1) — Fresh institute, all assets are new
            // ══════════════════════════════════════════════════════════════════
            // BUILDING: 1,00,000 in 1st half (Apr-Sep) → FULL 10%
            ["FY2022-23", "BUILDING", "", 1, "2023-03-31",
                0, 100000, 100000, 0, 0, 0, 0, 100000,
                0, 10, 0, 10000, 10000, 10000,
                90000, 0, "Y1: 1st half addition → full 10%. Dep = 1,00,000 x 10% = 10,000"],
            // MEDICAL EQUIPMENT: 20,000 in 2nd half (Oct-Mar) → HALF 15% = 7.5%
            ["FY2022-23", "MEDICAL EQUIPMENTS", "", 3, "2023-03-31",
                0, 20000, 0, 20000, 0, 0, 0, 20000,
                0, 15, 0, 1500, 1500, 1500,
                18500, 0, "Y1: 2nd half addition → half 15% = 7.5%. Dep = 20,000 x 7.5% = 1,500"],
            // FURNITURE: 50,000 in 1st half → FULL 10%
            ["FY2022-23", "FURNITURE & FIXTURES", "", 5, "2023-03-31",
                0, 50000, 50000, 0, 0, 0, 0, 50000,
                0, 10, 0, 5000, 5000, 5000,
                45000, 0, "Y1: 1st half addition → full 10%. Dep = 50,000 x 10% = 5,000"],
            // VEHICLES: 80,000 in 1st half → FULL 15%
            ["FY2022-23", "VEHICLES", "", 2, "2023-03-31",
                0, 80000, 80000, 0, 0, 0, 0, 80000,
                0, 15, 0, 12000, 12000, 12000,
                68000, 0, "Y1: 1st half addition → full 15%. Dep = 80,000 x 15% = 12,000"],
            // ══════════════════════════════════════════════════════════════════
            //  FY2023-24 (YEAR 2) — Opening = Y1 closing
            // ══════════════════════════════════════════════════════════════════
            // BUILDING: No additions
            ["FY2023-24", "BUILDING", "", 1, "2024-03-31",
                100000, 0, 0, 0, 0, 0, 0, 100000,
                10000, 10, 9000, 0, 9000, 19000,
                81000, 90000, "Y2: No additions. Dep on opening WDV 90,000 x 10% = 9,000"],
            // MEDICAL EQUIP: +10,000 in 1st half (Apr-Sep) → full 15%
            // Dep on opening: 18,500 x 15% = 2,775
            // Dep on addition: 10,000 x 15% = 1,500
            ["FY2023-24", "MEDICAL EQUIPMENTS", "", 3, "2024-03-31",
                20000, 10000, 10000, 0, 0, 0, 0, 30000,
                1500, 15, 2775, 1500, 4275, 5775,
                24225, 18500, "Y2 SPLIT: Opening 18500x15%=2775 + 1st half addn 10000x15%=1500 = 4275"],
            // FURNITURE: +10,000 in 2nd half (Oct-Mar) → half 10% = 5%
            // Dep on opening: 45,000 x 10% = 4,500
            // Dep on addition: 10,000 x 5% = 500
            ["FY2023-24", "FURNITURE & FIXTURES", "", 5, "2024-03-31",
                50000, 10000, 0, 10000, 0, 0, 0, 60000,
                5000, 10, 4500, 500, 5000, 10000,
                50000, 45000, "Y2 SPLIT: Opening 45000x10%=4500 + 2nd half addn 10000x5%=500 = 5000"],
            // VEHICLES: No additions
            ["FY2023-24", "VEHICLES", "", 2, "2024-03-31",
                80000, 0, 0, 0, 0, 0, 0, 80000,
                12000, 15, 10200, 0, 10200, 22200,
                57800, 68000, "Y2: No additions. Dep on opening WDV 68,000 x 15% = 10,200"],
            // ══════════════════════════════════════════════════════════════════
            //  FY2024-25 (YEAR 3) — Opening = Y2 closing
            // ══════════════════════════════════════════════════════════════════
            // BUILDING: +20,000 in 2nd half → half 10% = 5%
            // Dep on opening: 81,000 x 10% = 8,100
            // Dep on addition: 20,000 x 5% = 1,000
            ["FY2024-25", "BUILDING", "", 1, "2025-03-31",
                100000, 20000, 0, 20000, 0, 0, 0, 120000,
                19000, 10, 8100, 1000, 9100, 28100,
                91900, 81000, "Y3 SPLIT: Opening 81000x10%=8100 + 2nd half addn 20000x5%=1000 = 9100"],
            // MEDICAL EQUIP: No additions
            ["FY2024-25", "MEDICAL EQUIPMENTS", "", 3, "2025-03-31",
                30000, 0, 0, 0, 0, 0, 0, 30000,
                5775, 15, 3634, 0, 3634, 9409,
                20591, 24225, "Y3: No additions. Dep on opening WDV 24,225 x 15% = 3,634"],
            // FURNITURE: No additions
            ["FY2024-25", "FURNITURE & FIXTURES", "", 5, "2025-03-31",
                60000, 0, 0, 0, 0, 0, 0, 60000,
                10000, 10, 5000, 0, 5000, 15000,
                45000, 50000, "Y3: No additions. Dep on opening WDV 50,000 x 10% = 5,000"],
            // VEHICLES: +30,000 in 1st half → full 15%
            // Dep on opening: 57,800 x 15% = 8,670
            // Dep on addition: 30,000 x 15% = 4,500
            ["FY2024-25", "VEHICLES", "", 2, "2025-03-31",
                80000, 30000, 30000, 0, 0, 0, 0, 110000,
                22200, 15, 8670, 4500, 13170, 35370,
                74630, 57800, "Y3 SPLIT: Opening 57800x15%=8670 + 1st half addn 30000x15%=4500 = 13170"],
        ];
        const ws = xlsx_1.default.utils.aoa_to_sheet([headers, ...rows]);
        // Column widths (22 columns now)
        ws["!cols"] = [
            { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, // FY, category, dept, qty
            { wch: 16 }, { wch: 18 }, // fyEnd, openingGB
            { wch: 14 }, { wch: 18 }, { wch: 18 }, // additions, 1stHalf, 2ndHalf
            { wch: 14 }, { wch: 18 }, { wch: 18 }, // deletions, 1stHalf, 2ndHalf
            { wch: 18 }, // closingGB
            { wch: 22 }, { wch: 10 }, // openAccDep, rate
            { wch: 18 }, { wch: 18 }, { wch: 18 }, // depOnOpening, depOnAdditions, depForPeriod
            { wch: 22 }, // closeAccDep
            { wch: 18 }, { wch: 20 }, { wch: 60 }, // closeNB, prevNB, notes
        ];
        xlsx_1.default.utils.book_append_sheet(wb, ws, "FA Register");
        const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Disposition", 'attachment; filename="FA_Register_Pool_Template.xlsx"');
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buf);
    }
    catch (err) {
        console.error("downloadFaRegisterTemplate error:", err);
        res.status(500).json({ message: "Failed to generate template" });
    }
});
exports.downloadFaRegisterTemplate = downloadFaRegisterTemplate;
// ─── POST /asset-pool/import-fa-register ─────────────────────────────────────
// Upload one FA register Excel sheet → creates pools + depreciation schedules
const importFaRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const filePath = (_a = req.file) === null || _a === void 0 ? void 0 : _a.path;
    try {
        if (!filePath) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const wb = xlsx_1.default.readFile(filePath);
        const sheetName = (_b = wb.SheetNames.find(n => n.toLowerCase() !== "instructions")) !== null && _b !== void 0 ? _b : wb.SheetNames[0];
        const rows = xlsx_1.default.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
        if (!rows.length) {
            res.status(400).json({ message: "Spreadsheet is empty" });
            return;
        }
        const createdById = (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null;
        const results = [];
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // 1-indexed, row 1 = header
            const financialYear = String((_e = row.financialYear) !== null && _e !== void 0 ? _e : "").trim();
            const categoryName = String((_f = row.category) !== null && _f !== void 0 ? _f : "").trim();
            const departmentName = String((_g = row.department) !== null && _g !== void 0 ? _g : "").trim();
            const fyEndRaw = row.financialYearEnd;
            if (!financialYear || !categoryName) {
                errors.push({ row: rowNum, error: "financialYear and category are required" });
                continue;
            }
            // Parse financialYearEnd — Excel numeric date or ISO string
            let financialYearEnd = null;
            if (fyEndRaw) {
                if (typeof fyEndRaw === "number") {
                    const epoch = new Date(Date.UTC(1899, 11, 30));
                    financialYearEnd = new Date(epoch.getTime() + fyEndRaw * 86400000);
                }
                else {
                    const d = new Date(fyEndRaw);
                    if (!isNaN(d.getTime()))
                        financialYearEnd = d;
                }
            }
            // Fallback: derive from FY string e.g. FY2022-23 → 2023-03-31
            if (!financialYearEnd) {
                const m = String(financialYear).match(/(\d{4})-(\d{2,4})/);
                if (m) {
                    const endYear = m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) : Number(m[2]);
                    financialYearEnd = new Date(`${endYear}-03-31`);
                }
            }
            if (!financialYearEnd) {
                errors.push({ row: rowNum, error: "Could not parse financialYearEnd. Use YYYY-MM-DD format." });
                continue;
            }
            const n = (v) => (v === "" || v == null ? 0 : Number(v));
            const openingGrossBlock = n(row.openingGrossBlock);
            const additions = n(row.additions);
            const additionsFirstHalf = n(row.additionsFirstHalf);
            const additionsSecondHalf = n(row.additionsSecondHalf);
            const deletions = n(row.deletions);
            const deletionsFirstHalf = n(row.deletionsFirstHalf);
            const deletionsSecondHalf = n(row.deletionsSecondHalf);
            const closingGrossBlock = n(row.closingGrossBlock) || openingGrossBlock + additions - deletions;
            const openingAccumulatedDep = n(row.openingAccumulatedDep);
            const depreciationRate = n(row.depreciationRate);
            const depOnOpeningBlock = n(row.depOnOpeningBlock);
            const depOnAdditions = n(row.depOnAdditions);
            const depreciationForPeriod = n(row.depreciationForPeriod) || depOnOpeningBlock + depOnAdditions;
            const closingAccumulatedDep = n(row.closingAccumulatedDep) || openingAccumulatedDep + depreciationForPeriod;
            const openingNetBlock = openingGrossBlock - openingAccumulatedDep;
            const closingNetBlock = n(row.closingNetBlock) || closingGrossBlock - closingAccumulatedDep;
            const originalQuantity = n(row.originalQuantity);
            try {
                // Resolve or create AssetCategory by name
                let category = yield prismaClient_1.default.assetCategory.findFirst({
                    where: { name: categoryName },
                });
                if (!category) {
                    category = yield prismaClient_1.default.assetCategory.create({ data: { name: categoryName } });
                }
                // Resolve department if provided
                let departmentId = null;
                if (departmentName) {
                    const dept = yield prismaClient_1.default.department.findFirst({
                        where: { name: departmentName },
                    });
                    if (dept)
                        departmentId = dept.id;
                }
                // Find existing pool for this category (+ dept).
                // ONE pool per category — multiple FY schedules attach to the same pool.
                // The pool's financialYear = the earliest FY encountered.
                let pool = yield prismaClient_1.default.assetPool.findFirst({
                    where: Object.assign({ categoryId: category.id }, (departmentId ? { departmentId } : {})),
                });
                if (!pool) {
                    const poolCode = yield generatePoolCode(financialYear, departmentId);
                    pool = yield prismaClient_1.default.assetPool.create({
                        data: {
                            poolCode,
                            financialYear,
                            categoryId: category.id,
                            departmentId,
                            originalQuantity,
                            totalPoolCost: closingGrossBlock || null,
                            status: "PENDING",
                            notes: String((_h = row.notes) !== null && _h !== void 0 ? _h : "").trim() || null,
                            createdById,
                        },
                    });
                }
                else {
                    // Update quantity/cost + totalPoolCost to latest closing gross
                    yield prismaClient_1.default.assetPool.update({
                        where: { id: pool.id },
                        data: Object.assign(Object.assign({}, (originalQuantity > 0 && { originalQuantity })), (closingGrossBlock > 0 && { totalPoolCost: closingGrossBlock })),
                    });
                }
                // Upsert the depreciation schedule for this FY
                const existingSched = yield prismaClient_1.default.assetPoolDepreciationSchedule.findFirst({
                    where: { poolId: pool.id, financialYear },
                });
                const schedData = {
                    poolId: pool.id,
                    financialYear,
                    financialYearEnd,
                    openingGrossBlock,
                    additions,
                    additionsFirstHalf,
                    additionsSecondHalf,
                    deletions,
                    deletionsFirstHalf,
                    deletionsSecondHalf,
                    closingGrossBlock,
                    openingAccumulatedDep,
                    depreciationRate,
                    depOnOpeningBlock: depOnOpeningBlock || null,
                    depOnAdditions: depOnAdditions || null,
                    depreciationForPeriod,
                    closingAccumulatedDep,
                    openingNetBlock,
                    closingNetBlock,
                    createdById,
                };
                let schedule;
                if (existingSched) {
                    schedule = yield prismaClient_1.default.assetPoolDepreciationSchedule.update({
                        where: { id: existingSched.id },
                        data: schedData,
                    });
                }
                else {
                    schedule = yield prismaClient_1.default.assetPoolDepreciationSchedule.create({ data: schedData });
                }
                results.push({
                    row: rowNum,
                    poolCode: pool.poolCode,
                    poolId: pool.id,
                    category: categoryName,
                    financialYear,
                    action: existingSched ? "schedule_updated" : "pool_created",
                    closingGrossBlock,
                    closingNetBlock,
                });
            }
            catch (rowErr) {
                errors.push({ row: rowNum, category: categoryName, error: (_j = rowErr === null || rowErr === void 0 ? void 0 : rowErr.message) !== null && _j !== void 0 ? _j : "Unknown error" });
            }
        }
        // Clean up uploaded file
        try {
            fs_1.default.unlinkSync(filePath);
        }
        catch (_k) { }
        res.json({
            imported: results.length,
            errorCount: errors.length,
            results,
            errors,
        });
    }
    catch (err) {
        try {
            if (filePath)
                fs_1.default.unlinkSync(filePath);
        }
        catch (_l) { }
        console.error("importFaRegister error:", err);
        res.status(500).json({ message: "Failed to import FA register" });
    }
});
exports.importFaRegister = importFaRegister;
// ─── DELETE /asset-pool/reset ─────────────────────────────────────────────────
// Delete ALL asset pools, their depreciation schedules and adjustments.
// Linked individual assets are UNLINKED (assetPoolId set to null) — not deleted.
// Requires header: x-confirm-reset: true
const resetAllPools = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const confirm = req.headers["x-confirm-reset"];
        if (confirm !== "true") {
            res.status(400).json({
                message: "Send header 'x-confirm-reset: true' to confirm this destructive operation.",
            });
            return;
        }
        // 1. Unlink any individual assets from all pools
        const unlinkResult = yield prismaClient_1.default.asset.updateMany({
            where: { assetPoolId: { not: null } },
            data: { assetPoolId: null, financialYearAdded: null },
        });
        // 2. Delete all depreciation schedules
        const schedDel = yield prismaClient_1.default.assetPoolDepreciationSchedule.deleteMany({});
        // 3. Delete all adjustments
        const adjDel = yield prismaClient_1.default.assetPoolAdjustment.deleteMany({});
        // 4. Delete all pools
        const poolDel = yield prismaClient_1.default.assetPool.deleteMany({});
        res.json({
            message: "All asset pools have been deleted. You can now re-import the FA register.",
            deletedPools: poolDel.count,
            deletedSchedules: schedDel.count,
            deletedAdjustments: adjDel.count,
            unlinkedAssets: unlinkResult.count,
        });
    }
    catch (err) {
        console.error("resetAllPools error:", err);
        res.status(500).json({ message: "Failed to reset asset pools" });
    }
});
exports.resetAllPools = resetAllPools;
// ─── GET /asset-pool/individual-assets-template ───────────────────────────────
// Download Excel template for importing individual assets linked to a pool
const downloadIndividualAssetsTemplate = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const wb = xlsx_1.default.utils.book_new();
        // Instructions sheet
        const instructions = [
            ["Individual Asset Import Template — Instructions"],
            [""],
            ["This template contains DEMO DATA matching the FA Register demo template."],
            ["Each row = one individual asset from the FA register, linked to a pool."],
            [""],
            ["COLUMN GUIDE:"],
            ["  poolRef: 'FY2022-23/BUILDING' — must match financialYear/categoryName of an existing pool."],
            ["  assetName: name of the individual asset."],
            ["  serialNumber: leave blank to auto-generate."],
            ["  purchaseCost: cost in Indian Rupees (must sum up to the pool's additions for that FY)."],
            ["  purchaseDate: YYYY-MM-DD format. IMPORTANT — determines the half-year rule:"],
            ["      Apr 1 – Sep 30 = 1st half → full depreciation rate"],
            ["      Oct 1 – Mar 31 = 2nd half → half depreciation rate in year of purchase"],
            ["  openingAccDep: leave blank to auto-calculate proportionally from pool's closing acc dep."],
            [""],
            ["DEMO DATA SUMMARY (matches the FA Register template):"],
            ["  FY2022-23: Building 1,00,000 + Medical 20,000 + Furniture 50,000 + Vehicles 80,000"],
            ["  FY2023-24: Medical +10,000 + Furniture +10,000 (additions only)"],
            ["  FY2024-25: Building +20,000 + Vehicles +30,000 (additions only)"],
            ["  Total: 15 individual assets across 4 categories"],
        ];
        xlsx_1.default.utils.book_append_sheet(wb, xlsx_1.default.utils.aoa_to_sheet(instructions), "Instructions");
        // Data sheet
        const headers = [
            "poolRef", // FY2022-23/BUILDING
            "assetName", // Asset name from FA register
            "serialNumber", // Optional — auto-generated if blank
            "purchaseCost", // Cost in INR
            "purchaseDate", // YYYY-MM-DD (determines half-year rule)
            "department", // Optional
            "openingAccDep", // Optional — auto-calc if blank
            "manufacturer", // Optional
            "modelNumber", // Optional
            "notes", // Optional
        ];
        // Demo rows — 15 assets matching the FA Register demo template
        // The sum of purchaseCost per poolRef MUST match that FY's "additions" in the FA register
        const samples = [
            // ══════════════════════════════════════════════════════════════
            //  FY2022-23 — Year 1 (all fresh purchases)
            // ══════════════════════════════════════════════════════════════
            // BUILDING: Total addition = 1,00,000 (1 asset, 1st half → full 10%)
            ["FY2022-23/BUILDING", "Hospital Main Building", "BLD-001", 100000, "2022-06-15", "", "", "", "", "1st half purchase → full 10% rate in Y1"],
            // MEDICAL EQUIPMENTS: Total addition = 20,000 (3 assets, 2nd half → half 15% = 7.5%)
            ["FY2022-23/MEDICAL EQUIPMENTS", "BP Monitor Digital", "MED-001", 5000, "2022-11-10", "OPD", "", "Omron", "HEM-7156", "2nd half → half rate 7.5%"],
            ["FY2022-23/MEDICAL EQUIPMENTS", "Pulse Oximeter", "MED-002", 7000, "2022-12-05", "ICU", "", "Nellcor", "PM10N", "2nd half → half rate 7.5%"],
            ["FY2022-23/MEDICAL EQUIPMENTS", "Nebulizer Machine", "MED-003", 8000, "2023-01-20", "OPD", "", "Philips", "InnoSpire", "2nd half → half rate 7.5%"],
            // FURNITURE: Total addition = 50,000 (5 assets, 1st half → full 10%)
            ["FY2022-23/FURNITURE & FIXTURES", "Office Chair (set of 5)", "FUR-001", 5000, "2022-05-01", "Admin", "", "Godrej", "Motion", "1st half → full 10%"],
            ["FY2022-23/FURNITURE & FIXTURES", "Office Table - L Shape", "FUR-002", 8000, "2022-05-01", "Admin", "", "Godrej", "Interio", "1st half → full 10%"],
            ["FY2022-23/FURNITURE & FIXTURES", "Patient Bed - Manual", "FUR-003", 15000, "2022-06-10", "Ward", "", "Narang", "HF-104", "1st half → full 10%"],
            ["FY2022-23/FURNITURE & FIXTURES", "Waiting Room Bench (3-seater)", "FUR-004", 12000, "2022-07-15", "OPD", "", "Local", "", "1st half → full 10%"],
            ["FY2022-23/FURNITURE & FIXTURES", "Steel Filing Cabinet", "FUR-005", 10000, "2022-08-20", "Admin", "", "Godrej", "Storwel", "1st half → full 10%"],
            // VEHICLES: Total addition = 80,000 (2 assets, 1st half → full 15%)
            ["FY2022-23/VEHICLES", "Ambulance - Maruti Eeco", "VEH-001", 50000, "2022-04-10", "", "", "Maruti", "Eeco Ambulance", "1st half → full 15%"],
            ["FY2022-23/VEHICLES", "Staff Transport Van", "VEH-002", 30000, "2022-05-25", "", "", "Tata", "Winger", "1st half → full 15%"],
            // ══════════════════════════════════════════════════════════════
            //  FY2023-24 — Year 2 (additions only for some categories)
            // ══════════════════════════════════════════════════════════════
            // MEDICAL EQUIPMENTS: Addition = 10,000 (1 asset, 1st half → full 15%)
            ["FY2023-24/MEDICAL EQUIPMENTS", "Weighing Scale Digital", "MED-004", 10000, "2023-07-12", "OPD", "", "Essae", "DS-252", "Y2 addition, 1st half → full 15%"],
            // FURNITURE: Addition = 10,000 (1 asset, 2nd half → half 10% = 5%)
            ["FY2023-24/FURNITURE & FIXTURES", "Reception Counter", "FUR-006", 10000, "2023-11-01", "Front Desk", "", "Local", "", "Y2 addition, 2nd half → half rate 5%"],
            // ══════════════════════════════════════════════════════════════
            //  FY2024-25 — Year 3 (additions only for some categories)
            // ══════════════════════════════════════════════════════════════
            // BUILDING: Addition = 20,000 (1 asset, 2nd half → half 10% = 5%)
            ["FY2024-25/BUILDING", "Pharmacy Room Extension", "BLD-002", 20000, "2024-12-15", "", "", "", "", "Y3 addition, 2nd half → half rate 5%"],
            // VEHICLES: Addition = 30,000 (1 asset, 1st half → full 15%)
            ["FY2024-25/VEHICLES", "Utility Delivery Bike", "VEH-003", 30000, "2024-06-01", "", "", "Hero", "Splendor", "Y3 addition, 1st half → full 15%"],
        ];
        const ws = xlsx_1.default.utils.aoa_to_sheet([headers, ...samples]);
        ws["!cols"] = [
            { wch: 36 }, { wch: 40 }, { wch: 28 }, { wch: 16 },
            { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 22 },
            { wch: 18 }, { wch: 30 },
        ];
        xlsx_1.default.utils.book_append_sheet(wb, ws, "Individual Assets");
        const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Disposition", 'attachment; filename="Individual_Assets_Import_Template.xlsx"');
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buf);
    }
    catch (err) {
        console.error("downloadIndividualAssetsTemplate error:", err);
        res.status(500).json({ message: "Failed to generate template" });
    }
});
exports.downloadIndividualAssetsTemplate = downloadIndividualAssetsTemplate;
// ─── POST /asset-pool/import-individual-assets ────────────────────────────────
// Import individual asset line items from FA register.
// Each row creates one Asset record linked to an existing pool, flagged as legacy.
const importIndividualAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    const filePath = (_a = req.file) === null || _a === void 0 ? void 0 : _a.path;
    try {
        if (!filePath) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const wb = xlsx_1.default.readFile(filePath);
        const sheetName = (_b = wb.SheetNames.find(n => n.toLowerCase().includes("individual") || n.toLowerCase().includes("asset"))) !== null && _b !== void 0 ? _b : wb.SheetNames[0];
        const rows = xlsx_1.default.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
        if (!rows.length) {
            res.status(400).json({ message: "Spreadsheet is empty" });
            return;
        }
        const createdById = (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null;
        const results = [];
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;
            const poolRef = String((_e = row.poolRef) !== null && _e !== void 0 ? _e : "").trim();
            const assetNameRaw = String((_f = row.assetName) !== null && _f !== void 0 ? _f : "").trim();
            if (!poolRef || !assetNameRaw) {
                errors.push({ row: rowNum, error: "poolRef and assetName are required" });
                continue;
            }
            // Parse poolRef: "FY2024-25/MEDICAL EQUIPMENTS"
            const slashIdx = poolRef.indexOf("/");
            if (slashIdx === -1) {
                errors.push({ row: rowNum, poolRef, error: "poolRef must be 'FY####-##/CATEGORY NAME'" });
                continue;
            }
            const poolFY = poolRef.slice(0, slashIdx).trim();
            const poolCategory = poolRef.slice(slashIdx + 1).trim();
            const purchaseCostRaw = row.purchaseCost;
            const purchaseCost = purchaseCostRaw === "" || purchaseCostRaw == null ? null : Number(purchaseCostRaw);
            if (purchaseCost === null || isNaN(purchaseCost) || purchaseCost <= 0) {
                errors.push({ row: rowNum, assetName: assetNameRaw, error: "purchaseCost must be a positive number" });
                continue;
            }
            // Parse purchaseDate
            let purchaseDate = null;
            const purchaseDateRaw = row.purchaseDate;
            if (purchaseDateRaw) {
                if (typeof purchaseDateRaw === "number") {
                    const epoch = new Date(Date.UTC(1899, 11, 30));
                    purchaseDate = new Date(epoch.getTime() + purchaseDateRaw * 86400000);
                }
                else {
                    const d = new Date(purchaseDateRaw);
                    if (!isNaN(d.getTime()))
                        purchaseDate = d;
                }
            }
            try {
                // 1. Resolve pool by FY + category name
                const category = yield prismaClient_1.default.assetCategory.findFirst({
                    where: { name: poolCategory },
                });
                if (!category) {
                    errors.push({ row: rowNum, assetName: assetNameRaw, error: `Category not found: "${poolCategory}". Import the FA register first to create pools.` });
                    continue;
                }
                // Find pool by category (not by FY — one pool per category)
                const pool = yield prismaClient_1.default.assetPool.findFirst({
                    where: { categoryId: category.id },
                    include: {
                        depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 },
                    },
                });
                if (!pool) {
                    errors.push({ row: rowNum, assetName: assetNameRaw, error: `Pool not found for category "${poolCategory}". Import the FA register first.` });
                    continue;
                }
                // If purchaseDate is missing, default to pool FY end date
                if (!purchaseDate) {
                    const latestSched = (_g = pool.depreciationSchedules) === null || _g === void 0 ? void 0 : _g[0];
                    purchaseDate = (latestSched === null || latestSched === void 0 ? void 0 : latestSched.financialYearEnd)
                        ? new Date(latestSched.financialYearEnd)
                        : new Date(`${poolFY.replace("FY", "").split("-")[0]}03-31`);
                }
                // 2. Resolve optional department
                let departmentId = (_h = pool.departmentId) !== null && _h !== void 0 ? _h : null;
                const deptName = String((_j = row.department) !== null && _j !== void 0 ? _j : "").trim();
                if (deptName) {
                    const dept = yield prismaClient_1.default.department.findFirst({ where: { name: deptName } });
                    if (dept)
                        departmentId = dept.id;
                }
                // 3. Proportional accumulated depreciation (with half-year rule for year-of-acquisition)
                const latestSched = (_l = (_k = pool.depreciationSchedules) === null || _k === void 0 ? void 0 : _k[0]) !== null && _l !== void 0 ? _l : null;
                const poolClosingAccDep = latestSched ? Number(latestSched.closingAccumulatedDep) : 0;
                const poolClosingGrossBlock = latestSched ? Number(latestSched.closingGrossBlock) : Number((_m = pool.totalPoolCost) !== null && _m !== void 0 ? _m : 0);
                const depRate = latestSched ? Number(latestSched.depreciationRate) : 0;
                // Half-year rule: if asset was purchased in current FY's 2nd half (Oct 1 – Mar 31),
                // its acquisition-year depreciation is at 50% of rate. We reflect this by capping
                // the proportional acc-dep allocation to half for assets purchased in that window.
                const m = purchaseDate.getMonth();
                const acquisitionInSecondHalfOfFY = m >= 9 || m <= 2;
                // Determine if purchaseDate falls within the latest schedule's FY (year of acquisition)
                let halfYearAdjustmentApplied = false;
                let openingAccDep;
                const openingAccDepRaw = row.openingAccDep;
                if (openingAccDepRaw !== "" && openingAccDepRaw != null && !isNaN(Number(openingAccDepRaw))) {
                    openingAccDep = Number(openingAccDepRaw);
                }
                else if (poolClosingGrossBlock > 0) {
                    const shareRatio = purchaseCost / poolClosingGrossBlock;
                    let raw = poolClosingAccDep * shareRatio;
                    // Apply half-year rule when the purchase falls in the latest FY 2nd half
                    if (acquisitionInSecondHalfOfFY && latestSched &&
                        purchaseDate >= new Date(latestSched.financialYearEnd.getFullYear(), 9, 1)) {
                        raw = raw / 2;
                        halfYearAdjustmentApplied = true;
                    }
                    openingAccDep = Math.round(raw);
                }
                else {
                    openingAccDep = 0;
                }
                const currentBookValue = Math.max(0, purchaseCost - openingAccDep);
                // 4. Serial number — auto-generate if blank
                const serialNumberRaw = String((_o = row.serialNumber) !== null && _o !== void 0 ? _o : "").trim();
                const serialNumber = serialNumberRaw || `POOL-${pool.poolCode}-${Date.now()}-${i}`;
                // 5. Generate legacy asset ID
                const assetId = yield (0, assetIdGenerator_1.generateLegacyAssetId)(purchaseDate, undefined, category.id);
                // 6. Create the Asset record
                const asset = yield prismaClient_1.default.asset.create({
                    data: {
                        assetId,
                        assetName: assetNameRaw,
                        assetType: category.name,
                        assetCategoryId: category.id,
                        serialNumber,
                        purchaseCost,
                        purchaseDate,
                        modeOfProcurement: "PURCHASE",
                        status: "ACTIVE",
                        isLegacyAsset: true,
                        migrationMode: "PROPORTIONAL",
                        migrationDate: (_p = latestSched === null || latestSched === void 0 ? void 0 : latestSched.financialYearEnd) !== null && _p !== void 0 ? _p : purchaseDate,
                        originalCost: purchaseCost,
                        accDepAtMigration: openingAccDep,
                        openingWdvAtMigration: currentBookValue,
                        assetPoolId: pool.id,
                        financialYearAdded: poolFY,
                        manufacturer: String((_q = row.manufacturer) !== null && _q !== void 0 ? _q : "").trim() || null,
                        modelNumber: String((_r = row.modelNumber) !== null && _r !== void 0 ? _r : "").trim() || null,
                        remarks: String((_s = row.notes) !== null && _s !== void 0 ? _s : "").trim() || null,
                        departmentId,
                        createdById,
                    },
                });
                // 7. Create AssetDepreciation record
                // lastCalculatedAt = pool FY end date → tells the batch engine that depreciation
                // is already captured up to this date via the proportional opening balance.
                // The next batch run (e.g. FY2025-26 year-end) will correctly start from here.
                if (depRate > 0 || openingAccDep > 0) {
                    const fyEndForDep = (latestSched === null || latestSched === void 0 ? void 0 : latestSched.financialYearEnd)
                        ? new Date(latestSched.financialYearEnd)
                        : null;
                    yield prismaClient_1.default.assetDepreciation.create({
                        data: {
                            assetId: asset.id,
                            depreciationMethod: "DB",
                            depreciationRate: depRate,
                            expectedLifeYears: depRate > 0 ? Math.ceil(100 / depRate) : 0,
                            salvageValue: 0,
                            depreciationStart: purchaseDate,
                            accumulatedDepreciation: openingAccDep,
                            currentBookValue,
                            depreciationFrequency: "YEARLY",
                            lastCalculatedAt: fyEndForDep,
                            isActive: true,
                            createdById,
                        },
                    });
                }
                // 8. Update pool status
                const linkedCount = yield prismaClient_1.default.asset.count({ where: { assetPoolId: pool.id } });
                const newStatus = pool.originalQuantity > 0 && linkedCount >= pool.originalQuantity
                    ? "COMPLETE"
                    : "PARTIAL";
                yield prismaClient_1.default.assetPool.update({
                    where: { id: pool.id },
                    data: { status: newStatus },
                });
                results.push({
                    row: rowNum,
                    assetId,
                    assetName: assetNameRaw,
                    poolCode: pool.poolCode,
                    poolRef,
                    purchaseCost,
                    openingAccDep,
                    currentBookValue,
                    poolStatus: newStatus,
                    halfYearAdjustmentApplied,
                    acquisitionInSecondHalfOfFY,
                });
            }
            catch (rowErr) {
                errors.push({ row: rowNum, assetName: assetNameRaw, error: (_t = rowErr === null || rowErr === void 0 ? void 0 : rowErr.message) !== null && _t !== void 0 ? _t : "Unknown error" });
            }
        }
        try {
            fs_1.default.unlinkSync(filePath);
        }
        catch (_u) { }
        res.json({
            imported: results.length,
            errorCount: errors.length,
            results,
            errors,
        });
    }
    catch (err) {
        try {
            if (filePath)
                fs_1.default.unlinkSync(filePath);
        }
        catch (_v) { }
        console.error("importIndividualAssets error:", err);
        res.status(500).json({ message: "Failed to import individual assets" });
    }
});
exports.importIndividualAssets = importIndividualAssets;

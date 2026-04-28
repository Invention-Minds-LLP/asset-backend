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
exports.getAssetValueBuckets = exports.getMaintenanceByCategory = exports.getUncoveredAssets = exports.getInStoreAging = exports.getCooDashboard = exports.getIdleCapitalAnalysis = exports.getCfoDashboard = exports.getAssetTurnover = exports.getAssetTCO = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const client_1 = require("@prisma/client");
// ═══════════════════════════════════════════════════════════
// 1. GET /tco — Total Cost of Ownership
// ═══════════════════════════════════════════════════════════
const getAssetTCO = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    try {
        const { assetId, categoryId, departmentId, level = "asset" } = req.query;
        const user = req.user;
        const broadAccess = ["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role);
        // ── Single asset TCO ──────────────────────────────────
        if (assetId) {
            const asset = yield prismaClient_1.default.asset.findUnique({
                where: { id: Number(assetId) },
                include: {
                    assetCategory: { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                },
            });
            if (!asset) {
                res.status(404).json({ error: "Asset not found" });
                return;
            }
            // Non-broad-access users can only view TCO for assets in their own department.
            // Only block if the asset explicitly belongs to a DIFFERENT department — unassigned assets (no dept) are viewable.
            if (!broadAccess && (user === null || user === void 0 ? void 0 : user.departmentId) && ((_a = asset.department) === null || _a === void 0 ? void 0 : _a.id) != null && asset.department.id !== Number(user.departmentId)) {
                res.status(404).json({ error: "Asset not found" });
                return;
            }
            const capitalCost = Number((_b = asset.purchaseCost) !== null && _b !== void 0 ? _b : 0);
            // Repair cost from tickets
            const ticketAgg = yield prismaClient_1.default.ticket.aggregate({
                where: { assetId: Number(assetId) },
                _sum: { totalCost: true },
            });
            const repairCost = Number((_c = ticketAgg._sum.totalCost) !== null && _c !== void 0 ? _c : 0);
            // PM cost from maintenance history
            const mhAgg = yield prismaClient_1.default.maintenanceHistory.aggregate({
                where: { assetId: Number(assetId) },
                _sum: { totalCost: true },
            });
            const pmCost = Number((_d = mhAgg._sum.totalCost) !== null && _d !== void 0 ? _d : 0);
            // Material issue cost (via work orders linked to this asset)
            const materialAgg = yield prismaClient_1.default.materialIssue.aggregate({
                where: { workOrder: { assetId: Number(assetId) } },
                _sum: { totalCost: true },
            });
            const consumableCost = Number((_e = materialAgg._sum.totalCost) !== null && _e !== void 0 ? _e : 0);
            // Spare part usage cost
            const spareAgg = yield prismaClient_1.default.sparePartUsage.aggregate({
                where: { assetId: Number(assetId) },
                _sum: { costAtUse: true },
            });
            const sparePartCost = Number((_f = spareAgg._sum.costAtUse) !== null && _f !== void 0 ? _f : 0);
            // Cost allocations grouped by costType
            const allocations = yield prismaClient_1.default.assetCostAllocation.groupBy({
                by: ["costType"],
                where: { assetId: Number(assetId) },
                _sum: { amount: true },
            });
            const allocationMap = {};
            for (const a of allocations) {
                allocationMap[a.costType] = Number((_g = a._sum.amount) !== null && _g !== void 0 ? _g : 0);
            }
            const laborCost = (_h = allocationMap["LABOR"]) !== null && _h !== void 0 ? _h : 0;
            const utilityCost = (_j = allocationMap["UTILITY_POWER"]) !== null && _j !== void 0 ? _j : 0;
            const spaceCost = (_k = allocationMap["SPACE_FACILITY"]) !== null && _k !== void 0 ? _k : 0;
            const outsourcedCost = (_l = allocationMap["OUTSOURCED_SERVICE"]) !== null && _l !== void 0 ? _l : 0;
            const allocConsumable = (_m = allocationMap["CONSUMABLE"]) !== null && _m !== void 0 ? _m : 0;
            const otherCost = (_o = allocationMap["OTHER"]) !== null && _o !== void 0 ? _o : 0;
            // Historical opening balance costs (legacy assets only)
            const historicalMaintenanceCost = Number((_p = asset.historicalMaintenanceCost) !== null && _p !== void 0 ? _p : 0);
            const historicalSparePartsCost = Number((_q = asset.historicalSparePartsCost) !== null && _q !== void 0 ? _q : 0);
            const historicalOtherCost = Number((_r = asset.historicalOtherCost) !== null && _r !== void 0 ? _r : 0);
            const totalHistoricalCost = historicalMaintenanceCost + historicalSparePartsCost + historicalOtherCost;
            const totalTCO = capitalCost +
                repairCost +
                pmCost +
                consumableCost +
                sparePartCost +
                laborCost +
                utilityCost +
                spaceCost +
                outsourcedCost +
                allocConsumable +
                otherCost +
                totalHistoricalCost;
            const purchaseDate = (_s = asset.purchaseDate) !== null && _s !== void 0 ? _s : asset.grnDate;
            const ageYears = purchaseDate
                ? Math.max((Date.now() - new Date(purchaseDate).getTime()) /
                    (365.25 * 24 * 60 * 60 * 1000), 1)
                : 1;
            res.json({
                asset: {
                    id: asset.id,
                    assetId: asset.assetId,
                    assetName: asset.assetName,
                    category: asset.assetCategory.name,
                    department: (_u = (_t = asset.department) === null || _t === void 0 ? void 0 : _t.name) !== null && _u !== void 0 ? _u : null,
                },
                capitalCost,
                repairCost,
                pmCost,
                laborCost,
                utilityCost,
                spaceCost,
                consumableCost: consumableCost + allocConsumable,
                outsourcedCost,
                sparePartCost,
                otherCost,
                totalTCO: Math.round(totalTCO * 100) / 100,
                costPerYear: Math.round((totalTCO / ageYears) * 100) / 100,
                totalHistoricalCost: asset.isLegacyAsset ? totalHistoricalCost : null,
                costBreakdownByType: allocations.map((a) => {
                    var _a;
                    return ({
                        costType: a.costType,
                        amount: Number((_a = a._sum.amount) !== null && _a !== void 0 ? _a : 0),
                    });
                }),
            });
            return;
        }
        // ── Grouped TCO (category or department level) ────────
        const groupLevel = String(level);
        if (groupLevel !== "category" && groupLevel !== "department") {
            res
                .status(400)
                .json({ error: "Provide assetId for asset-level, or set level=category|department" });
            return;
        }
        const assetWhere = {};
        if (categoryId)
            assetWhere.assetCategoryId = Number(categoryId);
        if (departmentId) {
            assetWhere.departmentId = Number(departmentId);
        }
        else if (!broadAccess && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            assetWhere.departmentId = Number(user.departmentId);
        }
        const groupByField = groupLevel === "category" ? "assetCategoryId" : "departmentId";
        // Get assets grouped (filter out unassigned assets with no category/dept after query)
        const groups = (yield prismaClient_1.default.asset.groupBy({
            by: [groupByField],
            where: Object.assign(Object.assign({}, assetWhere), { status: { notIn: ["DISPOSED", "SCRAPPED"] } }),
            _count: { id: true },
            _sum: { purchaseCost: true },
        })).filter((g) => g[groupByField] != null);
        const results = yield Promise.all(groups.map((g) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const groupId = g[groupByField];
            const assetFilter = { [groupByField]: groupId };
            // Get all asset IDs in this group
            const assetIds = (yield prismaClient_1.default.asset.findMany({
                where: Object.assign(Object.assign({}, assetFilter), { status: { notIn: ["DISPOSED", "SCRAPPED"] } }),
                select: { id: true },
            })).map((a) => a.id);
            const [ticketSum, mhSum, materialSum, spareSum, allocSum, historicalSum] = yield Promise.all([
                prismaClient_1.default.ticket.aggregate({
                    where: { assetId: { in: assetIds } },
                    _sum: { totalCost: true },
                }),
                prismaClient_1.default.maintenanceHistory.aggregate({
                    where: { assetId: { in: assetIds } },
                    _sum: { totalCost: true },
                }),
                prismaClient_1.default.materialIssue.aggregate({
                    where: { workOrder: { assetId: { in: assetIds } } },
                    _sum: { totalCost: true },
                }),
                prismaClient_1.default.sparePartUsage.aggregate({
                    where: { assetId: { in: assetIds } },
                    _sum: { costAtUse: true },
                }),
                prismaClient_1.default.assetCostAllocation.aggregate({
                    where: { assetId: { in: assetIds } },
                    _sum: { amount: true },
                }),
                // Historical opening balance costs from legacy assets in this group
                prismaClient_1.default.asset.aggregate({
                    where: { id: { in: assetIds }, isLegacyAsset: true },
                    _sum: { historicalMaintenanceCost: true, historicalSparePartsCost: true, historicalOtherCost: true },
                }),
            ]);
            const groupHistoricalCost = Number((_a = historicalSum._sum.historicalMaintenanceCost) !== null && _a !== void 0 ? _a : 0) +
                Number((_b = historicalSum._sum.historicalSparePartsCost) !== null && _b !== void 0 ? _b : 0) +
                Number((_c = historicalSum._sum.historicalOtherCost) !== null && _c !== void 0 ? _c : 0);
            const capitalCost = Number((_d = g._sum.purchaseCost) !== null && _d !== void 0 ? _d : 0);
            const totalTCO = capitalCost +
                Number((_e = ticketSum._sum.totalCost) !== null && _e !== void 0 ? _e : 0) +
                Number((_f = mhSum._sum.totalCost) !== null && _f !== void 0 ? _f : 0) +
                Number((_g = materialSum._sum.totalCost) !== null && _g !== void 0 ? _g : 0) +
                Number((_h = spareSum._sum.costAtUse) !== null && _h !== void 0 ? _h : 0) +
                Number((_j = allocSum._sum.amount) !== null && _j !== void 0 ? _j : 0) +
                groupHistoricalCost;
            // Resolve group name
            let groupName = "Unknown";
            if (groupLevel === "category") {
                const cat = yield prismaClient_1.default.assetCategory.findUnique({
                    where: { id: groupId },
                    select: { name: true },
                });
                groupName = (_k = cat === null || cat === void 0 ? void 0 : cat.name) !== null && _k !== void 0 ? _k : "Unknown";
            }
            else {
                const dept = yield prismaClient_1.default.department.findUnique({
                    where: { id: groupId },
                    select: { name: true },
                });
                groupName = (_l = dept === null || dept === void 0 ? void 0 : dept.name) !== null && _l !== void 0 ? _l : "Unknown";
            }
            return {
                groupId,
                groupName,
                assetCount: g._count.id,
                totalTCO: Math.round(totalTCO * 100) / 100,
                avgTCOPerAsset: g._count.id > 0
                    ? Math.round((totalTCO / g._count.id) * 100) / 100
                    : 0,
            };
        })));
        results.sort((a, b) => b.totalTCO - a.totalTCO);
        res.json(results);
    }
    catch (err) {
        console.error("getAssetTCO error:", err);
        res.status(500).json({ error: "Failed to compute TCO", details: err.message });
    }
});
exports.getAssetTCO = getAssetTCO;
// ═══════════════════════════════════════════════════════════
// 2. GET /asset-turnover — Asset Turnover Ratio
// ═══════════════════════════════════════════════════════════
const getAssetTurnover = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { categoryId, departmentId } = req.query;
        const user = req.user;
        const where = {
            status: { notIn: ["DISPOSED", "SCRAPPED"] },
            purchaseCost: { not: null, gt: 0 },
        };
        const broadAccessTurnover = ["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role);
        if (categoryId)
            where.assetCategoryId = Number(categoryId);
        if (departmentId) {
            where.departmentId = Number(departmentId);
        }
        else if (!broadAccessTurnover && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            where.departmentId = Number(user.departmentId);
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where,
            select: {
                id: true,
                assetId: true,
                assetName: true,
                purchaseCost: true,
                assetCategory: { select: { name: true } },
            },
        });
        if (assets.length === 0) {
            res.json({
                avgTurnoverRatio: 0,
                totalRevenue: 0,
                totalAssetValue: 0,
                topPerformers: [],
                bottomPerformers: [],
            });
            return;
        }
        // Batch fetch revenue from daily usage logs (actual + estimated per asset)
        // AssetDailyUsageLog has richer real data — staff log it daily during operations.
        // AssetRevenueEntry requires manual Cost Analysis input which is rarely filled.
        const assetIds = assets.map((a) => a.id);
        const dailyRevByAsset = yield prismaClient_1.default.assetDailyUsageLog.groupBy({
            by: ["assetId"],
            where: { assetId: { in: assetIds } },
            _sum: { revenueGenerated: true, estimatedRevenue: true },
        });
        const revenueMap = new Map();
        for (const r of dailyRevByAsset) {
            const actual = Number((_a = r._sum.revenueGenerated) !== null && _a !== void 0 ? _a : 0);
            const estimated = Number((_b = r._sum.estimatedRevenue) !== null && _b !== void 0 ? _b : 0);
            // Prefer actual revenue; fall back to estimated when actual is not recorded
            revenueMap.set(r.assetId, actual > 0 ? actual : estimated);
        }
        let totalRevenue = 0;
        let totalAssetValue = 0;
        const items = assets.map((a) => {
            var _a, _b;
            const revenue = (_a = revenueMap.get(a.id)) !== null && _a !== void 0 ? _a : 0;
            const cost = Number((_b = a.purchaseCost) !== null && _b !== void 0 ? _b : 0);
            totalRevenue += revenue;
            totalAssetValue += cost;
            return {
                assetId: a.assetId,
                assetName: a.assetName,
                category: a.assetCategory.name,
                revenue: Math.round(revenue * 100) / 100,
                purchaseCost: cost,
                turnoverRatio: cost > 0 ? Math.round((revenue / cost) * 10000) / 10000 : 0,
            };
        });
        items.sort((a, b) => b.turnoverRatio - a.turnoverRatio);
        res.json({
            avgTurnoverRatio: totalAssetValue > 0
                ? Math.round((totalRevenue / totalAssetValue) * 10000) / 10000
                : 0,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalAssetValue: Math.round(totalAssetValue * 100) / 100,
            topPerformers: items.slice(0, 5),
            bottomPerformers: items.slice(-5).reverse(),
        });
    }
    catch (err) {
        console.error("getAssetTurnover error:", err);
        res.status(500).json({ error: "Failed to compute asset turnover", details: err.message });
    }
});
exports.getAssetTurnover = getAssetTurnover;
// ═══════════════════════════════════════════════════════════
// 3. GET /cfo-dashboard — CFO Financial Summary
// ═══════════════════════════════════════════════════════════
const getCfoDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const { departmentId } = req.query;
        const user = req.user;
        // Auto-inject departmentId for non-admin users
        const broadAccess = ["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role);
        const deptFilter = departmentId
            ? Number(departmentId)
            : (!broadAccess && (user === null || user === void 0 ? void 0 : user.departmentId) ? Number(user.departmentId) : undefined);
        // All KPIs sourced from the Asset module only — no PO/GRA workflow tables.
        // Basic PO/GRN details (purchaseOrderNo, grnNumber, purchaseCost, grnValue)
        // are stored directly on the Asset record.
        const [assetValueResult, bookValueResult, ticketCostResult, mhCostResult, activeAssetCount, disposedAssetCount,] = yield Promise.all([
            // Total capital invested — sum of purchase cost of all active assets
            prismaClient_1.default.asset.aggregate({
                where: Object.assign({ status: { notIn: ["DISPOSED", "SCRAPPED"] } }, (deptFilter ? { departmentId: deptFilter } : {})),
                _sum: { purchaseCost: true },
            }),
            // Total current book value (from depreciation records)
            prismaClient_1.default.assetDepreciation.aggregate({
                where: Object.assign({ isActive: true }, (deptFilter ? { asset: { departmentId: deptFilter } } : {})),
                _sum: { currentBookValue: true },
            }),
            // Maintenance cost — corrective tickets
            prismaClient_1.default.ticket.aggregate({
                where: deptFilter ? { departmentId: deptFilter } : {},
                _sum: { totalCost: true },
            }),
            // Maintenance cost — planned maintenance history
            prismaClient_1.default.maintenanceHistory.aggregate({
                where: deptFilter ? { asset: { departmentId: deptFilter } } : {},
                _sum: { totalCost: true },
            }),
            // Active asset count
            prismaClient_1.default.asset.count({
                where: Object.assign({ status: { notIn: ["DISPOSED", "SCRAPPED"] } }, (deptFilter ? { departmentId: deptFilter } : {})),
            }),
            // Disposed/scrapped assets
            prismaClient_1.default.asset.count({
                where: Object.assign({ status: { in: ["DISPOSED", "SCRAPPED"] } }, (deptFilter ? { departmentId: deptFilter } : {})),
            }),
        ]);
        // Monthly asset acquisitions (capital) — based on purchaseDate on the asset record
        // Monthly maintenance cost — ticket costs by creation month
        const now = new Date();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        const monthlyAcquisitions = yield prismaClient_1.default.$queryRaw `
      SELECT
        DATE_FORMAT(purchaseDate, '%Y-%m') AS month,
        COALESCE(SUM(purchaseCost), 0) AS capital
      FROM asset
      WHERE purchaseDate >= ${twelveMonthsAgo}
        AND status NOT IN ('DISPOSED', 'SCRAPPED')
        ${deptFilter ? client_1.Prisma.sql `AND departmentId = ${deptFilter}` : client_1.Prisma.empty}
      GROUP BY DATE_FORMAT(purchaseDate, '%Y-%m')
      ORDER BY month
    `;
        const monthlyMaintenance = yield prismaClient_1.default.$queryRaw `
      SELECT
        DATE_FORMAT(createdAt, '%Y-%m') AS month,
        COALESCE(SUM(totalCost), 0) AS maintenance
      FROM ticket
      WHERE createdAt >= ${twelveMonthsAgo}
        ${deptFilter ? client_1.Prisma.sql `AND departmentId = ${deptFilter}` : client_1.Prisma.empty}
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
      ORDER BY month
    `;
        // Build 12-month scaffold and merge
        const monthMap = new Map();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            monthMap.set(key, { month: key, capital: 0, maintenance: 0 });
        }
        for (const row of monthlyAcquisitions) {
            const entry = monthMap.get(row.month);
            if (entry)
                entry.capital = Number(row.capital);
        }
        for (const row of monthlyMaintenance) {
            const entry = monthMap.get(row.month);
            if (entry)
                entry.maintenance = Number(row.maintenance);
        }
        const liveMaintenanceCost = Number((_a = ticketCostResult._sum.totalCost) !== null && _a !== void 0 ? _a : 0) +
            Number((_b = mhCostResult._sum.totalCost) !== null && _b !== void 0 ? _b : 0);
        // Add historical opening balance costs from legacy assets
        const historicalCostAgg = yield prismaClient_1.default.asset.aggregate({
            where: Object.assign({ isLegacyAsset: true }, (deptFilter ? { departmentId: deptFilter } : {})),
            _sum: { historicalMaintenanceCost: true, historicalSparePartsCost: true, historicalOtherCost: true },
        });
        const totalHistoricalCost = Number((_c = historicalCostAgg._sum.historicalMaintenanceCost) !== null && _c !== void 0 ? _c : 0) +
            Number((_d = historicalCostAgg._sum.historicalSparePartsCost) !== null && _d !== void 0 ? _d : 0) +
            Number((_e = historicalCostAgg._sum.historicalOtherCost) !== null && _e !== void 0 ? _e : 0);
        const totalMaintenanceCost = liveMaintenanceCost + totalHistoricalCost;
        const totalAssetValue = Number((_f = assetValueResult._sum.purchaseCost) !== null && _f !== void 0 ? _f : 0);
        // Pool undigitized balances (from FA register schedules)
        const cfoPools = yield prismaClient_1.default.assetPool.findMany({
            select: { id: true, originalQuantity: true, status: true },
            where: deptFilter ? { departmentId: deptFilter } : {},
        });
        let cfoPoolGrossBlock = 0, cfoPoolNetBlock = 0, cfoUndigitizedAssets = 0;
        for (const pool of cfoPools) {
            const linkedCount = yield prismaClient_1.default.asset.count({ where: { assetPoolId: pool.id } });
            cfoUndigitizedAssets += Math.max(0, pool.originalQuantity - linkedCount);
            const latestSched = yield prismaClient_1.default.assetPoolDepreciationSchedule.findFirst({
                where: { poolId: pool.id }, orderBy: { financialYearEnd: "desc" },
            });
            if (latestSched) {
                const ratio = pool.originalQuantity > 0
                    ? Math.max(0, pool.originalQuantity - linkedCount) / pool.originalQuantity : 0;
                cfoPoolGrossBlock += Number(latestSched.closingGrossBlock) * ratio;
                cfoPoolNetBlock += Number(latestSched.closingNetBlock) * ratio;
            }
        }
        // E-Waste scrap value recovered (closed records)
        const fyStart = new Date(now.getFullYear() - (now.getMonth() < 3 ? 1 : 0), 3, 1); // April 1
        const eWasteClosedRecords = yield prismaClient_1.default.eWasteRecord.findMany({
            where: { status: 'CLOSED', closedAt: { gte: fyStart } },
            include: { assetDisposal: { select: { actualSaleValue: true } } },
        });
        const eWasteScrapValueFY = eWasteClosedRecords.reduce((sum, r) => { var _a, _b; return sum + Number((_b = (_a = r.assetDisposal) === null || _a === void 0 ? void 0 : _a.actualSaleValue) !== null && _b !== void 0 ? _b : 0); }, 0);
        const [eWastePendingTotal, eWasteClosedTotal] = yield Promise.all([
            prismaClient_1.default.eWasteRecord.count({ where: { status: { not: 'CLOSED' } } }),
            prismaClient_1.default.eWasteRecord.count({ where: { status: 'CLOSED' } }),
        ]);
        res.json({
            totalAssetValue,
            totalBookValue: Number((_g = bookValueResult._sum.currentBookValue) !== null && _g !== void 0 ? _g : 0),
            liveMaintenanceCost,
            totalHistoricalCost,
            totalMaintenanceCost,
            maintenanceToAssetRatio: totalAssetValue > 0
                ? Math.round((totalMaintenanceCost / totalAssetValue) * 10000) / 100
                : 0,
            activeAssets: activeAssetCount,
            disposedAssets: disposedAssetCount,
            monthlyTrend: Array.from(monthMap.values()),
            eWaste: {
                pendingSignOff: eWastePendingTotal,
                closedTotal: eWasteClosedTotal,
                scrapValueRecoveredFY: Math.round(eWasteScrapValueFY * 100) / 100,
            },
            // Pool balances — adds undigitized FA register assets to the balance sheet
            poolSummary: {
                totalPools: cfoPools.length,
                totalUndigitizedAssets: cfoUndigitizedAssets,
                poolGrossBlock: Math.round(cfoPoolGrossBlock),
                poolNetBlock: Math.round(cfoPoolNetBlock),
                // Combined balance sheet totals (individual + pool)
                combinedAssetValue: totalAssetValue + Math.round(cfoPoolGrossBlock),
                combinedBookValue: Number((_h = bookValueResult._sum.currentBookValue) !== null && _h !== void 0 ? _h : 0) + Math.round(cfoPoolNetBlock),
            },
            legacyAssetCount: yield prismaClient_1.default.asset.count({ where: Object.assign({ isLegacyAsset: true }, (deptFilter ? { departmentId: deptFilter } : {})) }),
            dataAvailableSince: yield prismaClient_1.default.asset.findFirst({
                where: Object.assign({ isLegacyAsset: true, dataAvailableSince: { not: null } }, (deptFilter ? { departmentId: deptFilter } : {})),
                orderBy: { dataAvailableSince: 'asc' },
                select: { dataAvailableSince: true },
            }).then(r => { var _a; return (_a = r === null || r === void 0 ? void 0 : r.dataAvailableSince) !== null && _a !== void 0 ? _a : null; }),
        });
    }
    catch (err) {
        console.error("getCfoDashboard error:", err);
        res.status(500).json({ error: "Failed to load CFO dashboard", details: err.message });
    }
});
exports.getCfoDashboard = getCfoDashboard;
// ═══════════════════════════════════════════════════════════
// 4. GET /idle-capital — Idle Capital Analysis
// ═══════════════════════════════════════════════════════════
const getIdleCapitalAnalysis = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const monthsThreshold = Number((_a = req.query.monthsThreshold) !== null && _a !== void 0 ? _a : 6);
        const user = req.user;
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - monthsThreshold);
        // Department-based scoping for non-admin users
        const deptScope = {};
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            deptScope.departmentId = Number(user.departmentId);
        }
        // Asset status buckets:
        //   Always idle  : IN_STORE (in warehouse, not deployed), RETIRED (withdrawn from service)
        //   Activity-based: ACTIVE, UNDER_OBSERVATION — deployed but may be unused
        //   Never idle   : IN_MAINTENANCE (currently being worked on)
        //   Excluded      : DISPOSED, SCRAPPED, CONDEMNED, REJECTED
        const assetSelect = {
            id: true,
            assetId: true,
            assetName: true,
            status: true,
            purchaseCost: true,
            departmentId: true,
            assetCategoryId: true,
            assetCategory: { select: { name: true } },
            department: { select: { name: true } },
        };
        // Fetch IN_STORE and RETIRED separately — they are always idle
        const alwaysIdleAssets = yield prismaClient_1.default.asset.findMany({
            where: Object.assign({ status: { in: ["IN_STORE", "RETIRED"] } }, deptScope),
            select: assetSelect,
        });
        // Fetch ACTIVE and UNDER_OBSERVATION — need activity check
        const deployedAssets = yield prismaClient_1.default.asset.findMany({
            where: Object.assign({ status: { in: ["ACTIVE", "UNDER_OBSERVATION"] } }, deptScope),
            select: assetSelect,
        });
        // Total active fleet value (for idlePctOfTotal denominator) = all non-disposed/scrapped
        const fleetAgg = yield prismaClient_1.default.asset.aggregate({
            where: Object.assign({ status: { notIn: ["DISPOSED", "SCRAPPED", "CONDEMNED", "REJECTED"] } }, deptScope),
            _sum: { purchaseCost: true },
        });
        const totalFleetValueNum = Number((_b = fleetAgg._sum.purchaseCost) !== null && _b !== void 0 ? _b : 0);
        const deployedIds = deployedAssets.map((a) => a.id);
        // Find deployed assets that had activity within the threshold window
        const [ticketActive, mhActive, dailyLogActive, pmRunActive] = deployedIds.length > 0
            ? yield Promise.all([
                prismaClient_1.default.ticket.findMany({
                    where: { assetId: { in: deployedIds }, createdAt: { gte: cutoffDate } },
                    select: { assetId: true },
                    distinct: ["assetId"],
                }),
                prismaClient_1.default.maintenanceHistory.findMany({
                    where: { assetId: { in: deployedIds }, createdAt: { gte: cutoffDate } },
                    select: { assetId: true },
                    distinct: ["assetId"],
                }),
                prismaClient_1.default.assetDailyUsageLog.findMany({
                    where: { assetId: { in: deployedIds }, logDate: { gte: cutoffDate } },
                    select: { assetId: true },
                    distinct: ["assetId"],
                }),
                prismaClient_1.default.pMChecklistRun.findMany({
                    where: { assetId: { in: deployedIds }, createdAt: { gte: cutoffDate } },
                    select: { assetId: true },
                    distinct: ["assetId"],
                }),
            ])
            : [[], [], [], []];
        const recentlyActiveIds = new Set();
        for (const r of [...ticketActive, ...mhActive, ...dailyLogActive, ...pmRunActive]) {
            recentlyActiveIds.add(r.assetId);
        }
        // Deployed assets with no activity in threshold window
        const inactiveDeployedAssets = deployedAssets.filter((a) => !recentlyActiveIds.has(a.id));
        // Final idle list: always-idle (IN_STORE + RETIRED) + inactive deployed
        const idleAssetList = [...alwaysIdleAssets, ...inactiveDeployedAssets];
        if (idleAssetList.length === 0) {
            res.json({ idleAssets: [], totalIdleValue: 0, idleCount: 0, idlePctOfTotal: 0 });
            return;
        }
        // Batch-fetch last activity dates
        const idleIds = idleAssetList.map((a) => a.id);
        const [lastTickets, lastMH, lastDailyLog, lastPM] = yield Promise.all([
            idleIds.length > 0
                ? prismaClient_1.default.$queryRaw `
            SELECT assetId, MAX(createdAt) as lastDate
            FROM ticket WHERE assetId IN (${client_1.Prisma.join(idleIds)})
            GROUP BY assetId
          `
                : Promise.resolve([]),
            idleIds.length > 0
                ? prismaClient_1.default.$queryRaw `
            SELECT assetId, MAX(createdAt) as lastDate
            FROM maintenancehistory WHERE assetId IN (${client_1.Prisma.join(idleIds)})
            GROUP BY assetId
          `
                : Promise.resolve([]),
            idleIds.length > 0
                ? prismaClient_1.default.$queryRaw `
            SELECT assetId, MAX(logDate) as lastDate
            FROM assetdailyusagelog WHERE assetId IN (${client_1.Prisma.join(idleIds)})
            GROUP BY assetId
          `
                : Promise.resolve([]),
            idleIds.length > 0
                ? prismaClient_1.default.$queryRaw `
            SELECT assetId, MAX(createdAt) as lastDate
            FROM pmchecklistrun WHERE assetId IN (${client_1.Prisma.join(idleIds)})
            GROUP BY assetId
          `
                : Promise.resolve([]),
        ]);
        const lastActivityMap = new Map();
        for (const rows of [lastTickets, lastMH, lastDailyLog, lastPM]) {
            for (const r of rows) {
                const current = lastActivityMap.get(r.assetId);
                const d = new Date(r.lastDate);
                if (!current || d > current) {
                    lastActivityMap.set(r.assetId, d);
                }
            }
        }
        // Fetch book values for idle assets
        const depreciations = idleIds.length > 0
            ? yield prismaClient_1.default.assetDepreciation.findMany({
                where: { assetId: { in: idleIds } },
                select: { assetId: true, currentBookValue: true },
            })
            : [];
        const bookValueMap = new Map();
        for (const d of depreciations) {
            bookValueMap.set(d.assetId, Number((_c = d.currentBookValue) !== null && _c !== void 0 ? _c : 0));
        }
        const nowMs = Date.now();
        let totalIdleValue = 0;
        const idleAssets = idleAssetList.map((a) => {
            var _a, _b, _c, _d, _e;
            const cost = Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0);
            totalIdleValue += cost;
            const lastActivity = (_b = lastActivityMap.get(a.id)) !== null && _b !== void 0 ? _b : null;
            const daysSinceActivity = lastActivity
                ? Math.floor((nowMs - new Date(lastActivity).getTime()) / (24 * 60 * 60 * 1000))
                : null;
            return {
                assetId: a.assetId,
                assetName: a.assetName,
                category: a.assetCategory.name,
                department: (_d = (_c = a.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null,
                purchaseCost: cost,
                currentBookValue: (_e = bookValueMap.get(a.id)) !== null && _e !== void 0 ? _e : null,
                lastActivityDate: lastActivity,
                daysSinceActivity,
            };
        });
        idleAssets.sort((a, b) => { var _a, _b; return ((_a = b.daysSinceActivity) !== null && _a !== void 0 ? _a : Infinity) - ((_b = a.daysSinceActivity) !== null && _b !== void 0 ? _b : Infinity); });
        res.json({
            idleAssets,
            totalIdleValue: Math.round(totalIdleValue * 100) / 100,
            idleCount: idleAssets.length,
            idlePctOfTotal: totalFleetValueNum > 0
                ? Math.round((totalIdleValue / totalFleetValueNum) * 10000) / 100
                : 0,
        });
    }
    catch (err) {
        console.error("getIdleCapitalAnalysis error:", err);
        res.status(500).json({ error: "Failed to analyse idle capital", details: err.message });
    }
});
exports.getIdleCapitalAnalysis = getIdleCapitalAnalysis;
// ═══════════════════════════════════════════════════════════
// 5. GET /coo-dashboard — COO Operational Dashboard
// ═══════════════════════════════════════════════════════════
const getCooDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const now = new Date();
        // Support optional dateFrom / dateTo query params for ticket/WO stats
        const { dateFrom, dateTo } = req.query;
        const rangeStart = dateFrom ? new Date(String(dateFrom)) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const rangeEnd = dateTo ? new Date(String(dateTo)) : now;
        const thirtyDaysAgo = rangeStart; // alias for readability in existing code
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        // Auto-inject departmentId for non-admin users
        const user = req.user;
        const deptFilter = !["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId) ? Number(user.departmentId) : undefined;
        const deptAssetWhere = deptFilter ? { departmentId: deptFilter } : {};
        const deptWhere = deptFilter ? { departmentId: deptFilter } : {};
        const deptAssetNestedWhere = deptFilter ? { asset: { departmentId: deptFilter } } : {};
        // ── 1. Asset Fleet Health ────────────────────────────────
        const [totalAssets, activeAssets, inMaintenanceAssets, inStoreAssets, underObservationAssets, retiredAssets, disposedAssets, scrappedAssets,] = yield Promise.all([
            prismaClient_1.default.asset.count({ where: Object.assign({ status: { notIn: ["DISPOSED", "SCRAPPED"] } }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "ACTIVE" }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "IN_MAINTENANCE" }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "IN_STORE" }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "UNDER_OBSERVATION" }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "RETIRED" }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "DISPOSED" }, deptAssetWhere) }),
            prismaClient_1.default.asset.count({ where: Object.assign({ status: "SCRAPPED" }, deptAssetWhere) }),
        ]);
        const fleetAvailabilityPct = totalAssets > 0 ? Math.round((activeAssets / totalAssets) * 10000) / 100 : 0;
        // ── 1b. Financial Summary ───────────────────────────────
        const [totalPurchaseCostAgg, totalMaintenanceCost30dAgg] = yield Promise.all([
            prismaClient_1.default.asset.aggregate({
                where: Object.assign({ status: "ACTIVE" }, deptAssetWhere),
                _sum: { purchaseCost: true },
            }),
            prismaClient_1.default.ticket.aggregate({
                where: Object.assign({ createdAt: { gte: thirtyDaysAgo, lte: rangeEnd } }, deptWhere),
                _sum: { totalCost: true },
            }),
        ]);
        const totalPurchaseCost = Number((_a = totalPurchaseCostAgg._sum.purchaseCost) !== null && _a !== void 0 ? _a : 0);
        const totalMaintenanceCost30d = Number((_b = totalMaintenanceCost30dAgg._sum.totalCost) !== null && _b !== void 0 ? _b : 0);
        // ── 2. Ticket Operations (date range) ──────────────────
        const [openTickets, resolvedTickets30d, slaBreachedTickets, ticketsByPriority] = yield Promise.all([
            prismaClient_1.default.ticket.count({
                where: Object.assign({ status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } }, deptWhere),
            }),
            prismaClient_1.default.ticket.count({
                where: Object.assign({ status: { in: ["RESOLVED", "CLOSED"] }, updatedAt: { gte: thirtyDaysAgo, lte: rangeEnd } }, deptWhere),
            }),
            prismaClient_1.default.ticket.count({
                where: Object.assign({ slaBreached: true, createdAt: { gte: thirtyDaysAgo, lte: rangeEnd } }, deptWhere),
            }),
            prismaClient_1.default.ticket.groupBy({
                by: ["priority"],
                where: Object.assign({ status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } }, deptWhere),
                _count: { id: true },
            }),
        ]);
        // Avg resolution hours for resolved tickets in date range
        const resolvedTicketsForAvg = yield prismaClient_1.default.ticket.findMany({
            where: Object.assign({ status: { in: ["RESOLVED", "CLOSED"] }, updatedAt: { gte: thirtyDaysAgo, lte: rangeEnd }, slaResolvedAt: { not: null } }, deptWhere),
            select: { createdAt: true, slaResolvedAt: true },
        });
        let avgResolutionHours = 0;
        if (resolvedTicketsForAvg.length > 0) {
            const totalHours = resolvedTicketsForAvg.reduce((sum, t) => {
                const diffMs = new Date(t.slaResolvedAt).getTime() - new Date(t.createdAt).getTime();
                return sum + diffMs / (1000 * 60 * 60);
            }, 0);
            avgResolutionHours =
                Math.round((totalHours / resolvedTicketsForAvg.length) * 100) / 100;
        }
        const priorityMap = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
        for (const g of ticketsByPriority) {
            priorityMap[g.priority] = g._count.id;
        }
        // ── 4. Preventive Maintenance Compliance ─────────────────
        const [totalSchedules, overdueSchedules, upcomingSchedules] = yield Promise.all([
            prismaClient_1.default.maintenanceSchedule.count({ where: Object.assign({ isActive: true }, deptAssetNestedWhere) }),
            prismaClient_1.default.maintenanceSchedule.count({
                where: Object.assign({ isActive: true, nextDueAt: { lt: now } }, deptAssetNestedWhere),
            }),
            prismaClient_1.default.maintenanceSchedule.count({
                where: Object.assign({ isActive: true, nextDueAt: { gte: now, lte: sevenDaysFromNow } }, deptAssetNestedWhere),
            }),
        ]);
        const pmCompliancePct = totalSchedules > 0
            ? Math.round(((totalSchedules - overdueSchedules) / totalSchedules) * 10000) / 100
            : 100;
        // Top 10 overdue schedules
        const overdueList = yield prismaClient_1.default.maintenanceSchedule.findMany({
            where: Object.assign({ isActive: true, nextDueAt: { lt: now } }, deptAssetNestedWhere),
            include: { asset: { select: { assetName: true, assetId: true } } },
            orderBy: { nextDueAt: "asc" },
            take: 10,
        });
        const overdueListFormatted = overdueList.map((s) => ({
            scheduleId: s.id,
            assetName: s.asset.assetName,
            assetCode: s.asset.assetId,
            frequencyUnit: s.frequencyUnit,
            nextDueAt: s.nextDueAt,
            daysOverdue: Math.floor((now.getTime() - new Date(s.nextDueAt).getTime()) / (1000 * 60 * 60 * 24)),
        }));
        // ── 5. Department Performance (last 30 days) ─────────────
        const deptTickets = yield prismaClient_1.default.ticket.groupBy({
            by: ["departmentId"],
            where: Object.assign({ createdAt: { gte: thirtyDaysAgo } }, deptWhere),
            _count: { id: true },
        });
        const deptResolved = yield prismaClient_1.default.ticket.groupBy({
            by: ["departmentId"],
            where: Object.assign({ status: { in: ["RESOLVED", "CLOSED"] }, updatedAt: { gte: thirtyDaysAgo } }, deptWhere),
            _count: { id: true },
        });
        const deptSlaBreaches = yield prismaClient_1.default.ticket.groupBy({
            by: ["departmentId"],
            where: Object.assign({ slaBreached: true, createdAt: { gte: thirtyDaysAgo } }, deptWhere),
            _count: { id: true },
        });
        // Collect all department IDs
        const allDeptIds = new Set();
        for (const g of [...deptTickets, ...deptResolved, ...deptSlaBreaches]) {
            allDeptIds.add(g.departmentId);
        }
        // Fetch department names
        const departments = yield prismaClient_1.default.department.findMany({
            where: { id: { in: Array.from(allDeptIds) } },
            select: { id: true, name: true },
        });
        const deptNameMap = new Map(departments.map((d) => [d.id, d.name]));
        // Build maps
        const deptTicketMap = new Map(deptTickets.map((g) => [g.departmentId, g._count.id]));
        const deptResolvedMap = new Map(deptResolved.map((g) => [g.departmentId, g._count.id]));
        const deptSlaMap = new Map(deptSlaBreaches.map((g) => [g.departmentId, g._count.id]));
        // Avg resolution per department
        const resolvedByDept = yield prismaClient_1.default.ticket.findMany({
            where: {
                status: { in: ["RESOLVED", "CLOSED"] },
                updatedAt: { gte: thirtyDaysAgo },
                slaResolvedAt: { not: null },
                departmentId: { in: Array.from(allDeptIds) },
            },
            select: { departmentId: true, createdAt: true, slaResolvedAt: true },
        });
        const deptResolutionHours = new Map();
        for (const t of resolvedByDept) {
            const diffHrs = (new Date(t.slaResolvedAt).getTime() - new Date(t.createdAt).getTime()) /
                (1000 * 60 * 60);
            const entry = (_c = deptResolutionHours.get(t.departmentId)) !== null && _c !== void 0 ? _c : { total: 0, count: 0 };
            entry.total += diffHrs;
            entry.count += 1;
            deptResolutionHours.set(t.departmentId, entry);
        }
        const departmentPerformance = Array.from(allDeptIds)
            .map((deptId) => {
            var _a, _b, _c, _d;
            const resEntry = deptResolutionHours.get(deptId);
            return {
                departmentId: deptId,
                departmentName: (_a = deptNameMap.get(deptId)) !== null && _a !== void 0 ? _a : "Unknown",
                ticketCount: (_b = deptTicketMap.get(deptId)) !== null && _b !== void 0 ? _b : 0,
                resolvedCount: (_c = deptResolvedMap.get(deptId)) !== null && _c !== void 0 ? _c : 0,
                avgResolutionHours: resEntry
                    ? Math.round((resEntry.total / resEntry.count) * 100) / 100
                    : 0,
                slaBreaches: (_d = deptSlaMap.get(deptId)) !== null && _d !== void 0 ? _d : 0,
            };
        })
            .sort((a, b) => b.slaBreaches - a.slaBreaches)
            .slice(0, 15);
        // ── 6. Critical Alerts ───────────────────────────────────
        const [assetsNeedingAttention, expiredWarranties, pendingTransfers] = yield Promise.all([
            prismaClient_1.default.asset.count({
                where: Object.assign({ workingCondition: { in: ["NOT_WORKING", "PARTIAL"] } }, deptAssetWhere),
            }),
            prismaClient_1.default.warranty.count({
                where: Object.assign({ warrantyEnd: { lt: now }, isUnderWarranty: true }, (deptFilter ? { asset: { departmentId: deptFilter } } : {})),
            }),
            prismaClient_1.default.assetTransferHistory.count({
                where: Object.assign({ status: { in: ["REQUESTED", "IN_TRANSIT"] } }, (deptFilter ? { asset: { departmentId: deptFilter } } : {})),
            }),
        ]);
        res.json({
            fleetHealth: {
                totalAssets,
                activeAssets,
                inMaintenanceAssets,
                inStoreAssets,
                underObservationAssets,
                retiredAssets,
                disposedAssets,
                scrappedAssets,
                fleetAvailabilityPct,
            },
            financialSummary: {
                totalPurchaseCost,
                totalMaintenanceCost30d,
            },
            ticketOperations: {
                openTickets,
                resolvedTickets30d,
                slaBreachedTickets,
                avgResolutionHours,
                ticketsByPriority: priorityMap,
            },
            pmCompliance: {
                totalSchedules,
                overdueSchedules,
                upcomingSchedules,
                pmCompliancePct,
                overdueList: overdueListFormatted,
            },
            departmentPerformance,
            criticalAlerts: {
                assetsNeedingAttention,
                expiredWarranties,
                pendingTransfers,
            },
            eWaste: yield (() => __awaiter(void 0, void 0, void 0, function* () {
                const [pendingHOD, pendingOps, pendingSec, openOver30, closedThisMonth] = yield Promise.all([
                    prismaClient_1.default.eWasteRecord.count({ where: { status: 'PENDING_HOD' } }),
                    prismaClient_1.default.eWasteRecord.count({ where: { status: 'PENDING_OPERATIONS' } }),
                    prismaClient_1.default.eWasteRecord.count({ where: { status: 'PENDING_SECURITY' } }),
                    prismaClient_1.default.eWasteRecord.count({ where: { status: { not: 'CLOSED' }, createdAt: { lte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
                    prismaClient_1.default.eWasteRecord.count({ where: { status: 'CLOSED', closedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }),
                ]);
                // Avg days to close
                const closedRecords = yield prismaClient_1.default.eWasteRecord.findMany({
                    where: { status: 'CLOSED', closedAt: { not: null } },
                    select: { createdAt: true, closedAt: true },
                });
                const avgDaysToClose = closedRecords.length > 0
                    ? Math.round(closedRecords.reduce((sum, r) => sum + (new Date(r.closedAt).getTime() - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000), 0) / closedRecords.length)
                    : 0;
                return { pendingHOD, pendingOps, pendingSec, totalPending: pendingHOD + pendingOps + pendingSec, openOver30, closedThisMonth, avgDaysToClose };
            }))(),
            legacyAssetCount: yield prismaClient_1.default.asset.count({ where: { isLegacyAsset: true } }),
            dataAvailableSince: yield prismaClient_1.default.asset.findFirst({
                where: { isLegacyAsset: true, dataAvailableSince: { not: null } },
                orderBy: { dataAvailableSince: 'asc' },
                select: { dataAvailableSince: true },
            }).then(r => { var _a; return (_a = r === null || r === void 0 ? void 0 : r.dataAvailableSince) !== null && _a !== void 0 ? _a : null; }),
            // Pool digitization summary for COO operational view
            poolSummary: yield (() => __awaiter(void 0, void 0, void 0, function* () {
                const pools = yield prismaClient_1.default.assetPool.findMany({
                    select: { id: true, originalQuantity: true, status: true },
                    where: deptFilter ? { departmentId: deptFilter } : {},
                });
                let poolGrossBlock = 0, poolNetBlock = 0, notIndividualized = 0;
                for (const pool of pools) {
                    const cnt = yield prismaClient_1.default.asset.count({ where: { assetPoolId: pool.id } });
                    notIndividualized += Math.max(0, pool.originalQuantity - cnt);
                    const s = yield prismaClient_1.default.assetPoolDepreciationSchedule.findFirst({
                        where: { poolId: pool.id }, orderBy: { financialYearEnd: "desc" },
                    });
                    if (s) {
                        const r = pool.originalQuantity > 0 ? Math.max(0, pool.originalQuantity - cnt) / pool.originalQuantity : 0;
                        poolGrossBlock += Number(s.closingGrossBlock) * r;
                        poolNetBlock += Number(s.closingNetBlock) * r;
                    }
                }
                const total = pools.reduce((s, p) => s + p.originalQuantity, 0);
                return {
                    totalPools: pools.length,
                    assetsNotIndividualized: notIndividualized,
                    poolGrossBlock: Math.round(poolGrossBlock),
                    poolNetBlock: Math.round(poolNetBlock),
                    digitizationPct: total > 0 ? Math.round((1 - notIndividualized / total) * 100) : 100,
                };
            }))(),
        });
    }
    catch (err) {
        console.error("getCooDashboard error:", err);
        res.status(500).json({ error: "Failed to load COO dashboard", details: err.message });
    }
});
exports.getCooDashboard = getCooDashboard;
// ═══════════════════════════════════════════════════════════
// 6. GET /in-store-aging — In-Store Asset Aging
// ═══════════════════════════════════════════════════════════
const getInStoreAging = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const deptScope = !["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId) ? Number(user.departmentId) : undefined;
        const assets = yield prismaClient_1.default.asset.findMany({
            where: Object.assign({ OR: [
                    { status: "IN_STORE" },
                    { departmentId: null, allottedToId: null },
                ] }, (deptScope ? { departmentId: deptScope } : {})),
            select: {
                id: true,
                assetId: true,
                assetName: true,
                purchaseCost: true,
                purchaseDate: true,
                grnDate: true,
                status: true,
                currentLocation: true,
                assetCategory: { select: { name: true } },
            },
            orderBy: { purchaseDate: "asc" },
        });
        const nowMs = Date.now();
        const result = assets.map((a) => {
            var _a, _b, _c;
            const referenceDate = (_a = a.grnDate) !== null && _a !== void 0 ? _a : a.purchaseDate;
            const daysInStore = referenceDate
                ? Math.floor((nowMs - new Date(referenceDate).getTime()) / (24 * 60 * 60 * 1000))
                : null;
            return {
                assetId: a.assetId,
                assetName: a.assetName,
                category: a.assetCategory.name,
                purchaseCost: Number((_b = a.purchaseCost) !== null && _b !== void 0 ? _b : 0),
                daysInStore,
                storeLocation: (_c = a.currentLocation) !== null && _c !== void 0 ? _c : null,
            };
        });
        result.sort((a, b) => { var _a, _b; return ((_a = b.daysInStore) !== null && _a !== void 0 ? _a : 0) - ((_b = a.daysInStore) !== null && _b !== void 0 ? _b : 0); });
        res.json(result);
    }
    catch (err) {
        console.error("getInStoreAging error:", err);
        res.status(500).json({ error: "Failed to load in-store aging", details: err.message });
    }
});
exports.getInStoreAging = getInStoreAging;
// ═══════════════════════════════════════════════════════════
// 7. GET /uncovered-assets — Assets with no warranty AND no contract
// ═══════════════════════════════════════════════════════════
const getUncoveredAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const now = new Date();
        // Department scoping for non-admin users
        const assetWhere = {
            status: { notIn: ["DISPOSED", "SCRAPPED"] },
        };
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            assetWhere.departmentId = Number(user.departmentId);
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            select: {
                id: true,
                assetId: true,
                assetName: true,
                purchaseCost: true,
                assetCategoryId: true,
                assetCategory: { select: { name: true } },
                department: { select: { name: true } },
            },
        });
        if (assets.length === 0) {
            res.json({ uncoveredAssets: [], total: 0, totalValue: 0 });
            return;
        }
        // Batch-fetch active warranties and active contracts for all assets
        const assetIds = assets.map((a) => a.id);
        const [activeWarranties, activeContracts, lastMaintenanceDates] = yield Promise.all([
            prismaClient_1.default.warranty.findMany({
                where: {
                    assetId: { in: assetIds },
                    isActive: true,
                    isUnderWarranty: true,
                    warrantyEnd: { gte: now },
                },
                select: { assetId: true },
                distinct: ["assetId"],
            }),
            prismaClient_1.default.serviceContract.findMany({
                where: {
                    assetId: { in: assetIds },
                    status: "ACTIVE",
                },
                select: { assetId: true },
                distinct: ["assetId"],
            }),
            assetIds.length > 0
                ? prismaClient_1.default.$queryRaw `
            SELECT assetId, MAX(createdAt) AS lastDate
            FROM maintenancehistory
            WHERE assetId IN (${client_1.Prisma.join(assetIds)})
            GROUP BY assetId
          `
                : Promise.resolve([]),
        ]);
        const coveredByWarranty = new Set(activeWarranties.map((w) => w.assetId));
        const coveredByContract = new Set(activeContracts.map((c) => c.assetId));
        const lastMaintMap = new Map();
        for (const row of lastMaintenanceDates) {
            lastMaintMap.set(row.assetId, new Date(row.lastDate));
        }
        const nowMs = now.getTime();
        let totalValue = 0;
        const uncoveredAssets = assets
            .filter((a) => !coveredByWarranty.has(a.id) && !coveredByContract.has(a.id))
            .map((a) => {
            var _a, _b, _c, _d;
            const cost = Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0);
            totalValue += cost;
            const lastMaint = (_b = lastMaintMap.get(a.id)) !== null && _b !== void 0 ? _b : null;
            const daysSinceLastService = lastMaint
                ? Math.floor((nowMs - lastMaint.getTime()) / (24 * 60 * 60 * 1000))
                : null;
            return {
                id: a.id,
                assetId: a.assetId,
                assetName: a.assetName,
                category: a.assetCategory.name,
                department: (_d = (_c = a.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null,
                purchaseCost: cost,
                lastMaintenanceDate: lastMaint,
                daysSinceLastService,
            };
        });
        res.json({
            uncoveredAssets,
            total: uncoveredAssets.length,
            totalValue: Math.round(totalValue * 100) / 100,
        });
    }
    catch (err) {
        console.error("getUncoveredAssets error:", err);
        res.status(500).json({ error: "Failed to load uncovered assets", details: err.message });
    }
});
exports.getUncoveredAssets = getUncoveredAssets;
// ═══════════════════════════════════════════════════════════
// 8. GET /maintenance-by-category
//    Maintenance cost breakdown by asset category.
//    Returns categories sorted by total maintenance cost desc,
//    each with their assets sorted by individual cost desc.
// ═══════════════════════════════════════════════════════════
const getMaintenanceByCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        const user = req.user;
        const deptFilter = !["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)
            ? Number(user.departmentId) : undefined;
        const deptAssetWhere = deptFilter ? { departmentId: deptFilter } : {};
        // Step 1: Aggregate ticket (corrective) costs per asset
        const ticketCosts = yield prismaClient_1.default.ticket.groupBy({
            by: ["assetId"],
            where: Object.assign({ assetId: { not: undefined } }, (deptFilter ? { departmentId: deptFilter } : {})),
            _sum: { totalCost: true },
        });
        // Step 2: Aggregate maintenance history (PM) costs per asset
        const mhCosts = yield prismaClient_1.default.maintenanceHistory.groupBy({
            by: ["assetId"],
            where: Object.assign({ assetId: { not: undefined } }, (deptFilter ? { asset: deptAssetWhere } : {})),
            _sum: { totalCost: true },
        });
        // Build cost map: assetDbId → { ticket, pm }
        const costMap = new Map();
        for (const t of ticketCosts) {
            if (!t.assetId)
                continue;
            const cur = (_a = costMap.get(t.assetId)) !== null && _a !== void 0 ? _a : { ticket: 0, pm: 0 };
            cur.ticket += Number((_c = (_b = t._sum) === null || _b === void 0 ? void 0 : _b.totalCost) !== null && _c !== void 0 ? _c : 0);
            costMap.set(t.assetId, cur);
        }
        for (const m of mhCosts) {
            if (!m.assetId)
                continue;
            const cur = (_d = costMap.get(m.assetId)) !== null && _d !== void 0 ? _d : { ticket: 0, pm: 0 };
            cur.pm += Number((_f = (_e = m._sum) === null || _e === void 0 ? void 0 : _e.totalCost) !== null && _f !== void 0 ? _f : 0);
            costMap.set(m.assetId, cur);
        }
        // Step 3: Load all assets with category & department
        const assets = yield prismaClient_1.default.asset.findMany({
            where: deptFilter ? { departmentId: deptFilter } : {},
            select: {
                id: true,
                assetId: true,
                assetName: true,
                status: true,
                purchaseCost: true,
                estimatedValue: true,
                assetCategoryId: true,
                assetCategory: { select: { id: true, name: true } },
                department: { select: { name: true } },
            },
        });
        // Step 4: Group by category
        const catMap = new Map();
        for (const asset of assets) {
            const catId = asset.assetCategoryId;
            if (!catId)
                continue;
            const costs = (_g = costMap.get(asset.id)) !== null && _g !== void 0 ? _g : { ticket: 0, pm: 0 };
            const totalCost = costs.ticket + costs.pm;
            if (!catMap.has(catId)) {
                catMap.set(catId, {
                    categoryId: catId,
                    categoryName: (_j = (_h = asset.assetCategory) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "Uncategorized",
                    assetCount: 0,
                    totalMaintenanceCost: 0,
                    ticketCost: 0,
                    pmCost: 0,
                    assets: [],
                });
            }
            const cat = catMap.get(catId);
            cat.assetCount++;
            cat.totalMaintenanceCost += totalCost;
            cat.ticketCost += costs.ticket;
            cat.pmCost += costs.pm;
            cat.assets.push({
                id: asset.id,
                assetId: asset.assetId,
                assetName: asset.assetName,
                department: (_l = (_k = asset.department) === null || _k === void 0 ? void 0 : _k.name) !== null && _l !== void 0 ? _l : null,
                status: asset.status,
                purchaseCost: Number((_o = (_m = asset.purchaseCost) !== null && _m !== void 0 ? _m : asset.estimatedValue) !== null && _o !== void 0 ? _o : 0),
                ticketCost: Math.round(costs.ticket * 100) / 100,
                pmCost: Math.round(costs.pm * 100) / 100,
                totalMaintenanceCost: Math.round(totalCost * 100) / 100,
            });
        }
        // Step 5: Sort categories and their assets by cost desc
        const result = [...catMap.values()]
            .sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost)
            .map(cat => (Object.assign(Object.assign({}, cat), { totalMaintenanceCost: Math.round(cat.totalMaintenanceCost * 100) / 100, ticketCost: Math.round(cat.ticketCost * 100) / 100, pmCost: Math.round(cat.pmCost * 100) / 100, avgCostPerAsset: cat.assetCount > 0
                ? Math.round((cat.totalMaintenanceCost / cat.assetCount) * 100) / 100
                : 0, assets: cat.assets.sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost) })));
        res.json(result);
    }
    catch (err) {
        console.error("getMaintenanceByCategory error:", err);
        res.status(500).json({ error: "Failed to load maintenance breakdown", details: err.message });
    }
});
exports.getMaintenanceByCategory = getMaintenanceByCategory;
// ═══════════════════════════════════════════════════════════
// 9. GET /asset-value-buckets — Asset count+value by cost range
// ═══════════════════════════════════════════════════════════
const getAssetValueBuckets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const user = req.user;
        const deptFilter = !["ADMIN", "CEO_COO", "FINANCE"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)
            ? { departmentId: Number(user.departmentId) } : {};
        const activeWhere = Object.assign({ status: { notIn: ["DISPOSED", "SCRAPPED", "CONDEMNED"] } }, deptFilter);
        const assets = yield prismaClient_1.default.asset.findMany({
            where: activeWhere,
            select: {
                id: true, assetId: true, assetName: true,
                purchaseCost: true, estimatedValue: true,
                status: true,
                assetCategory: { select: { name: true } },
                department: { select: { name: true } },
                depreciation: { select: { currentBookValue: true } },
            },
        });
        const buckets = [
            { key: 'A', label: 'Below ₹1 Lakh', min: 0, max: 100000, assets: [], count: 0, totalCost: 0, totalBookValue: 0 },
            { key: 'B', label: '₹1L – ₹10L', min: 100000, max: 1000000, assets: [], count: 0, totalCost: 0, totalBookValue: 0 },
            { key: 'C', label: '₹10L – ₹50L', min: 1000000, max: 5000000, assets: [], count: 0, totalCost: 0, totalBookValue: 0 },
            { key: 'D', label: 'Above ₹50 Lakh', min: 5000000, max: Infinity, assets: [], count: 0, totalCost: 0, totalBookValue: 0 },
        ];
        for (const asset of assets) {
            const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
            const bookVal = Number((_d = (_c = asset.depreciation) === null || _c === void 0 ? void 0 : _c.currentBookValue) !== null && _d !== void 0 ? _d : cost);
            const bucket = buckets.find(b => cost >= b.min && cost < b.max);
            if (!bucket)
                continue;
            bucket.count++;
            bucket.totalCost += cost;
            bucket.totalBookValue += bookVal;
            bucket.assets.push({
                id: asset.id,
                assetId: asset.assetId,
                assetName: asset.assetName,
                category: (_f = (_e = asset.assetCategory) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : '—',
                department: (_h = (_g = asset.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : '—',
                status: asset.status,
                purchaseCost: cost,
                bookValue: Math.round(bookVal * 100) / 100,
            });
        }
        // Sort assets within each bucket by cost desc
        for (const b of buckets) {
            b.assets.sort((a, b) => b.purchaseCost - a.purchaseCost);
            b.totalCost = Math.round(b.totalCost * 100) / 100;
            b.totalBookValue = Math.round(b.totalBookValue * 100) / 100;
        }
        res.json({ buckets, totalAssets: assets.length });
    }
    catch (err) {
        console.error("getAssetValueBuckets error:", err);
        res.status(500).json({ error: "Failed to load asset value buckets", details: err.message });
    }
});
exports.getAssetValueBuckets = getAssetValueBuckets;

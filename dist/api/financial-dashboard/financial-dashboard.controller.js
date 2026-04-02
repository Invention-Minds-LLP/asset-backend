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
exports.getMonthBreakdown = exports.getCostTrend = exports.getMonthlyAssets = exports.getFYBreakdown = exports.getFinancialSummary = exports.getFilterOptions = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const financial_dashboard_utils_1 = require("./financial-dashboard.utils");
// ─── 1. Filter Options ─────────────────────────────────────────────────────────
const getFilterOptions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [departments, categories, branches, vendors] = yield Promise.all([
            prismaClient_1.default.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
            prismaClient_1.default.assetCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
            prismaClient_1.default.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
            prismaClient_1.default.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
        ]);
        // Compute available financial years from actual data
        const fyRaw = yield prismaClient_1.default.$queryRaw `
      SELECT DISTINCT YEAR(purchaseDate) as yr, MONTH(purchaseDate) as mo
      FROM asset WHERE purchaseDate IS NOT NULL
    `;
        const fySet = new Set();
        for (const r of fyRaw) {
            fySet.add(Number(r.mo) >= 4 ? Number(r.yr) : Number(r.yr) - 1);
        }
        const financialYears = [...fySet]
            .sort((a, b) => b - a)
            .map((y) => ({ label: (0, financial_dashboard_utils_1.getFYLabel)(y), value: y }));
        res.json({
            departments,
            categories,
            branches,
            vendors,
            financialYears,
            procurementModes: [
                { label: "Purchase", value: "PURCHASE" },
                { label: "Donation", value: "DONATION" },
                { label: "Lease", value: "LEASE" },
                { label: "Rental", value: "RENTAL" },
            ],
            assetStatuses: [
                { label: "Active", value: "ACTIVE" },
                { label: "Retired", value: "RETIRED" },
                { label: "In Maintenance", value: "IN_MAINTENANCE" },
                { label: "Disposed", value: "DISPOSED" },
                { label: "In Transit", value: "IN_TRANSIT" },
            ],
        });
    }
    catch (err) {
        console.error("getFilterOptions error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getFilterOptions = getFilterOptions;
// ─── 2. Financial Summary ───────────────────────────────────────────────────────
const getFinancialSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const assetWhere = (0, financial_dashboard_utils_1.buildAssetWhere)(query, user);
        // Get matching asset IDs for related model queries
        const matchingAssets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            select: { id: true, purchaseCost: true, leaseAmount: true, rentalAmount: true, estimatedValue: true },
        });
        const assetIds = matchingAssets.map((a) => a.id);
        const [maintenanceSum, ticketCostSum, insuranceSum, contractSum, depreciationSum, sparePartUsageSum,] = yield Promise.all([
            prismaClient_1.default.maintenanceHistory.aggregate({
                where: { assetId: { in: assetIds } },
                _sum: { totalCost: true },
            }),
            prismaClient_1.default.ticket.aggregate({
                where: { assetId: { in: assetIds } },
                _sum: { totalCost: true },
            }),
            prismaClient_1.default.assetInsurance.aggregate({
                where: { assetId: { in: assetIds } },
                _sum: { premiumAmount: true },
            }),
            prismaClient_1.default.serviceContract.aggregate({
                where: { assetId: { in: assetIds } },
                _sum: { cost: true },
            }),
            prismaClient_1.default.assetDepreciation.aggregate({
                where: { assetId: { in: assetIds } },
                _sum: { accumulatedDepreciation: true },
            }),
            prismaClient_1.default.sparePartUsage.aggregate({
                where: { assetId: { in: assetIds } },
                _sum: { costAtUse: true },
            }),
        ]);
        // Compute totals
        const totalPurchaseCost = matchingAssets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0);
        const totalLeaseAmount = matchingAssets.reduce((s, a) => s + Number(a.leaseAmount || 0), 0);
        const totalRentalAmount = matchingAssets.reduce((s, a) => s + Number(a.rentalAmount || 0), 0);
        const totalDonationValue = matchingAssets.reduce((s, a) => s + Number(a.estimatedValue || 0), 0);
        const totalMaintenanceCost = Number(maintenanceSum._sum.totalCost || 0) + Number(ticketCostSum._sum.totalCost || 0);
        const totalInsurancePremiums = Number(insuranceSum._sum.premiumAmount || 0);
        const totalAmcCmcCost = Number(contractSum._sum.cost || 0);
        const totalDepreciation = Number(depreciationSum._sum.accumulatedDepreciation || 0);
        const totalSparePartCost = Number(sparePartUsageSum._sum.costAtUse || 0);
        const totalCostOfOwnership = totalPurchaseCost + totalMaintenanceCost + totalInsurancePremiums +
            totalAmcCmcCost + totalSparePartCost + totalLeaseAmount + totalRentalAmount;
        // Breakdowns
        const [costByCategory, costByDepartment, costByProcurement] = yield Promise.all([
            prismaClient_1.default.asset.groupBy({
                by: ["assetCategoryId"],
                where: assetWhere,
                _sum: { purchaseCost: true },
                _count: true,
            }),
            prismaClient_1.default.asset.groupBy({
                by: ["departmentId"],
                where: assetWhere,
                _sum: { purchaseCost: true },
                _count: true,
            }),
            prismaClient_1.default.asset.groupBy({
                by: ["modeOfProcurement"],
                where: assetWhere,
                _sum: { purchaseCost: true, leaseAmount: true, rentalAmount: true, estimatedValue: true },
                _count: true,
            }),
        ]);
        // Resolve names
        const catIds = costByCategory.map((c) => c.assetCategoryId).filter(Boolean);
        const deptIds = costByDepartment.map((d) => d.departmentId).filter(Boolean);
        const [cats, depts] = yield Promise.all([
            prismaClient_1.default.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }),
            prismaClient_1.default.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
        ]);
        const catMap = new Map(cats.map((c) => [c.id, c.name]));
        const deptMap = new Map(depts.map((d) => [d.id, d.name]));
        res.json({
            assetCount: matchingAssets.length,
            totalPurchaseCost,
            totalLeaseAmount,
            totalRentalAmount,
            totalDonationValue,
            totalMaintenanceCost,
            totalInsurancePremiums,
            totalAmcCmcCost,
            totalDepreciation,
            totalSparePartCost,
            totalCostOfOwnership,
            avgCostPerAsset: matchingAssets.length > 0 ? +(totalCostOfOwnership / matchingAssets.length).toFixed(2) : 0,
            costByCategory: costByCategory.map((c) => ({
                category: catMap.get(c.assetCategoryId) || "Unknown",
                total: Number(c._sum.purchaseCost || 0),
                count: c._count,
            })),
            costByDepartment: costByDepartment.map((d) => ({
                department: deptMap.get(d.departmentId) || "Unassigned",
                total: Number(d._sum.purchaseCost || 0),
                count: d._count,
            })),
            costByProcurement: costByProcurement.map((p) => ({
                mode: p.modeOfProcurement,
                total: Number(p._sum.purchaseCost || 0) +
                    Number(p._sum.leaseAmount || 0) +
                    Number(p._sum.rentalAmount || 0) +
                    Number(p._sum.estimatedValue || 0),
                count: p._count,
            })),
        });
    }
    catch (err) {
        console.error("getFinancialSummary error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getFinancialSummary = getFinancialSummary;
// ─── 3. FY Breakdown (Tree Data) ───────────────────────────────────────────────
const getFYBreakdown = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const view = query.view || "purchase";
        const { clause, params } = (0, financial_dashboard_utils_1.buildRawWhereClause)(query, user);
        let rows;
        switch (view) {
            case "purchase":
                rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(a.purchaseCost),0) as total, COUNT(*) as assetCount
           FROM asset a WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`, ...params);
                break;
            case "maintenance":
                rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(mh.totalCost),0) + COALESCE(SUM(t.totalCost),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN maintenancehistory mh ON mh.assetId = a.id
           LEFT JOIN ticket t ON t.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`, ...params);
                break;
            case "insurance":
                rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(ai.premiumAmount),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN assetinsurance ai ON ai.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`, ...params);
                break;
            case "amc_cmc":
                rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(sc.cost),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN servicecontract sc ON sc.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`, ...params);
                break;
            case "depreciation":
                rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(ad.accumulatedDepreciation),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN assetdepreciation ad ON ad.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`, ...params);
                break;
            case "total_cost":
            default:
                rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(a.purchaseCost),0) +
                  COALESCE(SUM(a.leaseAmount),0) +
                  COALESCE(SUM(a.rentalAmount),0) as total,
                  COUNT(*) as assetCount
           FROM asset a
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`, ...params);
                break;
        }
        // Normalize BigInt to Number
        const normalizedRows = rows.map((r) => ({
            yr: Number(r.yr),
            mo: Number(r.mo),
            total: Number(r.total || 0),
            assetCount: Number(r.assetCount || 0),
        }));
        const tree = (0, financial_dashboard_utils_1.buildFYTree)(normalizedRows);
        res.json({ financialYears: tree, view });
    }
    catch (err) {
        console.error("getFYBreakdown error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getFYBreakdown = getFYBreakdown;
// ─── 4. Monthly Assets (Leaf-Level Detail) ──────────────────────────────────────
const getMonthlyAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const year = Number(query.year);
        const month = Number(query.month);
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 25;
        if (!year || !month) {
            res.status(400).json({ message: "year and month are required" });
            return;
        }
        // Build base where from filters + role
        const baseWhere = (0, financial_dashboard_utils_1.buildAssetWhere)(query, user);
        // Override date filter to target specific month
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 1); // first day of next month
        baseWhere.purchaseDate = { gte: startDate, lt: endDate };
        const [total, assets] = yield Promise.all([
            prismaClient_1.default.asset.count({ where: baseWhere }),
            prismaClient_1.default.asset.findMany({
                where: baseWhere,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { purchaseDate: "desc" },
                select: {
                    id: true,
                    assetId: true,
                    assetName: true,
                    purchaseDate: true,
                    purchaseCost: true,
                    leaseAmount: true,
                    rentalAmount: true,
                    estimatedValue: true,
                    modeOfProcurement: true,
                    status: true,
                    assetCategory: { select: { name: true } },
                    department: { select: { name: true } },
                    vendor: { select: { name: true } },
                },
            }),
        ]);
        // Fetch per-asset cost summaries
        const assetIds = assets.map((a) => a.id);
        const [maintenanceCosts, ticketCosts, insuranceCosts, contractCosts, depreciationData] = yield Promise.all([
            prismaClient_1.default.maintenanceHistory.groupBy({
                by: ["assetId"],
                where: { assetId: { in: assetIds } },
                _sum: { totalCost: true },
            }),
            prismaClient_1.default.ticket.groupBy({
                by: ["assetId"],
                where: { assetId: { in: assetIds } },
                _sum: { totalCost: true },
            }),
            prismaClient_1.default.assetInsurance.groupBy({
                by: ["assetId"],
                where: { assetId: { in: assetIds } },
                _sum: { premiumAmount: true },
            }),
            prismaClient_1.default.serviceContract.groupBy({
                by: ["assetId"],
                where: { assetId: { in: assetIds } },
                _sum: { cost: true },
            }),
            prismaClient_1.default.assetDepreciation.findMany({
                where: { assetId: { in: assetIds } },
                select: { assetId: true, accumulatedDepreciation: true, currentBookValue: true },
            }),
        ]);
        // Build lookup maps
        const mCostMap = new Map(maintenanceCosts.map((m) => [m.assetId, Number(m._sum.totalCost || 0)]));
        const tCostMap = new Map(ticketCosts.map((t) => [t.assetId, Number(t._sum.totalCost || 0)]));
        const iCostMap = new Map(insuranceCosts.map((i) => [i.assetId, Number(i._sum.premiumAmount || 0)]));
        const sCostMap = new Map(contractCosts.map((s) => [s.assetId, Number(s._sum.cost || 0)]));
        const dMap = new Map(depreciationData.map((d) => [d.assetId, {
                depreciation: Number(d.accumulatedDepreciation || 0),
                bookValue: Number(d.currentBookValue || 0),
            }]));
        const enriched = assets.map((a) => {
            var _a, _b, _c;
            const purchaseCost = Number(a.purchaseCost || 0);
            const maintenanceCost = (mCostMap.get(a.id) || 0) + (tCostMap.get(a.id) || 0);
            const insurancePremium = iCostMap.get(a.id) || 0;
            const amcCmcCost = sCostMap.get(a.id) || 0;
            const dep = dMap.get(a.id);
            const depreciation = (dep === null || dep === void 0 ? void 0 : dep.depreciation) || 0;
            const bookValue = (dep === null || dep === void 0 ? void 0 : dep.bookValue) || 0;
            return {
                id: a.id,
                assetId: a.assetId,
                assetName: a.assetName,
                category: ((_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) || "",
                department: ((_b = a.department) === null || _b === void 0 ? void 0 : _b.name) || "",
                vendor: ((_c = a.vendor) === null || _c === void 0 ? void 0 : _c.name) || "",
                purchaseDate: a.purchaseDate,
                modeOfProcurement: a.modeOfProcurement,
                status: a.status,
                purchaseCost,
                leaseAmount: Number(a.leaseAmount || 0),
                rentalAmount: Number(a.rentalAmount || 0),
                maintenanceCost,
                insurancePremium,
                amcCmcCost,
                depreciation,
                bookValue,
                totalCost: purchaseCost + maintenanceCost + insurancePremium + amcCmcCost,
            };
        });
        res.json({
            assets: enriched,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    }
    catch (err) {
        console.error("getMonthlyAssets error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getMonthlyAssets = getMonthlyAssets;
// ─── 5. Cost Trend (for charts) ─────────────────────────────────────────────────
const getCostTrend = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const { clause, params } = (0, financial_dashboard_utils_1.buildRawWhereClause)(query, user);
        // Multi-view: purchase + maintenance + insurance + AMC in one pass
        const rows = yield prismaClient_1.default.$queryRawUnsafe(`SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
              COALESCE(SUM(a.purchaseCost),0) as purchaseTotal,
              COUNT(*) as assetCount
       FROM asset a WHERE ${clause}
       GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
       ORDER BY yr, mo`, ...params);
        res.json({
            trend: rows.map((r) => ({
                year: Number(r.yr),
                month: Number(r.mo),
                purchaseTotal: Number(r.purchaseTotal || 0),
                assetCount: Number(r.assetCount || 0),
            })),
        });
    }
    catch (err) {
        console.error("getCostTrend error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getCostTrend = getCostTrend;
// ─── 6. Month Drill-Down: category-wise + department-wise breakdown ────────────
// GET /api/financial-dashboard/month-breakdown?year=2025&month=11
const getMonthBreakdown = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const year = Number(req.query.year);
        const month = Number(req.query.month); // 1-12
        if (!year || !month || month < 1 || month > 12) {
            res.status(400).json({ message: "year and month (1-12) required" });
            return;
        }
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 1);
        // Category-wise cost
        const categoryRaw = yield prismaClient_1.default.$queryRaw `
      SELECT
        ac.name            AS categoryName,
        COUNT(a.id)        AS assetCount,
        COALESCE(SUM(a.purchaseCost), 0) AS totalCost
      FROM asset a
      LEFT JOIN assetcategory ac ON ac.id = a.assetCategoryId
      WHERE a.purchaseDate >= ${start} AND a.purchaseDate < ${end}
      GROUP BY ac.id, ac.name
      ORDER BY totalCost DESC
    `;
        // Department-wise cost
        const deptRaw = yield prismaClient_1.default.$queryRaw `
      SELECT
        d.name             AS departmentName,
        COUNT(a.id)        AS assetCount,
        COALESCE(SUM(a.purchaseCost), 0) AS totalCost
      FROM asset a
      LEFT JOIN department d ON d.id = a.departmentId
      WHERE a.purchaseDate >= ${start} AND a.purchaseDate < ${end}
      GROUP BY d.id, d.name
      ORDER BY totalCost DESC
    `;
        const totalCost = categoryRaw.reduce((s, r) => s + Number(r.totalCost), 0);
        const totalCount = categoryRaw.reduce((s, r) => s + Number(r.assetCount), 0);
        res.json({
            year,
            month,
            totalCost,
            totalAssets: totalCount,
            byCategory: categoryRaw.map((r) => ({
                category: r.categoryName || "Uncategorized",
                assetCount: Number(r.assetCount),
                totalCost: Number(r.totalCost),
            })),
            byDepartment: deptRaw.map((r) => ({
                department: r.departmentName || "Unassigned",
                assetCount: Number(r.assetCount),
                totalCost: Number(r.totalCost),
            })),
        });
    }
    catch (err) {
        console.error("getMonthBreakdown error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getMonthBreakdown = getMonthBreakdown;

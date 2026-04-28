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
exports.getExpiryAlerts = exports.getAssetLifecycleSummary = exports.getLookupData = exports.getDashboardStats = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Dashboard Stats ───────────────────────────────────────────────────────────
const getDashboardStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        const role = user === null || user === void 0 ? void 0 : user.role;
        const departmentId = user === null || user === void 0 ? void 0 : user.departmentId;
        const employeeDbId = (user === null || user === void 0 ? void 0 : user.employeeDbId) || (user === null || user === void 0 ? void 0 : user.employeeId) || (user === null || user === void 0 ? void 0 : user.id);
        let assetWhere = {};
        let ticketWhere = {};
        if (role === "HOD") {
            assetWhere = { departmentId: Number(departmentId) };
            ticketWhere = { departmentId: Number(departmentId) };
        }
        else if (role === "SUPERVISOR") {
            assetWhere = { supervisorId: Number(employeeDbId) };
        }
        // Get asset IDs for department-scoped queries on related models
        let scopedAssetIds = null; // null = no filter (ADMIN sees all)
        if (Object.keys(assetWhere).length > 0) {
            const scopedAssets = yield prismaClient_1.default.asset.findMany({
                where: assetWhere,
                select: { id: true },
            });
            scopedAssetIds = scopedAssets.map(a => a.id);
        }
        // Build where clauses for related models (scoped by department's assets)
        const warrantyWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
        const contractWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
        const calibrationWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
        const pmWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
        const [totalAssets, activeAssets, inStoreAssets, inMaintenanceAssets, retiredAssets, disposedAssets, openTickets, inProgressTickets, resolvedTickets, pendingAssignments, expiredWarranties, expiredContracts, activeContracts, dueCalibrations, duePMSchedules, totalVendors, totalEmployees, totalDepartments, slaBreachedTickets, legacyAssetCount,] = yield Promise.all([
            prismaClient_1.default.asset.count({ where: assetWhere }),
            prismaClient_1.default.asset.count({ where: Object.assign(Object.assign({}, assetWhere), { status: "ACTIVE" }) }),
            prismaClient_1.default.asset.count({ where: Object.assign(Object.assign({}, assetWhere), { status: "IN_STORE" }) }),
            prismaClient_1.default.asset.count({ where: Object.assign(Object.assign({}, assetWhere), { status: "IN_MAINTENANCE" }) }),
            prismaClient_1.default.asset.count({ where: Object.assign(Object.assign({}, assetWhere), { status: "RETIRED" }) }),
            prismaClient_1.default.asset.count({ where: Object.assign(Object.assign({}, assetWhere), { status: { in: ["DISPOSED", "SCRAPPED"] } }) }),
            prismaClient_1.default.ticket.count({ where: Object.assign(Object.assign({}, ticketWhere), { status: "OPEN" }) }),
            prismaClient_1.default.ticket.count({ where: Object.assign(Object.assign({}, ticketWhere), { status: "IN_PROGRESS" }) }),
            prismaClient_1.default.ticket.count({ where: Object.assign(Object.assign({}, ticketWhere), { status: "RESOLVED" }) }),
            scopedAssetIds
                ? prismaClient_1.default.assetAssignment.count({ where: { status: "PENDING", isActive: true, asset: { id: { in: scopedAssetIds } } } })
                : prismaClient_1.default.assetAssignment.count({ where: { status: "PENDING", isActive: true } }),
            prismaClient_1.default.warranty.count({ where: Object.assign(Object.assign({}, warrantyWhere), { isUnderWarranty: false, isActive: true }) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign(Object.assign({}, contractWhere), { status: "EXPIRED" }) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign(Object.assign({}, contractWhere), { status: "ACTIVE" }) }),
            prismaClient_1.default.calibrationSchedule.count({ where: Object.assign(Object.assign({}, calibrationWhere), { nextDueAt: { lte: new Date() }, isActive: true }) }),
            prismaClient_1.default.maintenanceSchedule.count({ where: Object.assign(Object.assign({}, pmWhere), { nextDueAt: { lte: new Date() }, isActive: true }) }),
            prismaClient_1.default.vendor.count(),
            prismaClient_1.default.employee.count(),
            prismaClient_1.default.department.count(),
            prismaClient_1.default.ticket.count({ where: Object.assign(Object.assign({}, ticketWhere), { slaBreached: true, status: { notIn: ["CLOSED", "RESOLVED"] } }) }),
            prismaClient_1.default.asset.count({ where: Object.assign(Object.assign({}, assetWhere), { isLegacyAsset: true }) }),
        ]);
        // Earliest dataAvailableSince across all legacy assets (for dashboard banner)
        const earliestLegacy = legacyAssetCount > 0
            ? yield prismaClient_1.default.asset.findFirst({
                where: Object.assign(Object.assign({}, assetWhere), { isLegacyAsset: true, dataAvailableSince: { not: null } }),
                orderBy: { dataAvailableSince: 'asc' },
                select: { dataAvailableSince: true },
            })
            : null;
        // Pool summary — undigitized asset balances from FA register
        const allPools = yield prismaClient_1.default.assetPool.findMany({
            select: { id: true, originalQuantity: true, totalPoolCost: true, status: true },
        });
        let poolTotalGrossBlock = 0, poolTotalNetBlock = 0, totalUndigitizedAssets = 0;
        let totalPools = allPools.length, completePools = 0, partialPools = 0, pendingPools = 0;
        for (const pool of allPools) {
            if (pool.status === "COMPLETE")
                completePools++;
            else if (pool.status === "PARTIAL")
                partialPools++;
            else
                pendingPools++;
            const linkedCount = yield prismaClient_1.default.asset.count({ where: { assetPoolId: pool.id } });
            totalUndigitizedAssets += Math.max(0, pool.originalQuantity - linkedCount);
            const latestSched = yield prismaClient_1.default.assetPoolDepreciationSchedule.findFirst({
                where: { poolId: pool.id }, orderBy: { financialYearEnd: "desc" },
            });
            if (latestSched) {
                const remainingRatio = pool.originalQuantity > 0
                    ? Math.max(0, pool.originalQuantity - linkedCount) / pool.originalQuantity : 0;
                poolTotalGrossBlock += Number(latestSched.closingGrossBlock) * remainingRatio;
                poolTotalNetBlock += Number(latestSched.closingNetBlock) * remainingRatio;
            }
        }
        // E-Waste summary
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const [eWastePendingHOD, eWastePendingOps, eWastePendingSec, eWasteClosedThisMonth, eWasteOpenOver30Days] = yield Promise.all([
            prismaClient_1.default.eWasteRecord.count({ where: { status: 'PENDING_HOD' } }),
            prismaClient_1.default.eWasteRecord.count({ where: { status: 'PENDING_OPERATIONS' } }),
            prismaClient_1.default.eWasteRecord.count({ where: { status: 'PENDING_SECURITY' } }),
            prismaClient_1.default.eWasteRecord.count({ where: { status: 'CLOSED', closedAt: { gte: startOfMonth } } }),
            prismaClient_1.default.eWasteRecord.count({ where: { status: { not: 'CLOSED' }, createdAt: { lte: thirtyDaysAgo } } }),
        ]);
        // Ticket status breakdown
        const ticketStatusBreakdown = yield prismaClient_1.default.ticket.groupBy({
            by: ["status"],
            _count: { id: true },
            where: ticketWhere,
        });
        // Asset category breakdown
        const assetCategoryBreakdown = yield prismaClient_1.default.asset.groupBy({
            by: ["assetCategoryId"],
            _count: { id: true },
            where: assetWhere,
        });
        const categoryIds = assetCategoryBreakdown.map((c) => c.assetCategoryId).filter(Boolean);
        const categories = yield prismaClient_1.default.assetCategory.findMany({ where: { id: { in: categoryIds } } });
        const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
        const assetsByCategory = assetCategoryBreakdown.map((row) => {
            var _a;
            return ({
                category: (_a = categoryMap[row.assetCategoryId]) !== null && _a !== void 0 ? _a : "Unknown",
                count: row._count.id,
            });
        });
        // Recent tickets (configurable limit)
        const recentLimit = Math.min(Number(req.query.recentLimit) || 5, 25);
        const recentTickets = yield prismaClient_1.default.ticket.findMany({
            where: ticketWhere,
            orderBy: { createdAt: "desc" },
            take: recentLimit,
            include: { asset: { select: { assetName: true, assetId: true } }, department: { select: { name: true } } },
        });
        // Recent assets (configurable limit)
        const recentAssets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            orderBy: { createdAt: "desc" },
            take: recentLimit,
            include: { assetCategory: { select: { name: true } }, department: { select: { name: true } } },
        });
        res.json({
            summary: {
                totalAssets,
                activeAssets,
                inStoreAssets,
                inMaintenanceAssets,
                retiredAssets,
                disposedAssets,
                openTickets,
                inProgressTickets,
                resolvedTickets,
                pendingAssignments,
                expiredWarranties,
                expiredContracts,
                activeContracts,
                dueCalibrations,
                duePMSchedules,
                totalVendors,
                totalEmployees,
                totalDepartments,
                slaBreachedTickets,
                legacyAssetCount,
                dataAvailableSince: (_a = earliestLegacy === null || earliestLegacy === void 0 ? void 0 : earliestLegacy.dataAvailableSince) !== null && _a !== void 0 ? _a : null,
                eWaste: {
                    pendingHOD: eWastePendingHOD,
                    pendingOps: eWastePendingOps,
                    pendingSecurity: eWastePendingSec,
                    totalPending: eWastePendingHOD + eWastePendingOps + eWastePendingSec,
                    closedThisMonth: eWasteClosedThisMonth,
                    openOver30Days: eWasteOpenOver30Days,
                },
                // Pool digitization summary
                poolSummary: {
                    totalPools, completePools, partialPools, pendingPools,
                    totalUndigitizedAssets,
                    poolTotalGrossBlock: Math.round(poolTotalGrossBlock),
                    poolTotalNetBlock: Math.round(poolTotalNetBlock),
                    digitizationPct: totalUndigitizedAssets > 0 || allPools.reduce((s, p) => s + p.originalQuantity, 0) > 0
                        ? Math.round((1 - totalUndigitizedAssets / Math.max(1, allPools.reduce((s, p) => s + p.originalQuantity, 0))) * 100)
                        : 100,
                },
            },
            ticketStatusBreakdown: ticketStatusBreakdown.map((t) => ({
                status: t.status,
                count: t._count.id,
            })),
            assetsByCategory,
            recentTickets,
            recentAssets,
        });
    }
    catch (error) {
        console.error("getDashboardStats error:", error);
        res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
});
exports.getDashboardStats = getDashboardStats;
// ─── Lookup (master data for dropdowns) ───────────────────────────────────────
const getLookupData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [categories, departments, employees, vendors, branches,] = yield Promise.all([
            prismaClient_1.default.assetCategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
            prismaClient_1.default.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
            prismaClient_1.default.employee.findMany({
                select: { id: true, name: true, employeeID: true, role: true, departmentId: true, department: { select: { name: true } } },
                orderBy: { name: "asc" },
            }),
            prismaClient_1.default.vendor.findMany({ select: { id: true, name: true, contact: true, email: true }, orderBy: { name: "asc" } }),
            prismaClient_1.default.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        ]);
        res.json({ categories, departments, employees, vendors, branches });
    }
    catch (error) {
        console.error("getLookupData error:", error);
        res.status(500).json({ message: "Failed to fetch lookup data" });
    }
});
exports.getLookupData = getLookupData;
// ─── Asset Lifecycle Summary ───────────────────────────────────────────────────
const getAssetLifecycleSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId } = req.params;
        const id = parseInt(assetId);
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id },
            include: {
                assetCategory: true,
                department: true,
                vendor: true,
                allottedTo: true,
                supervisor: true,
                warranties: { where: { isActive: true } },
                insurance: { where: { isActive: true } },
                serviceContracts: { where: { status: "ACTIVE" } },
                depreciation: true,
                tickets: { orderBy: { createdAt: "desc" }, take: 5 },
                maintenanceHistory: { orderBy: { createdAt: "desc" }, take: 5 },
                calibrationHistory: { orderBy: { calibratedAt: "desc" }, take: 3 },
                calibrationSchedules: { where: { isActive: true } },
                maintenanceSchedules: { where: { isActive: true } },
                assignments: { where: { isActive: true }, include: { assignedTo: true } },
                transfers: { orderBy: { createdAt: "desc" }, take: 5 },
                locations: { where: { isActive: true }, include: { branch: true } },
                specifications: true,
                subAssets: { select: { id: true, assetId: true, assetName: true, status: true } },
                gatePasses: { orderBy: { createdAt: "desc" }, take: 5 },
            },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        res.json(asset);
    }
    catch (error) {
        console.error("getAssetLifecycleSummary error:", error);
        res.status(500).json({ message: "Failed to fetch asset lifecycle summary" });
    }
});
exports.getAssetLifecycleSummary = getAssetLifecycleSummary;
// ─── Expiry Alerts ─────────────────────────────────────────────────────────────
const getExpiryAlerts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const daysAhead = parseInt(req.query.days || "30");
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + daysAhead);
        const [expiringWarranties, expiringInsurance, expiringContracts, dueCalibrations, dueMaintenances] = yield Promise.all([
            prismaClient_1.default.warranty.findMany({
                where: { warrantyEnd: { lte: cutoffDate }, isActive: true },
                include: { asset: { select: { assetId: true, assetName: true } } },
                orderBy: { warrantyEnd: "asc" },
            }),
            prismaClient_1.default.assetInsurance.findMany({
                where: { endDate: { lte: cutoffDate }, isActive: true },
                include: { asset: { select: { assetId: true, assetName: true } } },
                orderBy: { endDate: "asc" },
            }),
            prismaClient_1.default.serviceContract.findMany({
                where: { endDate: { lte: cutoffDate }, status: "ACTIVE" },
                include: { asset: { select: { assetId: true, assetName: true } } },
                orderBy: { endDate: "asc" },
            }),
            prismaClient_1.default.calibrationSchedule.findMany({
                where: { nextDueAt: { lte: cutoffDate }, isActive: true },
                include: { asset: { select: { assetId: true, assetName: true } } },
                orderBy: { nextDueAt: "asc" },
            }),
            prismaClient_1.default.maintenanceSchedule.findMany({
                where: { nextDueAt: { lte: cutoffDate }, isActive: true },
                include: { asset: { select: { assetId: true, assetName: true } } },
                orderBy: { nextDueAt: "asc" },
            }),
        ]);
        res.json({
            expiringWarranties,
            expiringInsurance,
            expiringContracts,
            dueCalibrations,
            dueMaintenances,
            summary: {
                expiringWarranties: expiringWarranties.length,
                expiringInsurance: expiringInsurance.length,
                expiringContracts: expiringContracts.length,
                dueCalibrations: dueCalibrations.length,
                dueMaintenances: dueMaintenances.length,
            },
        });
    }
    catch (error) {
        console.error("getExpiryAlerts error:", error);
        res.status(500).json({ message: "Failed to fetch expiry alerts" });
    }
});
exports.getExpiryAlerts = getExpiryAlerts;

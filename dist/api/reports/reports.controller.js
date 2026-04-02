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
exports.getInventoryStockReport = exports.getDepreciationReport = exports.getExpiryReport = exports.getTicketAnalyticsReport = exports.getMaintenanceCostReport = exports.getAssetRegisterReport = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const xlsx_1 = __importDefault(require("xlsx"));
// ─── Role-based Filter Helper ───────────────────────────────────────────────
function buildRoleFilter(user) {
    const role = user === null || user === void 0 ? void 0 : user.role;
    const departmentId = user === null || user === void 0 ? void 0 : user.departmentId;
    const employeeDbId = (user === null || user === void 0 ? void 0 : user.employeeDbId) || (user === null || user === void 0 ? void 0 : user.employeeId) || (user === null || user === void 0 ? void 0 : user.id);
    if (role === "HOD")
        return { departmentId: Number(departmentId) };
    if (role === "SUPERVISOR")
        return { supervisorId: Number(employeeDbId) };
    return {}; // ADMIN and others see everything
}
// ─── Export Helpers ──────────────────────────────────────────────────────────
function sendCsv(res, rows, filename) {
    if (rows.length === 0) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
        res.send("");
        return;
    }
    const headers = Object.keys(rows[0]).join(",");
    const csvRows = rows.map((r) => Object.values(r)
        .map((v) => {
        const str = String(v !== null && v !== void 0 ? v : "").replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
    })
        .join(","));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
    res.send(headers + "\n" + csvRows.join("\n"));
}
function sendExcel(res, rows, filename, sheetName = "Report") {
    const wb = xlsx_1.default.utils.book_new();
    const ws = xlsx_1.default.utils.json_to_sheet(rows);
    xlsx_1.default.utils.book_append_sheet(wb, ws, sheetName);
    const buffer = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}.xlsx`);
    res.send(buffer);
}
function formatDate(d) {
    if (!d)
        return "";
    return new Date(d).toISOString().split("T")[0];
}
// ─── 1. Asset Register Report ───────────────────────────────────────────────
const getAssetRegisterReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const exportFormat = query.export; // "csv" | "excel"
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 25;
        const where = Object.assign({}, buildRoleFilter(user));
        if (query.departmentId)
            where.departmentId = Number(query.departmentId);
        if (query.categoryId)
            where.assetCategoryId = Number(query.categoryId);
        if (query.vendorId)
            where.vendorId = Number(query.vendorId);
        if (query.status)
            where.status = query.status;
        if (query.modeOfProcurement)
            where.modeOfProcurement = query.modeOfProcurement;
        if (query.search) {
            where.OR = [
                { assetId: { contains: String(query.search) } },
                { assetName: { contains: String(query.search) } },
                { serialNumber: { contains: String(query.search) } },
            ];
        }
        if (query.dateFrom || query.dateTo) {
            where.purchaseDate = {};
            if (query.dateFrom)
                where.purchaseDate.gte = new Date(query.dateFrom);
            if (query.dateTo)
                where.purchaseDate.lte = new Date(query.dateTo);
        }
        const [total, assets] = yield Promise.all([
            prismaClient_1.default.asset.count({ where }),
            prismaClient_1.default.asset.findMany(Object.assign(Object.assign({ where }, (!exportFormat ? { skip: (page - 1) * limit, take: limit } : {})), { orderBy: { purchaseDate: "desc" }, select: {
                    id: true, assetId: true, assetName: true, serialNumber: true,
                    purchaseDate: true, purchaseCost: true, modeOfProcurement: true,
                    status: true, manufacturer: true, modelNumber: true,
                    currentLocation: true, physicalCondition: true, warrantyStatus: true,
                    assetCategory: { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                    vendor: { select: { id: true, name: true } },
                } })),
        ]);
        // Fetch warranty status
        const assetIds = assets.map((a) => a.id);
        const warranties = yield prismaClient_1.default.warranty.findMany({
            where: { assetId: { in: assetIds }, isActive: true },
            select: { assetId: true, warrantyEnd: true, isUnderWarranty: true },
        });
        const warrantyMap = new Map(warranties.map((w) => [w.assetId, w]));
        const data = assets.map((a) => {
            var _a, _b, _c, _d;
            const warranty = warrantyMap.get(a.id);
            return {
                assetId: a.assetId,
                assetName: a.assetName,
                serialNumber: a.serialNumber,
                category: ((_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) || "N/A",
                department: ((_b = a.department) === null || _b === void 0 ? void 0 : _b.name) || "N/A",
                vendor: ((_c = a.vendor) === null || _c === void 0 ? void 0 : _c.name) || "N/A",
                manufacturer: a.manufacturer || "",
                modelNumber: a.modelNumber || "",
                purchaseDate: a.purchaseDate,
                purchaseCost: Number(a.purchaseCost || 0),
                modeOfProcurement: a.modeOfProcurement,
                status: a.status,
                location: a.currentLocation || "",
                physicalCondition: a.physicalCondition || "",
                warrantyEnd: (warranty === null || warranty === void 0 ? void 0 : warranty.warrantyEnd) || null,
                isUnderWarranty: (_d = warranty === null || warranty === void 0 ? void 0 : warranty.isUnderWarranty) !== null && _d !== void 0 ? _d : false,
            };
        });
        // Export
        if (exportFormat === "csv" || exportFormat === "excel") {
            const exportRows = data.map((d) => ({
                "Asset ID": d.assetId,
                "Asset Name": d.assetName,
                "Serial Number": d.serialNumber,
                "Category": d.category,
                "Department": d.department,
                "Vendor": d.vendor,
                "Manufacturer": d.manufacturer,
                "Model Number": d.modelNumber,
                "Purchase Date": formatDate(d.purchaseDate),
                "Purchase Cost": d.purchaseCost,
                "Mode of Procurement": d.modeOfProcurement,
                "Status": d.status,
                "Location": d.location,
                "Physical Condition": d.physicalCondition,
                "Warranty End": formatDate(d.warrantyEnd),
                "Under Warranty": d.isUnderWarranty ? "Yes" : "No",
            }));
            if (exportFormat === "csv")
                return sendCsv(res, exportRows, "asset-register-report");
            return sendExcel(res, exportRows, "asset-register-report", "Asset Register");
        }
        res.json({
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    }
    catch (err) {
        console.error("getAssetRegisterReport error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getAssetRegisterReport = getAssetRegisterReport;
// ─── 2. Maintenance Cost Report ─────────────────────────────────────────────
const getMaintenanceCostReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const exportFormat = query.export;
        const assetWhere = Object.assign({}, buildRoleFilter(user));
        if (query.departmentId)
            assetWhere.departmentId = Number(query.departmentId);
        if (query.vendorId)
            assetWhere.vendorId = Number(query.vendorId);
        if (query.assetId)
            assetWhere.id = Number(query.assetId);
        const matchingAssets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            select: {
                id: true, assetId: true, assetName: true,
                department: { select: { name: true } },
                vendor: { select: { name: true } },
            },
        });
        const assetIds = matchingAssets.map((a) => a.id);
        const dateFilter = {};
        if (query.dateFrom)
            dateFilter.gte = new Date(query.dateFrom);
        if (query.dateTo)
            dateFilter.lte = new Date(query.dateTo);
        const maintenanceWhere = { assetId: { in: assetIds } };
        if (query.dateFrom || query.dateTo)
            maintenanceWhere.actualDoneAt = dateFilter;
        const ticketWhere = { assetId: { in: assetIds } };
        if (query.dateFrom || query.dateTo)
            ticketWhere.createdAt = dateFilter;
        const [maintenanceByAsset, maintenanceByType, ticketCostByAsset] = yield Promise.all([
            prismaClient_1.default.maintenanceHistory.groupBy({
                by: ["assetId"], where: maintenanceWhere,
                _sum: { totalCost: true, serviceCost: true, partsCost: true }, _count: true,
            }),
            prismaClient_1.default.maintenanceHistory.groupBy({
                by: ["assetId", "serviceType"], where: maintenanceWhere,
                _sum: { totalCost: true }, _count: true,
            }),
            prismaClient_1.default.ticket.groupBy({
                by: ["assetId"], where: ticketWhere,
                _sum: { totalCost: true }, _count: true,
            }),
        ]);
        const maintenanceCostMap = new Map(maintenanceByAsset.map((m) => [m.assetId, {
                total: Number(m._sum.totalCost || 0),
                serviceCost: Number(m._sum.serviceCost || 0),
                partsCost: Number(m._sum.partsCost || 0),
                count: m._count,
            }]));
        const ticketCostMap = new Map(ticketCostByAsset.map((t) => [t.assetId, { total: Number(t._sum.totalCost || 0), count: t._count }]));
        const typeBreakdownMap = new Map();
        for (const row of maintenanceByType) {
            if (!typeBreakdownMap.has(row.assetId))
                typeBreakdownMap.set(row.assetId, []);
            typeBreakdownMap.get(row.assetId).push({
                serviceType: row.serviceType || "Unknown", total: Number(row._sum.totalCost || 0), count: row._count,
            });
        }
        const assetMap = new Map(matchingAssets.map((a) => [a.id, a]));
        const data = assetIds
            .filter((id) => maintenanceCostMap.has(id) || ticketCostMap.has(id))
            .map((id) => {
            var _a, _b;
            const asset = assetMap.get(id);
            const maintenance = maintenanceCostMap.get(id) || { total: 0, serviceCost: 0, partsCost: 0, count: 0 };
            const tickets = ticketCostMap.get(id) || { total: 0, count: 0 };
            return {
                assetId: asset.assetId,
                assetName: asset.assetName,
                department: ((_a = asset.department) === null || _a === void 0 ? void 0 : _a.name) || "N/A",
                vendor: ((_b = asset.vendor) === null || _b === void 0 ? void 0 : _b.name) || "N/A",
                maintenanceCost: maintenance.total,
                maintenanceServiceCost: maintenance.serviceCost,
                maintenancePartsCost: maintenance.partsCost,
                maintenanceCount: maintenance.count,
                ticketCost: tickets.total,
                ticketCount: tickets.count,
                totalCost: maintenance.total + tickets.total,
                serviceTypeBreakdown: typeBreakdownMap.get(id) || [],
            };
        })
            .sort((a, b) => b.totalCost - a.totalCost);
        const grandTotal = data.reduce((sum, d) => sum + d.totalCost, 0);
        if (exportFormat === "csv" || exportFormat === "excel") {
            const exportRows = data.map((d) => ({
                "Asset ID": d.assetId,
                "Asset Name": d.assetName,
                "Department": d.department,
                "Vendor": d.vendor,
                "Maintenance Service Cost": d.maintenanceServiceCost,
                "Maintenance Parts Cost": d.maintenancePartsCost,
                "Total Maintenance Cost": d.maintenanceCost,
                "Maintenance Count": d.maintenanceCount,
                "Ticket Repair Cost": d.ticketCost,
                "Ticket Count": d.ticketCount,
                "Grand Total Cost": d.totalCost,
            }));
            if (exportFormat === "csv")
                return sendCsv(res, exportRows, "maintenance-cost-report");
            return sendExcel(res, exportRows, "maintenance-cost-report", "Maintenance Cost");
        }
        res.json({
            data,
            summary: { totalAssets: data.length, grandTotalCost: grandTotal },
        });
    }
    catch (err) {
        console.error("getMaintenanceCostReport error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getMaintenanceCostReport = getMaintenanceCostReport;
// ─── 3. Ticket Analytics Report ─────────────────────────────────────────────
const getTicketAnalyticsReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const exportFormat = query.export;
        const ticketWhere = {};
        const role = user === null || user === void 0 ? void 0 : user.role;
        if (role === "HOD" && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            ticketWhere.departmentId = Number(user.departmentId);
        }
        else if (role === "SUPERVISOR") {
            const employeeDbId = (user === null || user === void 0 ? void 0 : user.employeeDbId) || (user === null || user === void 0 ? void 0 : user.employeeId) || (user === null || user === void 0 ? void 0 : user.id);
            ticketWhere.asset = { supervisorId: Number(employeeDbId) };
        }
        if (query.departmentId)
            ticketWhere.departmentId = Number(query.departmentId);
        if (query.priority)
            ticketWhere.priority = query.priority;
        if (query.dateFrom || query.dateTo) {
            ticketWhere.createdAt = {};
            if (query.dateFrom)
                ticketWhere.createdAt.gte = new Date(query.dateFrom);
            if (query.dateTo)
                ticketWhere.createdAt.lte = new Date(query.dateTo);
        }
        const [countByStatus, countByPriority, countByServiceType] = yield Promise.all([
            prismaClient_1.default.ticket.groupBy({ by: ["status"], where: ticketWhere, _count: true }),
            prismaClient_1.default.ticket.groupBy({ by: ["priority"], where: ticketWhere, _count: true }),
            prismaClient_1.default.ticket.groupBy({ by: ["serviceType"], where: ticketWhere, _count: true }),
        ]);
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where: ticketWhere,
            select: {
                id: true, ticketId: true, status: true, priority: true, issueType: true,
                slaBreached: true, downtimeStart: true, downtimeEnd: true,
                rootCause: true, resolutionSummary: true, customerSatisfaction: true,
                serviceType: true, totalCost: true,
                createdAt: true, slaResolvedAt: true,
                asset: { select: { assetId: true, assetName: true } },
                department: { select: { name: true } },
                assignedTo: { select: { name: true } },
            },
        });
        const totalTickets = tickets.length;
        const resolvedTickets = tickets.filter((t) => t.downtimeStart && t.downtimeEnd);
        let avgResolutionTimeHours = 0;
        if (resolvedTickets.length > 0) {
            const totalHours = resolvedTickets.reduce((sum, t) => {
                return sum + (new Date(t.downtimeEnd).getTime() - new Date(t.downtimeStart).getTime()) / (1000 * 60 * 60);
            }, 0);
            avgResolutionTimeHours = +(totalHours / resolvedTickets.length).toFixed(2);
        }
        const slaBreachCount = tickets.filter((t) => t.slaBreached === true).length;
        const satisfactionTickets = tickets.filter((t) => t.customerSatisfaction != null);
        let avgCustomerSatisfaction = 0;
        if (satisfactionTickets.length > 0) {
            avgCustomerSatisfaction = +(satisfactionTickets.reduce((sum, t) => sum + Number(t.customerSatisfaction || 0), 0) / satisfactionTickets.length).toFixed(2);
        }
        const rootCauseCounts = new Map();
        for (const t of tickets) {
            if (t.rootCause) {
                const cause = t.rootCause.trim();
                rootCauseCounts.set(cause, (rootCauseCounts.get(cause) || 0) + 1);
            }
        }
        const topRootCauses = [...rootCauseCounts.entries()]
            .sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([cause, count]) => ({ cause, count }));
        // Export - detailed ticket list
        if (exportFormat === "csv" || exportFormat === "excel") {
            const exportRows = tickets.map((t) => {
                var _a, _b, _c, _d;
                return ({
                    "Ticket ID": t.ticketId,
                    "Asset ID": ((_a = t.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    "Asset Name": ((_b = t.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    "Department": ((_c = t.department) === null || _c === void 0 ? void 0 : _c.name) || "",
                    "Issue Type": t.issueType,
                    "Priority": t.priority,
                    "Status": t.status,
                    "Assigned To": ((_d = t.assignedTo) === null || _d === void 0 ? void 0 : _d.name) || "",
                    "Service Type": t.serviceType || "",
                    "Total Cost": t.totalCost ? Number(t.totalCost) : "",
                    "SLA Breached": t.slaBreached ? "Yes" : "No",
                    "Root Cause": t.rootCause || "",
                    "Resolution": t.resolutionSummary || "",
                    "Satisfaction": t.customerSatisfaction || "",
                    "Created At": formatDate(t.createdAt),
                    "Resolved At": formatDate(t.slaResolvedAt),
                });
            });
            if (exportFormat === "csv")
                return sendCsv(res, exportRows, "ticket-analytics-report");
            return sendExcel(res, exportRows, "ticket-analytics-report", "Ticket Analytics");
        }
        res.json({
            totalTickets,
            countByStatus: countByStatus.map((s) => ({ status: s.status, count: s._count })),
            countByPriority: countByPriority.map((p) => ({ priority: p.priority, count: p._count })),
            countByServiceType: countByServiceType.map((s) => ({ serviceType: s.serviceType, count: s._count })),
            avgResolutionTimeHours,
            slaBreachCount,
            avgCustomerSatisfaction,
            topRootCauses,
        });
    }
    catch (err) {
        console.error("getTicketAnalyticsReport error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getTicketAnalyticsReport = getTicketAnalyticsReport;
// ─── 4. Expiry Report ───────────────────────────────────────────────────────
const getExpiryReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const exportFormat = query.export;
        const days = Number(query.days) || 90;
        const now = new Date();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + days);
        const assetWhere = Object.assign({}, buildRoleFilter(user));
        const matchingAssets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            select: { id: true, assetId: true, assetName: true, department: { select: { name: true } } },
        });
        const assetIds = matchingAssets.map((a) => a.id);
        const assetMap = new Map(matchingAssets.map((a) => [a.id, a]));
        const [expiringWarranties, expiringInsurance, expiringContracts] = yield Promise.all([
            prismaClient_1.default.warranty.findMany({
                where: { assetId: { in: assetIds }, warrantyEnd: { gte: now, lte: cutoffDate } },
                select: { id: true, assetId: true, warrantyEnd: true, isUnderWarranty: true, warrantyProvider: true },
                orderBy: { warrantyEnd: "asc" },
            }),
            prismaClient_1.default.assetInsurance.findMany({
                where: { assetId: { in: assetIds }, endDate: { gte: now, lte: cutoffDate } },
                select: { id: true, assetId: true, endDate: true, policyStatus: true, premiumAmount: true, provider: true, policyNumber: true },
                orderBy: { endDate: "asc" },
            }),
            prismaClient_1.default.serviceContract.findMany({
                where: { assetId: { in: assetIds }, endDate: { gte: now, lte: cutoffDate } },
                select: { id: true, assetId: true, endDate: true, status: true, cost: true, contractType: true, contractNumber: true },
                orderBy: { endDate: "asc" },
            }),
        ]);
        const warranties = expiringWarranties.map((w) => {
            var _a;
            const asset = assetMap.get(w.assetId);
            return {
                type: "WARRANTY", id: w.id,
                assetId: (asset === null || asset === void 0 ? void 0 : asset.assetId) || "N/A", assetName: (asset === null || asset === void 0 ? void 0 : asset.assetName) || "N/A",
                department: ((_a = asset === null || asset === void 0 ? void 0 : asset.department) === null || _a === void 0 ? void 0 : _a.name) || "",
                provider: w.warrantyProvider || "",
                expiryDate: w.warrantyEnd,
                daysRemaining: Math.ceil((new Date(w.warrantyEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
            };
        });
        const insurance = expiringInsurance.map((i) => {
            var _a;
            const asset = assetMap.get(i.assetId);
            return {
                type: "INSURANCE", id: i.id,
                assetId: (asset === null || asset === void 0 ? void 0 : asset.assetId) || "N/A", assetName: (asset === null || asset === void 0 ? void 0 : asset.assetName) || "N/A",
                department: ((_a = asset === null || asset === void 0 ? void 0 : asset.department) === null || _a === void 0 ? void 0 : _a.name) || "",
                provider: i.provider || "", policyNumber: i.policyNumber || "",
                expiryDate: i.endDate,
                daysRemaining: Math.ceil((new Date(i.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
                premiumAmount: Number(i.premiumAmount || 0),
            };
        });
        const contracts = expiringContracts.map((c) => {
            var _a;
            const asset = assetMap.get(c.assetId);
            return {
                type: "SERVICE_CONTRACT", id: c.id,
                assetId: (asset === null || asset === void 0 ? void 0 : asset.assetId) || "N/A", assetName: (asset === null || asset === void 0 ? void 0 : asset.assetName) || "N/A",
                department: ((_a = asset === null || asset === void 0 ? void 0 : asset.department) === null || _a === void 0 ? void 0 : _a.name) || "",
                contractType: c.contractType, contractNumber: c.contractNumber || "",
                expiryDate: c.endDate,
                daysRemaining: Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
                cost: Number(c.cost || 0),
            };
        });
        if (exportFormat === "csv" || exportFormat === "excel") {
            const allExpiring = [
                ...warranties.map((w) => ({
                    "Type": "Warranty", "Asset ID": w.assetId, "Asset Name": w.assetName,
                    "Department": w.department, "Provider/Vendor": w.provider,
                    "Reference": "", "Expiry Date": formatDate(w.expiryDate),
                    "Days Remaining": w.daysRemaining, "Cost/Premium": "",
                })),
                ...insurance.map((i) => ({
                    "Type": "Insurance", "Asset ID": i.assetId, "Asset Name": i.assetName,
                    "Department": i.department, "Provider/Vendor": i.provider,
                    "Reference": i.policyNumber, "Expiry Date": formatDate(i.expiryDate),
                    "Days Remaining": i.daysRemaining, "Cost/Premium": i.premiumAmount,
                })),
                ...contracts.map((c) => ({
                    "Type": `Service Contract (${c.contractType})`, "Asset ID": c.assetId, "Asset Name": c.assetName,
                    "Department": c.department, "Provider/Vendor": "",
                    "Reference": c.contractNumber, "Expiry Date": formatDate(c.expiryDate),
                    "Days Remaining": c.daysRemaining, "Cost/Premium": c.cost,
                })),
            ].sort((a, b) => a["Days Remaining"] - b["Days Remaining"]);
            if (exportFormat === "csv")
                return sendCsv(res, allExpiring, "expiry-report");
            return sendExcel(res, allExpiring, "expiry-report", "Expiry Alerts");
        }
        res.json({
            filterDays: days, warranties, insurance, serviceContracts: contracts,
            summary: {
                totalExpiring: warranties.length + insurance.length + contracts.length,
                warrantiesExpiring: warranties.length, insuranceExpiring: insurance.length,
                contractsExpiring: contracts.length,
            },
        });
    }
    catch (err) {
        console.error("getExpiryReport error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getExpiryReport = getExpiryReport;
// ─── 5. Depreciation Report ─────────────────────────────────────────────────
const getDepreciationReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const query = req.query;
        const exportFormat = query.export;
        const assetWhere = Object.assign({}, buildRoleFilter(user));
        if (query.departmentId)
            assetWhere.departmentId = Number(query.departmentId);
        if (query.categoryId)
            assetWhere.assetCategoryId = Number(query.categoryId);
        const assets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            select: {
                id: true, assetId: true, assetName: true, serialNumber: true,
                purchaseCost: true, purchaseDate: true, status: true,
                assetCategory: { select: { name: true } },
                department: { select: { name: true } },
                depreciation: {
                    select: {
                        depreciationMethod: true, depreciationRate: true,
                        expectedLifeYears: true, salvageValue: true,
                        accumulatedDepreciation: true, currentBookValue: true,
                        depreciationFrequency: true, lastCalculatedAt: true,
                    },
                },
            },
        });
        const data = assets
            .filter((a) => a.depreciation)
            .map((a) => {
            var _a, _b;
            const dep = a.depreciation;
            const originalCost = Number(a.purchaseCost || 0);
            const accumulatedDepreciation = Number(dep.accumulatedDepreciation || 0);
            const currentBookValue = Number(dep.currentBookValue || 0);
            return {
                assetId: a.assetId,
                assetName: a.assetName,
                serialNumber: a.serialNumber,
                category: ((_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) || "N/A",
                department: ((_b = a.department) === null || _b === void 0 ? void 0 : _b.name) || "N/A",
                purchaseDate: a.purchaseDate,
                status: a.status,
                method: dep.depreciationMethod,
                rate: Number(dep.depreciationRate),
                lifeYears: dep.expectedLifeYears,
                frequency: dep.depreciationFrequency || "YEARLY",
                originalCost,
                salvageValue: Number(dep.salvageValue || 0),
                accumulatedDepreciation,
                currentBookValue,
                depreciationPercentage: originalCost > 0
                    ? +((accumulatedDepreciation / originalCost) * 100).toFixed(2)
                    : 0,
                lastCalculated: dep.lastCalculatedAt,
            };
        });
        const totalOriginalCost = data.reduce((sum, d) => sum + d.originalCost, 0);
        const totalDepreciation = data.reduce((sum, d) => sum + d.accumulatedDepreciation, 0);
        const totalBookValue = data.reduce((sum, d) => sum + d.currentBookValue, 0);
        if (exportFormat === "csv" || exportFormat === "excel") {
            const exportRows = data.map((d) => ({
                "Asset ID": d.assetId, "Asset Name": d.assetName, "Serial Number": d.serialNumber,
                "Category": d.category, "Department": d.department,
                "Purchase Date": formatDate(d.purchaseDate), "Status": d.status,
                "Method": d.method, "Rate (%)": d.rate, "Life (Years)": d.lifeYears,
                "Frequency": d.frequency, "Original Cost": d.originalCost,
                "Salvage Value": d.salvageValue,
                "Accumulated Depreciation": d.accumulatedDepreciation,
                "Current Book Value": d.currentBookValue,
                "Depreciation %": d.depreciationPercentage,
                "Last Calculated": formatDate(d.lastCalculated),
            }));
            if (exportFormat === "csv")
                return sendCsv(res, exportRows, "depreciation-report");
            return sendExcel(res, exportRows, "depreciation-report", "Depreciation Schedule");
        }
        res.json({
            data,
            summary: { totalAssets: data.length, totalOriginalCost, totalDepreciation, totalBookValue },
        });
    }
    catch (err) {
        console.error("getDepreciationReport error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getDepreciationReport = getDepreciationReport;
// ─── 6. Inventory Stock Report ──────────────────────────────────────────────
const getInventoryStockReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const query = req.query;
        const exportFormat = query.export;
        const spareParts = yield prismaClient_1.default.sparePart.findMany({
            include: { vendor: { select: { name: true } } },
            orderBy: { stockQuantity: "asc" },
        });
        const data = spareParts.map((sp) => {
            var _a;
            const stockQuantity = Number(sp.stockQuantity || 0);
            const reorderLevel = Number(sp.reorderLevel || 0);
            const cost = Number(sp.cost || 0);
            return {
                id: sp.id, name: sp.name, partNumber: sp.partNumber || "",
                category: sp.category || "", vendor: ((_a = sp.vendor) === null || _a === void 0 ? void 0 : _a.name) || "",
                stockQuantity, reorderLevel, cost,
                totalValue: +(stockQuantity * cost).toFixed(2),
                needsReorder: stockQuantity <= reorderLevel,
            };
        });
        const reorderAlerts = data.filter((d) => d.needsReorder);
        const totalInventoryValue = data.reduce((sum, d) => sum + d.totalValue, 0);
        if (exportFormat === "csv" || exportFormat === "excel") {
            const exportRows = data.map((d) => ({
                "Part Name": d.name, "Part Number": d.partNumber,
                "Category": d.category, "Vendor": d.vendor,
                "Stock Qty": d.stockQuantity, "Reorder Level": d.reorderLevel,
                "Unit Cost": d.cost, "Total Value": d.totalValue,
                "Needs Reorder": d.needsReorder ? "YES" : "No",
            }));
            if (exportFormat === "csv")
                return sendCsv(res, exportRows, "inventory-stock-report");
            return sendExcel(res, exportRows, "inventory-stock-report", "Inventory Stock");
        }
        res.json({
            data, reorderAlerts,
            summary: { totalParts: data.length, totalInventoryValue, reorderAlertCount: reorderAlerts.length },
        });
    }
    catch (err) {
        console.error("getInventoryStockReport error:", err);
        res.status(500).json({ message: err.message });
    }
});
exports.getInventoryStockReport = getInventoryStockReport;

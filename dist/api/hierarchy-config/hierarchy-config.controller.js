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
exports.getEscalationSummary = exports.getRepeatTickets = exports.getSlaBreachAlerts = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ═══════════════════════════════════════════════════════════
// 1. GET /sla-breach-alerts
// ═══════════════════════════════════════════════════════════
const getSlaBreachAlerts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where: {
                slaBreached: true,
                status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
            },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true, department: { select: { id: true, name: true } } } },
            },
            orderBy: { createdAt: "desc" },
        });
        // Group by department
        const byDept = {};
        for (const t of tickets) {
            const deptId = (_b = (_a = t.asset) === null || _a === void 0 ? void 0 : _a.departmentId) !== null && _b !== void 0 ? _b : 0;
            const deptName = (_e = (_d = (_c = t.asset) === null || _c === void 0 ? void 0 : _c.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "Unassigned";
            if (!byDept[deptId]) {
                byDept[deptId] = { departmentId: deptId, departmentName: deptName, tickets: [] };
            }
            byDept[deptId].tickets.push({
                ticketId: t.id,
                ticketNumber: t.ticketId,
                title: t.issueType,
                priority: t.priority,
                status: t.status,
                assetId: (_f = t.asset) === null || _f === void 0 ? void 0 : _f.assetId,
                assetName: (_g = t.asset) === null || _g === void 0 ? void 0 : _g.assetName,
                createdAt: t.createdAt,
            });
        }
        // Fetch escalation rules for context
        const escalationRules = yield prismaClient_1.default.escalationMatrix.findMany({
            select: { id: true, level: true, escalateAfterValue: true, escalateAfterUnit: true, notifyRole: true, priority: true },
            orderBy: { level: "asc" },
        });
        res.json({
            totalBreachedTickets: tickets.length,
            departments: Object.values(byDept).sort((a, b) => b.tickets.length - a.tickets.length),
            escalationChain: escalationRules,
        });
    }
    catch (err) {
        console.error("getSlaBreachAlerts error:", err);
        res.status(500).json({ error: "Failed to fetch SLA breach alerts", details: err.message });
    }
});
exports.getSlaBreachAlerts = getSlaBreachAlerts;
// ═══════════════════════════════════════════════════════════
// 2. GET /repeat-tickets
// ═══════════════════════════════════════════════════════════
const getRepeatTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        // Group tickets by assetId in last 90 days
        const grouped = yield prismaClient_1.default.ticket.groupBy({
            by: ["assetId"],
            _count: { id: true },
            where: { createdAt: { gte: ninetyDaysAgo } },
            having: { id: { _count: { gte: 2 } } },
        });
        if (grouped.length === 0) {
            res.json([]);
            return;
        }
        const assetIds = grouped.map((g) => g.assetId);
        const countMap = new Map(grouped.map((g) => { var _a, _b; return [g.assetId, (_b = (_a = g._count) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0]; }));
        // Fetch asset details
        const assets = yield prismaClient_1.default.asset.findMany({
            where: { id: { in: assetIds } },
            select: {
                id: true, assetId: true, assetName: true,
                department: { select: { id: true, name: true } },
            },
        });
        const assetMap = new Map(assets.map((a) => [a.id, a]));
        // Fetch the actual tickets for these assets
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where: { assetId: { in: assetIds }, createdAt: { gte: ninetyDaysAgo } },
            select: {
                id: true, ticketId: true, issueType: true, priority: true, status: true,
                createdAt: true, assetId: true,
            },
            orderBy: { createdAt: "desc" },
        });
        // Group tickets by assetId
        const ticketsByAsset = new Map();
        for (const t of tickets) {
            const list = (_a = ticketsByAsset.get(t.assetId)) !== null && _a !== void 0 ? _a : [];
            list.push({
                id: t.id,
                ticketNumber: t.ticketId,
                title: t.issueType,
                priority: t.priority,
                status: t.status,
                createdAt: t.createdAt,
            });
            ticketsByAsset.set(t.assetId, list);
        }
        const result = assetIds.map((aid) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const asset = assetMap.get(aid);
            return {
                assetId: (_a = asset === null || asset === void 0 ? void 0 : asset.assetId) !== null && _a !== void 0 ? _a : null,
                assetName: (_b = asset === null || asset === void 0 ? void 0 : asset.assetName) !== null && _b !== void 0 ? _b : "Unknown",
                department: (_d = (_c = asset === null || asset === void 0 ? void 0 : asset.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "Unassigned",
                departmentId: (_f = (_e = asset === null || asset === void 0 ? void 0 : asset.department) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null,
                ticketCount: (_g = countMap.get(aid)) !== null && _g !== void 0 ? _g : 0,
                tickets: ((_h = ticketsByAsset.get(aid)) !== null && _h !== void 0 ? _h : []).slice(0, 10),
            };
        }).sort((a, b) => b.ticketCount - a.ticketCount);
        res.json(result);
    }
    catch (err) {
        console.error("getRepeatTickets error:", err);
        res.status(500).json({ error: "Failed to fetch repeat tickets", details: err.message });
    }
});
exports.getRepeatTickets = getRepeatTickets;
// ═══════════════════════════════════════════════════════════
// 3. GET /escalation-summary — combined view
// ═══════════════════════════════════════════════════════════
const getEscalationSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const [slaBreachesByDept, repeatFailureCount, overdueSchedules, uncoveredAssets,] = yield Promise.all([
            // SLA breaches grouped by department
            prismaClient_1.default.ticket.groupBy({
                by: ["departmentId"],
                _count: { id: true },
                where: {
                    slaBreached: true,
                    status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
                },
            }),
            // Repeat failure assets count
            prismaClient_1.default.ticket.groupBy({
                by: ["assetId"],
                _count: { id: true },
                where: { createdAt: { gte: ninetyDaysAgo } },
                having: { id: { _count: { gte: 2 } } },
            }),
            // Overdue PMs
            prismaClient_1.default.maintenanceSchedule.count({
                where: { isActive: true, nextDueAt: { lt: now } },
            }),
            // Uncovered assets (no active warranty)
            prismaClient_1.default.asset.count({
                where: {
                    status: "ACTIVE",
                    warranties: { none: { isUnderWarranty: true, warrantyEnd: { gte: now } } },
                },
            }),
        ]);
        // Resolve department names for SLA breaches
        const deptIds = slaBreachesByDept.map((g) => g.departmentId);
        const depts = yield prismaClient_1.default.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
        });
        const deptNameMap = new Map(depts.map((d) => [d.id, d.name]));
        res.json({
            slaBreachesByDepartment: slaBreachesByDept.map((g) => {
                var _a;
                return ({
                    departmentId: g.departmentId,
                    departmentName: (_a = deptNameMap.get(g.departmentId)) !== null && _a !== void 0 ? _a : "Unknown",
                    breachedCount: g._count.id,
                });
            }).sort((a, b) => b.breachedCount - a.breachedCount),
            repeatFailureAssetsCount: repeatFailureCount.length,
            overduePMs: overdueSchedules,
            uncoveredAssetsCount: uncoveredAssets,
        });
    }
    catch (err) {
        console.error("getEscalationSummary error:", err);
        res.status(500).json({ error: "Failed to fetch escalation summary", details: err.message });
    }
});
exports.getEscalationSummary = getEscalationSummary;

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
exports.getUserActivityStats = exports.getAllLoginHistory = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllLoginHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, success, dateFrom, dateTo, page = "1", limit = "25", search, exportCsv } = req.query;
        const where = {};
        if (userId)
            where.userId = Number(userId);
        if (success !== undefined)
            where.success = success === "true";
        if (dateFrom || dateTo) {
            where.attemptedAt = {};
            if (dateFrom)
                where.attemptedAt.gte = new Date(String(dateFrom));
            if (dateTo)
                where.attemptedAt.lte = new Date(String(dateTo));
        }
        if (search) {
            where.OR = [
                { ipAddress: { contains: String(search) } },
                { user: { username: { contains: String(search) } } },
                { user: { employee: { name: { contains: String(search) } } } },
            ];
        }
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, history] = yield Promise.all([
            prismaClient_1.default.loginHistory.count({ where }),
            prismaClient_1.default.loginHistory.findMany(Object.assign({ where, include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            employeeID: true,
                            role: true,
                            employee: { select: { name: true, departmentId: true } },
                        },
                    },
                }, orderBy: { attemptedAt: "desc" } }, (exportCsv !== "true" ? { skip, take } : {}))),
        ]);
        if (exportCsv === "true") {
            const csvRows = history.map((h) => {
                var _a, _b, _c, _d;
                return ({
                    Username: ((_a = h.user) === null || _a === void 0 ? void 0 : _a.username) || "",
                    EmployeeName: ((_c = (_b = h.user) === null || _b === void 0 ? void 0 : _b.employee) === null || _c === void 0 ? void 0 : _c.name) || "",
                    Role: ((_d = h.user) === null || _d === void 0 ? void 0 : _d.role) || "",
                    AttemptedAt: h.attemptedAt ? new Date(h.attemptedAt).toISOString() : "",
                    Success: h.success ? "Yes" : "No",
                    IpAddress: h.ipAddress || "",
                    UserAgent: h.userAgent || "",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=login-history.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json({ data: history, total, page: parseInt(String(page)), limit: take });
    }
    catch (error) {
        console.error("getAllLoginHistory error:", error);
        res.status(500).json({ message: "Failed to fetch login history" });
    }
});
exports.getAllLoginHistory = getAllLoginHistory;
// ─── User Activity Stats ─────────────────────────────────────────────────────
const getUserActivityStats = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const [totalLogins, todayLogins, failedToday, recentActiveUsers, last7DayLogins] = yield Promise.all([
            prismaClient_1.default.loginHistory.count(),
            prismaClient_1.default.loginHistory.count({ where: { attemptedAt: { gte: today }, success: true } }),
            prismaClient_1.default.loginHistory.count({ where: { attemptedAt: { gte: today }, success: false } }),
            prismaClient_1.default.loginHistory.findMany({
                where: { success: true, attemptedAt: { gte: sevenDaysAgo } },
                select: { userId: true },
                distinct: ["userId"],
            }),
            prismaClient_1.default.loginHistory.count({ where: { attemptedAt: { gte: sevenDaysAgo } } }),
        ]);
        // Last login per user (most recent successful logins)
        const recentLogins = yield prismaClient_1.default.user.findMany({
            where: { lastLogin: { not: null } },
            select: {
                id: true,
                username: true,
                role: true,
                lastLogin: true,
                employee: { select: { name: true } },
            },
            orderBy: { lastLogin: "desc" },
            take: 20,
        });
        res.json({
            totalLogins,
            todayLogins,
            failedToday,
            activeUsersLast7Days: recentActiveUsers.length,
            last7DayLogins,
            recentLogins,
        });
    }
    catch (error) {
        console.error("getUserActivityStats error:", error);
        res.status(500).json({ message: "Failed to fetch user activity stats" });
    }
});
exports.getUserActivityStats = getUserActivityStats;

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
exports.getAuditLogsByEntity = exports.getAuditLogs = exports.logAction = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ---------------------------------------------------------------------------
// Helper function – importable by other controllers to log actions
// ---------------------------------------------------------------------------
const logAction = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        yield prismaClient_1.default.auditLog.create({
            data: {
                entityType: params.entityType,
                entityId: params.entityId,
                action: params.action,
                description: (_a = params.description) !== null && _a !== void 0 ? _a : null,
                oldValue: (_b = params.oldValue) !== null && _b !== void 0 ? _b : null,
                newValue: (_c = params.newValue) !== null && _c !== void 0 ? _c : null,
                performedBy: (_d = params.performedBy) !== null && _d !== void 0 ? _d : null,
                performedById: (_e = params.performedById) !== null && _e !== void 0 ? _e : null,
                ipAddress: (_f = params.ipAddress) !== null && _f !== void 0 ? _f : null,
                userAgent: (_g = params.userAgent) !== null && _g !== void 0 ? _g : null,
            },
        });
    }
    catch (error) {
        // Logging should never break the main flow – swallow & print
        console.error("Failed to write audit log:", error);
    }
});
exports.logAction = logAction;
// ---------------------------------------------------------------------------
// GET /  –  paginated & filtered list
// ---------------------------------------------------------------------------
const getAuditLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { entityType, entityId, action, performedById, dateFrom, dateTo, page = "1", limit = "20", } = req.query;
        const pageNum = Math.max(parseInt(page || "1", 10), 1);
        const limitNum = Math.max(parseInt(limit || "20", 10), 1);
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (entityType) {
            where.entityType = entityType;
        }
        if (entityId) {
            where.entityId = Number(entityId);
        }
        if (action) {
            where.action = action;
        }
        if (performedById) {
            where.performedById = Number(performedById);
        }
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) {
                where.createdAt.gte = new Date(dateFrom);
            }
            if (dateTo) {
                where.createdAt.lte = new Date(dateTo);
            }
        }
        const [total, logs] = yield Promise.all([
            prismaClient_1.default.auditLog.count({ where }),
            prismaClient_1.default.auditLog.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limitNum,
            }),
        ]);
        res.json({
            data: logs,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    }
    catch (error) {
        console.error("Error fetching audit logs:", error);
        res.status(500).json({ error: "Failed to fetch audit logs" });
    }
});
exports.getAuditLogs = getAuditLogs;
// ---------------------------------------------------------------------------
// GET /:entityType/:entityId  –  all logs for a specific entity
// ---------------------------------------------------------------------------
const getAuditLogsByEntity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { entityType, entityId } = req.params;
        const logs = yield prismaClient_1.default.auditLog.findMany({
            where: {
                entityType,
                entityId: Number(entityId),
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(logs);
    }
    catch (error) {
        console.error("Error fetching audit logs by entity:", error);
        res.status(500).json({ error: "Failed to fetch audit logs for entity" });
    }
});
exports.getAuditLogsByEntity = getAuditLogsByEntity;

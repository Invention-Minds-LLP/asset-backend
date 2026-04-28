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
exports.deliverMaterialRequest = exports.rejectMaterialRequest = exports.approveMaterialRequest = exports.createMaterialRequest = exports.listMaterialRequests = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const audit_trail_controller_1 = require("../audit-trail/audit-trail.controller");
const notificationHelper_1 = require("../../utilis/notificationHelper");
// Helper: get all OPERATIONS employee IDs
const getOperationsIds = () => __awaiter(void 0, void 0, void 0, function* () {
    const ops = yield prismaClient_1.default.employee.findMany({
        where: { role: "OPERATIONS", isActive: true },
        select: { id: true },
    });
    return ops.map((o) => o.id);
});
// ═══════════════════════════════════════════════════════════
// GET / — List material requests
// ═══════════════════════════════════════════════════════════
const listMaterialRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const { ticketId, status } = req.query;
        const where = {};
        if (ticketId)
            where.ticketId = Number(ticketId);
        if (status)
            where.status = String(status);
        // Department scoping for non-admin users
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            where.ticket = { departmentId: Number(user.departmentId) };
        }
        const requests = yield prismaClient_1.default.materialRequest.findMany({
            where,
            include: {
                ticket: {
                    select: { id: true, ticketId: true, assetId: true, departmentId: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(requests);
    }
    catch (err) {
        console.error("listMaterialRequests error:", err);
        res.status(500).json({ error: "Failed to list material requests", details: err.message });
    }
});
exports.listMaterialRequests = listMaterialRequests;
// ═══════════════════════════════════════════════════════════
// POST / — Create material request
// ═══════════════════════════════════════════════════════════
const createMaterialRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        const { ticketId, itemType, sparePartId, consumableId, description, quantity, estimatedCost } = req.body;
        if (!ticketId || !itemType || !description || !quantity) {
            res.status(400).json({ error: "ticketId, itemType, description, and quantity are required" });
            return;
        }
        // Verify ticket exists
        const ticket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: Number(ticketId) },
            select: { id: true, ticketId: true, departmentId: true },
        });
        if (!ticket) {
            res.status(404).json({ error: "Ticket not found" });
            return;
        }
        const record = yield prismaClient_1.default.materialRequest.create({
            data: {
                ticketId: Number(ticketId),
                itemType,
                sparePartId: sparePartId ? Number(sparePartId) : null,
                consumableId: consumableId ? Number(consumableId) : null,
                description,
                quantity,
                estimatedCost: estimatedCost !== null && estimatedCost !== void 0 ? estimatedCost : null,
                status: "PENDING",
                requestedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
                requestedAt: new Date(),
            },
        });
        // Audit log
        yield (0, audit_trail_controller_1.logAction)({
            entityType: "MATERIAL_REQUEST",
            entityId: record.id,
            action: "CREATED",
            description: `Material request created for ticket ${ticket.ticketId}`,
            performedById: user === null || user === void 0 ? void 0 : user.employeeDbId,
        });
        // Notify operations team
        const opsIds = yield getOperationsIds();
        const adminIds = yield (0, notificationHelper_1.getAdminIds)();
        const recipientIds = [...new Set([...opsIds, ...adminIds])];
        if (recipientIds.length > 0) {
            yield (0, notificationHelper_1.notify)({
                type: "MATERIAL_REQUEST",
                title: "New Material Request",
                message: `A material request has been raised for ticket ${ticket.ticketId} — ${itemType}: ${description}`,
                recipientIds,
                priority: "MEDIUM",
                ticketId: ticket.id,
                createdById: user === null || user === void 0 ? void 0 : user.employeeDbId,
            });
        }
        res.status(201).json(record);
    }
    catch (err) {
        console.error("createMaterialRequest error:", err);
        res.status(500).json({ error: "Failed to create material request", details: err.message });
    }
});
exports.createMaterialRequest = createMaterialRequest;
// ═══════════════════════════════════════════════════════════
// PATCH /:id/approve — Operations approves
// ═══════════════════════════════════════════════════════════
const approveMaterialRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        // Only OPERATIONS or ADMIN
        if ((user === null || user === void 0 ? void 0 : user.role) !== "OPERATIONS" && (user === null || user === void 0 ? void 0 : user.role) !== "ADMIN") {
            res.status(403).json({ error: "Only OPERATIONS or ADMIN can approve material requests" });
            return;
        }
        const id = Number(req.params.id);
        const { approvalRemarks, expectedDelivery } = req.body;
        const existing = yield prismaClient_1.default.materialRequest.findUnique({
            where: { id },
            include: { ticket: { select: { ticketId: true } } },
        });
        if (!existing) {
            res.status(404).json({ error: "Material request not found" });
            return;
        }
        if (existing.status !== "PENDING") {
            res.status(400).json({ error: `Cannot approve a request with status ${existing.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.materialRequest.update({
            where: { id },
            data: {
                status: "OPERATIONS_APPROVED",
                approvedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
                approvedAt: new Date(),
                approvalRemarks: approvalRemarks !== null && approvalRemarks !== void 0 ? approvalRemarks : null,
                expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
            },
        });
        yield (0, audit_trail_controller_1.logAction)({
            entityType: "MATERIAL_REQUEST",
            entityId: id,
            action: "APPROVED",
            description: `Material request #${id} approved by operations`,
            performedById: user === null || user === void 0 ? void 0 : user.employeeDbId,
        });
        // Notify requester
        if (existing.requestedById) {
            yield (0, notificationHelper_1.notify)({
                type: "MATERIAL_REQUEST",
                title: "Material Request Approved",
                message: `Your material request for ticket ${existing.ticket.ticketId} has been approved.${approvalRemarks ? ` Remarks: ${approvalRemarks}` : ""}`,
                recipientIds: [existing.requestedById],
                priority: "MEDIUM",
                ticketId: existing.ticketId,
                createdById: user === null || user === void 0 ? void 0 : user.employeeDbId,
            });
        }
        res.json(updated);
    }
    catch (err) {
        console.error("approveMaterialRequest error:", err);
        res.status(500).json({ error: "Failed to approve material request", details: err.message });
    }
});
exports.approveMaterialRequest = approveMaterialRequest;
// ═══════════════════════════════════════════════════════════
// PATCH /:id/reject — Reject material request
// ═══════════════════════════════════════════════════════════
const rejectMaterialRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        if ((user === null || user === void 0 ? void 0 : user.role) !== "OPERATIONS" && (user === null || user === void 0 ? void 0 : user.role) !== "ADMIN") {
            res.status(403).json({ error: "Only OPERATIONS or ADMIN can reject material requests" });
            return;
        }
        const id = Number(req.params.id);
        const { approvalRemarks } = req.body;
        const existing = yield prismaClient_1.default.materialRequest.findUnique({
            where: { id },
            include: { ticket: { select: { ticketId: true } } },
        });
        if (!existing) {
            res.status(404).json({ error: "Material request not found" });
            return;
        }
        if (existing.status !== "PENDING") {
            res.status(400).json({ error: `Cannot reject a request with status ${existing.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.materialRequest.update({
            where: { id },
            data: {
                status: "REJECTED",
                approvedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
                approvedAt: new Date(),
                approvalRemarks: approvalRemarks !== null && approvalRemarks !== void 0 ? approvalRemarks : null,
            },
        });
        yield (0, audit_trail_controller_1.logAction)({
            entityType: "MATERIAL_REQUEST",
            entityId: id,
            action: "REJECTED",
            description: `Material request #${id} rejected`,
            performedById: user === null || user === void 0 ? void 0 : user.employeeDbId,
        });
        // Notify requester
        if (existing.requestedById) {
            yield (0, notificationHelper_1.notify)({
                type: "MATERIAL_REQUEST",
                title: "Material Request Rejected",
                message: `Your material request for ticket ${existing.ticket.ticketId} has been rejected.${approvalRemarks ? ` Reason: ${approvalRemarks}` : ""}`,
                recipientIds: [existing.requestedById],
                priority: "MEDIUM",
                ticketId: existing.ticketId,
                createdById: user === null || user === void 0 ? void 0 : user.employeeDbId,
            });
        }
        res.json(updated);
    }
    catch (err) {
        console.error("rejectMaterialRequest error:", err);
        res.status(500).json({ error: "Failed to reject material request", details: err.message });
    }
});
exports.rejectMaterialRequest = rejectMaterialRequest;
// ═══════════════════════════════════════════════════════════
// PATCH /:id/deliver — Mark as delivered
// ═══════════════════════════════════════════════════════════
const deliverMaterialRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        const { deliveryRemarks } = req.body;
        const existing = yield prismaClient_1.default.materialRequest.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: "Material request not found" });
            return;
        }
        if (existing.status !== "OPERATIONS_APPROVED") {
            res.status(400).json({ error: `Cannot mark as delivered — current status is ${existing.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.materialRequest.update({
            where: { id },
            data: {
                status: "DELIVERED",
                actualDelivery: new Date(),
                deliveryRemarks: deliveryRemarks !== null && deliveryRemarks !== void 0 ? deliveryRemarks : null,
            },
        });
        yield (0, audit_trail_controller_1.logAction)({
            entityType: "MATERIAL_REQUEST",
            entityId: id,
            action: "DELIVERED",
            description: `Material request #${id} marked as delivered`,
            performedById: user === null || user === void 0 ? void 0 : user.employeeDbId,
        });
        res.json(updated);
    }
    catch (err) {
        console.error("deliverMaterialRequest error:", err);
        res.status(500).json({ error: "Failed to mark material request as delivered", details: err.message });
    }
});
exports.deliverMaterialRequest = deliverMaterialRequest;

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
exports.cancelIndent = exports.fulfillIndent = exports.managementApproveIndent = exports.hodApproveIndent = exports.createIndent = exports.getIndentById = exports.getAllIndents = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
function mustUser(req) {
    const u = req.user;
    if (!(u === null || u === void 0 ? void 0 : u.employeeDbId))
        throw new Error("Unauthorized");
    return u;
}
// FY-based indent number: IND-FY2526-001
function generateIndentNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEndYear = fyStartYear + 1;
        const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;
        const latest = yield prismaClient_1.default.assetIndent.findFirst({
            where: { indentNumber: { startsWith: `IND-${fyString}` } },
            orderBy: { id: "desc" },
        });
        let seq = 1;
        if (latest) {
            const parts = latest.indentNumber.split("-");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last))
                seq = last + 1;
        }
        return `IND-${fyString}-${seq.toString().padStart(3, "0")}`;
    });
}
// GET /api/asset-indent
const getAllIndents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { status, departmentId, myDept } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (departmentId)
            where.departmentId = Number(departmentId);
        // Non-HOD/management see only their dept
        if (myDept === "true" && user.departmentId) {
            where.departmentId = user.departmentId;
        }
        const indents = yield prismaClient_1.default.assetIndent.findMany({
            where,
            include: {
                raisedBy: { select: { id: true, name: true, employeeID: true } },
                department: { select: { id: true, name: true } },
                assetCategory: { select: { id: true, name: true } },
                hodApprovedBy: { select: { id: true, name: true } },
                fulfilledAsset: { select: { id: true, assetId: true, assetName: true } },
            },
            orderBy: { id: "desc" },
        });
        res.json(indents);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch indents" });
    }
});
exports.getAllIndents = getAllIndents;
// GET /api/asset-indent/:id
const getIndentById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const indent = yield prismaClient_1.default.assetIndent.findUnique({
            where: { id: Number(req.params.id) },
            include: {
                raisedBy: { select: { id: true, name: true, employeeID: true, designation: true } },
                department: { select: { id: true, name: true } },
                assetCategory: { select: { id: true, name: true } },
                hodApprovedBy: { select: { id: true, name: true } },
                fulfilledAsset: { select: { id: true, assetId: true, assetName: true } },
            },
        });
        if (!indent) {
            res.status(404).json({ message: "Indent not found" });
            return;
        }
        res.json(indent);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch indent" });
    }
});
exports.getIndentById = getIndentById;
// POST /api/asset-indent
const createIndent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { assetCategoryId, assetName, quantity, justification, urgency, estimatedBudget, requiredByDate, specifications, departmentId, } = req.body;
        if (!assetName || !justification) {
            res.status(400).json({ message: "assetName and justification are required" });
            return;
        }
        const deptId = departmentId ? Number(departmentId) : user.departmentId;
        if (!deptId) {
            res.status(400).json({ message: "departmentId required" });
            return;
        }
        const indentNumber = yield generateIndentNumber();
        const indent = yield prismaClient_1.default.assetIndent.create({
            data: {
                indentNumber,
                raisedById: user.employeeDbId,
                departmentId: deptId,
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : null,
                assetName: String(assetName),
                quantity: quantity ? Number(quantity) : 1,
                justification: String(justification),
                urgency: urgency !== null && urgency !== void 0 ? urgency : "NORMAL",
                estimatedBudget: estimatedBudget ? Number(estimatedBudget) : null,
                requiredByDate: requiredByDate ? new Date(requiredByDate) : null,
                specifications: specifications !== null && specifications !== void 0 ? specifications : null,
                status: "SUBMITTED",
                hodApprovalStatus: "PENDING",
            },
        });
        // Fire-and-forget: notify department HODs about new indent
        (0, notificationHelper_1.getDepartmentHODs)(deptId).then(hodIds => (0, notificationHelper_1.notify)({
            type: "OTHER",
            title: `New Asset Indent ${indentNumber}`,
            message: `Asset indent for "${assetName}" requires HOD approval`,
            recipientIds: hodIds,
            priority: urgency === "URGENT" ? "HIGH" : "MEDIUM",
            createdById: user.employeeDbId,
        })).catch(() => { });
        // Notify department HOD
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: deptId, role: "HOD" },
            select: { id: true },
        });
        if (hod) {
            const notif = yield prismaClient_1.default.notification.create({
                data: {
                    type: "OTHER",
                    title: `New Asset Indent ${indentNumber}`,
                    message: `Asset indent for "${assetName}" requires your approval`,
                    priority: urgency === "URGENT" ? "HIGH" : "MEDIUM",
                    dedupeKey: `INDENT_NEW_${indent.id}`,
                    createdById: user.employeeDbId,
                },
            });
            yield prismaClient_1.default.notificationRecipient.create({
                data: { notificationId: notif.id, employeeId: hod.id },
            });
        }
        res.status(201).json(indent);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to create indent" });
    }
});
exports.createIndent = createIndent;
// PATCH /api/asset-indent/:id/hod-approval
const hodApproveIndent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const indentId = Number(req.params.id);
        const { decision, remarks } = req.body; // APPROVED | REJECTED
        if (!["APPROVED", "REJECTED"].includes(decision)) {
            res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
            return;
        }
        const indent = yield prismaClient_1.default.assetIndent.findUnique({ where: { id: indentId } });
        if (!indent) {
            res.status(404).json({ message: "Indent not found" });
            return;
        }
        if (indent.hodApprovalStatus !== "PENDING") {
            res.status(400).json({ message: "Indent already processed" });
            return;
        }
        const updated = yield prismaClient_1.default.assetIndent.update({
            where: { id: indentId },
            data: {
                hodApprovalStatus: decision,
                hodApprovedById: user.employeeDbId,
                hodApprovedAt: new Date(),
                hodRemarks: remarks !== null && remarks !== void 0 ? remarks : null,
                status: decision === "APPROVED" ? "HOD_APPROVED" : "REJECTED",
                // If approved, forward to management (status change is enough; management polls HOD_APPROVED)
                managementApprovalStatus: decision === "APPROVED" ? "PENDING" : null,
            },
        });
        // Fire-and-forget: notify raiser about HOD decision
        (0, notificationHelper_1.notify)({
            type: "OTHER",
            title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Approved" : "Rejected"} by HOD`,
            message: remarks || (decision === "APPROVED" ? "Indent forwarded for management review" : "Indent rejected"),
            recipientIds: [indent.raisedById],
            priority: "MEDIUM",
            createdById: user.employeeDbId,
            channel: "BOTH",
            templateCode: decision === "APPROVED" ? "INDENT_APPROVED" : "INDENT_REJECTED",
            templateData: { indentNumber: indent.indentNumber, assetName: indent.assetName || '', reason: remarks || '' },
        }).catch(() => { });
        // Fire-and-forget: if HOD approved, notify admins for management approval
        if (decision === "APPROVED") {
            (0, notificationHelper_1.getAdminIds)().then(adminIds => (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: `Indent ${indent.indentNumber} Awaiting Management Approval`,
                message: `Asset indent for "${indent.assetName}" approved by HOD, pending management approval`,
                recipientIds: adminIds,
                priority: "MEDIUM",
                createdById: user.employeeDbId,
            })).catch(() => { });
        }
        // Notify raiser
        const notif = yield prismaClient_1.default.notification.create({
            data: {
                type: "OTHER",
                title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Approved" : "Rejected"} by HOD`,
                message: remarks || (decision === "APPROVED" ? "Indent forwarded for management review" : "Indent rejected"),
                priority: "MEDIUM",
                dedupeKey: `INDENT_HOD_${indentId}_${decision}`,
                createdById: user.employeeDbId,
            },
        });
        yield prismaClient_1.default.notificationRecipient.create({
            data: { notificationId: notif.id, employeeId: indent.raisedById },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to process HOD approval" });
    }
});
exports.hodApproveIndent = hodApproveIndent;
// PATCH /api/asset-indent/:id/management-approval
const managementApproveIndent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const indentId = Number(req.params.id);
        const { decision, remarks } = req.body;
        if (!["APPROVED", "REJECTED"].includes(decision)) {
            res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
            return;
        }
        const indent = yield prismaClient_1.default.assetIndent.findUnique({ where: { id: indentId } });
        if (!indent) {
            res.status(404).json({ message: "Indent not found" });
            return;
        }
        if (indent.managementApprovalStatus !== "PENDING") {
            res.status(400).json({ message: "Management approval not pending" });
            return;
        }
        const updated = yield prismaClient_1.default.assetIndent.update({
            where: { id: indentId },
            data: {
                managementApprovalStatus: decision,
                status: decision === "APPROVED" ? "MANAGEMENT_APPROVED" : "REJECTED",
            },
        });
        // Fire-and-forget: notify raiser about management decision
        (0, notificationHelper_1.notify)({
            type: "OTHER",
            title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Management Approved" : "Rejected"}`,
            message: remarks || `Management has ${decision === "APPROVED" ? "approved" : "rejected"} your indent`,
            recipientIds: [indent.raisedById],
            priority: "MEDIUM",
            createdById: user.employeeDbId,
            channel: "BOTH",
            templateCode: decision === "APPROVED" ? "INDENT_APPROVED" : "INDENT_REJECTED",
            templateData: { indentNumber: indent.indentNumber, assetName: indent.assetName || '', reason: remarks || '' },
        }).catch(() => { });
        // Notify raiser
        const notif = yield prismaClient_1.default.notification.create({
            data: {
                type: "OTHER",
                title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Management Approved" : "Rejected"}`,
                message: remarks || `Management has ${decision === "APPROVED" ? "approved" : "rejected"} your indent`,
                priority: "MEDIUM",
                dedupeKey: `INDENT_MGMT_${indentId}_${decision}`,
                createdById: user.employeeDbId,
            },
        });
        yield prismaClient_1.default.notificationRecipient.create({
            data: { notificationId: notif.id, employeeId: indent.raisedById },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to process management approval" });
    }
});
exports.managementApproveIndent = managementApproveIndent;
// PATCH /api/asset-indent/:id/fulfill
const fulfillIndent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const indentId = Number(req.params.id);
        const { fulfilledAssetId } = req.body;
        const indent = yield prismaClient_1.default.assetIndent.findUnique({ where: { id: indentId } });
        if (!indent) {
            res.status(404).json({ message: "Indent not found" });
            return;
        }
        if (!["MANAGEMENT_APPROVED", "HOD_APPROVED"].includes(indent.status)) {
            res.status(400).json({ message: "Indent must be approved before fulfillment" });
            return;
        }
        const updated = yield prismaClient_1.default.assetIndent.update({
            where: { id: indentId },
            data: {
                status: "FULFILLED",
                fulfilledAt: new Date(),
                fulfilledAssetId: fulfilledAssetId ? Number(fulfilledAssetId) : null,
            },
        });
        // Notify raiser
        const notif = yield prismaClient_1.default.notification.create({
            data: {
                type: "OTHER",
                title: `Indent ${indent.indentNumber} Fulfilled`,
                message: `Your asset indent has been fulfilled`,
                priority: "MEDIUM",
                dedupeKey: `INDENT_FULFILLED_${indentId}`,
                createdById: user.employeeDbId,
            },
        });
        yield prismaClient_1.default.notificationRecipient.create({
            data: { notificationId: notif.id, employeeId: indent.raisedById },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to fulfill indent" });
    }
});
exports.fulfillIndent = fulfillIndent;
// DELETE /api/asset-indent/:id  (only DRAFT/SUBMITTED can be cancelled by raiser)
const cancelIndent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const indentId = Number(req.params.id);
        const indent = yield prismaClient_1.default.assetIndent.findUnique({ where: { id: indentId } });
        if (!indent) {
            res.status(404).json({ message: "Indent not found" });
            return;
        }
        if (indent.raisedById !== user.employeeDbId) {
            res.status(403).json({ message: "Only the raiser can cancel this indent" });
            return;
        }
        if (!["DRAFT", "SUBMITTED"].includes(indent.status)) {
            res.status(400).json({ message: "Only DRAFT or SUBMITTED indents can be cancelled" });
            return;
        }
        const updated = yield prismaClient_1.default.assetIndent.update({
            where: { id: indentId },
            data: { status: "CANCELLED" },
        });
        // Notify HOD about cancellation
        if (indent.departmentId) {
            (0, notificationHelper_1.getDepartmentHODs)(indent.departmentId).then(hodIds => (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: `Indent ${indent.indentNumber} Cancelled`,
                message: `Asset indent for "${indent.assetName}" has been cancelled by the raiser`,
                recipientIds: hodIds,
                priority: "MEDIUM",
                createdById: user.employeeDbId,
            })).catch(() => { });
        }
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to cancel indent" });
    }
});
exports.cancelIndent = cancelIndent;

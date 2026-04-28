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
exports.cancelWorkOrder = exports.closeWorkOrder = exports.issueWCC = exports.completeWorkOrder = exports.issueMaterial = exports.startWorkOrder = exports.approveWorkOrder = exports.updateWorkOrder = exports.createWorkOrder = exports.getWorkOrderById = exports.getAllWorkOrders = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const client_1 = require("@prisma/client");
const audit_trail_controller_1 = require("../audit-trail/audit-trail.controller");
const notificationHelper_1 = require("../../utilis/notificationHelper");
const approvalConfigHelper_1 = require("../../utilis/approvalConfigHelper");
const assetIdGenerator_1 = require("../../utilis/assetIdGenerator");
// ─── helpers ───────────────────────────────────────────────
function getFY() {
    const now = new Date();
    const month = now.getMonth() + 1;
    return month >= 4
        ? `${now.getFullYear().toString().slice(2)}${(now.getFullYear() + 1).toString().slice(2)}`
        : `${(now.getFullYear() - 1).toString().slice(2)}${now.getFullYear().toString().slice(2)}`;
}
function generateWoNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const fy = getFY();
        const prefix = `WO-FY${fy}-`;
        const last = yield prismaClient_1.default.workOrder.findFirst({
            where: { woNumber: { startsWith: prefix } },
            orderBy: { woNumber: "desc" },
        });
        const seq = last ? parseInt(last.woNumber.replace(prefix, ""), 10) + 1 : 1;
        return `${prefix}${seq.toString().padStart(5, "0")}`;
    });
}
function generateWccNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const fy = getFY();
        const prefix = `WCC-FY${fy}-`;
        const last = yield prismaClient_1.default.workCompletionCertificate.findFirst({
            where: { wccNumber: { startsWith: prefix } },
            orderBy: { wccNumber: "desc" },
        });
        const seq = last ? parseInt(last.wccNumber.replace(prefix, ""), 10) + 1 : 1;
        return `${prefix}${seq.toString().padStart(5, "0")}`;
    });
}
// ═══════════════════════════════════════════════════════════
// GET ALL (paginated + filters)
// ═══════════════════════════════════════════════════════════
const getAllWorkOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, woType, assetId, departmentId, page = "1", limit = "20" } = req.query;
        const user = req.user;
        const skip = (Number(page) - 1) * Number(limit);
        const where = {};
        if (status)
            where.status = String(status);
        if (woType)
            where.woType = String(woType);
        if (assetId)
            where.assetId = Number(assetId);
        if (departmentId)
            where.departmentId = Number(departmentId);
        // Department-based scoping for non-admin users
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId) && !departmentId) {
            where.departmentId = Number(user.departmentId);
        }
        const [data, total] = yield Promise.all([
            prismaClient_1.default.workOrder.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { id: "desc" },
                include: {
                    asset: { select: { id: true, assetId: true, assetName: true } },
                },
            }),
            prismaClient_1.default.workOrder.count({ where }),
        ]);
        res.json({ data, total, page: Number(page), limit: Number(limit) });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllWorkOrders = getAllWorkOrders;
// ═══════════════════════════════════════════════════════════
// GET BY ID
// ═══════════════════════════════════════════════════════════
const getWorkOrderById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const wo = yield prismaClient_1.default.workOrder.findUnique({
            where: { id },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, status: true } },
                ticket: { select: { id: true, ticketId: true, issueType: true, status: true } },
                materialIssues: {
                    include: {
                        store: { select: { id: true, name: true } },
                        sparePart: { select: { id: true, name: true, partNumber: true } },
                        consumable: { select: { id: true, name: true } },
                    },
                    orderBy: { issuedAt: "desc" },
                },
                wcc: true,
            },
        });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        res.json(wo);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getWorkOrderById = getWorkOrderById;
// ═══════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════
const createWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { woType, assetId, ticketId, description, priority, departmentId, assignedToId, estimatedCost, budgetCode, capitalizeAsAsset, assetCategoryId, scheduledStart, scheduledEnd, contractorVendorId, contractorName, } = req.body;
        if (!woType || !description) {
            res.status(400).json({ message: "woType and description are required" });
            return;
        }
        const woNumber = yield generateWoNumber();
        const wo = yield prismaClient_1.default.workOrder.create({
            data: {
                woNumber,
                woType,
                assetId: assetId ? Number(assetId) : null,
                ticketId: ticketId ? Number(ticketId) : null,
                description,
                priority: priority || "MEDIUM",
                departmentId: departmentId ? Number(departmentId) : null,
                assignedToId: assignedToId ? Number(assignedToId) : null,
                estimatedCost: estimatedCost ? new client_1.Prisma.Decimal(estimatedCost) : null,
                budgetCode: budgetCode || null,
                capitalizeAsAsset: capitalizeAsAsset === true,
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : null,
                scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
                scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
                contractorVendorId: contractorVendorId ? Number(contractorVendorId) : null,
                contractorName: contractorName || null,
                status: "DRAFT",
                createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: wo.id, action: "CREATE", description: `WO ${wo.woNumber} created (${woType})`, performedById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        // Notify HODs about new work order
        const hodIds = yield (0, notificationHelper_1.getDepartmentHODs)(wo.departmentId);
        (0, notificationHelper_1.notify)({ type: "WO_STATUS", title: "New Work Order", message: `WO ${wo.woNumber} (${woType}) created, pending approval`, recipientIds: hodIds, assetId: (_d = wo.assetId) !== null && _d !== void 0 ? _d : undefined, createdById: (_e = req.user) === null || _e === void 0 ? void 0 : _e.employeeDbId });
        res.status(201).json(wo);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createWorkOrder = createWorkOrder;
// ═══════════════════════════════════════════════════════════
// UPDATE (only DRAFT / SUBMITTED)
// ═══════════════════════════════════════════════════════════
const updateWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const id = Number(req.params.id);
        const existing = yield prismaClient_1.default.workOrder.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (!["DRAFT", "SUBMITTED"].includes(existing.status)) {
            res.status(400).json({ message: `Cannot update work order in ${existing.status} status` });
            return;
        }
        const { woType, assetId, ticketId, description, priority, departmentId, assignedToId, estimatedCost, budgetCode, capitalizeAsAsset, assetCategoryId, scheduledStart, scheduledEnd, contractorVendorId, contractorName, status, } = req.body;
        const updated = yield prismaClient_1.default.workOrder.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (woType !== undefined && { woType })), (assetId !== undefined && { assetId: assetId ? Number(assetId) : null })), (ticketId !== undefined && { ticketId: ticketId ? Number(ticketId) : null })), (description !== undefined && { description })), (priority !== undefined && { priority })), (departmentId !== undefined && { departmentId: departmentId ? Number(departmentId) : null })), (assignedToId !== undefined && { assignedToId: assignedToId ? Number(assignedToId) : null })), (estimatedCost !== undefined && { estimatedCost: estimatedCost ? new client_1.Prisma.Decimal(estimatedCost) : null })), (budgetCode !== undefined && { budgetCode })), (capitalizeAsAsset !== undefined && { capitalizeAsAsset })), (assetCategoryId !== undefined && { assetCategoryId: assetCategoryId ? Number(assetCategoryId) : null })), (scheduledStart !== undefined && { scheduledStart: scheduledStart ? new Date(scheduledStart) : null })), (scheduledEnd !== undefined && { scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null })), (contractorVendorId !== undefined && { contractorVendorId: contractorVendorId ? Number(contractorVendorId) : null })), (contractorName !== undefined && { contractorName })), (status !== undefined && ["DRAFT", "SUBMITTED"].includes(status) && { status })), { updatedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null }),
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.updateWorkOrder = updateWorkOrder;
// ═══════════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════════
const approveWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const id = Number(req.params.id);
        const { approvedById, approvalRemarks } = req.body;
        const wo = yield prismaClient_1.default.workOrder.findUnique({ where: { id } });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (wo.status !== "SUBMITTED" && wo.status !== "DRAFT") {
            res.status(400).json({ message: `Cannot approve work order in ${wo.status} status` });
            return;
        }
        // Check if the current user's role has authority to approve this WO based on estimated cost
        const userRole = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== null && _b !== void 0 ? _b : "";
        if (wo.estimatedCost != null) {
            const requiredLevel = yield (0, approvalConfigHelper_1.getRequiredApprovalLevel)("WORK_ORDER", Number(wo.estimatedCost));
            if (!(0, approvalConfigHelper_1.canApproveAtLevel)(userRole, requiredLevel)) {
                res.status(403).json({
                    message: `WO estimated cost requires ${requiredLevel}-level approval. Your role (${userRole}) is not authorised.`,
                    requiredLevel,
                });
                return;
            }
        }
        const updated = yield prismaClient_1.default.workOrder.update({
            where: { id },
            data: {
                status: "APPROVED",
                approvedById: approvedById ? Number(approvedById) : (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null,
                approvedAt: new Date(),
                approvalRemarks: approvalRemarks || null,
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: id, action: "APPROVE", description: `WO ${wo.woNumber} approved`, performedById: (_e = req.user) === null || _e === void 0 ? void 0 : _e.employeeDbId });
        // Notify assigned employee about approval
        if (wo.assignedToId)
            (0, notificationHelper_1.notify)({ type: "WO_STATUS", title: "Work Order Approved", message: `WO ${wo.woNumber} approved, you can start work`, recipientIds: [wo.assignedToId], channel: "BOTH", templateCode: "WO_ASSIGNED", templateData: { woNumber: wo.woNumber, woType: wo.woType || '', assetName: '', description: wo.description || '' } });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.approveWorkOrder = approveWorkOrder;
// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
const startWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = Number(req.params.id);
        const wo = yield prismaClient_1.default.workOrder.findUnique({ where: { id } });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (wo.status !== "APPROVED") {
            res.status(400).json({ message: `Cannot start work order in ${wo.status} status` });
            return;
        }
        const updated = yield prismaClient_1.default.workOrder.update({
            where: { id },
            data: { status: "IN_PROGRESS", actualStart: new Date() },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} started`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify WO creator + HODs that work has started
        const startNotifyIds = [];
        if (wo.createdById)
            startNotifyIds.push(wo.createdById);
        const startHodIds = yield (0, notificationHelper_1.getDepartmentHODs)(wo.departmentId);
        const allStartIds = [...new Set([...startNotifyIds, ...startHodIds])];
        if (allStartIds.length > 0) {
            (0, notificationHelper_1.notify)({ type: "WO_STATUS", title: "Work Order Started", message: `WO ${wo.woNumber} is now in progress`, recipientIds: allStartIds, assetId: (_b = wo.assetId) !== null && _b !== void 0 ? _b : undefined, createdById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        }
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.startWorkOrder = startWorkOrder;
// ═══════════════════════════════════════════════════════════
// ISSUE MATERIAL
// ═══════════════════════════════════════════════════════════
const issueMaterial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const workOrderId = Number(req.params.id);
        const { storeId, issueType, sparePartId, consumableId, description, quantity, unitCost } = req.body;
        if (!storeId || !issueType || !quantity) {
            res.status(400).json({ message: "storeId, issueType, and quantity are required" });
            return;
        }
        const wo = yield prismaClient_1.default.workOrder.findUnique({ where: { id: workOrderId } });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (!["IN_PROGRESS", "PENDING_MATERIAL", "APPROVED"].includes(wo.status)) {
            res.status(400).json({ message: `Cannot issue material for work order in ${wo.status} status` });
            return;
        }
        const qty = new client_1.Prisma.Decimal(quantity);
        const uCost = unitCost ? new client_1.Prisma.Decimal(unitCost) : new client_1.Prisma.Decimal(0);
        const totalCost = qty.mul(uCost);
        // Check stock availability
        const stockWhere = Object.assign(Object.assign({ storeId: Number(storeId), itemType: issueType }, (issueType === "SPARE_PART" ? { sparePartId: Number(sparePartId) } : {})), (issueType === "CONSUMABLE" ? { consumableId: Number(consumableId) } : {}));
        const stock = yield prismaClient_1.default.storeStockPosition.findFirst({ where: stockWhere });
        if (!stock || stock.availableQty.lessThan(qty)) {
            res.status(400).json({
                message: "Insufficient stock",
                available: (_b = (_a = stock === null || stock === void 0 ? void 0 : stock.availableQty) === null || _a === void 0 ? void 0 : _a.toString()) !== null && _b !== void 0 ? _b : "0",
                requested: qty.toString(),
            });
            return;
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            // Create MaterialIssue
            const materialIssue = yield tx.materialIssue.create({
                data: {
                    workOrderId,
                    storeId: Number(storeId),
                    issueType,
                    sparePartId: sparePartId ? Number(sparePartId) : null,
                    consumableId: consumableId ? Number(consumableId) : null,
                    description: description || null,
                    quantity: qty,
                    unitCost: uCost,
                    totalCost,
                    issuedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                },
            });
            // Create InventoryTransaction
            const invTx = yield tx.inventoryTransaction.create({
                data: {
                    type: "OUT",
                    sparePartId: sparePartId ? Number(sparePartId) : null,
                    consumableId: consumableId ? Number(consumableId) : null,
                    quantity: qty,
                    referenceType: "WORK_ORDER",
                    referenceId: workOrderId,
                    storeId: Number(storeId),
                    workOrderId,
                    performedById: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null,
                    notes: `Material issued for WO ${wo.woNumber}`,
                },
            });
            // Update MaterialIssue with transaction id
            yield tx.materialIssue.update({
                where: { id: materialIssue.id },
                data: { inventoryTransactionId: invTx.id },
            });
            // Decrement stock
            yield tx.storeStockPosition.update({
                where: { id: stock.id },
                data: {
                    currentQty: { decrement: qty },
                    availableQty: { decrement: qty },
                    lastUpdatedAt: new Date(),
                },
            });
            return materialIssue;
        }));
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: workOrderId, action: "UPDATE", description: `Material issued for WO ${wo.woNumber} (${issueType}, qty ${quantity})`, performedById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        res.status(201).json(result);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.issueMaterial = issueMaterial;
// ═══════════════════════════════════════════════════════════
// COMPLETE
// ═══════════════════════════════════════════════════════════
const completeWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const id = Number(req.params.id);
        const wo = yield prismaClient_1.default.workOrder.findUnique({
            where: { id },
            include: { materialIssues: true },
        });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (wo.status !== "IN_PROGRESS" && wo.status !== "PENDING_MATERIAL") {
            res.status(400).json({ message: `Cannot complete work order in ${wo.status} status` });
            return;
        }
        // Calculate actual cost
        const materialTotal = wo.materialIssues.reduce((sum, mi) => { var _a; return sum.add((_a = mi.totalCost) !== null && _a !== void 0 ? _a : new client_1.Prisma.Decimal(0)); }, new client_1.Prisma.Decimal(0));
        const laborCost = (_a = wo.laborCost) !== null && _a !== void 0 ? _a : new client_1.Prisma.Decimal(0);
        const nonMaterialCost = (_b = wo.nonMaterialCost) !== null && _b !== void 0 ? _b : new client_1.Prisma.Decimal(0);
        const actualCost = materialTotal.add(laborCost).add(nonMaterialCost);
        const updated = yield prismaClient_1.default.workOrder.update({
            where: { id },
            data: {
                status: "WORK_COMPLETED",
                actualEnd: new Date(),
                actualCost,
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} completed, actual cost ${actualCost}`, performedById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        // Notify HODs that work order is completed, pending WCC
        const completionHodIds = yield (0, notificationHelper_1.getDepartmentHODs)(wo.departmentId);
        (0, notificationHelper_1.notify)({ type: "WO_STATUS", title: "Work Order Completed", message: `WO ${wo.woNumber} completed, pending WCC`, recipientIds: completionHodIds, assetId: (_d = wo.assetId) !== null && _d !== void 0 ? _d : undefined, channel: "BOTH", templateCode: "WO_COMPLETED", templateData: { woNumber: wo.woNumber, actualCost: actualCost.toString() } });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.completeWorkOrder = completeWorkOrder;
// ═══════════════════════════════════════════════════════════
// ISSUE WCC
// ═══════════════════════════════════════════════════════════
const issueWCC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const workOrderId = Number(req.params.id);
        const { workSummary, materialsUsedSummary, totalLaborCost, totalMaterialCost, qualityCheckStatus, qualityRemarks, certifiedById, } = req.body;
        if (!workSummary) {
            res.status(400).json({ message: "workSummary is required" });
            return;
        }
        const wo = yield prismaClient_1.default.workOrder.findUnique({ where: { id: workOrderId } });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (wo.status !== "WORK_COMPLETED") {
            res.status(400).json({ message: `Cannot issue WCC for work order in ${wo.status} status` });
            return;
        }
        const existingWcc = yield prismaClient_1.default.workCompletionCertificate.findUnique({ where: { workOrderId } });
        if (existingWcc) {
            res.status(400).json({ message: "WCC already issued for this work order" });
            return;
        }
        const wccNumber = yield generateWccNumber();
        const labor = totalLaborCost ? new client_1.Prisma.Decimal(totalLaborCost) : new client_1.Prisma.Decimal(0);
        const material = totalMaterialCost ? new client_1.Prisma.Decimal(totalMaterialCost) : new client_1.Prisma.Decimal(0);
        const totalCost = labor.add(material);
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            // Create WCC
            const wcc = yield tx.workCompletionCertificate.create({
                data: {
                    workOrderId,
                    wccNumber,
                    workSummary,
                    materialsUsedSummary: materialsUsedSummary || null,
                    totalLaborCost: labor,
                    totalMaterialCost: material,
                    totalCost,
                    qualityCheckStatus: qualityCheckStatus || null,
                    qualityRemarks: qualityRemarks || null,
                    certifiedById: certifiedById ? Number(certifiedById) : (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                    certifiedAt: new Date(),
                    createdById: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null,
                },
            });
            // Update WO status
            const woUpdate = { status: "WCC_ISSUED" };
            // CAPEX capitalization
            if (wo.woType === "CAPEX" && wo.capitalizeAsAsset === true && wo.assetCategoryId) {
                const assetId = yield (0, assetIdGenerator_1.generateAssetId)(undefined, tx, { categoryId: wo.assetCategoryId });
                const newAsset = yield tx.asset.create({
                    data: {
                        assetId,
                        assetName: `Asset from ${wo.woNumber}`,
                        assetType: "CAPEX",
                        assetCategoryId: wo.assetCategoryId,
                        serialNumber: `SN-${wo.woNumber}-${Date.now()}`,
                        purchaseCost: totalCost,
                        sourceType: "WORK_ORDER_CAPEX",
                        sourceReference: wo.woNumber,
                        status: "ACTIVE",
                        workOrderCapexId: wo.id,
                        createdById: (_f = (_e = req.user) === null || _e === void 0 ? void 0 : _e.employeeDbId) !== null && _f !== void 0 ? _f : null,
                    },
                });
                woUpdate.capitalizedAssetId = newAsset.id;
            }
            yield tx.workOrder.update({ where: { id: workOrderId }, data: woUpdate });
            return wcc;
        }));
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: workOrderId, action: "STATUS_CHANGE", description: `WCC ${result.wccNumber} issued for WO ${wo.woNumber}`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify WO creator that WCC has been issued
        (0, notificationHelper_1.notify)({ type: "WO_STATUS", title: "WCC Issued", message: `WCC ${result.wccNumber} issued for WO ${wo.woNumber}`, recipientIds: [wo.createdById].filter(Boolean), channel: "BOTH", templateCode: "WCC_ISSUED", templateData: { wccNumber: result.wccNumber, woNumber: wo.woNumber, totalCost: totalCost.toString(), qualityStatus: qualityCheckStatus || '' } });
        res.status(201).json(result);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.issueWCC = issueWCC;
// ═══════════════════════════════════════════════════════════
// CLOSE
// ═══════════════════════════════════════════════════════════
const closeWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = Number(req.params.id);
        const wo = yield prismaClient_1.default.workOrder.findUnique({ where: { id } });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (wo.status !== "WCC_ISSUED" && wo.status !== "WORK_COMPLETED") {
            res.status(400).json({ message: `Cannot close work order in ${wo.status} status` });
            return;
        }
        const updated = yield prismaClient_1.default.workOrder.update({
            where: { id },
            data: { status: "CLOSED" },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} closed`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.closeWorkOrder = closeWorkOrder;
// ═══════════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════════
const cancelWorkOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = Number(req.params.id);
        const wo = yield prismaClient_1.default.workOrder.findUnique({ where: { id } });
        if (!wo) {
            res.status(404).json({ message: "Work order not found" });
            return;
        }
        if (["CLOSED", "CANCELLED"].includes(wo.status)) {
            res.status(400).json({ message: `Cannot cancel work order in ${wo.status} status` });
            return;
        }
        const updated = yield prismaClient_1.default.workOrder.update({
            where: { id },
            data: { status: "CANCELLED" },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "WORK_ORDER", entityId: id, action: "STATUS_CHANGE", description: `WO ${wo.woNumber} cancelled`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify assignee + creator about cancellation
        const cancelNotifyIds = [wo.assignedToId, wo.createdById].filter((id) => { var _a; return !!id && id !== ((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId); });
        if (cancelNotifyIds.length > 0) {
            (0, notificationHelper_1.notify)({ type: "WO_STATUS", title: "Work Order Cancelled", message: `WO ${wo.woNumber} has been cancelled`, recipientIds: cancelNotifyIds, assetId: (_b = wo.assetId) !== null && _b !== void 0 ? _b : undefined, createdById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        }
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.cancelWorkOrder = cancelWorkOrder;

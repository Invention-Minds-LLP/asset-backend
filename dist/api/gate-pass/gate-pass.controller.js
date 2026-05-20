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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGatePass = exports.downloadGatePassPdf = exports.getSecurityQueue = exports.getPendingApproval = exports.updateGatePassStatus = exports.gateInGatePass = exports.gateOutGatePass = exports.rejectGatePass = exports.approveGatePass = exports.submitForApproval = exports.updateGatePass = exports.getOverdueGatePasses = exports.getGatePassesByAsset = exports.getGatePassById = exports.getAllGatePasses = exports.createGatePass = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
const gatePassPdf_1 = require("../../utilis/gatePassPdf");
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function generateGatePassNo() {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
        const count = yield prismaClient_1.default.gatePass.count({
            where: { gatePassNo: { startsWith: `GP-${dateStr}` } },
        });
        return `GP-${dateStr}-${String(count + 1).padStart(4, "0")}`;
    });
}
const FULL_INCLUDE = {
    items: { include: { asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true, departmentId: true } } } },
    requestedBy: { select: { id: true, name: true } },
    approvedByEmployee: { select: { id: true, name: true } },
    gatedOutBy: { select: { id: true, name: true } },
    gatedInBy: { select: { id: true, name: true } },
    ticket: { select: { id: true, ticketId: true } },
    serviceVisit: { select: { id: true, visitDate: true, visitType: true } },
    transferHistory: { select: { id: true, transferType: true } },
};
function userId(req) {
    var _a, _b, _c;
    const u = req.user;
    return (_c = (_b = (_a = u === null || u === void 0 ? void 0 : u.employeeDbId) !== null && _a !== void 0 ? _a : u === null || u === void 0 ? void 0 : u.employeeId) !== null && _b !== void 0 ? _b : u === null || u === void 0 ? void 0 : u.id) !== null && _c !== void 0 ? _c : null;
}
function resolveApproverDepartmentId(items) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (items.length === 0)
            return null;
        const a = yield prismaClient_1.default.asset.findUnique({ where: { id: items[0].assetId }, select: { departmentId: true } });
        return (_a = a === null || a === void 0 ? void 0 : a.departmentId) !== null && _a !== void 0 ? _a : null;
    });
}
// ────────────────────────────────────────────────────────────────────────────
// CREATE — multi-asset, lands in DRAFT
// ────────────────────────────────────────────────────────────────────────────
const createGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { type, issuedTo, purpose, expectedReturnDate, courierDetails, vehicleNo, vehicleType, reason, ticketId, 
        // multi-asset payload
        items, 
        // legacy single-asset (still accepted; auto-converted to one item)
        assetId, description, quantity, } = req.body;
        if (!type || !issuedTo || !purpose) {
            res.status(400).json({ message: "type, issuedTo and purpose are required" });
            return;
        }
        if (!["RETURNABLE", "NON_RETURNABLE"].includes(type)) {
            res.status(400).json({ message: "type must be RETURNABLE or NON_RETURNABLE" });
            return;
        }
        const itemRows = Array.isArray(items) && items.length > 0
            ? items.map((it) => {
                var _a;
                return ({
                    assetId: Number(it.assetId),
                    quantity: it.quantity ? Number(it.quantity) : 1,
                    remarks: (_a = it.remarks) !== null && _a !== void 0 ? _a : null,
                });
            })
            : assetId
                ? [{ assetId: Number(assetId), quantity: quantity ? Number(quantity) : 1, remarks: description !== null && description !== void 0 ? description : null }]
                : [];
        if (itemRows.length === 0) {
            res.status(400).json({ message: "At least one asset item is required" });
            return;
        }
        const gatePassNo = yield generateGatePassNo();
        const created = yield prismaClient_1.default.gatePass.create({
            data: {
                gatePassNo,
                type,
                status: "DRAFT",
                approvalStatus: "PENDING",
                issuedTo,
                purpose,
                expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
                courierDetails: courierDetails !== null && courierDetails !== void 0 ? courierDetails : null,
                vehicleNo: vehicleNo !== null && vehicleNo !== void 0 ? vehicleNo : null,
                vehicleType: vehicleType !== null && vehicleType !== void 0 ? vehicleType : null,
                reason: reason !== null && reason !== void 0 ? reason : null,
                ticketId: ticketId ? Number(ticketId) : null,
                requestedById: userId(req),
                requestedAt: new Date(),
                items: { create: itemRows },
            },
            include: FULL_INCLUDE,
        });
        res.status(201).json(created);
    }
    catch (error) {
        console.error("createGatePass error:", error);
        res.status(500).json({ message: "Failed to create gate pass" });
    }
});
exports.createGatePass = createGatePass;
// ────────────────────────────────────────────────────────────────────────────
// LIST + filters (status, approvalStatus, type, assetId, ticketId)
// ────────────────────────────────────────────────────────────────────────────
const getAllGatePasses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, approvalStatus, type, assetId, ticketId } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (approvalStatus)
            where.approvalStatus = String(approvalStatus);
        if (type)
            where.type = String(type);
        if (ticketId)
            where.ticketId = Number(ticketId);
        if (assetId)
            where.items = { some: { assetId: Number(assetId) } };
        const list = yield prismaClient_1.default.gatePass.findMany({
            where,
            include: FULL_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
        res.json(list);
    }
    catch (error) {
        console.error("getAllGatePasses error:", error);
        res.status(500).json({ message: "Failed to fetch gate passes" });
    }
});
exports.getAllGatePasses = getAllGatePasses;
const getGatePassById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id }, include: FULL_INCLUDE });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        res.json(gp);
    }
    catch (error) {
        console.error("getGatePassById error:", error);
        res.status(500).json({ message: "Failed to fetch gate pass" });
    }
});
exports.getGatePassById = getGatePassById;
const getGatePassesByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        const list = yield prismaClient_1.default.gatePass.findMany({
            where: { items: { some: { assetId } } },
            include: FULL_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
        res.json(list);
    }
    catch (error) {
        console.error("getGatePassesByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch gate passes" });
    }
});
exports.getGatePassesByAsset = getGatePassesByAsset;
const getOverdueGatePasses = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const overdue = yield prismaClient_1.default.gatePass.findMany({
            where: { type: "RETURNABLE", status: "ISSUED", expectedReturnDate: { lt: new Date() } },
            include: FULL_INCLUDE,
            orderBy: { expectedReturnDate: "asc" },
        });
        res.json(overdue);
    }
    catch (error) {
        console.error("getOverdueGatePasses error:", error);
        res.status(500).json({ message: "Failed to fetch overdue gate passes" });
    }
});
exports.getOverdueGatePasses = getOverdueGatePasses;
// ────────────────────────────────────────────────────────────────────────────
// EDIT (only while DRAFT) — replace items if provided
// ────────────────────────────────────────────────────────────────────────────
const updateGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.gatePass.findUnique({ where: { id }, include: { items: true } });
        if (!existing) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (existing.status !== "DRAFT") {
            res.status(400).json({ message: "Only DRAFT gate passes can be edited" });
            return;
        }
        const _a = req.body, { items } = _a, rest = __rest(_a, ["items"]);
        const data = Object.assign({}, rest);
        if (data.expectedReturnDate)
            data.expectedReturnDate = new Date(data.expectedReturnDate);
        if (data.ticketId !== undefined)
            data.ticketId = data.ticketId ? Number(data.ticketId) : null;
        // Strip fields managed by lifecycle endpoints
        delete data.status;
        delete data.approvalStatus;
        delete data.gatePassNo;
        delete data.requestedById;
        delete data.requestedAt;
        delete data.approvedById;
        delete data.approvedAt;
        delete data.gatedOutAt;
        delete data.gatedOutById;
        delete data.gatedInAt;
        delete data.gatedInById;
        if (Array.isArray(items)) {
            // Replace items wholesale
            yield prismaClient_1.default.gatePassItem.deleteMany({ where: { gatePassId: id } });
            data.items = {
                create: items.map((it) => {
                    var _a;
                    return ({
                        assetId: Number(it.assetId),
                        quantity: it.quantity ? Number(it.quantity) : 1,
                        remarks: (_a = it.remarks) !== null && _a !== void 0 ? _a : null,
                    });
                }),
            };
        }
        const updated = yield prismaClient_1.default.gatePass.update({ where: { id }, data, include: FULL_INCLUDE });
        res.json(updated);
    }
    catch (error) {
        console.error("updateGatePass error:", error);
        res.status(500).json({ message: "Failed to update gate pass" });
    }
});
exports.updateGatePass = updateGatePass;
// ────────────────────────────────────────────────────────────────────────────
// LIFECYCLE — submit → approve / reject → gate-out → gate-in → close
// ────────────────────────────────────────────────────────────────────────────
const submitForApproval = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id }, include: { items: true } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (gp.status !== "DRAFT") {
            res.status(400).json({ message: `Cannot submit a gate pass in status ${gp.status}` });
            return;
        }
        if (gp.items.length === 0) {
            res.status(400).json({ message: "Gate pass must have at least one item before submission" });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: { status: "PENDING_APPROVAL", approvalStatus: "PENDING", requestedAt: new Date() },
            include: FULL_INCLUDE,
        });
        // Notify HODs of the (first) asset's department
        const deptId = yield resolveApproverDepartmentId(gp.items);
        if (deptId) {
            (0, notificationHelper_1.getDepartmentHODs)(deptId).then(ids => {
                var _a;
                return (0, notificationHelper_1.notify)({
                    type: "OTHER",
                    title: "Gate Pass Approval Required",
                    message: `Gate pass ${gp.gatePassNo} (${gp.type}, ${gp.items.length} item${gp.items.length > 1 ? "s" : ""}) needs your approval — Purpose: ${gp.purpose}`,
                    recipientIds: ids,
                    gatePassId: gp.id,
                    createdById: (_a = userId(req)) !== null && _a !== void 0 ? _a : undefined,
                });
            }).catch(() => { });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("submitForApproval error:", error);
        res.status(500).json({ message: "Failed to submit gate pass for approval" });
    }
});
exports.submitForApproval = submitForApproval;
const approveGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const { remarks } = req.body;
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (gp.status !== "PENDING_APPROVAL") {
            res.status(400).json({ message: `Cannot approve a gate pass in status ${gp.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: {
                status: "APPROVED",
                approvalStatus: "APPROVED",
                approvedById: userId(req),
                approvedAt: new Date(),
                approvalRemarks: remarks !== null && remarks !== void 0 ? remarks : null,
            },
            include: FULL_INCLUDE,
        });
        if (updated.requestedById) {
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Gate Pass Approved",
                message: `Your gate pass ${gp.gatePassNo} has been approved. Hand over to security for gate-out.`,
                recipientIds: [updated.requestedById],
                gatePassId: gp.id,
                createdById: (_a = userId(req)) !== null && _a !== void 0 ? _a : undefined,
            }).catch(() => { });
        }
        // Tell security a new pass is ready in their queue
        (0, notificationHelper_1.getSecurityTeam)().then(secIds => {
            var _a;
            if (secIds.length === 0)
                return;
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Gate Pass Ready to Issue",
                message: `${gp.gatePassNo} (${gp.type}) is approved — issue to ${gp.issuedTo} when they arrive.`,
                recipientIds: secIds,
                gatePassId: gp.id,
                priority: "HIGH",
                createdById: (_a = userId(req)) !== null && _a !== void 0 ? _a : undefined,
            });
        }).catch(() => { });
        res.json(updated);
    }
    catch (error) {
        console.error("approveGatePass error:", error);
        res.status(500).json({ message: "Failed to approve gate pass" });
    }
});
exports.approveGatePass = approveGatePass;
const rejectGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            res.status(400).json({ message: "rejection reason is required" });
            return;
        }
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (gp.status !== "PENDING_APPROVAL") {
            res.status(400).json({ message: `Cannot reject a gate pass in status ${gp.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: {
                status: "REJECTED",
                approvalStatus: "REJECTED",
                approvedById: userId(req),
                approvedAt: new Date(),
                rejectionReason: String(reason).trim(),
            },
            include: FULL_INCLUDE,
        });
        if (updated.requestedById) {
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Gate Pass Rejected",
                message: `Your gate pass ${gp.gatePassNo} was rejected. Reason: ${reason}`,
                recipientIds: [updated.requestedById],
                gatePassId: gp.id,
                createdById: (_a = userId(req)) !== null && _a !== void 0 ? _a : undefined,
            }).catch(() => { });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("rejectGatePass error:", error);
        res.status(500).json({ message: "Failed to reject gate pass" });
    }
});
exports.rejectGatePass = rejectGatePass;
// SECURITY — physical gate-out (asset leaving)
const gateOutGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (gp.status !== "APPROVED") {
            res.status(400).json({ message: `Cannot gate-out a pass in status ${gp.status}. Only APPROVED passes can be issued.` });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: { status: "ISSUED", gatedOutAt: new Date(), gatedOutById: userId(req) },
            include: FULL_INCLUDE,
        });
        if (updated.requestedById) {
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Gate Pass Issued",
                message: `Gate pass ${gp.gatePassNo} has been issued by security. Asset(s) released.`,
                recipientIds: [updated.requestedById],
                gatePassId: gp.id,
                createdById: (_a = userId(req)) !== null && _a !== void 0 ? _a : undefined,
            }).catch(() => { });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("gateOutGatePass error:", error);
        res.status(500).json({ message: "Failed to gate-out" });
    }
});
exports.gateOutGatePass = gateOutGatePass;
// SECURITY — physical gate-in (asset returning). Body: { itemReturns: [{ itemId, condition, remarks }], returnCondition? }
const gateInGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = parseInt(req.params.id);
        const { itemReturns, returnCondition, returnedBy } = req.body;
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id }, include: { items: true } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (gp.status !== "ISSUED") {
            res.status(400).json({ message: `Cannot gate-in a pass in status ${gp.status}` });
            return;
        }
        if (gp.type !== "RETURNABLE") {
            res.status(400).json({ message: "Only RETURNABLE gate passes can be returned" });
            return;
        }
        // Per-item return updates (optional)
        if (Array.isArray(itemReturns)) {
            for (const r of itemReturns) {
                if (!r.itemId)
                    continue;
                yield prismaClient_1.default.gatePassItem.update({
                    where: { id: Number(r.itemId) },
                    data: {
                        returnedAt: new Date(),
                        returnCondition: (_a = r.condition) !== null && _a !== void 0 ? _a : "GOOD",
                        returnRemarks: (_b = r.remarks) !== null && _b !== void 0 ? _b : null,
                    },
                });
            }
        }
        else {
            // Bulk-return all items as GOOD if caller didn't specify per-item data
            yield prismaClient_1.default.gatePassItem.updateMany({
                where: { gatePassId: id, returnedAt: null },
                data: { returnedAt: new Date(), returnCondition: returnCondition !== null && returnCondition !== void 0 ? returnCondition : "GOOD" },
            });
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: {
                status: "RETURNED",
                gatedInAt: new Date(),
                gatedInById: userId(req),
                returnedAt: new Date(),
                returnedBy: returnedBy !== null && returnedBy !== void 0 ? returnedBy : null,
                returnCondition: returnCondition !== null && returnCondition !== void 0 ? returnCondition : null,
            },
            include: FULL_INCLUDE,
        });
        if (updated.requestedById) {
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Gate Pass Returned",
                message: `Gate pass ${gp.gatePassNo} marked as returned by security.`,
                recipientIds: [updated.requestedById],
                gatePassId: gp.id,
                createdById: (_c = userId(req)) !== null && _c !== void 0 ? _c : undefined,
            }).catch(() => { });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("gateInGatePass error:", error);
        res.status(500).json({ message: "Failed to gate-in" });
    }
});
exports.gateInGatePass = gateInGatePass;
// Generic state-change endpoint for CLOSE/CANCEL (back-compat with old callers)
const updateGatePassStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const { status, reason } = req.body;
        const valid = ["CLOSED", "CANCELLED"];
        if (!status || !valid.includes(status)) {
            res.status(400).json({ message: `status must be one of: ${valid.join(", ")} (use lifecycle endpoints for approve/reject/gate-out/gate-in)` });
            return;
        }
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (status === "CANCELLED" && ["RETURNED", "CLOSED", "CANCELLED"].includes(gp.status)) {
            res.status(400).json({ message: `Cannot cancel a pass in status ${gp.status}` });
            return;
        }
        if (status === "CLOSED" && !["RETURNED", "ISSUED"].includes(gp.status) && gp.type === "RETURNABLE") {
            res.status(400).json({ message: "RETURNABLE pass must be RETURNED before closing" });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: { status, reason: reason !== null && reason !== void 0 ? reason : gp.reason },
            include: FULL_INCLUDE,
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateGatePassStatus error:", error);
        res.status(500).json({ message: "Failed to update gate pass status" });
    }
});
exports.updateGatePassStatus = updateGatePassStatus;
// ────────────────────────────────────────────────────────────────────────────
// INBOX queries
// ────────────────────────────────────────────────────────────────────────────
// HOD inbox — passes awaiting approval whose first item's asset is in the user's department.
const getPendingApproval = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const u = req.user;
        const departmentId = (u === null || u === void 0 ? void 0 : u.departmentId) ? Number(u.departmentId) : null;
        const where = { status: "PENDING_APPROVAL", approvalStatus: "PENDING" };
        if (departmentId) {
            where.items = { some: { asset: { departmentId } } };
        }
        const list = yield prismaClient_1.default.gatePass.findMany({
            where,
            include: FULL_INCLUDE,
            orderBy: { requestedAt: "desc" },
        });
        res.json(list);
    }
    catch (error) {
        console.error("getPendingApproval error:", error);
        res.status(500).json({ message: "Failed to fetch pending gate passes" });
    }
});
exports.getPendingApproval = getPendingApproval;
// Security inbox — APPROVED (ready to issue) + ISSUED (awaiting return).
const getSecurityQueue = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const list = yield prismaClient_1.default.gatePass.findMany({
            where: { status: { in: ["APPROVED", "ISSUED"] } },
            include: FULL_INCLUDE,
            orderBy: [{ status: "asc" }, { approvedAt: "desc" }],
        });
        res.json(list);
    }
    catch (error) {
        console.error("getSecurityQueue error:", error);
        res.status(500).json({ message: "Failed to fetch security queue" });
    }
});
exports.getSecurityQueue = getSecurityQueue;
// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────
const downloadGatePassPdf = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id }, include: FULL_INCLUDE });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        yield (0, gatePassPdf_1.streamGatePassPdf)(gp, res);
    }
    catch (error) {
        console.error("downloadGatePassPdf error:", error);
        res.status(500).json({ message: "Failed to generate PDF" });
    }
});
exports.downloadGatePassPdf = downloadGatePassPdf;
// ────────────────────────────────────────────────────────────────────────────
// DELETE — only DRAFT
// ────────────────────────────────────────────────────────────────────────────
const deleteGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!gp) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        if (gp.status !== "DRAFT") {
            res.status(400).json({ message: "Only DRAFT gate passes can be deleted; use cancel for issued/approved passes" });
            return;
        }
        yield prismaClient_1.default.gatePass.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteGatePass error:", error);
        res.status(500).json({ message: "Failed to delete gate pass" });
    }
});
exports.deleteGatePass = deleteGatePass;

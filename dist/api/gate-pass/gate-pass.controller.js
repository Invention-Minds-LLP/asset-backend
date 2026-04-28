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
exports.getOverdueGatePasses = exports.getGatePassesByAsset = exports.deleteGatePass = exports.updateGatePassStatus = exports.updateGatePass = exports.getGatePassById = exports.getAllGatePasses = exports.createGatePass = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
// Generate unique gate pass number: GP-YYYYMMDD-NNNN
function generateGatePassNo() {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
        const count = yield prismaClient_1.default.gatePass.count({
            where: { gatePassNo: { startsWith: `GP-${dateStr}` } },
        });
        const seq = String(count + 1).padStart(4, "0");
        return `GP-${dateStr}-${seq}`;
    });
}
const createGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { type, assetId, description, quantity, issuedTo, purpose, expectedReturnDate, courierDetails, vehicleNo, vehicleType, approvedBy, issuedBy, reason, } = req.body;
        if (!type || !issuedTo || !purpose) {
            res.status(400).json({ message: "type, issuedTo and purpose are required" });
            return;
        }
        const gatePassNo = yield generateGatePassNo();
        const gatePass = yield prismaClient_1.default.gatePass.create({
            data: {
                gatePassNo,
                type,
                status: "ISSUED",
                assetId: assetId ? Number(assetId) : undefined,
                description,
                quantity: quantity ? Number(quantity) : undefined,
                issuedTo,
                purpose,
                expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : undefined,
                courierDetails,
                vehicleNo,
                vehicleType: vehicleType !== null && vehicleType !== void 0 ? vehicleType : null,
                approvedBy,
                issuedBy,
                reason,
            },
            include: { asset: { select: { assetId: true, assetName: true, departmentId: true } } },
        });
        // Fire-and-forget: notify department HODs about new gate pass
        const deptId = (_a = gatePass.asset) === null || _a === void 0 ? void 0 : _a.departmentId;
        if (deptId) {
            (0, notificationHelper_1.getDepartmentHODs)(deptId).then(hodIds => {
                var _a;
                return (0, notificationHelper_1.notify)({
                    type: "OTHER",
                    title: "Gate Pass Created",
                    message: `Gate pass ${gatePassNo} (${type}) issued to ${issuedTo} — ${purpose}`,
                    recipientIds: hodIds,
                    createdById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId,
                });
            }).catch(() => { });
        }
        res.status(201).json(gatePass);
    }
    catch (error) {
        console.error("createGatePass error:", error);
        res.status(500).json({ message: "Failed to create gate pass" });
    }
});
exports.createGatePass = createGatePass;
const getAllGatePasses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, type, assetId } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (type)
            where.type = String(type);
        if (assetId)
            where.assetId = Number(assetId);
        const gatePasses = yield prismaClient_1.default.gatePass.findMany({
            where,
            include: { asset: { select: { assetId: true, assetName: true } } },
            orderBy: { createdAt: "desc" },
        });
        res.json(gatePasses);
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
        const gatePass = yield prismaClient_1.default.gatePass.findUnique({
            where: { id },
            include: { asset: { select: { assetId: true, assetName: true, assetType: true } } },
        });
        if (!gatePass) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        res.json(gatePass);
    }
    catch (error) {
        console.error("getGatePassById error:", error);
        res.status(500).json({ message: "Failed to fetch gate pass" });
    }
});
exports.getGatePassById = getGatePassById;
const updateGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: req.body,
            include: { asset: { select: { assetId: true, assetName: true } } },
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateGatePass error:", error);
        res.status(500).json({ message: "Failed to update gate pass" });
    }
});
exports.updateGatePass = updateGatePass;
const updateGatePassStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const { status, reason } = req.body;
        const validStatuses = ["ISSUED", "RETURNED", "CLOSED", "CANCELLED"];
        if (!status || !validStatuses.includes(status)) {
            res.status(400).json({ message: `status must be one of: ${validStatuses.join(", ")}` });
            return;
        }
        const existing = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Gate pass not found" });
            return;
        }
        const updated = yield prismaClient_1.default.gatePass.update({
            where: { id },
            data: { status, reason: reason !== null && reason !== void 0 ? reason : existing.reason },
            include: { asset: { select: { assetId: true, assetName: true, departmentId: true } } },
        });
        // Notify HOD of asset's department for status changes
        if (["RETURNED", "CLOSED", "CANCELLED"].includes(status)) {
            const deptId = (_a = updated.asset) === null || _a === void 0 ? void 0 : _a.departmentId;
            if (deptId) {
                const statusLabels = { RETURNED: "returned", CLOSED: "closed", CANCELLED: "cancelled" };
                (0, notificationHelper_1.getDepartmentHODs)(deptId).then(hodIds => {
                    var _a;
                    return (0, notificationHelper_1.notify)({
                        type: "OTHER",
                        title: `Gate Pass ${statusLabels[status] || status}`,
                        message: `Gate pass ${existing.gatePassNo} (${existing.type}) has been ${statusLabels[status] || status}${reason ? `. Reason: ${reason}` : ""}`,
                        recipientIds: hodIds,
                        createdById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId,
                    });
                }).catch(() => { });
            }
        }
        res.json(updated);
    }
    catch (error) {
        console.error("updateGatePassStatus error:", error);
        res.status(500).json({ message: "Failed to update gate pass status" });
    }
});
exports.updateGatePassStatus = updateGatePassStatus;
const deleteGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.gatePass.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Gate pass not found" });
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
const getGatePassesByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        const gatePasses = yield prismaClient_1.default.gatePass.findMany({
            where: { assetId },
            orderBy: { createdAt: "desc" },
        });
        res.json(gatePasses);
    }
    catch (error) {
        console.error("getGatePassesByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch gate passes" });
    }
});
exports.getGatePassesByAsset = getGatePassesByAsset;
const getOverdueGatePasses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const overdue = yield prismaClient_1.default.gatePass.findMany({
            where: {
                type: "RETURNABLE",
                status: "ISSUED",
                expectedReturnDate: { lt: new Date() },
            },
            include: { asset: { select: { assetId: true, assetName: true } } },
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

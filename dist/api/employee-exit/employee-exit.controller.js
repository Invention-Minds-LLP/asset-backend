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
exports.getExitByEmployee = exports.completeExit = exports.returnAsset = exports.initiateExit = exports.getExitById = exports.getAllExits = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
function mustUser(req) {
    const u = req.user;
    if (!(u === null || u === void 0 ? void 0 : u.employeeDbId))
        throw new Error("Unauthorized");
    return u;
}
function generateExitNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEndYear = fyStartYear + 1;
        const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;
        const latest = yield prismaClient_1.default.employeeExit.findFirst({
            where: { exitNumber: { startsWith: `EXIT-${fyString}` } },
            orderBy: { id: "desc" },
        });
        let seq = 1;
        if (latest) {
            const parts = latest.exitNumber.split("-");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last))
                seq = last + 1;
        }
        return `EXIT-${fyString}-${seq.toString().padStart(3, "0")}`;
    });
}
// GET /api/employee-exit
const getAllExits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, employeeId } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (employeeId)
            where.employeeId = Number(employeeId);
        const exits = yield prismaClient_1.default.employeeExit.findMany({
            where,
            include: {
                employee: { select: { id: true, name: true, employeeID: true, designation: true } },
                handledBy: { select: { id: true, name: true } },
                handoverItems: {
                    include: {
                        asset: { select: { id: true, assetId: true, assetName: true } },
                    },
                },
            },
            orderBy: { id: "desc" },
        });
        res.json(exits);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch exits" });
    }
});
exports.getAllExits = getAllExits;
// GET /api/employee-exit/:id
const getExitById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exit = yield prismaClient_1.default.employeeExit.findUnique({
            where: { id: Number(req.params.id) },
            include: {
                employee: { select: { id: true, name: true, employeeID: true, designation: true, departmentId: true } },
                handledBy: { select: { id: true, name: true } },
                handoverItems: {
                    include: {
                        asset: { select: { id: true, assetId: true, assetName: true, status: true } },
                    },
                },
            },
        });
        if (!exit) {
            res.status(404).json({ message: "Exit record not found" });
            return;
        }
        res.json(exit);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch exit" });
    }
});
exports.getExitById = getExitById;
// POST /api/employee-exit — initiate offboarding for an employee
const initiateExit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { employeeId, exitType, exitDate, handledById } = req.body;
        if (!employeeId || !exitType || !exitDate) {
            res.status(400).json({ message: "employeeId, exitType, and exitDate are required" });
            return;
        }
        // Fetch all assets currently assigned to this employee
        const assignedAssets = yield prismaClient_1.default.asset.findMany({
            where: { allottedToId: Number(employeeId), status: { notIn: ["DISPOSED", "CONDEMNED"] } },
            select: { id: true },
        });
        const exitNumber = yield generateExitNumber();
        const exit = yield prismaClient_1.default.employeeExit.create({
            data: {
                exitNumber,
                employeeId: Number(employeeId),
                exitType: String(exitType),
                exitDate: new Date(exitDate),
                handledById: handledById ? Number(handledById) : user.employeeDbId,
                status: "INITIATED",
                totalAssetsAssigned: assignedAssets.length,
                assetsReturned: 0,
                assetsPending: assignedAssets.length,
                handoverItems: {
                    create: assignedAssets.map((a) => ({
                        assetId: a.id,
                        status: "PENDING",
                    })),
                },
            },
            include: {
                handoverItems: true,
            },
        });
        // Fetch employee info for notification
        const employee = yield prismaClient_1.default.employee.findUnique({
            where: { id: Number(employeeId) },
            select: { id: true, name: true, departmentId: true },
        });
        // Notify the employee being offboarded + their dept HOD about pending asset handover
        if (employee) {
            const notifyIds = [employee.id];
            const hodIds = yield (0, notificationHelper_1.getDepartmentHODs)(employee.departmentId);
            const allIds = [...new Set([...notifyIds, ...hodIds])];
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Employee Exit Initiated",
                message: `Exit process initiated for ${employee.name}. ${assignedAssets.length} asset(s) pending handover before ${new Date(exitDate).toLocaleDateString()}`,
                recipientIds: allIds,
                priority: "HIGH",
                createdById: user.employeeDbId,
            }).catch(() => { });
        }
        res.status(201).json(exit);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to initiate exit" });
    }
});
exports.initiateExit = initiateExit;
// PATCH /api/employee-exit/:id/return-asset — mark a single asset as returned
const returnAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const exitId = Number(req.params.id);
        const { exitAssetId, conditionOnReturn, handoverToId } = req.body;
        if (!exitAssetId) {
            res.status(400).json({ message: "exitAssetId required" });
            return;
        }
        const exitItem = yield prismaClient_1.default.employeeExitAsset.findFirst({
            where: { id: Number(exitAssetId), exitId },
        });
        if (!exitItem) {
            res.status(404).json({ message: "Exit asset record not found" });
            return;
        }
        if (exitItem.status === "RETURNED") {
            res.status(400).json({ message: "Asset already marked as returned" });
            return;
        }
        yield prismaClient_1.default.employeeExitAsset.update({
            where: { id: exitItem.id },
            data: {
                status: "RETURNED",
                returnedAt: new Date(),
                conditionOnReturn: conditionOnReturn !== null && conditionOnReturn !== void 0 ? conditionOnReturn : null,
                handoverToId: handoverToId ? Number(handoverToId) : null,
            },
        });
        // Update asset: unassign it
        yield prismaClient_1.default.asset.update({
            where: { id: exitItem.assetId },
            data: {
                allottedToId: null,
                status: "IN_STORE",
            },
        });
        // Recalculate counts on exit record
        const allItems = yield prismaClient_1.default.employeeExitAsset.findMany({ where: { exitId } });
        const returned = allItems.filter((i) => i.status === "RETURNED").length;
        const pending = allItems.length - returned;
        const updatedExit = yield prismaClient_1.default.employeeExit.update({
            where: { id: exitId },
            data: {
                assetsReturned: returned,
                assetsPending: pending,
                status: pending === 0 ? "COMPLETED" : "IN_PROGRESS",
            },
        });
        res.json(updatedExit);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to mark asset returned" });
    }
});
exports.returnAsset = returnAsset;
// PATCH /api/employee-exit/:id/complete — force-complete even if assets pending (with reason)
const completeExit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const exitId = Number(req.params.id);
        const exit = yield prismaClient_1.default.employeeExit.findUnique({ where: { id: exitId } });
        if (!exit) {
            res.status(404).json({ message: "Exit record not found" });
            return;
        }
        const updated = yield prismaClient_1.default.employeeExit.update({
            where: { id: exitId },
            data: { status: "COMPLETED" },
        });
        // Notify admins about exit completion (for write-off / asset reconciliation)
        const adminIds = yield (0, notificationHelper_1.getAdminIds)();
        if (adminIds.length > 0) {
            (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Employee Exit Completed",
                message: `Exit record ${exit.exitNumber} marked as completed${exit.assetsPending > 0 ? ` with ${exit.assetsPending} asset(s) still pending handover` : ""}`,
                recipientIds: adminIds,
                priority: exit.assetsPending > 0 ? "HIGH" : "MEDIUM",
                createdById: user.employeeDbId,
            }).catch(() => { });
        }
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to complete exit" });
    }
});
exports.completeExit = completeExit;
// GET /api/employee-exit/employee/:employeeId — get exit record for a specific employee
const getExitByEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const empId = Number(req.params.employeeId);
        const exits = yield prismaClient_1.default.employeeExit.findMany({
            where: { employeeId: empId },
            include: {
                handoverItems: {
                    include: {
                        asset: { select: { id: true, assetId: true, assetName: true, status: true } },
                    },
                },
            },
            orderBy: { id: "desc" },
        });
        res.json(exits);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch exit records" });
    }
});
exports.getExitByEmployee = getExitByEmployee;

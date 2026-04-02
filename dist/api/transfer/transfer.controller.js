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
exports.managementApproveTransfer = exports.getPendingMgmtApprovals = exports.getTransferredAssetReturnChecklist = exports.completeTransferredAssetReturn = exports.getMyPendingTransferApprovals = exports.getPendingTransferRequests = exports.getTransferHistory = exports.approveTransferredAssetReturn = exports.requestTransferredAssetReturn = exports.returnTransferredAsset = exports.rejectAssetTransfer = exports.approveAssetTransfer = exports.requestAssetTransfer = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const basic_ftp_1 = require("basic-ftp");
const client_1 = require("@prisma/client");
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
function toDateOrNull(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
// POST /assets/transfer/request
const requestAssetTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { assetId, transferType, externalType, toBranchId, block, floor, room, destinationType, destinationName, destinationAddress, destinationContactPerson, destinationContactNumber, temporary, expiresAt, reason } = req.body;
        if (!assetId || !transferType) {
            res.status(400).json({ message: "assetId and transferType are required" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: Number(assetId) }
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const currentLocation = yield prismaClient_1.default.assetLocation.findFirst({
            where: { assetId: Number(assetId), isActive: true }
        });
        const transfer = yield prismaClient_1.default.assetTransferHistory.create({
            data: {
                assetId: Number(assetId),
                transferType,
                externalType: externalType || null,
                fromBranchId: (_a = currentLocation === null || currentLocation === void 0 ? void 0 : currentLocation.branchId) !== null && _a !== void 0 ? _a : null,
                toBranchId: toBranchId ? Number(toBranchId) : null,
                block: block || null,
                floor: floor || null,
                room: room || null,
                destinationType: destinationType || null,
                destinationName: destinationName || null,
                destinationAddress: destinationAddress || null,
                destinationContactPerson: destinationContactPerson || null,
                destinationContactNumber: destinationContactNumber || null,
                temporary: !!temporary,
                expiresAt: temporary ? toDateOrNull(expiresAt) : null,
                // Permanent transfers need management approval before HOD can approve
                managementApprovalStatus: (!temporary) ? "PENDING" : null,
                status: "REQUESTED",
                requestedById: (_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.employeeDbId) !== null && _c !== void 0 ? _c : null,
                reason: reason || null,
                transferDate: null
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true
            }
        });
        res.status(201).json({
            message: "Transfer request submitted",
            transfer
        });
    }
    catch (err) {
        console.error("Request transfer error:", err);
        res.status(500).json({ message: "Failed to submit transfer request" });
    }
});
exports.requestAssetTransfer = requestAssetTransfer;
// POST /assets/transfer/:id/approve
const approveAssetTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const transferId = Number(req.params.id);
        const { approvalReason } = req.body;
        const transfer = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: transferId }
        });
        if (!transfer) {
            res.status(404).json({ message: "Transfer request not found" });
            return;
        }
        if (transfer.status !== "REQUESTED") {
            res.status(400).json({ message: "Only requested transfers can be approved" });
            return;
        }
        const { asset, hod } = yield getAssetDepartmentHod(transfer.assetId);
        if (hod.id !== ((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId)) {
            res.status(403).json({ message: "Only asset department HOD can approve this transfer" });
            return;
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const currentLocation = yield tx.assetLocation.findFirst({
                where: { assetId: transfer.assetId, isActive: true }
            });
            const currentBranchId = (_a = currentLocation === null || currentLocation === void 0 ? void 0 : currentLocation.branchId) !== null && _a !== void 0 ? _a : null;
            yield tx.assetLocation.updateMany({
                where: { assetId: transfer.assetId, isActive: true },
                data: { isActive: false }
            });
            let newLocation = null;
            if (!(transfer.transferType === "EXTERNAL" && transfer.externalType === "DEAD")) {
                let targetBranchId = null;
                if (transfer.transferType === "INTERNAL") {
                    targetBranchId = currentBranchId;
                }
                else if (transfer.transferType === "EXTERNAL" && transfer.externalType === "BRANCH") {
                    targetBranchId = (_b = transfer.toBranchId) !== null && _b !== void 0 ? _b : null;
                }
                else {
                    // SERVICE / TEMP_USE / OTHER OUTSIDE
                    targetBranchId = currentBranchId;
                }
                if (targetBranchId) {
                    newLocation = yield tx.assetLocation.create({
                        data: {
                            assetId: transfer.assetId,
                            branchId: targetBranchId,
                            block: transfer.transferType === "INTERNAL" ? transfer.block : null,
                            floor: transfer.transferType === "INTERNAL" ? transfer.floor : null,
                            room: transfer.transferType === "INTERNAL" ? transfer.room : null,
                            isActive: true
                        }
                    });
                }
            }
            const updatedTransfer = yield tx.assetTransferHistory.update({
                where: { id: transfer.id },
                data: {
                    status: "APPROVED",
                    approvedById: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId) !== null && _d !== void 0 ? _d : null,
                    approvedAt: new Date(),
                    approvalReason: approvalReason || null,
                    transferDate: new Date(),
                    fromBranchId: (_e = transfer.fromBranchId) !== null && _e !== void 0 ? _e : currentBranchId
                },
                include: {
                    asset: true,
                    fromBranch: true,
                    toBranch: true,
                    requestedBy: true,
                    approvedBy: true
                }
            });
            if (transfer.externalType === "DEAD") {
                yield tx.asset.update({
                    where: { id: transfer.assetId },
                    data: { status: "DEAD" }
                });
            }
            // Auto-generate gate pass for external transfers (non-DEAD)
            let gatePass = null;
            if (transfer.transferType === "EXTERNAL" && transfer.externalType !== "DEAD") {
                const today = new Date();
                const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
                const gpCount = yield tx.gatePass.count({
                    where: { gatePassNo: { startsWith: `GP-${dateStr}` } },
                });
                const gatePassNo = `GP-${dateStr}-${String(gpCount + 1).padStart(4, "0")}`;
                gatePass = yield tx.gatePass.create({
                    data: {
                        gatePassNo,
                        type: "OUTWARD",
                        status: "ISSUED",
                        assetId: transfer.assetId,
                        issuedTo: (_g = (_f = transfer.destinationName) !== null && _f !== void 0 ? _f : transfer.destinationContactPerson) !== null && _g !== void 0 ? _g : "External",
                        purpose: (_h = transfer.reason) !== null && _h !== void 0 ? _h : `Transfer: ${transfer.externalType}`,
                        approvedBy: String((_k = (_j = req.user) === null || _j === void 0 ? void 0 : _j.employeeDbId) !== null && _k !== void 0 ? _k : "HOD"),
                        transferHistoryId: transfer.id,
                    },
                });
            }
            return { updatedTransfer, newLocation, gatePass };
        }));
        res.json(Object.assign({ message: "Transfer approved successfully" }, result));
    }
    catch (err) {
        console.error("Approve transfer error:", err);
        res.status(500).json({ message: "Failed to approve transfer" });
    }
});
exports.approveAssetTransfer = approveAssetTransfer;
// POST /assets/transfer/:id/reject
const rejectAssetTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const transferId = Number(req.params.id);
        const { rejectionReason } = req.body;
        const transfer = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: transferId }
        });
        if (!transfer) {
            res.status(404).json({ message: "Transfer request not found" });
            return;
        }
        if (transfer.status !== "REQUESTED") {
            res.status(400).json({ message: "Only requested transfers can be rejected" });
            return;
        }
        const { asset, hod } = yield getAssetDepartmentHod(transfer.assetId);
        if (hod.id !== ((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId)) {
            res.status(403).json({ message: "Only asset department HOD can reject this transfer" });
            return;
        }
        const updated = yield prismaClient_1.default.assetTransferHistory.update({
            where: { id: transferId },
            data: {
                status: "REJECTED",
                approvedById: (_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.employeeDbId) !== null && _c !== void 0 ? _c : null,
                rejectedAt: new Date(),
                rejectionReason: rejectionReason || null
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true
            }
        });
        res.json({
            message: "Transfer rejected",
            transfer: updated
        });
    }
    catch (err) {
        console.error("Reject transfer error:", err);
        res.status(500).json({ message: "Failed to reject transfer" });
    }
});
exports.rejectAssetTransfer = rejectAssetTransfer;
// POST /assets/transfer/:id/return
const returnTransferredAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const transferId = Number(req.params.id);
        const { returnReason } = req.body;
        const originalTransfer = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: transferId }
        });
        if (!originalTransfer) {
            res.status(404).json({ message: "Original transfer not found" });
            return;
        }
        if (originalTransfer.transferType === "RETURN") {
            res.status(400).json({ message: "Return entry cannot be returned again" });
            return;
        }
        if (originalTransfer.status !== "APPROVED") {
            res.status(400).json({ message: "Only approved transfers can be returned" });
            return;
        }
        if (!originalTransfer.temporary) {
            res.status(400).json({ message: "Only temporary transfers can be returned" });
            return;
        }
        if (!originalTransfer.fromBranchId) {
            res.status(400).json({ message: "Original branch not found for return" });
            return;
        }
        const existingReturn = yield prismaClient_1.default.assetTransferHistory.findFirst({
            where: {
                parentTransferId: originalTransfer.id,
                transferType: "RETURN"
            }
        });
        if (existingReturn) {
            res.status(400).json({ message: "This transfer has already been returned" });
            return;
        }
        const { hod } = yield getAssetDepartmentHod(originalTransfer.assetId);
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null;
        const canReturn = me === originalTransfer.requestedById || me === hod.id;
        if (!canReturn) {
            res.status(403).json({ message: "You are not allowed to return this asset" });
            return;
        }
        const currentLocation = yield prismaClient_1.default.assetLocation.findFirst({
            where: { assetId: originalTransfer.assetId, isActive: true }
        });
        const currentBranchId = (_c = currentLocation === null || currentLocation === void 0 ? void 0 : currentLocation.branchId) !== null && _c !== void 0 ? _c : null;
        yield prismaClient_1.default.assetLocation.updateMany({
            where: { assetId: originalTransfer.assetId, isActive: true },
            data: { isActive: false }
        });
        const newLocation = yield prismaClient_1.default.assetLocation.create({
            data: {
                assetId: originalTransfer.assetId,
                branchId: originalTransfer.fromBranchId,
                isActive: true
            }
        });
        const returnEntry = yield prismaClient_1.default.assetTransferHistory.create({
            data: {
                assetId: originalTransfer.assetId,
                transferType: "RETURN",
                externalType: null,
                fromBranchId: currentBranchId,
                toBranchId: originalTransfer.fromBranchId,
                destinationType: null,
                destinationName: null,
                destinationAddress: null,
                destinationContactPerson: null,
                destinationContactNumber: null,
                temporary: false,
                status: "RETURNED",
                requestedById: me,
                approvedById: me,
                requestedAt: new Date(),
                approvedAt: new Date(),
                returnedAt: new Date(),
                transferDate: new Date(),
                reason: returnReason || "Asset returned",
                returnReason: returnReason || null,
                parentTransferId: originalTransfer.id
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true,
                parentTransfer: true
            }
        });
        const updatedOriginalTransfer = yield prismaClient_1.default.assetTransferHistory.update({
            where: { id: originalTransfer.id },
            data: {
                status: "RETURNED",
                returnedAt: new Date()
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true
            }
        });
        res.json({
            message: "Asset returned successfully",
            returnEntry,
            updatedOriginalTransfer,
            newLocation
        });
    }
    catch (err) {
        console.error("Return transfer error:", err);
        res.status(500).json({ message: "Failed to return asset" });
    }
});
exports.returnTransferredAsset = returnTransferredAsset;
// POST /assets/transfer/:id/return
const requestTransferredAssetReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const transferId = Number(req.params.id);
        const { returnReason } = req.body;
        const originalTransfer = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: transferId }
        });
        if (!originalTransfer) {
            res.status(404).json({ message: "Original transfer not found" });
            return;
        }
        if (originalTransfer.transferType === "RETURN") {
            res.status(400).json({ message: "Return request cannot be created from a return row" });
            return;
        }
        if (originalTransfer.status !== "APPROVED") {
            res.status(400).json({ message: "Only approved transfers can be returned" });
            return;
        }
        if (!originalTransfer.temporary) {
            res.status(400).json({ message: "Only temporary transfers can be returned" });
            return;
        }
        if (!originalTransfer.fromBranchId) {
            res.status(400).json({ message: "Original branch not found for return" });
            return;
        }
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null;
        const existingReturnRequest = yield prismaClient_1.default.assetTransferHistory.findFirst({
            where: {
                parentTransferId: originalTransfer.id,
                transferType: "RETURN",
                status: {
                    in: ["REQUESTED", "RETURNED"]
                }
            }
        });
        if (existingReturnRequest) {
            res.status(400).json({ message: "Return request already exists for this transfer" });
            return;
        }
        const currentLocation = yield prismaClient_1.default.assetLocation.findFirst({
            where: { assetId: originalTransfer.assetId, isActive: true }
        });
        const returnRequest = yield prismaClient_1.default.assetTransferHistory.create({
            data: {
                assetId: originalTransfer.assetId,
                transferType: "RETURN",
                externalType: null,
                fromBranchId: (_c = currentLocation === null || currentLocation === void 0 ? void 0 : currentLocation.branchId) !== null && _c !== void 0 ? _c : null,
                toBranchId: originalTransfer.fromBranchId,
                destinationType: null,
                destinationName: null,
                destinationAddress: null,
                destinationContactPerson: null,
                destinationContactNumber: null,
                temporary: false,
                status: "REQUESTED",
                requestedById: me,
                approvedById: null,
                requestedAt: new Date(),
                approvedAt: null,
                returnedAt: null,
                transferDate: null,
                reason: returnReason || "Return requested",
                returnReason: returnReason || null,
                parentTransferId: originalTransfer.id
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true,
                parentTransfer: true
            }
        });
        res.status(201).json({
            message: "Return request submitted successfully",
            returnRequest
        });
    }
    catch (err) {
        console.error("Request return error:", err);
        res.status(500).json({ message: "Failed to request return" });
    }
});
exports.requestTransferredAssetReturn = requestTransferredAssetReturn;
// POST /assets/transfer/:id/approve-return
const approveTransferredAssetReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const returnTransferId = Number(req.params.id);
        const { approvalReason } = req.body;
        const returnRequest = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: returnTransferId },
            include: {
                parentTransfer: true
            }
        });
        if (!returnRequest) {
            res.status(404).json({ message: "Return request not found" });
            return;
        }
        if (returnRequest.transferType !== "RETURN") {
            res.status(400).json({ message: "Only return requests can be approved here" });
            return;
        }
        if (returnRequest.status !== "REQUESTED") {
            res.status(400).json({ message: "Only requested return entries can be approved" });
            return;
        }
        if (!returnRequest.parentTransfer) {
            res.status(400).json({ message: "Parent transfer not found for return request" });
            return;
        }
        const { hod } = yield getAssetDepartmentHod(returnRequest.assetId);
        if (hod.id !== ((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId)) {
            res.status(403).json({ message: "Only asset department HOD can approve this return" });
            return;
        }
        const approvedReturn = yield prismaClient_1.default.assetTransferHistory.update({
            where: { id: returnRequest.id },
            data: {
                status: "APPROVED",
                approvedById: (_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.employeeDbId) !== null && _c !== void 0 ? _c : null,
                approvedAt: new Date(),
                approvalReason: approvalReason || null
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true,
                parentTransfer: true
            }
        });
        res.json({
            message: "Return request approved. Awaiting physical return checklist submission.",
            approvedReturn
        });
    }
    catch (err) {
        console.error("Approve return error:", err);
        res.status(500).json({ message: "Failed to approve return" });
    }
});
exports.approveTransferredAssetReturn = approveTransferredAssetReturn;
// GET /assets/:assetId/transfer-history
const getTransferHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const history = yield prismaClient_1.default.assetTransferHistory.findMany({
            where: { assetId },
            include: {
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true,
                parentTransfer: true
            },
            orderBy: { createdAt: "desc" }
        });
        res.json(history);
    }
    catch (err) {
        console.error("Transfer history error:", err);
        res.status(500).json({ message: "Failed to fetch transfer history" });
    }
});
exports.getTransferHistory = getTransferHistory;
// GET /assets/transfer/pending
const getPendingTransferRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield prismaClient_1.default.assetTransferHistory.findMany({
            where: { status: "REQUESTED" },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true
            },
            orderBy: { requestedAt: "desc" }
        });
        res.json(rows);
    }
    catch (err) {
        console.error("Pending transfer requests error:", err);
        res.status(500).json({ message: "Failed to fetch pending requests" });
    }
});
exports.getPendingTransferRequests = getPendingTransferRequests;
const getMyPendingTransferApprovals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const employeeId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId;
        const me = yield prismaClient_1.default.employee.findUnique({
            where: { id: employeeId },
            select: { id: true, role: true, departmentId: true }
        });
        if (!me || me.role !== "HOD") {
            res.status(403).json({ message: "Only HOD can access pending transfer approvals" });
            return;
        }
        const rows = yield prismaClient_1.default.assetTransferHistory.findMany({
            where: {
                status: "REQUESTED",
                asset: {
                    departmentId: me.departmentId
                }
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                parentTransfer: {
                    include: {
                        fromBranch: true,
                        toBranch: true
                    }
                }
            },
            orderBy: {
                requestedAt: "desc"
            }
        });
        res.json(rows);
    }
    catch (err) {
        console.error("Pending transfer approvals error:", err);
        res.status(500).json({ message: "Failed to fetch pending approvals" });
    }
});
exports.getMyPendingTransferApprovals = getMyPendingTransferApprovals;
function getAssetDepartmentHod(assetId) {
    return __awaiter(this, void 0, void 0, function* () {
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetId },
            select: { id: true, departmentId: true }
        });
        if (!asset) {
            throw new Error("Asset not found");
        }
        if (!asset.departmentId) {
            throw new Error("Asset has no department assigned");
        }
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: {
                departmentId: asset.departmentId,
                role: "HOD"
            }
        });
        if (!hod) {
            throw new Error("No HOD found for asset department");
        }
        return { asset, hod };
    });
}
const completeTransferredAssetReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const returnTransferId = Number(req.params.id);
        const returnNote = req.body.returnNote;
        const digitalSignature = req.body.digitalSignature;
        let checklist = [];
        try {
            checklist = req.body.checklist ? JSON.parse(req.body.checklist) : [];
            if (!Array.isArray(checklist)) {
                res.status(400).json({ message: "Checklist must be an array" });
                return;
            }
        }
        catch (_d) {
            res.status(400).json({ message: "Invalid checklist format" });
            return;
        }
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const returnRequest = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: returnTransferId },
            include: {
                asset: {
                    select: {
                        id: true,
                        assetCategoryId: true
                    }
                },
                parentTransfer: true,
                requestedBy: true,
                approvedBy: true
            }
        });
        if (!returnRequest) {
            res.status(404).json({ message: "Return request not found" });
            return;
        }
        if (returnRequest.transferType !== "RETURN") {
            res.status(400).json({ message: "Only return request rows can be completed here" });
            return;
        }
        if (returnRequest.status !== "APPROVED") {
            res.status(400).json({ message: "Return request must be approved first" });
            return;
        }
        if (!returnRequest.parentTransferId || !returnRequest.parentTransfer) {
            res.status(400).json({ message: "Parent transfer not found" });
            return;
        }
        if (!returnRequest.toBranchId) {
            res.status(400).json({ message: "Return destination branch missing" });
            return;
        }
        // requester completes the physical return after approval
        if (returnRequest.requestedById !== employeeId) {
            res.status(403).json({
                message: "Only the requester can complete the return checklist"
            });
            return;
        }
        const templateWhere = {
            isActive: true,
            purpose: client_1.AcknowledgementPurpose.TRANSFER_RETURN,
            OR: [{ assetId: returnRequest.assetId }]
        };
        if (returnRequest.asset.assetCategoryId) {
            templateWhere.OR.push({
                assetCategoryId: returnRequest.asset.assetCategoryId
            });
        }
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.findFirst({
            where: templateWhere,
            include: {
                items: {
                    orderBy: { sortOrder: "asc" }
                }
            },
            orderBy: [{ assetId: "desc" }, { id: "desc" }]
        });
        if (template) {
            const validItemIds = new Set(template.items.map((item) => item.id));
            const invalidItems = checklist.filter((row) => !validItemIds.has(Number(row.itemId)));
            if (invalidItems.length > 0) {
                res.status(400).json({ message: "Checklist contains invalid items" });
                return;
            }
            const submittedMap = new Map();
            for (const row of checklist) {
                submittedMap.set(Number(row.itemId), {
                    checked: !!row.checked,
                    remarks: (_a = row.remarks) !== null && _a !== void 0 ? _a : null
                });
            }
            const missingRequired = template.items.filter((item) => { var _a; return item.isRequired && !((_a = submittedMap.get(item.id)) === null || _a === void 0 ? void 0 : _a.checked); });
            if (missingRequired.length > 0) {
                res.status(400).json({
                    message: "Please complete all required return checklist items",
                    missingItems: missingRequired.map((x) => ({
                        itemId: x.id,
                        title: x.title
                    }))
                });
                return;
            }
        }
        let photoUrl = null;
        if ((_b = req.file) === null || _b === void 0 ? void 0 : _b.path) {
            const original = req.file.originalname || `transfer-return-${returnTransferId}-${Date.now()}.jpg`;
            const remotePath = `/public_html/smartassets/return_photos/${Date.now()}-${original}`;
            photoUrl = yield uploadToFTP(req.file.path, remotePath);
            fs_1.default.unlinkSync(req.file.path);
        }
        const currentLocation = yield prismaClient_1.default.assetLocation.findFirst({
            where: { assetId: returnRequest.assetId, isActive: true }
        });
        const completedReturn = yield prismaClient_1.default.assetTransferHistory.update({
            where: { id: returnTransferId },
            data: {
                status: "RETURNED",
                returnedAt: new Date(),
                transferDate: new Date(),
                reason: returnNote || returnRequest.reason || "Asset returned with checklist"
            },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
                approvedBy: true,
                parentTransfer: true
            }
        });
        const updatedOriginalTransfer = yield prismaClient_1.default.assetTransferHistory.update({
            where: { id: returnRequest.parentTransferId },
            data: {
                status: "RETURNED",
                returnedAt: new Date()
            }
        });
        yield prismaClient_1.default.assetLocation.updateMany({
            where: { assetId: returnRequest.assetId, isActive: true },
            data: { isActive: false }
        });
        const newLocation = yield prismaClient_1.default.assetLocation.create({
            data: {
                assetId: returnRequest.assetId,
                branchId: returnRequest.toBranchId,
                isActive: true
            }
        });
        let acknowledgementRun = null;
        if (template) {
            acknowledgementRun = yield prismaClient_1.default.assetAcknowledgementRun.create({
                data: {
                    transferHistoryId: returnRequest.id,
                    assetId: returnRequest.assetId,
                    templateId: template.id,
                    assignedToId: employeeId,
                    acknowledgedAt: new Date(),
                    acknowledgedBy: (_c = req.user.employeeID) !== null && _c !== void 0 ? _c : String(employeeId),
                    remarks: returnNote !== null && returnNote !== void 0 ? returnNote : null,
                    digitalSignature: digitalSignature !== null && digitalSignature !== void 0 ? digitalSignature : null,
                    photoProof: photoUrl !== null && photoUrl !== void 0 ? photoUrl : null,
                    rows: {
                        create: checklist.map((row) => {
                            var _a;
                            return ({
                                itemId: Number(row.itemId),
                                checked: !!row.checked,
                                remarks: (_a = row.remarks) !== null && _a !== void 0 ? _a : null
                            });
                        })
                    }
                }
            });
        }
        res.json({
            message: "Asset return completed with checklist",
            completedReturn,
            updatedOriginalTransfer,
            newLocation,
            acknowledgementRun,
            previousLocation: currentLocation
        });
    }
    catch (err) {
        console.error("Complete transfer return error:", err);
        res.status(500).json({
            message: "Failed to complete asset return",
            error: err.message
        });
    }
});
exports.completeTransferredAssetReturn = completeTransferredAssetReturn;
const TEMP_FOLDER = path_1.default.join(__dirname, "../../temp");
if (!fs_1.default.existsSync(TEMP_FOLDER)) {
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
}
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = true;
        try {
            yield client.access(FTP_CONFIG);
            console.log("Connected to FTP server for asset image upload");
            const remoteDir = path_1.default.dirname(remoteFilePath);
            yield client.ensureDir(remoteDir);
            yield client.uploadFrom(localFilePath, remoteFilePath);
            console.log(`Uploaded asset image to: ${remoteFilePath}`);
            yield client.close();
            const fileName = path_1.default.basename(remoteFilePath);
            return `https://smartassets.inventionminds.com/assets_images/${fileName}`;
        }
        catch (error) {
            console.error("FTP upload error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const getTransferredAssetReturnChecklist = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const returnTransferId = Number(req.params.id);
        const returnRequest = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: returnTransferId },
            include: {
                asset: {
                    select: {
                        id: true,
                        assetCategoryId: true,
                        assetName: true,
                        referenceCode: true
                    }
                },
                parentTransfer: {
                    include: {
                        fromBranch: true,
                        toBranch: true
                    }
                },
                fromBranch: true,
                toBranch: true
            }
        });
        if (!returnRequest) {
            res.status(404).json({ message: "Return request not found" });
            return;
        }
        if (returnRequest.transferType !== "RETURN") {
            res.status(400).json({ message: "This row is not a return request" });
            return;
        }
        const templateWhere = {
            isActive: true,
            purpose: client_1.AcknowledgementPurpose.TRANSFER_RETURN,
            OR: [{ assetId: returnRequest.assetId }]
        };
        if (returnRequest.asset.assetCategoryId) {
            templateWhere.OR.push({
                assetCategoryId: returnRequest.asset.assetCategoryId
            });
        }
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.findFirst({
            where: templateWhere,
            include: {
                items: {
                    orderBy: { sortOrder: "asc" }
                }
            },
            orderBy: [{ assetId: "desc" }, { id: "desc" }]
        });
        res.json({
            transferId: returnRequest.id,
            assetId: returnRequest.assetId,
            asset: returnRequest.asset,
            status: returnRequest.status,
            template: template !== null && template !== void 0 ? template : null,
            items: (_a = template === null || template === void 0 ? void 0 : template.items) !== null && _a !== void 0 ? _a : [],
            fromBranch: returnRequest.fromBranch,
            toBranch: returnRequest.toBranch,
            parentTransfer: returnRequest.parentTransfer
        });
    }
    catch (err) {
        console.error("Get transfer return checklist error:", err);
        res.status(500).json({
            message: "Failed to fetch transfer return checklist",
            error: err.message
        });
    }
});
exports.getTransferredAssetReturnChecklist = getTransferredAssetReturnChecklist;
// POST /api/transfers/assets/transfer/:id/management-approve
// Management approves or rejects a permanent transfer before HOD approval
const getPendingMgmtApprovals = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield prismaClient_1.default.assetTransferHistory.findMany({
            where: { managementApprovalStatus: "PENDING" },
            include: {
                asset: true,
                fromBranch: true,
                toBranch: true,
                requestedBy: true,
            },
            orderBy: { requestedAt: "desc" },
        });
        res.json(rows);
    }
    catch (err) {
        console.error("getPendingMgmtApprovals error:", err);
        res.status(500).json({ message: "Failed to fetch pending management approvals" });
    }
});
exports.getPendingMgmtApprovals = getPendingMgmtApprovals;
const managementApproveTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const transferId = Number(req.params.id);
        const { decision, remarks } = req.body; // APPROVED | REJECTED
        if (!["APPROVED", "REJECTED"].includes(decision)) {
            res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
            return;
        }
        const transfer = yield prismaClient_1.default.assetTransferHistory.findUnique({
            where: { id: transferId },
        });
        if (!transfer) {
            res.status(404).json({ message: "Transfer not found" });
            return;
        }
        if (transfer.managementApprovalStatus !== "PENDING") {
            res.status(400).json({ message: "Management approval not pending for this transfer" });
            return;
        }
        const updated = yield prismaClient_1.default.assetTransferHistory.update({
            where: { id: transferId },
            data: {
                managementApprovalStatus: decision,
                managementApprovedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                managementApprovedAt: new Date(),
                managementRemarks: remarks !== null && remarks !== void 0 ? remarks : null,
                // If rejected, close the transfer
                status: decision === "REJECTED" ? "REJECTED" : "REQUESTED",
            },
        });
        res.json({ message: `Transfer ${decision.toLowerCase()} by management`, transfer: updated });
    }
    catch (err) {
        console.error("managementApproveTransfer error:", err);
        res.status(500).json({ message: "Failed to process management approval" });
    }
});
exports.managementApproveTransfer = managementApproveTransfer;

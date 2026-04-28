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
exports.getDisposalSubAssets = exports.completeDisposal = exports.rejectDisposal = exports.approveDisposal = exports.reviewDisposal = exports.requestDisposal = exports.getDisposalById = exports.getAllDisposals = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const audit_trail_controller_1 = require("../audit-trail/audit-trail.controller");
const notificationHelper_1 = require("../../utilis/notificationHelper");
const e_waste_controller_1 = require("../e-waste/e-waste.controller");
// GET /disposals
const getAllDisposals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, disposalType, assetId, page = "1", limit = "10", } = req.query;
        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (status)
            where.status = String(status);
        if (disposalType)
            where.disposalType = String(disposalType);
        if (assetId)
            where.assetId = Number(assetId);
        // Department-based scoping for non-admin users via asset
        const user = req.user;
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            const deptAssets = yield prismaClient_1.default.asset.findMany({
                where: { departmentId: Number(user.departmentId) },
                select: { id: true },
            });
            const scopedAssetIds = deptAssets.map(a => a.id);
            if (!assetId) {
                where.assetId = { in: scopedAssetIds };
            }
        }
        const [disposals, total] = yield Promise.all([
            prismaClient_1.default.assetDisposal.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { createdAt: "desc" },
                include: {
                    asset: {
                        select: { id: true, assetName: true, assetId: true },
                    },
                },
            }),
            prismaClient_1.default.assetDisposal.count({ where }),
        ]);
        res.json({
            data: disposals,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    }
    catch (error) {
        console.error("Error fetching disposals:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAllDisposals = getAllDisposals;
// GET /disposals/:id
const getDisposalById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
            include: {
                asset: true,
            },
        });
        if (!disposal) {
            res.status(404).json({ message: "Disposal not found" });
            return;
        }
        res.json({ data: disposal });
    }
    catch (error) {
        console.error("Error fetching disposal:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getDisposalById = getDisposalById;
// POST /disposals
const requestDisposal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const { assetId, disposalType, reason, estimatedScrapValue } = req.body;
        if (!assetId || !disposalType || !reason) {
            res.status(400).json({ message: "assetId, disposalType, and reason are required" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: Number(assetId) },
            include: { depreciation: { select: { currentBookValue: true } } },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        // Capture book value at time of disposal request
        const bookValueAtDisposal = ((_a = asset.depreciation) === null || _a === void 0 ? void 0 : _a.currentBookValue) != null
            ? Number(asset.depreciation.currentBookValue)
            : Number((_c = (_b = asset.purchaseCost) !== null && _b !== void 0 ? _b : asset.estimatedValue) !== null && _c !== void 0 ? _c : 0) || null;
        const disposal = yield prismaClient_1.default.assetDisposal.create({
            data: {
                assetId: Number(assetId),
                disposalType,
                reason,
                estimatedScrapValue: estimatedScrapValue != null ? estimatedScrapValue : null,
                bookValueAtDisposal: bookValueAtDisposal,
                status: "REQUESTED",
                requestedById: (_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.id) !== null && _e !== void 0 ? _e : null,
                requestedAt: new Date(),
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "DISPOSAL", entityId: disposal.id, action: "CREATE", description: `Disposal request created for asset #${assetId} (${disposalType})`, performedById: (_f = req.user) === null || _f === void 0 ? void 0 : _f.employeeDbId });
        // Notify admins about new disposal request
        const adminIds = yield (0, notificationHelper_1.getAdminIds)();
        (0, notificationHelper_1.notify)({ type: "DISPOSAL", title: "Disposal Request", message: `Disposal request for asset ${asset.assetId} — ${asset.assetName} (${disposalType})`, recipientIds: adminIds, assetId: Number(assetId), createdById: (_g = req.user) === null || _g === void 0 ? void 0 : _g.employeeDbId });
        res.status(201).json({ data: disposal, message: "Disposal request created successfully" });
    }
    catch (error) {
        console.error("Error creating disposal request:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.requestDisposal = requestDisposal;
// PUT /disposals/:id/review
const reviewDisposal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const { committeeMembers, committeeRemarks } = req.body;
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
        });
        if (!disposal) {
            res.status(404).json({ message: "Disposal not found" });
            return;
        }
        if (disposal.status !== "REQUESTED") {
            res.status(400).json({ message: "Disposal must be in REQUESTED status to move to review" });
            return;
        }
        const updated = yield prismaClient_1.default.assetDisposal.update({
            where: { id: Number(id) },
            data: {
                status: "COMMITTEE_REVIEW",
                committeeMembers: committeeMembers || null,
                committeeRemarks: committeeRemarks || null,
            },
            include: { asset: { select: { assetId: true, assetName: true } } },
        });
        // Notify admins that disposal is under committee review
        const reviewAdminIds = yield (0, notificationHelper_1.getAdminIds)();
        (0, notificationHelper_1.notify)({ type: "DISPOSAL", title: "Disposal Under Committee Review", message: `Disposal of asset ${(_a = updated.asset) === null || _a === void 0 ? void 0 : _a.assetId} — ${(_b = updated.asset) === null || _b === void 0 ? void 0 : _b.assetName} has been sent to committee review${committeeRemarks ? `. Remarks: ${committeeRemarks}` : ""}`, recipientIds: reviewAdminIds, assetId: disposal.assetId });
        res.json({ data: updated, message: "Disposal moved to committee review" });
    }
    catch (error) {
        console.error("Error reviewing disposal:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.reviewDisposal = reviewDisposal;
// PUT /disposals/:id/approve
const approveDisposal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id } = req.params;
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
            include: { asset: { select: { assetId: true, assetName: true } } },
        });
        if (!disposal) {
            res.status(404).json({ message: "Disposal not found" });
            return;
        }
        if (disposal.status !== "COMMITTEE_REVIEW") {
            res.status(400).json({ message: "Disposal must be in COMMITTEE_REVIEW status to approve" });
            return;
        }
        const now = new Date();
        // subAssetResolutions: [{ subAssetId: number, action: "CONDEMN"|"MOVE_TO_STORE"|"RELINK", newParentAssetId?: number }]
        const subAssetResolutions = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.subAssetResolutions) !== null && _b !== void 0 ? _b : [];
        const updated = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const updatedDisposal = yield tx.assetDisposal.update({
                where: { id: Number(id) },
                data: {
                    status: "APPROVED",
                    approvedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                    approvedAt: now,
                    committeeApprovalDate: now,
                },
            });
            yield tx.asset.update({
                where: { id: disposal.assetId },
                data: {
                    status: "DISPOSED",
                    disposalMethod: disposal.disposalType,
                    disposalDate: now,
                },
            });
            // Process each sub-asset resolution
            for (const r of subAssetResolutions) {
                if (r.action === "CONDEMN") {
                    yield tx.asset.update({ where: { id: r.subAssetId }, data: { status: "CONDEMNED", parentAssetId: null } });
                }
                else if (r.action === "MOVE_TO_STORE") {
                    yield tx.asset.update({ where: { id: r.subAssetId }, data: { status: "IN_STORE", parentAssetId: null } });
                }
                else if (r.action === "RELINK" && r.newParentAssetId) {
                    yield tx.asset.update({ where: { id: r.subAssetId }, data: { parentAssetId: r.newParentAssetId } });
                }
            }
            // Any remaining sub-assets not in the resolution list: detach from scrapped parent
            const resolvedIds = subAssetResolutions.map(r => r.subAssetId);
            yield tx.asset.updateMany({
                where: Object.assign({ parentAssetId: disposal.assetId }, (resolvedIds.length ? { id: { notIn: resolvedIds } } : {})),
                data: { parentAssetId: null },
            });
            return updatedDisposal;
        }));
        (0, audit_trail_controller_1.logAction)({ entityType: "DISPOSAL", entityId: Number(id), action: "APPROVE", description: `Disposal #${id} approved for asset #${disposal.assetId}`, performedById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        // Notify requester that disposal is approved
        if (disposal.requestedById)
            (0, notificationHelper_1.notify)({ type: "DISPOSAL", title: "Disposal Approved", message: `Disposal of asset ${disposal.asset.assetId} — ${disposal.asset.assetName} has been approved`, recipientIds: [disposal.requestedById].filter(Boolean), assetId: disposal.assetId, channel: "BOTH", templateCode: "DISPOSAL_APPROVED", templateData: { assetName: `${disposal.asset.assetId} — ${disposal.asset.assetName}` } });
        res.json({ data: updated, message: "Disposal approved and asset marked as disposed" });
    }
    catch (error) {
        console.error("Error approving disposal:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.approveDisposal = approveDisposal;
// PUT /disposals/:id/reject
const rejectDisposal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { rejectionReason } = req.body;
        if (!rejectionReason) {
            res.status(400).json({ message: "rejectionReason is required" });
            return;
        }
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
            include: { asset: { select: { assetId: true, assetName: true } } },
        });
        if (!disposal) {
            res.status(404).json({ message: "Disposal not found" });
            return;
        }
        if (disposal.status !== "COMMITTEE_REVIEW" && disposal.status !== "REQUESTED") {
            res.status(400).json({ message: "Disposal cannot be rejected in its current status" });
            return;
        }
        const updated = yield prismaClient_1.default.assetDisposal.update({
            where: { id: Number(id) },
            data: {
                status: "REJECTED",
                rejectionReason,
                rejectedAt: new Date(),
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "DISPOSAL", entityId: Number(id), action: "STATUS_CHANGE", description: `Disposal #${id} rejected`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        // Notify requester that disposal is rejected
        if (disposal.requestedById)
            (0, notificationHelper_1.notify)({ type: "DISPOSAL", title: "Disposal Rejected", message: `Disposal of asset ${disposal.asset.assetId} — ${disposal.asset.assetName} has been rejected: ${rejectionReason}`, recipientIds: [disposal.requestedById].filter(Boolean), assetId: disposal.assetId });
        res.json({ data: updated, message: "Disposal rejected" });
    }
    catch (error) {
        console.error("Error rejecting disposal:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.rejectDisposal = rejectDisposal;
// PUT /disposals/:id/complete
const completeDisposal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { id } = req.params;
        const { actualSaleValue, buyerName, buyerContact, certificateUrl } = req.body;
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
        });
        if (!disposal) {
            res.status(404).json({ message: "Disposal not found" });
            return;
        }
        if (disposal.status !== "APPROVED") {
            res.status(400).json({ message: "Disposal must be in APPROVED status to complete" });
            return;
        }
        const bookVal = disposal.bookValueAtDisposal != null ? Number(disposal.bookValueAtDisposal) : null;
        const saleVal = actualSaleValue != null ? Number(actualSaleValue) : null;
        const netGainLoss = (bookVal != null && saleVal != null) ? saleVal - bookVal : null;
        const updated = yield prismaClient_1.default.assetDisposal.update({
            where: { id: Number(id) },
            data: {
                status: "COMPLETED",
                actualSaleValue: actualSaleValue != null ? actualSaleValue : null,
                netGainLoss: netGainLoss,
                buyerName: buyerName || null,
                buyerContact: buyerContact || null,
                certificateUrl: certificateUrl || null,
                completedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                completedAt: new Date(),
            },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "DISPOSAL", entityId: Number(id), action: "STATUS_CHANGE", description: `Disposal #${id} completed${saleVal != null ? `, sale value ${saleVal}` : ""}`, performedById: (_c = req.user) === null || _c === void 0 ? void 0 : _c.employeeDbId });
        // Notify admins/finance about disposal completion
        const completeAdminIds = yield (0, notificationHelper_1.getAdminIds)();
        (0, notificationHelper_1.notify)({ type: "DISPOSAL", title: "Disposal Completed", message: `Disposal #${id} completed${saleVal != null ? `. Sale value: ${saleVal}` : ""}${netGainLoss != null ? `. Net gain/loss: ${netGainLoss}` : ""}`, recipientIds: completeAdminIds, assetId: disposal.assetId });
        // Auto-create e-waste record for SCRAP disposals
        if (disposal.disposalType === "SCRAP") {
            yield (0, e_waste_controller_1.autoCreateEWasteRecord)(disposal.id, disposal.assetId, (_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.employeeDbId) !== null && _e !== void 0 ? _e : null);
        }
        res.json({ data: updated, message: "Disposal completed successfully" });
    }
    catch (error) {
        console.error("Error completing disposal:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.completeDisposal = completeDisposal;
// GET /disposals/:id/sub-assets
// Returns sub-assets of the asset being disposed, so the frontend can prompt for resolution
const getDisposalSubAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
            select: { assetId: true },
        });
        if (!disposal) {
            res.status(404).json({ message: "Disposal not found" });
            return;
        }
        const subAssets = yield prismaClient_1.default.asset.findMany({
            where: { parentAssetId: disposal.assetId },
            select: {
                id: true, assetId: true, assetName: true, serialNumber: true,
                status: true, workingCondition: true,
            },
        });
        res.json({ subAssets, count: subAssets.length });
    }
    catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getDisposalSubAssets = getDisposalSubAssets;

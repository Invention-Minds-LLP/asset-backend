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
exports.completeDisposal = exports.rejectDisposal = exports.approveDisposal = exports.reviewDisposal = exports.requestDisposal = exports.getDisposalById = exports.getAllDisposals = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
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
    var _a, _b, _c, _d, _e;
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
        });
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
    try {
        const { id } = req.params;
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
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
            return updatedDisposal;
        }));
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
    try {
        const { id } = req.params;
        const { rejectionReason } = req.body;
        if (!rejectionReason) {
            res.status(400).json({ message: "rejectionReason is required" });
            return;
        }
        const disposal = yield prismaClient_1.default.assetDisposal.findUnique({
            where: { id: Number(id) },
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
    var _a, _b;
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
        res.json({ data: updated, message: "Disposal completed successfully" });
    }
    catch (error) {
        console.error("Error completing disposal:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.completeDisposal = completeDisposal;

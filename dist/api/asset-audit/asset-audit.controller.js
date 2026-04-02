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
exports.getAuditSummary = exports.completeAudit = exports.verifyItem = exports.startAudit = exports.createAudit = exports.getAuditById = exports.getAllAudits = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// GET /asset-audits
const getAllAudits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = "1", limit = "10" } = req.query;
        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const skip = (pageNum - 1) * limitNum;
        const [audits, total] = yield Promise.all([
            prismaClient_1.default.assetAudit.findMany({
                skip,
                take: limitNum,
                orderBy: { createdAt: "desc" },
            }),
            prismaClient_1.default.assetAudit.count(),
        ]);
        res.json({
            data: audits,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    }
    catch (error) {
        console.error("Error fetching audits:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAllAudits = getAllAudits;
// GET /asset-audits/:id
const getAuditById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const audit = yield prismaClient_1.default.assetAudit.findUnique({
            where: { id: Number(id) },
            include: {
                items: {
                    include: {
                        asset: true,
                    },
                },
            },
        });
        if (!audit) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        res.json({ data: audit });
    }
    catch (error) {
        console.error("Error fetching audit:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAuditById = getAuditById;
// POST /asset-audits
const createAudit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { auditName, auditDate, departmentId, branchId } = req.body;
        if (!auditName || !auditDate) {
            res.status(400).json({ message: "auditName and auditDate are required" });
            return;
        }
        const assetWhere = {};
        if (departmentId)
            assetWhere.departmentId = Number(departmentId);
        if (branchId)
            assetWhere.branchId = Number(branchId);
        const assets = yield prismaClient_1.default.asset.findMany({
            where: assetWhere,
            select: { id: true },
        });
        const audit = yield prismaClient_1.default.assetAudit.create({
            data: {
                auditName,
                auditDate: new Date(auditDate),
                status: "PLANNED",
                departmentId: departmentId ? Number(departmentId) : null,
                branchId: branchId ? Number(branchId) : null,
                conductedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                totalAssets: assets.length,
                items: {
                    create: assets.map((asset) => ({
                        assetId: asset.id,
                        status: "PENDING",
                    })),
                },
            },
            include: {
                items: true,
            },
        });
        res.status(201).json({ data: audit, message: "Audit created successfully" });
    }
    catch (error) {
        console.error("Error creating audit:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.createAudit = createAudit;
// PUT /asset-audits/:id/start
const startAudit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const audit = yield prismaClient_1.default.assetAudit.findUnique({
            where: { id: Number(id) },
        });
        if (!audit) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        if (audit.status !== "PLANNED") {
            res.status(400).json({ message: "Audit must be in PLANNED status to start" });
            return;
        }
        const updated = yield prismaClient_1.default.assetAudit.update({
            where: { id: Number(id) },
            data: { status: "IN_PROGRESS" },
        });
        res.json({ data: updated, message: "Audit started" });
    }
    catch (error) {
        console.error("Error starting audit:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.startAudit = startAudit;
// PUT /asset-audits/items/:itemId/verify
const verifyItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { itemId } = req.params;
        const { status, locationMatch, conditionMatch, actualLocation, actualCondition, remarks, } = req.body;
        if (!status || !["VERIFIED", "MISSING", "MISMATCH"].includes(status)) {
            res.status(400).json({ message: "status must be one of VERIFIED, MISSING, or MISMATCH" });
            return;
        }
        const item = yield prismaClient_1.default.assetAuditItem.findUnique({
            where: { id: Number(itemId) },
        });
        if (!item) {
            res.status(404).json({ message: "Audit item not found" });
            return;
        }
        const updated = yield prismaClient_1.default.assetAuditItem.update({
            where: { id: Number(itemId) },
            data: {
                status,
                scannedAt: new Date(),
                locationMatch: locationMatch != null ? locationMatch : null,
                conditionMatch: conditionMatch != null ? conditionMatch : null,
                actualLocation: actualLocation || null,
                actualCondition: actualCondition || null,
                remarks: remarks || null,
                verifiedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            },
        });
        res.json({ data: updated, message: "Audit item verified" });
    }
    catch (error) {
        console.error("Error verifying audit item:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.verifyItem = verifyItem;
// PUT /asset-audits/:id/complete
const completeAudit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const audit = yield prismaClient_1.default.assetAudit.findUnique({
            where: { id: Number(id) },
        });
        if (!audit) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        if (audit.status !== "IN_PROGRESS") {
            res.status(400).json({ message: "Audit must be in IN_PROGRESS status to complete" });
            return;
        }
        const items = yield prismaClient_1.default.assetAuditItem.findMany({
            where: { auditId: Number(id) },
        });
        const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
        const missingCount = items.filter((i) => i.status === "MISSING").length;
        const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;
        const updated = yield prismaClient_1.default.assetAudit.update({
            where: { id: Number(id) },
            data: {
                status: "COMPLETED",
                verifiedCount,
                missingCount,
                mismatchCount,
                completedAt: new Date(),
            },
        });
        res.json({ data: updated, message: "Audit completed" });
    }
    catch (error) {
        console.error("Error completing audit:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.completeAudit = completeAudit;
// GET /asset-audits/:id/summary
const getAuditSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const audit = yield prismaClient_1.default.assetAudit.findUnique({
            where: { id: Number(id) },
        });
        if (!audit) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        const items = yield prismaClient_1.default.assetAuditItem.findMany({
            where: { auditId: Number(id) },
            include: {
                asset: {
                    select: { id: true, assetName: true, assetId: true },
                },
            },
        });
        const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
        const missingCount = items.filter((i) => i.status === "MISSING").length;
        const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;
        const pendingCount = items.filter((i) => i.status === "PENDING").length;
        const missingItems = items.filter((i) => i.status === "MISSING");
        const mismatchItems = items.filter((i) => i.status === "MISMATCH");
        res.json({
            data: {
                auditId: audit.id,
                auditName: audit.auditName,
                status: audit.status,
                totalAssets: audit.totalAssets,
                verifiedCount,
                missingCount,
                mismatchCount,
                pendingCount,
                missingItems,
                mismatchItems,
            },
        });
    }
    catch (error) {
        console.error("Error fetching audit summary:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAuditSummary = getAuditSummary;

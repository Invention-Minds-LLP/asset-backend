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
exports.getAuditSummary = exports.completeAudit = exports.verifyItem = exports.startAudit = exports.createAudit = exports.getAuditLocationOptions = exports.getAuditById = exports.getAllAudits = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
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
// GET /asset-audits/locations — distinct floor/block/room values from active approved locations
const getAuditLocationOptions = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield prismaClient_1.default.assetLocation.findMany({
            where: { isActive: true, status: "APPROVED" },
            select: { floor: true, block: true, room: true },
            distinct: ["floor", "block", "room"],
            orderBy: [{ floor: "asc" }, { block: "asc" }, { room: "asc" }],
        });
        const floors = [...new Set(rows.map(r => r.floor).filter(Boolean))].sort();
        const blocks = [...new Set(rows.map(r => r.block).filter(Boolean))].sort();
        const rooms = [...new Set(rows.map(r => r.room).filter(Boolean))].sort();
        res.json({ data: { floors, blocks, rooms, all: rows } });
    }
    catch (error) {
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getAuditLocationOptions = getAuditLocationOptions;
// POST /asset-audits
const createAudit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { auditName, auditDate, departmentId, branchId, floor, block, room } = req.body;
        if (!auditName || !auditDate) {
            res.status(400).json({ message: "auditName and auditDate are required" });
            return;
        }
        let assetIds;
        if (floor || block || room) {
            // Location-based: find assets whose current active approved location matches
            const locationWhere = { isActive: true, status: "APPROVED" };
            if (floor)
                locationWhere.floor = floor;
            if (block)
                locationWhere.block = block;
            if (room)
                locationWhere.room = room;
            const locations = yield prismaClient_1.default.assetLocation.findMany({
                where: locationWhere,
                select: { assetId: true },
                distinct: ["assetId"],
            });
            assetIds = locations.map(l => l.assetId);
            console.log(`Found ${assetIds.length} assets for location filter:`, { floor, block, room });
        }
        else {
            const assetWhere = { status: { not: "DISPOSED" } };
            if (departmentId)
                assetWhere.departmentId = Number(departmentId);
            if (branchId)
                assetWhere.branchId = Number(branchId);
            const assets = yield prismaClient_1.default.asset.findMany({ where: assetWhere, select: { id: true } });
            assetIds = assets.map(a => a.id);
        }
        const scopeNote = floor || block || room
            ? `Location: ${[floor, block, room].filter(Boolean).join(" / ")}`
            : undefined;
        const audit = yield prismaClient_1.default.assetAudit.create({
            data: Object.assign(Object.assign({ auditName, auditDate: new Date(auditDate), status: "PLANNED", departmentId: departmentId ? Number(departmentId) : null, branchId: branchId ? Number(branchId) : null, conductedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null, totalAssets: assetIds.length }, (scopeNote ? { description: scopeNote } : {})), { items: {
                    create: assetIds.map((id) => ({
                        assetId: id,
                        status: "PENDING",
                    })),
                } }),
            include: { items: true },
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
        // Notify admins with audit results
        (0, notificationHelper_1.getAdminIds)().then(adminIds => {
            var _a, _b;
            return (0, notificationHelper_1.notify)({
                type: "OTHER",
                title: "Asset Audit Completed",
                message: `Audit "${audit.auditName}" completed: ${verifiedCount} verified, ${missingCount} missing, ${mismatchCount} mismatched out of ${items.length} assets`,
                recipientIds: adminIds,
                priority: missingCount > 0 || mismatchCount > 0 ? "HIGH" : "MEDIUM",
                createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : undefined,
            });
        }).catch(() => { });
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

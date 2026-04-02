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
exports.getPendingAcknowledgements = exports.getRunById = exports.getRunsByAsset = exports.submitAcknowledgementRun = exports.createAcknowledgementRun = exports.addAcknowledgementItems = exports.deleteAcknowledgementTemplate = exports.updateAcknowledgementTemplate = exports.getAcknowledgementTemplateById = exports.getAllAcknowledgementTemplates = exports.createAcknowledgementTemplate = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Templates ─────────────────────────────────────────────────────────────────
const createAcknowledgementTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description, purpose, assetCategoryId, assetId, isActive } = req.body;
        if (!name) {
            res.status(400).json({ message: "name is required" });
            return;
        }
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.create({
            data: {
                name,
                description,
                purpose: purpose !== null && purpose !== void 0 ? purpose : "ASSIGNMENT",
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                assetId: assetId ? Number(assetId) : undefined,
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            },
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
            },
        });
        res.status(201).json(template);
    }
    catch (error) {
        console.error("createAcknowledgementTemplate error:", error);
        res.status(500).json({ message: "Failed to create template" });
    }
});
exports.createAcknowledgementTemplate = createAcknowledgementTemplate;
const getAllAcknowledgementTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetCategoryId, assetId, purpose, isActive } = req.query;
        const where = {};
        if (assetCategoryId)
            where.assetCategoryId = Number(assetCategoryId);
        if (assetId)
            where.assetId = Number(assetId);
        if (purpose)
            where.purpose = String(purpose);
        if (isActive !== undefined)
            where.isActive = isActive === "true";
        const templates = yield prismaClient_1.default.assetAcknowledgementTemplate.findMany({
            where,
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
                items: { orderBy: { sortOrder: "asc" } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(templates);
    }
    catch (error) {
        console.error("getAllAcknowledgementTemplates error:", error);
        res.status(500).json({ message: "Failed to fetch templates" });
    }
});
exports.getAllAcknowledgementTemplates = getAllAcknowledgementTemplates;
const getAcknowledgementTemplateById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.findUnique({
            where: { id },
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
                items: { orderBy: { sortOrder: "asc" } },
            },
        });
        if (!template) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        res.json(template);
    }
    catch (error) {
        console.error("getAcknowledgementTemplateById error:", error);
        res.status(500).json({ message: "Failed to fetch template" });
    }
});
exports.getAcknowledgementTemplateById = getAcknowledgementTemplateById;
const updateAcknowledgementTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.assetAcknowledgementTemplate.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        const updated = yield prismaClient_1.default.assetAcknowledgementTemplate.update({
            where: { id },
            data: req.body,
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateAcknowledgementTemplate error:", error);
        res.status(500).json({ message: "Failed to update template" });
    }
});
exports.updateAcknowledgementTemplate = updateAcknowledgementTemplate;
const deleteAcknowledgementTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.assetAcknowledgementTemplate.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        yield prismaClient_1.default.assetAcknowledgementItem.deleteMany({ where: { templateId: id } });
        yield prismaClient_1.default.assetAcknowledgementTemplate.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteAcknowledgementTemplate error:", error);
        res.status(500).json({ message: "Failed to delete template" });
    }
});
exports.deleteAcknowledgementTemplate = deleteAcknowledgementTemplate;
const addAcknowledgementItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templateId = parseInt(req.params.templateId);
        const { items } = req.body;
        if (!(items === null || items === void 0 ? void 0 : items.length)) {
            res.status(400).json({ message: "items array is required" });
            return;
        }
        const template = yield prismaClient_1.default.assetAcknowledgementTemplate.findUnique({ where: { id: templateId } });
        if (!template) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        const created = yield prismaClient_1.default.$transaction(items.map((item, idx) => {
            var _a;
            return prismaClient_1.default.assetAcknowledgementItem.create({
                data: {
                    templateId,
                    title: item.title,
                    description: item.description,
                    sortOrder: (_a = item.sortOrder) !== null && _a !== void 0 ? _a : idx,
                    isRequired: item.isRequired !== undefined ? item.isRequired : true,
                },
            });
        }));
        res.status(201).json(created);
    }
    catch (error) {
        console.error("addAcknowledgementItems error:", error);
        res.status(500).json({ message: "Failed to add items" });
    }
});
exports.addAcknowledgementItems = addAcknowledgementItems;
// ─── Runs ──────────────────────────────────────────────────────────────────────
const createAcknowledgementRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, templateId, assignedToId, transferHistoryId, assignmentId, } = req.body;
        if (!assetId) {
            res.status(400).json({ message: "assetId is required" });
            return;
        }
        // Resolve template items to pre-populate rows
        let itemRows = [];
        if (templateId) {
            const items = yield prismaClient_1.default.assetAcknowledgementItem.findMany({
                where: { templateId: Number(templateId) },
                orderBy: { sortOrder: "asc" },
            });
            itemRows = items.map((i) => ({ itemId: i.id }));
        }
        const run = yield prismaClient_1.default.assetAcknowledgementRun.create({
            data: {
                assetId: Number(assetId),
                templateId: templateId ? Number(templateId) : undefined,
                assignedToId: assignedToId ? Number(assignedToId) : undefined,
                transferHistoryId: transferHistoryId ? Number(transferHistoryId) : undefined,
                assignmentId: assignmentId ? Number(assignmentId) : undefined,
                rows: itemRows.length
                    ? {
                        create: itemRows.map((r) => ({
                            itemId: r.itemId,
                            checked: false,
                        })),
                    }
                    : undefined,
            },
            include: {
                asset: { select: { assetId: true, assetName: true } },
                template: { include: { items: { orderBy: { sortOrder: "asc" } } } },
                assignedTo: { select: { name: true, employeeID: true } },
                rows: { include: { item: true } },
            },
        });
        res.status(201).json(run);
    }
    catch (error) {
        console.error("createAcknowledgementRun error:", error);
        res.status(500).json({ message: "Failed to create acknowledgement run" });
    }
});
exports.createAcknowledgementRun = createAcknowledgementRun;
const submitAcknowledgementRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const runId = parseInt(req.params.runId);
        const { acknowledgedBy, remarks, digitalSignature, photoProof, rows, // [{ itemId, checked, remarks }]
         } = req.body;
        const run = yield prismaClient_1.default.assetAcknowledgementRun.findUnique({ where: { id: runId } });
        if (!run) {
            res.status(404).json({ message: "Acknowledgement run not found" });
            return;
        }
        // Update each row
        if (rows === null || rows === void 0 ? void 0 : rows.length) {
            yield prismaClient_1.default.$transaction(rows.map((r) => prismaClient_1.default.assetAcknowledgementResult.upsert({
                where: { runId_itemId: { runId, itemId: r.itemId } },
                create: { runId, itemId: r.itemId, checked: r.checked, remarks: r.remarks },
                update: { checked: r.checked, remarks: r.remarks },
            })));
        }
        const updated = yield prismaClient_1.default.assetAcknowledgementRun.update({
            where: { id: runId },
            data: {
                acknowledgedAt: new Date(),
                acknowledgedBy,
                remarks,
                digitalSignature,
                photoProof,
            },
            include: {
                asset: { select: { assetId: true, assetName: true } },
                rows: { include: { item: true } },
            },
        });
        res.json(updated);
    }
    catch (error) {
        console.error("submitAcknowledgementRun error:", error);
        res.status(500).json({ message: "Failed to submit acknowledgement" });
    }
});
exports.submitAcknowledgementRun = submitAcknowledgementRun;
const getRunsByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        const runs = yield prismaClient_1.default.assetAcknowledgementRun.findMany({
            where: { assetId },
            include: {
                template: { select: { name: true, purpose: true } },
                assignedTo: { select: { name: true, employeeID: true } },
                rows: { include: { item: { select: { title: true } } } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(runs);
    }
    catch (error) {
        console.error("getRunsByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch acknowledgement runs" });
    }
});
exports.getRunsByAsset = getRunsByAsset;
const getRunById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const run = yield prismaClient_1.default.assetAcknowledgementRun.findUnique({
            where: { id },
            include: {
                asset: { select: { assetId: true, assetName: true } },
                template: { include: { items: { orderBy: { sortOrder: "asc" } } } },
                assignedTo: { select: { name: true, employeeID: true } },
                rows: { include: { item: true } },
            },
        });
        if (!run) {
            res.status(404).json({ message: "Run not found" });
            return;
        }
        res.json(run);
    }
    catch (error) {
        console.error("getRunById error:", error);
        res.status(500).json({ message: "Failed to fetch run" });
    }
});
exports.getRunById = getRunById;
const getPendingAcknowledgements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const pending = yield prismaClient_1.default.assetAcknowledgementRun.findMany({
            where: {
                assignedToId: employeeId,
                acknowledgedAt: null,
            },
            include: {
                asset: { select: { assetId: true, assetName: true, assetType: true } },
                template: { select: { name: true, purpose: true } },
                rows: { include: { item: true } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(pending);
    }
    catch (error) {
        console.error("getPendingAcknowledgements error:", error);
        res.status(500).json({ message: "Failed to fetch pending acknowledgements" });
    }
});
exports.getPendingAcknowledgements = getPendingAcknowledgements;

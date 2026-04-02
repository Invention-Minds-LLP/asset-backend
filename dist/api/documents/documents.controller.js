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
exports.getDocumentStats = exports.getAllDocumentsPaginated = exports.getDocumentsByAsset = exports.deleteDocument = exports.getDocumentById = exports.getDocuments = exports.uploadDocument = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const UPLOAD_DIR = path_1.default.join(process.cwd(), "uploads", "documents");
// Ensure upload directory exists
if (!fs_1.default.existsSync(UPLOAD_DIR)) {
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const uploadDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const form = (0, formidable_1.default)({ uploadDir: UPLOAD_DIR, keepExtensions: true, maxFileSize: 20 * 1024 * 1024 });
    form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        if (err) {
            res.status(400).json({ message: "File upload failed", error: String(err) });
            return;
        }
        try {
            const entityType = Array.isArray(fields.entityType) ? fields.entityType[0] : fields.entityType;
            const entityId = Array.isArray(fields.entityId) ? fields.entityId[0] : fields.entityId;
            const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;
            const title = Array.isArray(fields.title) ? fields.title[0] : fields.title;
            const reason = Array.isArray(fields.reason) ? fields.reason[0] : fields.reason;
            const assetId = Array.isArray(fields.assetId) ? fields.assetId[0] : fields.assetId;
            if (!entityType || !entityId || !documentType) {
                res.status(400).json({ message: "entityType, entityId, and documentType are required" });
                return;
            }
            const fileField = files.file;
            const file = Array.isArray(fileField) ? fileField[0] : fileField;
            if (!file) {
                res.status(400).json({ message: "No file uploaded" });
                return;
            }
            const fileUrl = `/uploads/documents/${path_1.default.basename(file.filepath)}`;
            const doc = yield prismaClient_1.default.document.create({
                data: {
                    entityType: String(entityType),
                    entityId: Number(entityId),
                    documentType: String(documentType),
                    title: title ? String(title) : undefined,
                    fileUrl,
                    uploadedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId,
                    reason: reason ? String(reason) : undefined,
                    assetId: assetId ? Number(assetId) : undefined,
                },
                include: { uploadedBy: { select: { name: true, employeeID: true } } },
            });
            res.status(201).json(doc);
        }
        catch (error) {
            console.error("uploadDocument error:", error);
            res.status(500).json({ message: "Failed to save document record" });
        }
    }));
});
exports.uploadDocument = uploadDocument;
const getDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { entityType, entityId, documentType, assetId } = req.query;
        const where = {};
        if (entityType)
            where.entityType = String(entityType);
        if (entityId)
            where.entityId = Number(entityId);
        if (documentType)
            where.documentType = String(documentType);
        if (assetId)
            where.assetId = Number(assetId);
        const documents = yield prismaClient_1.default.document.findMany({
            where,
            include: { uploadedBy: { select: { name: true, employeeID: true } } },
            orderBy: { uploadedAt: "desc" },
        });
        res.json(documents);
    }
    catch (error) {
        console.error("getDocuments error:", error);
        res.status(500).json({ message: "Failed to fetch documents" });
    }
});
exports.getDocuments = getDocuments;
const getDocumentById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const doc = yield prismaClient_1.default.document.findUnique({
            where: { id },
            include: { uploadedBy: { select: { name: true, employeeID: true } } },
        });
        if (!doc) {
            res.status(404).json({ message: "Document not found" });
            return;
        }
        res.json(doc);
    }
    catch (error) {
        console.error("getDocumentById error:", error);
        res.status(500).json({ message: "Failed to fetch document" });
    }
});
exports.getDocumentById = getDocumentById;
const deleteDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const doc = yield prismaClient_1.default.document.findUnique({ where: { id } });
        if (!doc) {
            res.status(404).json({ message: "Document not found" });
            return;
        }
        // Remove physical file
        const filePath = path_1.default.join(process.cwd(), doc.fileUrl);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
        yield prismaClient_1.default.document.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteDocument error:", error);
        res.status(500).json({ message: "Failed to delete document" });
    }
});
exports.deleteDocument = deleteDocument;
const getDocumentsByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        const docs = yield prismaClient_1.default.document.findMany({
            where: { assetId },
            include: { uploadedBy: { select: { name: true, employeeID: true } } },
            orderBy: { uploadedAt: "desc" },
        });
        res.json(docs);
    }
    catch (error) {
        console.error("getDocumentsByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch asset documents" });
    }
});
exports.getDocumentsByAsset = getDocumentsByAsset;
// ─── Document Vault: All docs with pagination, filters, CSV export ───────────
const getAllDocumentsPaginated = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { entityType, documentType, search, page = "1", limit = "25", exportCsv } = req.query;
        const where = {};
        if (entityType)
            where.entityType = String(entityType);
        if (documentType)
            where.documentType = String(documentType);
        if (search) {
            where.OR = [
                { title: { contains: String(search) } },
                { fileUrl: { contains: String(search) } },
                { reason: { contains: String(search) } },
            ];
        }
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, documents] = yield Promise.all([
            prismaClient_1.default.document.count({ where }),
            prismaClient_1.default.document.findMany(Object.assign({ where, include: {
                    uploadedBy: { select: { name: true, employeeID: true } },
                    asset: { select: { assetId: true, assetName: true } },
                }, orderBy: { uploadedAt: "desc" } }, (exportCsv !== "true" ? { skip, take } : {}))),
        ]);
        if (exportCsv === "true") {
            const csvRows = documents.map((d) => {
                var _a, _b, _c;
                return ({
                    Title: d.title || "",
                    EntityType: d.entityType || "",
                    DocumentType: d.documentType || "",
                    AssetId: ((_a = d.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    AssetName: ((_b = d.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    UploadedBy: ((_c = d.uploadedBy) === null || _c === void 0 ? void 0 : _c.name) || "",
                    UploadedAt: d.uploadedAt ? new Date(d.uploadedAt).toISOString().split("T")[0] : "",
                    Reason: d.reason || "",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=documents.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json({ data: documents, total, page: parseInt(String(page)), limit: take });
    }
    catch (error) {
        console.error("getAllDocumentsPaginated error:", error);
        res.status(500).json({ message: "Failed to fetch documents" });
    }
});
exports.getAllDocumentsPaginated = getAllDocumentsPaginated;
// ─── Document Stats ──────────────────────────────────────────────────────────
const getDocumentStats = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [total, byEntityType, byDocType] = yield Promise.all([
            prismaClient_1.default.document.count(),
            prismaClient_1.default.document.groupBy({ by: ["entityType"], _count: { id: true } }),
            prismaClient_1.default.document.groupBy({ by: ["documentType"], _count: { id: true } }),
        ]);
        res.json({
            total,
            byEntityType: byEntityType.map((g) => ({ type: g.entityType, count: g._count.id })),
            byDocumentType: byDocType.map((g) => ({ type: g.documentType, count: g._count.id })),
        });
    }
    catch (error) {
        console.error("getDocumentStats error:", error);
        res.status(500).json({ message: "Failed to fetch document stats" });
    }
});
exports.getDocumentStats = getDocumentStats;

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import formidable from "formidable";
import fs from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "documents");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const uploadDocument = async (req: AuthenticatedRequest, res: Response) => {
  const form = formidable({ uploadDir: UPLOAD_DIR, keepExtensions: true, maxFileSize: 20 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
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

      const fileUrl = `/uploads/documents/${path.basename(file.filepath)}`;

      const doc = await prisma.document.create({
        data: {
          entityType: String(entityType),
          entityId: Number(entityId),
          documentType: String(documentType),
          title: title ? String(title) : undefined,
          fileUrl,
          uploadedById: req.user?.employeeDbId,
          reason: reason ? String(reason) : undefined,
          assetId: assetId ? Number(assetId) : undefined,
        },
        include: { uploadedBy: { select: { name: true, employeeID: true } } },
      });

      res.status(201).json(doc);
    } catch (error) {
      console.error("uploadDocument error:", error);
      res.status(500).json({ message: "Failed to save document record" });
    }
  });
};

export const getDocuments = async (req: Request, res: Response) => {
  try {
    const { entityType, entityId, documentType, assetId } = req.query;

    const where: any = {};
    if (entityType) where.entityType = String(entityType);
    if (entityId) where.entityId = Number(entityId);
    if (documentType) where.documentType = String(documentType);
    if (assetId) where.assetId = Number(assetId);

    const documents = await prisma.document.findMany({
      where,
      include: { uploadedBy: { select: { name: true, employeeID: true } } },
      orderBy: { uploadedAt: "desc" },
    });

    res.json(documents);
  } catch (error) {
    console.error("getDocuments error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
};

export const getDocumentById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const doc = await prisma.document.findUnique({
      where: { id },
      include: { uploadedBy: { select: { name: true, employeeID: true } } },
    });

    if (!doc) {
      res.status(404).json({ message: "Document not found" });
      return;
    }

    res.json(doc);
  } catch (error) {
    console.error("getDocumentById error:", error);
    res.status(500).json({ message: "Failed to fetch document" });
  }
};

export const deleteDocument = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const doc = await prisma.document.findUnique({ where: { id } });

    if (!doc) {
      res.status(404).json({ message: "Document not found" });
      return;
    }

    // Remove physical file
    const filePath = path.join(process.cwd(), doc.fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.document.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteDocument error:", error);
    res.status(500).json({ message: "Failed to delete document" });
  }
};

export const getDocumentsByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const docs = await prisma.document.findMany({
      where: { assetId },
      include: { uploadedBy: { select: { name: true, employeeID: true } } },
      orderBy: { uploadedAt: "desc" },
    });
    res.json(docs);
  } catch (error) {
    console.error("getDocumentsByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch asset documents" });
  }
};

// ─── Document Vault: All docs with pagination, filters, CSV export ───────────
export const getAllDocumentsPaginated = async (req: Request, res: Response) => {
  try {
    const { entityType, documentType, search, page = "1", limit = "25", exportCsv } = req.query;

    const where: any = {};
    if (entityType) where.entityType = String(entityType);
    if (documentType) where.documentType = String(documentType);
    if (search) {
      where.OR = [
        { title: { contains: String(search) } },
        { fileUrl: { contains: String(search) } },
        { reason: { contains: String(search) } },
      ];
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, documents] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        include: {
          uploadedBy: { select: { name: true, employeeID: true } },
          asset: { select: { assetId: true, assetName: true } },
        },
        orderBy: { uploadedAt: "desc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = documents.map((d: any) => ({
        Title: d.title || "",
        EntityType: d.entityType || "",
        DocumentType: d.documentType || "",
        AssetId: d.asset?.assetId || "",
        AssetName: d.asset?.assetName || "",
        UploadedBy: d.uploadedBy?.name || "",
        UploadedAt: d.uploadedAt ? new Date(d.uploadedAt).toISOString().split("T")[0] : "",
        Reason: d.reason || "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=documents.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: documents, total, page: parseInt(String(page)), limit: take });
  } catch (error) {
    console.error("getAllDocumentsPaginated error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
};

// ─── Document Stats ──────────────────────────────────────────────────────────
export const getDocumentStats = async (_req: Request, res: Response) => {
  try {
    const [total, byEntityType, byDocType] = await Promise.all([
      prisma.document.count(),
      prisma.document.groupBy({ by: ["entityType"], _count: { id: true } }),
      prisma.document.groupBy({ by: ["documentType"], _count: { id: true } }),
    ]);

    res.json({
      total,
      byEntityType: byEntityType.map((g) => ({ type: g.entityType, count: g._count.id })),
      byDocumentType: byDocType.map((g) => ({ type: g.documentType, count: g._count.id })),
    });
  } catch (error) {
    console.error("getDocumentStats error:", error);
    res.status(500).json({ message: "Failed to fetch document stats" });
  }
};

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── Templates ─────────────────────────────────────────────────────────────────

export const createAcknowledgementTemplate = async (req: Request, res: Response) => {
  try {
    const { name, description, purpose, assetCategoryId, assetId, isActive } = req.body;

    if (!name) {
      res.status(400).json({ message: "name is required" });
      return;
    }

    const template = await prisma.assetAcknowledgementTemplate.create({
      data: {
        name,
        description,
        purpose: purpose ?? "ASSIGNMENT",
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
  } catch (error) {
    console.error("createAcknowledgementTemplate error:", error);
    res.status(500).json({ message: "Failed to create template" });
  }
};

export const getAllAcknowledgementTemplates = async (req: Request, res: Response) => {
  try {
    const { assetCategoryId, assetId, purpose, isActive } = req.query;
    const where: any = {};
    if (assetCategoryId) where.assetCategoryId = Number(assetCategoryId);
    if (assetId) where.assetId = Number(assetId);
    if (purpose) where.purpose = String(purpose);
    if (isActive !== undefined) where.isActive = isActive === "true";

    const templates = await prisma.assetAcknowledgementTemplate.findMany({
      where,
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
        items: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(templates);
  } catch (error) {
    console.error("getAllAcknowledgementTemplates error:", error);
    res.status(500).json({ message: "Failed to fetch templates" });
  }
};

export const getAcknowledgementTemplateById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const template = await prisma.assetAcknowledgementTemplate.findUnique({
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
  } catch (error) {
    console.error("getAcknowledgementTemplateById error:", error);
    res.status(500).json({ message: "Failed to fetch template" });
  }
};

export const updateAcknowledgementTemplate = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.assetAcknowledgementTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    const updated = await prisma.assetAcknowledgementTemplate.update({
      where: { id },
      data: req.body,
    });
    res.json(updated);
  } catch (error) {
    console.error("updateAcknowledgementTemplate error:", error);
    res.status(500).json({ message: "Failed to update template" });
  }
};

export const deleteAcknowledgementTemplate = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.assetAcknowledgementTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    await prisma.assetAcknowledgementItem.deleteMany({ where: { templateId: id } });
    await prisma.assetAcknowledgementTemplate.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteAcknowledgementTemplate error:", error);
    res.status(500).json({ message: "Failed to delete template" });
  }
};

export const addAcknowledgementItems = async (req: Request, res: Response) => {
  try {
    const templateId = parseInt(req.params.templateId);
    const { items } = req.body as {
      items: { title: string; description?: string; sortOrder?: number; isRequired?: boolean }[];
    };

    if (!items?.length) {
      res.status(400).json({ message: "items array is required" });
      return;
    }

    const template = await prisma.assetAcknowledgementTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    const created = await prisma.$transaction(
      items.map((item, idx) =>
        prisma.assetAcknowledgementItem.create({
          data: {
            templateId,
            title: item.title,
            description: item.description,
            sortOrder: item.sortOrder ?? idx,
            isRequired: item.isRequired !== undefined ? item.isRequired : true,
          },
        })
      )
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("addAcknowledgementItems error:", error);
    res.status(500).json({ message: "Failed to add items" });
  }
};

// ─── Runs ──────────────────────────────────────────────────────────────────────

export const createAcknowledgementRun = async (req: Request, res: Response) => {
  try {
    const {
      assetId,
      templateId,
      assignedToId,
      transferHistoryId,
      assignmentId,
    } = req.body;

    if (!assetId) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }

    // Resolve template items to pre-populate rows
    let itemRows: { itemId: number }[] = [];
    if (templateId) {
      const items = await prisma.assetAcknowledgementItem.findMany({
        where: { templateId: Number(templateId) },
        orderBy: { sortOrder: "asc" },
      });
      itemRows = items.map((i) => ({ itemId: i.id }));
    }

    const run = await prisma.assetAcknowledgementRun.create({
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
  } catch (error) {
    console.error("createAcknowledgementRun error:", error);
    res.status(500).json({ message: "Failed to create acknowledgement run" });
  }
};

export const submitAcknowledgementRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = parseInt(req.params.runId);
    const {
      acknowledgedBy,
      remarks,
      digitalSignature,
      photoProof,
      rows,  // [{ itemId, checked, remarks }]
    } = req.body;

    const run = await prisma.assetAcknowledgementRun.findUnique({ where: { id: runId } });
    if (!run) {
      res.status(404).json({ message: "Acknowledgement run not found" });
      return;
    }

    // Update each row
    if (rows?.length) {
      await prisma.$transaction(
        rows.map((r: { itemId: number; checked: boolean; remarks?: string }) =>
          prisma.assetAcknowledgementResult.upsert({
            where: { runId_itemId: { runId, itemId: r.itemId } },
            create: { runId, itemId: r.itemId, checked: r.checked, remarks: r.remarks },
            update: { checked: r.checked, remarks: r.remarks },
          })
        )
      );
    }

    const updated = await prisma.assetAcknowledgementRun.update({
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
  } catch (error) {
    console.error("submitAcknowledgementRun error:", error);
    res.status(500).json({ message: "Failed to submit acknowledgement" });
  }
};

export const getRunsByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const runs = await prisma.assetAcknowledgementRun.findMany({
      where: { assetId },
      include: {
        template: { select: { name: true, purpose: true } },
        assignedTo: { select: { name: true, employeeID: true } },
        rows: { include: { item: { select: { title: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(runs);
  } catch (error) {
    console.error("getRunsByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch acknowledgement runs" });
  }
};

export const getRunById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const run = await prisma.assetAcknowledgementRun.findUnique({
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
  } catch (error) {
    console.error("getRunById error:", error);
    res.status(500).json({ message: "Failed to fetch run" });
  }
};

export const getPendingAcknowledgements = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;

    const pending = await prisma.assetAcknowledgementRun.findMany({
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
  } catch (error) {
    console.error("getPendingAcknowledgements error:", error);
    res.status(500).json({ message: "Failed to fetch pending acknowledgements" });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// GET /asset-audits
export const getAllAudits = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { page = "1", limit = "10" } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [audits, total] = await Promise.all([
      prisma.assetAudit.findMany({
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
      }),
      prisma.assetAudit.count(),
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
  } catch (error: any) {
    console.error("Error fetching audits:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audits/:id
export const getAuditById = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
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
  } catch (error: any) {
    console.error("Error fetching audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// POST /asset-audits
export const createAudit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { auditName, auditDate, departmentId, branchId } = req.body;

    if (!auditName || !auditDate) {
      res.status(400).json({ message: "auditName and auditDate are required" });
      return;
    }

    const assetWhere: any = {};
    if (departmentId) assetWhere.departmentId = Number(departmentId);
    if (branchId) assetWhere.branchId = Number(branchId);

    const assets = await prisma.asset.findMany({
      where: assetWhere,
      select: { id: true },
    });

    const audit = await prisma.assetAudit.create({
      data: {
        auditName,
        auditDate: new Date(auditDate),
        status: "PLANNED",
        departmentId: departmentId ? Number(departmentId) : null,
        branchId: branchId ? Number(branchId) : null,
        conductedById: req.user?.id ?? null,
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
  } catch (error: any) {
    console.error("Error creating audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /asset-audits/:id/start
export const startAudit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
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

    const updated = await prisma.assetAudit.update({
      where: { id: Number(id) },
      data: { status: "IN_PROGRESS" },
    });

    res.json({ data: updated, message: "Audit started" });
  } catch (error: any) {
    console.error("Error starting audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /asset-audits/items/:itemId/verify
export const verifyItem = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { itemId } = req.params;
    const {
      status,
      locationMatch,
      conditionMatch,
      actualLocation,
      actualCondition,
      remarks,
    } = req.body;

    if (!status || !["VERIFIED", "MISSING", "MISMATCH"].includes(status)) {
      res.status(400).json({ message: "status must be one of VERIFIED, MISSING, or MISMATCH" });
      return;
    }

    const item = await prisma.assetAuditItem.findUnique({
      where: { id: Number(itemId) },
    });

    if (!item) {
      res.status(404).json({ message: "Audit item not found" });
      return;
    }

    const updated = await prisma.assetAuditItem.update({
      where: { id: Number(itemId) },
      data: {
        status,
        scannedAt: new Date(),
        locationMatch: locationMatch != null ? locationMatch : null,
        conditionMatch: conditionMatch != null ? conditionMatch : null,
        actualLocation: actualLocation || null,
        actualCondition: actualCondition || null,
        remarks: remarks || null,
        verifiedById: req.user?.id ?? null,
      },
    });

    res.json({ data: updated, message: "Audit item verified" });
  } catch (error: any) {
    console.error("Error verifying audit item:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /asset-audits/:id/complete
export const completeAudit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
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

    const items = await prisma.assetAuditItem.findMany({
      where: { auditId: Number(id) },
    });

    const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
    const missingCount = items.filter((i) => i.status === "MISSING").length;
    const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;

    const updated = await prisma.assetAudit.update({
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
  } catch (error: any) {
    console.error("Error completing audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audits/:id/summary
export const getAuditSummary = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
      where: { id: Number(id) },
    });

    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    const items = await prisma.assetAuditItem.findMany({
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
  } catch (error: any) {
    console.error("Error fetching audit summary:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── Clone/Duplicate Asset ───────────────────────────────────────────────────
export const duplicateAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }

    const sourceId = Number(req.params.id);
    const { newAssetId, newSerialNumber } = req.body;

    if (!newAssetId || !newSerialNumber) {
      res.status(400).json({ message: "newAssetId and newSerialNumber are required" });
      return;
    }

    const source = await prisma.asset.findUnique({ where: { id: sourceId } });
    if (!source) {
      res.status(404).json({ message: "Source asset not found" });
      return;
    }

    // Check uniqueness
    const existing = await prisma.asset.findFirst({
      where: { OR: [{ assetId: newAssetId }, { serialNumber: newSerialNumber }] },
    });
    if (existing) {
      res.status(409).json({ message: "Asset ID or Serial Number already exists" });
      return;
    }

    // Clone asset - exclude IDs, unique fields, and timestamps
    const {
      id, assetId, serialNumber, rfidCode, qrCode, referenceCode,
      createdAt, updatedAt, createdById, updatedById,
      qrGeneratedAt, qrLabelPrinted, lastAuditDate, auditedBy,
      retiredDate, retiredReason, retiredBy, disposalMethod, disposalValue,
      disposalDate, disposalApprovedBy, disposalCertificate,
      ...cloneData
    } = source as any;

    const clone = await prisma.asset.create({
      data: {
        ...cloneData,
        assetId: newAssetId,
        serialNumber: newSerialNumber,
        status: "AVAILABLE",
        createdById: req.user.employeeDbId,
        updatedById: req.user.employeeDbId,
      },
    });

    res.status(201).json(clone);
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ message: "Duplicate unique field constraint" });
      return;
    }
    console.error("duplicateAsset error:", error);
    res.status(500).json({ message: "Failed to duplicate asset" });
  }
};

// ─── Bulk Status Update ──────────────────────────────────────────────────────
export const bulkUpdateStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }

    const { assetIds, status, remarks } = req.body;

    if (!Array.isArray(assetIds) || assetIds.length === 0 || !status) {
      res.status(400).json({ message: "assetIds (array) and status are required" });
      return;
    }

    const validStatuses = ["AVAILABLE", "IN_USE", "UNDER_MAINTENANCE", "RETIRED", "DISPOSED", "LOST", "IN_TRANSIT"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    const result = await prisma.asset.updateMany({
      where: { id: { in: assetIds.map(Number) } },
      data: {
        status,
        remarks: remarks || undefined,
        updatedById: req.user.employeeDbId,
      },
    });

    // Log to audit trail
    for (const aid of assetIds) {
      await prisma.auditLog.create({
        data: {
          entityType: "ASSET",
          entityId: Number(aid),
          action: "BULK_STATUS_UPDATE",
          performedById: req.user.employeeDbId,
          newValue: JSON.stringify({ status, remarks }),
        },
      });
    }

    res.json({ message: `${result.count} assets updated to ${status}`, count: result.count });
  } catch (error) {
    console.error("bulkUpdateStatus error:", error);
    res.status(500).json({ message: "Failed to update assets" });
  }
};

// ─── QR Bulk Print (returns data for frontend to render labels) ──────────────
export const getQRBulkPrintData = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assetIds } = req.body;

    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      res.status(400).json({ message: "assetIds (array) is required" });
      return;
    }

    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds.map(Number) } },
      select: {
        id: true,
        assetId: true,
        assetName: true,
        serialNumber: true,
        qrCode: true,
        department: { select: { name: true } },
        currentLocation: true,
        assetCategory: { select: { name: true } },
      },
    });

    // Generate QR data for each asset (the actual QR image generation happens on frontend)
    const printData = assets.map((a) => ({
      id: a.id,
      assetId: a.assetId,
      assetName: a.assetName,
      serialNumber: a.serialNumber,
      qrCode: a.qrCode || a.assetId, // fallback to assetId if no QR
      department: a.department?.name || "",
      location: a.currentLocation || "",
      category: a.assetCategory?.name || "",
      qrValue: JSON.stringify({
        assetId: a.assetId,
        serialNumber: a.serialNumber,
        name: a.assetName,
      }),
    }));

    // Mark as printed
    await prisma.asset.updateMany({
      where: { id: { in: assetIds.map(Number) } },
      data: { qrLabelPrinted: true },
    });

    res.json({ count: printData.length, printData });
  } catch (error) {
    console.error("getQRBulkPrintData error:", error);
    res.status(500).json({ message: "Failed to get QR print data" });
  }
};

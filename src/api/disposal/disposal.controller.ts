import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

// GET /disposals
export const getAllDisposals = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const {
      status,
      disposalType,
      assetId,
      page = "1",
      limit = "10",
    } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status) where.status = String(status);
    if (disposalType) where.disposalType = String(disposalType);
    if (assetId) where.assetId = Number(assetId);

    // Department-based scoping for non-admin users via asset
    const user = (req as any).user;
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      const scopedAssetIds = deptAssets.map(a => a.id);
      if (!assetId) {
        where.assetId = { in: scopedAssetIds };
      }
    }

    const [disposals, total] = await Promise.all([
      prisma.assetDisposal.findMany({
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
      prisma.assetDisposal.count({ where }),
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
  } catch (error: any) {
    console.error("Error fetching disposals:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /disposals/:id
export const getDisposalById = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const disposal = await prisma.assetDisposal.findUnique({
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
  } catch (error: any) {
    console.error("Error fetching disposal:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// POST /disposals
export const requestDisposal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { assetId, disposalType, reason, estimatedScrapValue } = req.body;

    if (!assetId || !disposalType || !reason) {
      res.status(400).json({ message: "assetId, disposalType, and reason are required" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
      include: { depreciation: { select: { currentBookValue: true } } },
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    // Capture book value at time of disposal request
    const bookValueAtDisposal =
      (asset as any).depreciation?.currentBookValue != null
        ? Number((asset as any).depreciation.currentBookValue)
        : Number(asset.purchaseCost ?? asset.estimatedValue ?? 0) || null;

    const disposal = await prisma.assetDisposal.create({
      data: {
        assetId: Number(assetId),
        disposalType,
        reason,
        estimatedScrapValue: estimatedScrapValue != null ? estimatedScrapValue : null,
        bookValueAtDisposal: bookValueAtDisposal,
        status: "REQUESTED",
        requestedById: req.user?.id ?? null,
        requestedAt: new Date(),
      } as any,
    });

    logAction({ entityType: "DISPOSAL", entityId: disposal.id, action: "CREATE", description: `Disposal request created for asset #${assetId} (${disposalType})`, performedById: req.user?.employeeDbId });

    // Notify admins about new disposal request
    const adminIds = await getAdminIds();
    notify({ type: "DISPOSAL", title: "Disposal Request", message: `Disposal request for asset #${assetId} (${disposalType})`, recipientIds: adminIds, assetId: Number(assetId), createdById: req.user?.employeeDbId });

    res.status(201).json({ data: disposal, message: "Disposal request created successfully" });
  } catch (error: any) {
    console.error("Error creating disposal request:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /disposals/:id/review
export const reviewDisposal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { committeeMembers, committeeRemarks } = req.body;

    const disposal = await prisma.assetDisposal.findUnique({
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

    const updated = await prisma.assetDisposal.update({
      where: { id: Number(id) },
      data: {
        status: "COMMITTEE_REVIEW",
        committeeMembers: committeeMembers || null,
        committeeRemarks: committeeRemarks || null,
      },
    });

    res.json({ data: updated, message: "Disposal moved to committee review" });
  } catch (error: any) {
    console.error("Error reviewing disposal:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /disposals/:id/approve
export const approveDisposal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const disposal = await prisma.assetDisposal.findUnique({
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

    const updated = await prisma.$transaction(async (tx) => {
      const updatedDisposal = await tx.assetDisposal.update({
        where: { id: Number(id) },
        data: {
          status: "APPROVED",
          approvedById: req.user?.id ?? null,
          approvedAt: now,
          committeeApprovalDate: now,
        },
      });

      await tx.asset.update({
        where: { id: disposal.assetId },
        data: {
          status: "DISPOSED",
          disposalMethod: disposal.disposalType,
          disposalDate: now,
        },
      });

      return updatedDisposal;
    });

    logAction({ entityType: "DISPOSAL", entityId: Number(id), action: "APPROVE", description: `Disposal #${id} approved for asset #${disposal.assetId}`, performedById: req.user?.employeeDbId });

    // Notify requester that disposal is approved
    if ((disposal as any).requestedById) notify({ type: "DISPOSAL", title: "Disposal Approved", message: `Disposal #${id} approved for asset #${disposal.assetId}`, recipientIds: [(disposal as any).requestedById].filter(Boolean) as number[], assetId: disposal.assetId, channel: "BOTH", templateCode: "DISPOSAL_APPROVED", templateData: { assetName: `Asset #${disposal.assetId}` } });

    res.json({ data: updated, message: "Disposal approved and asset marked as disposed" });
  } catch (error: any) {
    console.error("Error approving disposal:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /disposals/:id/reject
export const rejectDisposal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      res.status(400).json({ message: "rejectionReason is required" });
      return;
    }

    const disposal = await prisma.assetDisposal.findUnique({
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

    const updated = await prisma.assetDisposal.update({
      where: { id: Number(id) },
      data: {
        status: "REJECTED",
        rejectionReason,
        rejectedAt: new Date(),
      },
    });

    logAction({ entityType: "DISPOSAL", entityId: Number(id), action: "STATUS_CHANGE", description: `Disposal #${id} rejected`, performedById: req.user?.employeeDbId });

    // Notify requester that disposal is rejected
    if ((disposal as any).requestedById) notify({ type: "DISPOSAL", title: "Disposal Rejected", message: `Disposal #${id} rejected: ${rejectionReason}`, recipientIds: [(disposal as any).requestedById].filter(Boolean) as number[], assetId: disposal.assetId });

    res.json({ data: updated, message: "Disposal rejected" });
  } catch (error: any) {
    console.error("Error rejecting disposal:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /disposals/:id/complete
export const completeDisposal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { actualSaleValue, buyerName, buyerContact, certificateUrl } = req.body;

    const disposal = await prisma.assetDisposal.findUnique({
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

    const bookVal = disposal.bookValueAtDisposal != null ? Number((disposal as any).bookValueAtDisposal) : null;
    const saleVal = actualSaleValue != null ? Number(actualSaleValue) : null;
    const netGainLoss = (bookVal != null && saleVal != null) ? saleVal - bookVal : null;

    const updated = await prisma.assetDisposal.update({
      where: { id: Number(id) },
      data: {
        status: "COMPLETED",
        actualSaleValue: actualSaleValue != null ? actualSaleValue : null,
        netGainLoss: netGainLoss,
        buyerName: buyerName || null,
        buyerContact: buyerContact || null,
        certificateUrl: certificateUrl || null,
        completedById: req.user?.id ?? null,
        completedAt: new Date(),
      } as any,
    });

    logAction({ entityType: "DISPOSAL", entityId: Number(id), action: "STATUS_CHANGE", description: `Disposal #${id} completed${saleVal != null ? `, sale value ${saleVal}` : ""}`, performedById: req.user?.employeeDbId });

    res.json({ data: updated, message: "Disposal completed successfully" });
  } catch (error: any) {
    console.error("Error completing disposal:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

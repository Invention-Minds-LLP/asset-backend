import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

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
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const disposal = await prisma.assetDisposal.create({
      data: {
        assetId: Number(assetId),
        disposalType,
        reason,
        estimatedScrapValue: estimatedScrapValue != null ? estimatedScrapValue : null,
        status: "REQUESTED",
        requestedById: req.user?.id ?? null,
        requestedAt: new Date(),
      },
    });

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

    const updated = await prisma.assetDisposal.update({
      where: { id: Number(id) },
      data: {
        status: "COMPLETED",
        actualSaleValue: actualSaleValue != null ? actualSaleValue : null,
        buyerName: buyerName || null,
        buyerContact: buyerContact || null,
        certificateUrl: certificateUrl || null,
        completedById: req.user?.id ?? null,
        completedAt: new Date(),
      },
    });

    res.json({ data: updated, message: "Disposal completed successfully" });
  } catch (error: any) {
    console.error("Error completing disposal:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

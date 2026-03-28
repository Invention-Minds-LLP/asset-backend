import { Request, Response } from "express";
import prisma from "../../prismaClient";

// ─── Search Knowledge Base (resolved tickets with root cause + resolution) ───
export const searchKnowledgeBase = async (req: Request, res: Response) => {
  try {
    const { search, issueType, assetCategoryId, page = "1", limit = "25" } = req.query;

    const where: any = {
      status: { in: ["RESOLVED", "CLOSED"] },
      rootCause: { not: null },
      resolutionSummary: { not: null },
    };

    if (search) {
      where.OR = [
        { rootCause: { contains: String(search) } },
        { resolutionSummary: { contains: String(search) } },
        { detailedDesc: { contains: String(search) } },
        { issueType: { contains: String(search) } },
      ];
    }

    if (issueType) where.issueType = String(issueType);
    if (assetCategoryId) where.asset = { assetCategoryId: Number(assetCategoryId) };

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, articles] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        select: {
          id: true,
          ticketId: true,
          issueType: true,
          detailedDesc: true,
          rootCause: true,
          resolutionSummary: true,
          customerSatisfaction: true,
          priority: true,
          createdAt: true,
          slaResolvedAt: true,
          asset: {
            select: {
              assetId: true,
              assetName: true,
              assetCategory: { select: { name: true } },
            },
          },
          assignedTo: { select: { name: true } },
        },
        orderBy: { slaResolvedAt: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({ data: articles, total, page: parseInt(String(page)), limit: take });
  } catch (error) {
    console.error("searchKnowledgeBase error:", error);
    res.status(500).json({ message: "Failed to search knowledge base" });
  }
};

// ─── Suggest Similar Resolved Issues (when raising a new ticket) ─────────────
export const suggestSimilarIssues = async (req: Request, res: Response) => {
  try {
    const { issueType, description, assetId } = req.query;

    if (!issueType && !description) {
      res.json([]);
      return;
    }

    const where: any = {
      status: { in: ["RESOLVED", "CLOSED"] },
      rootCause: { not: null },
      resolutionSummary: { not: null },
    };

    const orConditions: any[] = [];
    if (issueType) orConditions.push({ issueType: String(issueType) });
    if (description) {
      // Simple keyword matching - split description into words and search
      const words = String(description).split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
      for (const word of words) {
        orConditions.push({ detailedDesc: { contains: word } });
        orConditions.push({ rootCause: { contains: word } });
      }
    }

    if (orConditions.length > 0) where.OR = orConditions;

    // If asset provided, prefer same asset's issues
    if (assetId) {
      const asset = await prisma.asset.findUnique({ where: { assetId: String(assetId) } });
      if (asset) {
        where.assetId = asset.id;
      }
    }

    const suggestions = await prisma.ticket.findMany({
      where,
      select: {
        id: true,
        ticketId: true,
        issueType: true,
        detailedDesc: true,
        rootCause: true,
        resolutionSummary: true,
        asset: { select: { assetId: true, assetName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    res.json(suggestions);
  } catch (error) {
    console.error("suggestSimilarIssues error:", error);
    res.status(500).json({ message: "Failed to suggest similar issues" });
  }
};

// ─── Knowledge Base Stats ────────────────────────────────────────────────────
export const getKnowledgeBaseStats = async (_req: Request, res: Response) => {
  try {
    const [totalArticles, byIssueType] = await Promise.all([
      prisma.ticket.count({
        where: { status: { in: ["RESOLVED", "CLOSED"] }, rootCause: { not: null }, resolutionSummary: { not: null } },
      }),
      prisma.ticket.groupBy({
        by: ["issueType"],
        where: { status: { in: ["RESOLVED", "CLOSED"] }, rootCause: { not: null }, resolutionSummary: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
    ]);

    res.json({
      totalArticles,
      byIssueType: byIssueType.map((g) => ({ issueType: g.issueType, count: g._count.id })),
    });
  } catch (error) {
    console.error("getKnowledgeBaseStats error:", error);
    res.status(500).json({ message: "Failed to fetch knowledge base stats" });
  }
};

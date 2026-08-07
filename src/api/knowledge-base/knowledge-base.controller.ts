import { Request, Response } from "express";
import prisma from "../../prismaClient";

// A ticket becomes a Knowledge Base article when it carries reusable knowledge,
// which can come from either of two places:
//   1. the technician's root cause + resolution, captured at Complete Work
//   2. a formal Root Cause Analysis that has been finished (COMPLETED/REVIEWED)
// Draft analyses are never published — an unfinished investigation must not be
// taught to the next technician.
const PUBLISHED_RCA_STATUSES = ["COMPLETED", "REVIEWED"];

const hasKnowledge = {
  OR: [
    { AND: [{ rootCause: { not: null } }, { resolutionSummary: { not: null } }] },
    { rootCauseAnalyses: { some: { status: { in: PUBLISHED_RCA_STATUSES } } } },
  ],
};

const articleSelect = {
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
  rootCauseAnalyses: {
    where: { status: { in: PUBLISHED_RCA_STATUSES } },
    select: {
      id: true,
      framework: true,
      status: true,
      summary: true,
      conclusion: true,
      correctiveAction: true,
      preventiveAction: true,
      performedAt: true,
      fiveWhys: { orderBy: { whyNumber: "asc" as const }, select: { whyNumber: true, question: true, answer: true } },
      sixMItems: { select: { category: true, cause: true, isRoot: true } },
    },
    orderBy: { performedAt: "desc" as const },
    take: 1,
  },
};

// Flatten the single published RCA onto the article and label where the
// knowledge came from, so the UI can badge it without re-deriving the rule.
function shapeArticle(t: any) {
  const rca = t.rootCauseAnalyses?.[0] ?? null;
  const { rootCauseAnalyses, ...rest } = t;
  return {
    ...rest,
    rca,
    source: rca ? (t.rootCause && t.resolutionSummary ? "BOTH" : "RCA") : "TICKET",
  };
}

// ─── Search Knowledge Base ───────────────────────────────────────────────────
export const searchKnowledgeBase = async (req: Request, res: Response) => {
  try {
    const { search, q, issueType, assetCategoryId, page = "1", limit = "25" } = req.query;
    // The screen sends ?q= — accept both rather than silently ignoring the box.
    const term = String(search || q || "").trim();

    const and: any[] = [{ status: { in: ["RESOLVED", "CLOSED"] } }, hasKnowledge];

    if (term) {
      and.push({
        OR: [
          { rootCause: { contains: term } },
          { resolutionSummary: { contains: term } },
          { detailedDesc: { contains: term } },
          { issueType: { contains: term } },
          { rootCauseAnalyses: { some: { status: { in: PUBLISHED_RCA_STATUSES }, conclusion: { contains: term } } } },
          { rootCauseAnalyses: { some: { status: { in: PUBLISHED_RCA_STATUSES }, correctiveAction: { contains: term } } } },
        ],
      });
    }

    if (issueType) and.push({ issueType: String(issueType) });
    if (assetCategoryId) and.push({ asset: { assetCategoryId: Number(assetCategoryId) } });

    const where = { AND: and };

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, articles] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        select: articleSelect,
        orderBy: { slaResolvedAt: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({ data: articles.map(shapeArticle), total, page: parseInt(String(page)), limit: take });
  } catch (error) {
    console.error("searchKnowledgeBase error:", error);
    res.status(500).json({ message: "Failed to search knowledge base" });
  }
};

// ─── Suggest Similar Resolved Issues ─────────────────────────────────────────
// Used both when raising a ticket and while working one. Results are ranked by
// how close the source asset is, because "how was THIS machine fixed last time"
// beats a keyword match on an unrelated one:
//   1. SAME_ASSET     — same physical asset
//   2. SAME_SUBTYPE   — same sub-type (e.g. another Desktop Monitor)
//   3. SAME_CATEGORY  — same asset category
//   4. KEYWORD        — anywhere in the organisation
// Each tier is filled in order until we have enough, so a brand-new asset with
// no history still gets useful hits instead of an empty panel.
const SUGGEST_LIMIT = 5;

export const suggestSimilarIssues = async (req: Request, res: Response) => {
  try {
    const { issueType, description, assetId, excludeTicketId } = req.query;

    if (!issueType && !description) {
      res.json([]);
      return;
    }

    const baseAnd: any[] = [{ status: { in: ["RESOLVED", "CLOSED"] } }, hasKnowledge];

    // Never suggest the ticket the user is currently looking at.
    const excludeId = Number(excludeTicketId);
    if (Number.isFinite(excludeId) && excludeId > 0) baseAnd.push({ id: { not: excludeId } });

    const orConditions: any[] = [];
    if (issueType) orConditions.push({ issueType: String(issueType) });
    if (description) {
      // Simple keyword matching - split description into words and search
      const words = String(description).split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
      for (const word of words) {
        orConditions.push({ detailedDesc: { contains: word } });
        orConditions.push({ rootCause: { contains: word } });
        orConditions.push({
          rootCauseAnalyses: { some: { status: { in: PUBLISHED_RCA_STATUSES }, conclusion: { contains: word } } },
        });
      }
    }
    if (orConditions.length > 0) baseAnd.push({ OR: orConditions });

    const baseWhere: any = { AND: baseAnd };

    const asset = assetId
      ? await prisma.asset.findUnique({
        where: { assetId: String(assetId) },
        select: { id: true, assetSubTypeId: true, assetCategoryId: true },
      })
      : null;

    const select = {
      id: true,
      ticketId: true,
      issueType: true,
      detailedDesc: true,
      rootCause: true,
      resolutionSummary: true,
      asset: { select: { assetId: true, assetName: true } },
      rootCauseAnalyses: {
        where: { status: { in: PUBLISHED_RCA_STATUSES } },
        select: { id: true, framework: true, conclusion: true, correctiveAction: true, preventiveAction: true },
        orderBy: { performedAt: "desc" as const },
        take: 1,
      },
    };

    // Tiers are applied only when the asset gives us something to match on.
    const tiers: Array<{ level: string; scope: any }> = [];
    if (asset) {
      tiers.push({ level: "SAME_ASSET", scope: { assetId: asset.id } });
      if (asset.assetSubTypeId) {
        tiers.push({ level: "SAME_SUBTYPE", scope: { asset: { assetSubTypeId: asset.assetSubTypeId } } });
      }
      if (asset.assetCategoryId) {
        tiers.push({ level: "SAME_CATEGORY", scope: { asset: { assetCategoryId: asset.assetCategoryId } } });
      }
    }
    tiers.push({ level: "KEYWORD", scope: {} });

    const seen = new Set<number>();
    const suggestions: any[] = [];

    for (const tier of tiers) {
      if (suggestions.length >= SUGGEST_LIMIT) break;

      const rows = await prisma.ticket.findMany({
        where: { ...baseWhere, ...tier.scope },
        select,
        orderBy: { createdAt: "desc" },
        take: SUGGEST_LIMIT,
      });

      for (const row of rows) {
        if (seen.has(row.id)) continue;      // already matched by a closer tier
        seen.add(row.id);
        suggestions.push({ ...shapeArticle(row), matchLevel: tier.level });
        if (suggestions.length >= SUGGEST_LIMIT) break;
      }
    }

    res.json(suggestions);
  } catch (error) {
    console.error("suggestSimilarIssues error:", error);
    res.status(500).json({ message: "Failed to suggest similar issues" });
  }
};

// ─── Knowledge Base Stats ────────────────────────────────────────────────────
export const getKnowledgeBaseStats = async (_req: Request, res: Response) => {
  try {
    const publishedWhere: any = { AND: [{ status: { in: ["RESOLVED", "CLOSED"] } }, hasKnowledge] };
    const rcaBackedWhere: any = {
      AND: [
        { status: { in: ["RESOLVED", "CLOSED"] } },
        { rootCauseAnalyses: { some: { status: { in: PUBLISHED_RCA_STATUSES } } } },
      ],
    };

    const [totalArticles, fromRca, byIssueType] = await Promise.all([
      prisma.ticket.count({ where: publishedWhere }),
      prisma.ticket.count({ where: rcaBackedWhere }),
      prisma.ticket.groupBy({
        by: ["issueType"],
        where: publishedWhere,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
    ]);

    res.json({
      totalArticles,
      fromRca,
      byIssueType: byIssueType.map((g) => ({ issueType: g.issueType, count: g._count.id })),
    });
  } catch (error) {
    console.error("getKnowledgeBaseStats error:", error);
    res.status(500).json({ message: "Failed to fetch knowledge base stats" });
  }
};

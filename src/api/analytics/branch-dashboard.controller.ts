import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Management-only dashboard: one payload with every branch's KPIs so the
// remote-DB latency is paid once per load, not per widget.
const MANAGEMENT_ROLES = ["ADMIN", "CEO_COO", "CFO", "FINANCE", "OPERATIONS"];

const OPEN_TICKET_STATUSES = ["CLOSED", "RESOLVED"]; // NOT IN

/**
 * Branch Health Score (0–100), computed from four signals:
 *  - working condition: % of active assets NOT_WORKING     (up to −40)
 *  - SLA breaches:      open tickets past SLA, 4 pts each  (up to −20)
 *  - coverage:          % of active assets with no warranty/AMC (up to −25)
 *  - open ticket load:  open tickets per asset             (up to −15)
 */
function healthScore(input: {
  activeAssets: number;
  notWorking: number;
  slaBreached: number;
  uncovered: number;
  openTickets: number;
  totalAssets: number;
}): number {
  const { activeAssets, notWorking, slaBreached, uncovered, openTickets, totalAssets } = input;
  const act = Math.max(activeAssets, 1);
  let score = 100;
  score -= Math.min(40, (notWorking / act) * 40);
  score -= Math.min(20, slaBreached * 4);
  score -= Math.min(25, (uncovered / act) * 25);
  score -= Math.min(15, (openTickets / Math.max(totalAssets, 1)) * 75);
  return Math.max(0, Math.round(score));
}

function grade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

const num = (v: any) => (v == null ? 0 : Number(v));

export const getBranchDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    if (!MANAGEMENT_ROLES.includes(user?.role)) {
      res.status(403).json({ message: "Branch dashboard is restricted to management roles" });
      return;
    }

    const [
      branches,
      countByBranchStatus,
      valueByBranch,
      workingByBranch,
      categoryByBranch,
      categories,
      ticketRows,
      maintRows,
      uncoveredRows,
      monthlyRows,
      netBlockRows,
    ] = await Promise.all([
      prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
      // Counts are PARENT assets only (matches the master table); value below includes sub-assets.
      prisma.asset.groupBy({
        by: ["currentBranchId", "status"],
        where: { parentAssetId: null },
        _count: { id: true },
      }),
      prisma.asset.groupBy({
        by: ["currentBranchId"],
        _sum: { purchaseCost: true, estimatedValue: true },
        _count: { id: true },
      }),
      prisma.asset.groupBy({
        by: ["currentBranchId", "workingCondition"],
        where: { status: "ACTIVE" },
        _count: { id: true },
      }),
      prisma.asset.groupBy({
        by: ["currentBranchId", "assetCategoryId"],
        where: { parentAssetId: null },
        _count: { id: true },
      }),
      prisma.assetCategory.findMany({ select: { id: true, name: true } }),
      prisma.$queryRaw<any[]>`
        SELECT a.currentBranchId AS branchId,
               COUNT(CASE WHEN t.status NOT IN ('CLOSED','RESOLVED') THEN 1 END) AS openTickets,
               COUNT(CASE WHEN t.slaBreached = 1 AND t.status NOT IN ('CLOSED','RESOLVED') THEN 1 END) AS slaBreached,
               COALESCE(SUM(t.totalCost), 0) AS ticketCost
        FROM ticket t
        JOIN asset a ON a.id = t.assetId
        GROUP BY a.currentBranchId`,
      prisma.$queryRaw<any[]>`
        SELECT a.currentBranchId AS branchId,
               COALESCE(SUM(m.totalCost), 0) AS maintenanceCost
        FROM maintenancehistory m
        JOIN asset a ON a.id = m.assetId
        GROUP BY a.currentBranchId`,
      prisma.$queryRaw<any[]>`
        SELECT a.currentBranchId AS branchId, COUNT(*) AS uncovered
        FROM asset a
        WHERE a.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM warranty w
                          WHERE w.assetId = a.id AND w.isActive = 1 AND w.isUnderWarranty = 1)
          AND NOT EXISTS (SELECT 1 FROM servicecontract sc
                          WHERE sc.assetId = a.id AND sc.status = 'ACTIVE')
        GROUP BY a.currentBranchId`,
      prisma.$queryRaw<any[]>`
        SELECT a.currentBranchId AS branchId,
               DATE_FORMAT(a.purchaseDate, '%Y-%m') AS ym,
               COUNT(*) AS cnt,
               COALESCE(SUM(a.purchaseCost), 0) AS value
        FROM asset a
        WHERE a.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY a.currentBranchId, ym
        ORDER BY ym`,
      prisma.$queryRaw<any[]>`
        SELECT a.currentBranchId AS branchId,
               COALESCE(SUM(d.currentBookValue), 0) AS netBlock
        FROM assetdepreciation d
        JOIN asset a ON a.id = d.assetId
        GROUP BY a.currentBranchId`,
    ]);

    const catName = new Map(categories.map((c) => [c.id, c.name]));

    // Last 12 month labels (oldest → newest)
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const byBranch = (rows: any[], key = "branchId") => {
      const m = new Map<number | null, any>();
      for (const r of rows) m.set(r[key] == null ? null : Number(r[key]), r);
      return m;
    };
    const ticketMap = byBranch(ticketRows);
    const maintMap = byBranch(maintRows);
    const uncoveredMap = byBranch(uncoveredRows);
    const netBlockMap = byBranch(netBlockRows);

    // Include a synthetic "Unassigned" bucket if any asset has no branch.
    const branchList: Array<{ id: number | null; name: string; code: string | null }> = [
      ...branches,
      ...(valueByBranch.some((v) => v.currentBranchId == null)
        ? [{ id: null, name: "Unassigned", code: null }]
        : []),
    ];

    const result = branchList.map((b) => {
      const statusMix: Record<string, number> = {};
      let totalAssets = 0;
      for (const row of countByBranchStatus) {
        if (row.currentBranchId !== b.id) continue;
        statusMix[row.status] = row._count.id;
        totalAssets += row._count.id;
      }
      const activeAssets = statusMix["ACTIVE"] ?? 0;

      const valueRow = valueByBranch.find((v) => v.currentBranchId === b.id);
      const grossValue = num(valueRow?._sum.purchaseCost) + num(valueRow?._sum.estimatedValue);

      let notWorking = 0;
      const workingMix: Record<string, number> = {};
      for (const row of workingByBranch) {
        if (row.currentBranchId !== b.id) continue;
        const key = row.workingCondition || "UNKNOWN";
        workingMix[key] = row._count.id;
        if (key === "NOT_WORKING") notWorking += row._count.id;
      }

      const catRows = categoryByBranch
        .filter((c) => c.currentBranchId === b.id)
        .map((c) => ({ name: catName.get(c.assetCategoryId) ?? "Unknown", count: c._count.id }))
        .sort((a, z) => z.count - a.count);
      // Top 5 + Other (fixed slot count keeps chart colors stable)
      const topCategories = catRows.slice(0, 5);
      const otherCount = catRows.slice(5).reduce((s, c) => s + c.count, 0);
      if (otherCount > 0) topCategories.push({ name: "Other", count: otherCount });

      const t = ticketMap.get(b.id) || {};
      const openTickets = num(t.openTickets);
      const slaBreached = num(t.slaBreached);
      const maintenanceSpend = num(maintMap.get(b.id)?.maintenanceCost) + num(t.ticketCost);
      const uncovered = num(uncoveredMap.get(b.id)?.uncovered);
      const netBlock = num(netBlockMap.get(b.id)?.netBlock);

      const monthly = months.map((ym) => {
        const row = monthlyRows.find((m) => m.branchId === (b.id as any) && m.ym === ym)
          ?? monthlyRows.find((m) => (m.branchId == null ? null : Number(m.branchId)) === b.id && m.ym === ym);
        return { ym, count: num(row?.cnt), value: num(row?.value) };
      });

      const score = healthScore({ activeAssets, notWorking, slaBreached, uncovered, openTickets, totalAssets });

      return {
        id: b.id,
        name: b.name,
        code: b.code,
        assetCount: totalAssets,
        activeAssets,
        statusMix,
        workingMix,
        grossValue,
        netBlock,
        openTickets,
        slaBreached,
        maintenanceSpend,
        uncovered,
        topCategories,
        monthly,
        healthScore: score,
        grade: grade(score),
      };
    });

    // Sort: real branches by health desc, Unassigned last
    result.sort((a, z) => (a.id == null ? 1 : z.id == null ? -1 : z.healthScore - a.healthScore));

    const totals = {
      branches: branches.length,
      assets: result.reduce((s, r) => s + r.assetCount, 0),
      grossValue: result.reduce((s, r) => s + r.grossValue, 0),
      netBlock: result.reduce((s, r) => s + r.netBlock, 0),
      openTickets: result.reduce((s, r) => s + r.openTickets, 0),
      slaBreached: result.reduce((s, r) => s + r.slaBreached, 0),
    };

    res.json({ branches: result, totals, months, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("getBranchDashboard error:", err);
    res.status(500).json({ message: "Failed to load branch dashboard", error: err?.message });
  }
};

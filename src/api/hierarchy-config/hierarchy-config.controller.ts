import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ═══════════════════════════════════════════════════════════
// 1. GET /sla-breach-alerts
// ═══════════════════════════════════════════════════════════
export const getSlaBreachAlerts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tickets = await prisma.ticket.findMany({
      where: {
        slaBreached: true,
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
      },
      include: {
        asset: { select: { id: true, assetId: true, assetName: true, departmentId: true, department: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Group by department
    const byDept: Record<number, {
      departmentId: number;
      departmentName: string;
      tickets: any[];
    }> = {};

    for (const t of tickets) {
      const deptId = t.asset?.departmentId ?? 0;
      const deptName = t.asset?.department?.name ?? "Unassigned";
      if (!byDept[deptId]) {
        byDept[deptId] = { departmentId: deptId, departmentName: deptName, tickets: [] };
      }
      byDept[deptId].tickets.push({
        ticketId: t.id,
        ticketNumber: t.ticketId,
        title: t.issueType,
        priority: t.priority,
        status: t.status,
        assetId: t.asset?.assetId,
        assetName: t.asset?.assetName,
        createdAt: t.createdAt,
      });
    }

    // Fetch escalation rules for context
    const escalationRules = await prisma.escalationMatrix.findMany({
      select: { id: true, level: true, escalateAfterValue: true, escalateAfterUnit: true, notifyRole: true, priority: true },
      orderBy: { level: "asc" },
    });

    res.json({
      totalBreachedTickets: tickets.length,
      departments: Object.values(byDept).sort((a, b) => b.tickets.length - a.tickets.length),
      escalationChain: escalationRules,
    });
  } catch (err: any) {
    console.error("getSlaBreachAlerts error:", err);
    res.status(500).json({ error: "Failed to fetch SLA breach alerts", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 2. GET /repeat-tickets
// ═══════════════════════════════════════════════════════════
export const getRepeatTickets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Group tickets by assetId in last 90 days
    const grouped = await prisma.ticket.groupBy({
      by: ["assetId"],
      _count: { id: true },
      where: { createdAt: { gte: ninetyDaysAgo } },
      having: { id: { _count: { gte: 2 } } },
    });

    if (grouped.length === 0) {
      res.json([]);
      return;
    }

    const assetIds = grouped.map((g) => g.assetId);
    const countMap = new Map(grouped.map((g) => [g.assetId, g._count?.id ?? 0]));

    // Fetch asset details
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true, assetId: true, assetName: true,
        department: { select: { id: true, name: true } },
      },
    });
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    // Fetch the actual tickets for these assets
    const tickets = await prisma.ticket.findMany({
      where: { assetId: { in: assetIds }, createdAt: { gte: ninetyDaysAgo } },
      select: {
        id: true, ticketId: true, issueType: true, priority: true, status: true,
        createdAt: true, assetId: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Group tickets by assetId
    const ticketsByAsset = new Map<number, any[]>();
    for (const t of tickets) {
      const list = ticketsByAsset.get(t.assetId) ?? [];
      list.push({
        id: t.id,
        ticketNumber: t.ticketId,
        title: t.issueType,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
      });
      ticketsByAsset.set(t.assetId, list);
    }

    const result = assetIds.map((aid) => {
      const asset = assetMap.get(aid);
      return {
        assetId: asset?.assetId ?? null,
        assetName: asset?.assetName ?? "Unknown",
        department: asset?.department?.name ?? "Unassigned",
        departmentId: asset?.department?.id ?? null,
        ticketCount: countMap.get(aid) ?? 0,
        tickets: (ticketsByAsset.get(aid) ?? []).slice(0, 10),
      };
    }).sort((a, b) => b.ticketCount - a.ticketCount);

    res.json(result);
  } catch (err: any) {
    console.error("getRepeatTickets error:", err);
    res.status(500).json({ error: "Failed to fetch repeat tickets", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 3. GET /escalation-summary — combined view
// ═══════════════════════════════════════════════════════════
export const getEscalationSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      slaBreachesByDept,
      repeatFailureCount,
      overdueSchedules,
      uncoveredAssets,
    ] = await Promise.all([
      // SLA breaches grouped by department
      prisma.ticket.groupBy({
        by: ["departmentId"],
        _count: { id: true },
        where: {
          slaBreached: true,
          status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
        },
      }),
      // Repeat failure assets count
      prisma.ticket.groupBy({
        by: ["assetId"],
        _count: { id: true },
        where: { createdAt: { gte: ninetyDaysAgo } },
        having: { id: { _count: { gte: 2 } } },
      }),
      // Overdue PMs
      prisma.maintenanceSchedule.count({
        where: { isActive: true, nextDueAt: { lt: now } },
      }),
      // Uncovered assets (no active warranty)
      prisma.asset.count({
        where: {
          status: "ACTIVE",
          warranties: { none: { isUnderWarranty: true, warrantyEnd: { gte: now } } },
        },
      }),
    ]);

    // Resolve department names for SLA breaches
    const deptIds = slaBreachesByDept.map((g) => g.departmentId);
    const depts = await prisma.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const deptNameMap = new Map(depts.map((d) => [d.id, d.name]));

    res.json({
      slaBreachesByDepartment: slaBreachesByDept.map((g) => ({
        departmentId: g.departmentId,
        departmentName: deptNameMap.get(g.departmentId) ?? "Unknown",
        breachedCount: g._count.id,
      })).sort((a, b) => b.breachedCount - a.breachedCount),
      repeatFailureAssetsCount: repeatFailureCount.length,
      overduePMs: overdueSchedules,
      uncoveredAssetsCount: uncoveredAssets,
    });
  } catch (err: any) {
    console.error("getEscalationSummary error:", err);
    res.status(500).json({ error: "Failed to fetch escalation summary", details: err.message });
  }
};

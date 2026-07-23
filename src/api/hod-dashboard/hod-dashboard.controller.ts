import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Drill-down: the asset list behind a KPI / gap tile. Keyed by the same keys the
// dashboard emits so a tile click maps directly to its rows.
const LIST_WHERE: Record<string, any> = {
  total: {},
  withSupervisor: { supervisorId: { not: null } },
  withEndUser: { allottedToId: { not: null } },
  fullyAssigned: { supervisorId: { not: null }, allottedToId: { not: null } },
  withTarget: { targetDepartmentId: { not: null } },
  pending: { OR: [{ supervisorId: null }, { allottedToId: null }] },
  noSupervisor: { supervisorId: null },
  noEndUser: { allottedToId: null },
  noTarget: { targetDepartmentId: null },
};

export const getHodDashboardList = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const isAdmin = ["ADMIN", "CEO_COO", "OPERATIONS", "FINANCE", "CFO"].includes((user?.role || "").toUpperCase());
    const deptId = isAdmin && req.query.departmentId ? Number(req.query.departmentId) : Number(user?.departmentId);
    const key = String(req.query.key || "total");
    if (!deptId) { res.status(400).json({ message: "No department" }); return; }
    const keyWhere = LIST_WHERE[key];
    if (!keyWhere) { res.status(400).json({ message: "Unknown list key" }); return; }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 20)); // up to 5000 for export
    const search = String(req.query.search || "").trim();

    let where: any = { departmentId: deptId, parentAssetId: null, ...keyWhere };
    if (search) {
      where = {
        AND: [
          where,
          {
            OR: [
              { assetId: { contains: search } },
              { assetName: { contains: search } },
              { status: { contains: search } },
              { supervisor: { name: { contains: search } } },
              { allottedTo: { name: { contains: search } } },
              { targetDepartment: { name: { contains: search } } },
              { assetCategory: { name: { contains: search } } },
            ],
          },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        select: {
          assetId: true, assetName: true, status: true,
          supervisor: { select: { name: true } },
          allottedTo: { select: { name: true } },
          targetDepartment: { select: { name: true } },
          assetCategory: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit,
      }),
      prisma.asset.count({ where }),
    ]);

    res.json({
      key, total, page, limit,
      assets: rows.map((a) => ({
        assetId: a.assetId, assetName: a.assetName, status: a.status,
        category: a.assetCategory?.name || "—",
        supervisor: a.supervisor?.name || "—",
        endUser: a.allottedTo?.name || "—",
        targetDept: a.targetDepartment?.name || "—",
      })),
    });
  } catch (e: any) {
    console.error("getHodDashboardList error:", e);
    res.status(500).json({ message: e.message || "Failed to load list" });
  }
};

// Source-department HOD dashboard: assignment coverage + gaps across the handover
// pipeline (supervisor → end user → target dept → target HOD → target end user).
const DAY = 86_400_000;
function daysAgoDate(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; }
function dayBuckets(n: number) {
  const out: { start: Date; end: Date; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(); s.setDate(s.getDate() - i); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setHours(23, 59, 59, 999);
    out.push({ start: s, end: e, label: `${s.getMonth() + 1}/${s.getDate()}` });
  }
  return out;
}
function bucketize(dates: (Date | null | undefined)[], buckets: { start: Date; end: Date }[]) {
  const c = new Array(buckets.length).fill(0);
  for (const d of dates) {
    if (!d) continue; const t = d.getTime();
    for (let i = 0; i < buckets.length; i++) { if (t >= buckets[i].start.getTime() && t <= buckets[i].end.getTime()) { c[i]++; break; } }
  }
  return c;
}

export const getHodDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const isAdmin = ["ADMIN", "CEO_COO", "OPERATIONS", "FINANCE", "CFO"].includes((user?.role || "").toUpperCase());
    const deptId = isAdmin && req.query.departmentId ? Number(req.query.departmentId) : Number(user?.departmentId);
    if (!deptId) { res.status(400).json({ message: "No department to load a dashboard for" }); return; }

    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { id: true, name: true } });
    if (!dept) { res.status(404).json({ message: "Department not found" }); return; }

    // Main assets only (exclude sub-assets), scoped to the HOD's department.
    const scope = { departmentId: deptId, parentAssetId: null } as const;
    const listSel = { assetId: true, assetName: true, status: true } as const;
    const route = (a: any) => ({ title: a.assetName, subtitle: a.assetId, meta: a.status, route: `/assets/edit/${a.assetId}` });

    const [
      total, withSupervisor, withEndUser, withTarget, fullyAssigned,
      byStatusRaw, byTargetRaw,
      noSupervisor, noEndUser, noTarget,
    ] = await Promise.all([
      prisma.asset.count({ where: scope }),
      prisma.asset.count({ where: { ...scope, supervisorId: { not: null } } }),
      prisma.asset.count({ where: { ...scope, allottedToId: { not: null } } }),
      prisma.asset.count({ where: { ...scope, targetDepartmentId: { not: null } } }),
      prisma.asset.count({ where: { ...scope, supervisorId: { not: null }, allottedToId: { not: null } } }),
      prisma.asset.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
      prisma.asset.groupBy({ by: ["targetDepartmentId"], where: { ...scope, targetDepartmentId: { not: null } }, _count: { _all: true } }),
      prisma.asset.findMany({ where: { ...scope, supervisorId: null }, select: listSel, take: 20, orderBy: { createdAt: "desc" } }),
      prisma.asset.findMany({ where: { ...scope, allottedToId: null }, select: listSel, take: 20, orderBy: { createdAt: "desc" } }),
      prisma.asset.findMany({ where: { ...scope, targetDepartmentId: null }, select: listSel, take: 20, orderBy: { createdAt: "desc" } }),
    ]);

    // Target-department distribution names.
    const tDepts = await prisma.department.findMany({ where: { id: { in: byTargetRaw.map((t) => t.targetDepartmentId!).filter(Boolean) } }, select: { id: true, name: true } });
    const tMap = new Map(tDepts.map((d) => [d.id, d.name]));

    // ── Acknowledgement pipeline (over this dept's assets) ──
    const assetIds = (await prisma.asset.findMany({ where: scope, select: { id: true } })).map((a) => a.id);
    const inIds = assetIds.length ? { in: assetIds } : { in: [-1] };
    const STAGES = ["HOD_SOURCE", "SUPERVISOR", "HOD_TARGET", "END_USER"] as const;
    const STAGE_LABEL: Record<string, string> = { HOD_SOURCE: "Source HOD", SUPERVISOR: "Supervisor", HOD_TARGET: "Target HOD", END_USER: "End User" };

    const ackCounts: number[] = [];
    const pendingCounts: number[] = [];
    const pendingByStage: Record<string, any[]> = {};
    for (const st of STAGES) {
      const ackAssets = await prisma.assetAssignment.findMany({ where: { assetId: inIds, stage: st as any, status: "ACKNOWLEDGED" }, distinct: ["assetId"], select: { assetId: true } });
      ackCounts.push(ackAssets.length);
      const pend = await prisma.assetAssignment.findMany({
        where: { assetId: inIds, stage: st as any, status: "PENDING", isActive: true },
        select: { asset: { select: { assetId: true, assetName: true, status: true } } },
        orderBy: { assignedAt: "asc" }, take: 20,
      });
      pendingByStage[st] = pend.map((p) => p.asset).filter(Boolean);
      pendingCounts.push(await prisma.assetAssignment.count({ where: { assetId: inIds, stage: st as any, status: "PENDING", isActive: true } }));
    }

    // Assets never entered into the acknowledgement flow (TEMP id → source HOD
    // hasn't acknowledged / issued the real Asset ID yet).
    const [awaitingHodStart, tempCount] = await Promise.all([
      prisma.asset.findMany({ where: { ...scope, assetId: { startsWith: "TEMP-" } }, select: listSel, take: 20 }),
      prisma.asset.count({ where: { ...scope, assetId: { startsWith: "TEMP-" } } }),
    ]);

    // ── (1) Aging of pending assets ──
    const now = Date.now();
    const ageDays = (d: Date) => Math.floor((now - d.getTime()) / DAY);
    const pendingAssets = await prisma.asset.findMany({
      where: { ...scope, OR: [{ supervisorId: null }, { allottedToId: null }] },
      select: { assetId: true, assetName: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" }, take: 3000,
    });
    let a7 = 0, a30 = 0, a90 = 0;
    for (const a of pendingAssets) { const g = ageDays(a.createdAt); if (g > 90) a90++; else if (g > 30) a30++; else if (g > 7) a7++; }
    const stuckItems = pendingAssets.slice(0, 15).map((a) => {
      const g = ageDays(a.createdAt);
      return { title: a.assetName, subtitle: a.assetId, meta: `${g}d waiting`, urgency: g > 90 ? "critical" : g > 30 ? "warning" : "info", route: `/assets/edit/${a.assetId}` };
    });

    // ── (3) Rejections needing re-action: latest is REJECTED and no active assignment ──
    const [rejectedRecs, activeRecs] = await Promise.all([
      prisma.assetAssignment.findMany({ where: { assetId: inIds, status: "REJECTED" }, distinct: ["assetId"], orderBy: { assignedAt: "desc" }, select: { assetId: true, stage: true, asset: { select: { assetId: true, assetName: true } } } }),
      prisma.assetAssignment.findMany({ where: { assetId: inIds, isActive: true }, distinct: ["assetId"], select: { assetId: true } }),
    ]);
    const activeSet = new Set(activeRecs.map((a) => a.assetId));
    const rejItems = rejectedRecs.filter((r) => !activeSet.has(r.assetId)).slice(0, 15)
      .map((r) => ({ title: r.asset?.assetName, subtitle: r.asset?.assetId, meta: `Rejected at ${STAGE_LABEL[r.stage]}`, urgency: "critical", route: `/assets/edit/${r.asset?.assetId}` }));

    // ── (7) Overdue acknowledgements (pending > 3 days) ──
    const overdueRecs = await prisma.assetAssignment.findMany({
      where: { assetId: inIds, status: "PENDING", isActive: true, assignedAt: { lt: daysAgoDate(3) } },
      orderBy: { assignedAt: "asc" }, take: 15,
      select: { stage: true, assignedAt: true, asset: { select: { assetId: true, assetName: true } } },
    });
    const overdueItems = overdueRecs.map((o) => ({ title: o.asset?.assetName, subtitle: o.asset?.assetId, meta: `${STAGE_LABEL[o.stage]} • ${ageDays(o.assignedAt)}d pending`, urgency: "critical", route: `/assets/edit/${o.asset?.assetId}` }));

    // ── (5) Per-supervisor workload ──
    const supLoadRaw = await prisma.asset.groupBy({ by: ["supervisorId"], where: { ...scope, supervisorId: { not: null } }, _count: { _all: true }, orderBy: { _count: { supervisorId: "desc" } }, take: 10 });
    const supEmps = await prisma.employee.findMany({ where: { id: { in: supLoadRaw.map((s) => s.supervisorId!).filter(Boolean) } }, select: { id: true, name: true } });
    const supMap = new Map(supEmps.map((e) => [e.id, e.name]));

    // ── (4) Completions trend + recently completed (END_USER acknowledged) ──
    const buckets = dayBuckets(14);
    const [endAcks, recentDone] = await Promise.all([
      prisma.assetAssignment.findMany({ where: { assetId: inIds, stage: "END_USER" as any, status: "ACKNOWLEDGED", acknowledgedAt: { gte: daysAgoDate(14) } }, select: { acknowledgedAt: true }, take: 5000 }),
      prisma.assetAssignment.findMany({ where: { assetId: inIds, stage: "END_USER" as any, status: "ACKNOWLEDGED", acknowledgedAt: { gte: daysAgoDate(7) } }, orderBy: { acknowledgedAt: "desc" }, take: 10, select: { acknowledgedAt: true, asset: { select: { assetId: true, assetName: true } } } }),
    ]);

    // ── Assemble ──
    const actions = [
      { key: "noSup", label: "No supervisor assigned", severity: noSupervisor.length ? "warning" : "good", items: noSupervisor.map(route) },
      { key: "noEnd", label: "No end user assigned", severity: noEndUser.length ? "warning" : "good", items: noEndUser.map(route) },
      { key: "hodStart", label: "Awaiting Source HOD acknowledgement", severity: awaitingHodStart.length ? "critical" : "good", items: awaitingHodStart.map((a) => ({ ...route(a), urgency: "critical" })) },
      { key: "supAck", label: "Awaiting supervisor acknowledgement", severity: pendingByStage["SUPERVISOR"].length ? "warning" : "good", items: pendingByStage["SUPERVISOR"].map((a) => ({ ...route(a), urgency: "warning" })) },
      { key: "tgtHodAck", label: "Awaiting target-HOD acknowledgement", severity: pendingByStage["HOD_TARGET"].length ? "warning" : "good", items: pendingByStage["HOD_TARGET"].map((a) => ({ ...route(a), urgency: "warning" })) },
      { key: "endAck", label: "Awaiting end-user acknowledgement", severity: pendingByStage["END_USER"].length ? "warning" : "good", items: pendingByStage["END_USER"].map((a) => ({ ...route(a), urgency: "warning" })) },
      { key: "overdue", label: "Overdue acknowledgements (>3 days)", severity: overdueItems.length ? "critical" : "good", items: overdueItems },
      { key: "rejected", label: "Rejected — need re-assignment", severity: rejItems.length ? "critical" : "good", items: rejItems },
      { key: "stuck", label: "Longest waiting (unassigned)", severity: (a90 || a30) ? "warning" : "good", items: stuckItems },
      { key: "noTarget", label: "No target department set", severity: "info", items: noTarget.map(route) },
    ];

    const pending = total - fullyAssigned;

    res.json({
      departmentId: deptId,
      departmentName: dept.name,
      profile: "HOD_ASSIGNMENT",
      data: {
        kpis: [
          { key: "total", label: "Department Assets", value: total, icon: "pi-database", tone: "info" },
          { key: "withSupervisor", label: "With Supervisor", value: withSupervisor, icon: "pi-user", tone: "info", pct: total ? Math.round((withSupervisor / total) * 100) : 0 },
          { key: "withEndUser", label: "With End User", value: withEndUser, icon: "pi-id-card", tone: "info", pct: total ? Math.round((withEndUser / total) * 100) : 0 },
          { key: "fullyAssigned", label: "Fully Assigned", value: fullyAssigned, icon: "pi-check-circle", tone: "good", pct: total ? Math.round((fullyAssigned / total) * 100) : 0 },
          { key: "withTarget", label: "For Transfer (target dept)", value: withTarget, icon: "pi-arrows-h", tone: "info" },
          { key: "pending", label: "Assignment Pending", value: pending, icon: "pi-clock", tone: pending > 0 ? "warning" : "good" },
          { key: "temp", label: "ID Not Issued (TEMP)", value: tempCount, icon: "pi-hourglass", tone: tempCount > 0 ? "critical" : "good" },
        ],
        gauges: [{ key: "coverage", label: "Assignment Coverage", value: total ? Math.round((fullyAssigned / total) * 100) : 0, max: 100, unit: "%", available: total > 0 }],
        // Assignment aging summary (chips).
        aging: [
          { label: "Waiting > 7d", value: a7, severity: a7 ? "warning" : "good", icon: "pi-clock" },
          { label: "Waiting > 30d", value: a30, severity: a30 ? "warning" : "good", icon: "pi-exclamation-circle" },
          { label: "Waiting > 90d", value: a90, severity: a90 ? "critical" : "good", icon: "pi-exclamation-triangle" },
        ],
        funnel: { title: "Acknowledged — pipeline", items: STAGES.map((st, i) => ({ name: STAGE_LABEL[st], value: ackCounts[i] })) },
        pendingFunnel: { title: "Pending at each stage (bottleneck)", items: STAGES.map((st, i) => ({ name: STAGE_LABEL[st], value: pendingCounts[i] })) },
        trend: { title: "Assignments completed (14 days)", labels: buckets.map((b) => b.label), series: [{ name: "Completed", color: 2, values: bucketize(endAcks.map((e) => e.acknowledgedAt), buckets) }] },
        donut: { title: "Assets by status", slices: byStatusRaw.map((s) => ({ name: s.status, value: s._count._all })) },
        bars: { title: "Transfers by target department", items: byTargetRaw.map((t) => ({ name: tMap.get(t.targetDepartmentId!) || "—", value: t._count._all })).sort((a, b) => b.value - a.value) },
        supervisorLoad: { title: "Assets per supervisor", items: supLoadRaw.map((s) => ({ name: supMap.get(s.supervisorId!) || "—", value: s._count._all })) },
        recentlyCompleted: recentDone.map((r) => ({ assetId: r.asset?.assetId, assetName: r.asset?.assetName, when: r.acknowledgedAt })),
        actions: actions.filter((a) => a.items.length),
      },
    });
  } catch (e: any) {
    console.error("getHodDashboard error:", e);
    res.status(500).json({ message: e.message || "Failed to load HOD dashboard" });
  }
};

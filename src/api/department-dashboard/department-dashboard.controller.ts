import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getResponsibleDepartments, resolveDashboardDepartment } from "../../utilis/departmentScopeHelper";

export const PROFILES = ["STORES", "PURCHASE", "IT", "MAINTENANCE", "BIOMEDICAL", "GENERIC"] as const;
type Profile = (typeof PROFILES)[number];

// ── Date helpers ─────────────────────────────────────────────────────────────
function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return { start, end };
}
function monthStart() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
function inDays(n: number) { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(23, 59, 59, 999); return d; }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; }

// Last `n` day buckets (oldest → today) as {start,end,label}.
function dayBuckets(n: number) {
  const out: { start: Date; end: Date; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(); s.setDate(s.getDate() - i); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setHours(23, 59, 59, 999);
    out.push({ start: s, end: e, label: `${s.getMonth() + 1}/${s.getDate()}` });
  }
  return out;
}
// Count how many of `dates` fall in each bucket.
function bucketize(dates: (Date | null | undefined)[], buckets: { start: Date; end: Date }[]) {
  const counts = new Array(buckets.length).fill(0);
  for (const d of dates) {
    if (!d) continue;
    const t = d.getTime();
    for (let i = 0; i < buckets.length; i++) {
      if (t >= buckets[i].start.getTime() && t <= buckets[i].end.getTime()) { counts[i]++; break; }
    }
  }
  return counts;
}
function pct(part: number, whole: number): number | null { return whole ? Math.round((part / whole) * 100) : null; }
function delta(now: number, prev: number) {
  const diff = now - prev;
  return { value: diff, dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat", prev };
}

async function procurementEnabled(): Promise<boolean> {
  const cfg = await prisma.tenantConfig.findUnique({ where: { key: "ENABLE_PROCUREMENT" } });
  return cfg?.value !== "false";
}

// ── STORES ───────────────────────────────────────────────────────────────────
async function storesWidgets(deptId: number) {
  const { start, end } = todayRange();
  const procurement = await procurementEnabled();
  const buckets = dayBuckets(14);

  if (!procurement) {
    const [inStore, receivedToday, byCategory, recent] = await Promise.all([
      prisma.asset.count({ where: { status: "IN_STORE" } }),
      prisma.asset.count({ where: { grnDate: { gte: start, lte: end } } }),
      prisma.asset.groupBy({ by: ["assetCategoryId"], where: { status: "IN_STORE" }, _count: { _all: true } }),
      prisma.asset.findMany({ where: { grnDate: { gte: daysAgo(14) } }, select: { grnDate: true }, take: 2000 }),
    ]);
    const cats = await prisma.assetCategory.findMany({ where: { id: { in: byCategory.map((b) => b.assetCategoryId) } }, select: { id: true, name: true } });
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    return {
      procurement: false,
      kpis: [
        { key: "inStore", label: "Assets In Store", value: inStore, icon: "pi-box", tone: "info" },
        { key: "receivedToday", label: "Received Today", value: receivedToday, icon: "pi-download", tone: "good" },
      ],
      trend: { title: "Assets received (14 days)", labels: buckets.map((b) => b.label), series: [{ name: "Received", color: 1, values: bucketize(recent.map((r) => r.grnDate), buckets) }] },
      donut: { title: "In store by category", slices: byCategory.map((b) => ({ name: catMap.get(b.assetCategoryId) || "—", value: b._count._all })).sort((a, b) => b.value - a.value).slice(0, 6) },
      actions: [],
    };
  }

  const [deliveredToday, grnPending, grnAccepted, topVendorsRaw, grnDates14, pendingList] = await Promise.all([
    prisma.goodsReceipt.count({ where: { OR: [{ deliveryDate: { gte: start, lte: end } }, { grnDate: { gte: start, lte: end } }] } }),
    prisma.goodsReceipt.count({ where: { status: { in: ["DRAFT", "INSPECTION_PENDING"] } } }),
    prisma.goodsReceipt.count({ where: { status: { in: ["ACCEPTED", "PARTIALLY_ACCEPTED", "INSPECTION_PASSED"] } } }),
    prisma.goodsReceipt.groupBy({ by: ["vendorId"], where: { vendorId: { not: null } }, _count: { _all: true }, orderBy: { _count: { vendorId: "desc" } }, take: 6 }),
    prisma.goodsReceipt.findMany({ where: { grnDate: { gte: daysAgo(14) } }, select: { grnDate: true }, take: 2000 }),
    prisma.goodsReceipt.findMany({ where: { status: { in: ["DRAFT", "INSPECTION_PENDING", "INSPECTION_FAILED"] } }, select: { id: true, grnNumber: true, status: true, grnDate: true, vendor: { select: { name: true } } }, orderBy: { grnDate: "asc" }, take: 12 }),
  ]);
  const vendors = await prisma.vendor.findMany({ where: { id: { in: topVendorsRaw.map((v) => v.vendorId!).filter(Boolean) } }, select: { id: true, name: true } });
  const vMap = new Map(vendors.map((v) => [v.id, v.name]));

  const grnsWithPo = await prisma.goodsReceipt.findMany({
    where: { deliveryDate: { not: null }, purchaseOrder: { deliveryDate: { not: null } } },
    select: { deliveryDate: true, purchaseOrder: { select: { deliveryDate: true } } }, take: 500,
  });
  let onTime = 0;
  for (const g of grnsWithPo) if (g.deliveryDate && g.purchaseOrder?.deliveryDate && g.deliveryDate <= g.purchaseOrder.deliveryDate) onTime++;
  const onTimePct = pct(onTime, grnsWithPo.length);

  return {
    procurement: true,
    kpis: [
      { key: "deliveredToday", label: "Deliveries Today", value: deliveredToday, icon: "pi-truck", tone: "info" },
      { key: "grnPending", label: "GRN Pending", value: grnPending, icon: "pi-clock", tone: grnPending > 0 ? "warning" : "good" },
      { key: "grnAccepted", label: "GRN Accepted", value: grnAccepted, icon: "pi-check-circle", tone: "good" },
    ],
    gauges: [{ key: "onTime", label: "On-time Delivery", value: onTimePct ?? 0, max: 100, unit: "%", available: onTimePct !== null }],
    trend: { title: "Deliveries (14 days)", labels: dayBuckets(14).map((b) => b.label), series: [{ name: "Deliveries", color: 1, values: bucketize(grnDates14.map((g) => g.grnDate), dayBuckets(14)) }] },
    bars: { title: "Top vendors by deliveries", items: topVendorsRaw.map((v) => ({ name: vMap.get(v.vendorId!) || "—", value: v._count._all })) },
    actions: [{
      key: "inspect", label: "GRNs awaiting inspection / action", severity: pendingList.length ? "warning" : "good",
      items: pendingList.map((p) => ({
        title: p.grnNumber, subtitle: p.vendor?.name || "—", meta: p.status,
        urgency: p.status === "INSPECTION_FAILED" ? "critical" : "warning",
        route: "/goods-receipts",
      })),
    }],
  };
}

// ── PURCHASE ─────────────────────────────────────────────────────────────────
async function purchaseWidgets(deptId: number) {
  const { start, end } = todayRange();
  const scope = { departmentId: deptId };
  const buckets = dayBuckets(14);

  const [raisedToday, raisedMonth, deadlineToday, overdue, pendingGrn, open, poDates14, prevMonthCount] = await Promise.all([
    prisma.purchaseOrder.count({ where: { ...scope, poDate: { gte: start, lte: end } } }),
    prisma.purchaseOrder.count({ where: { ...scope, poDate: { gte: monthStart() } } }),
    prisma.purchaseOrder.count({ where: { ...scope, deliveryDate: { gte: start, lte: end }, status: { notIn: ["FULLY_RECEIVED", "CANCELLED", "CLOSED"] } } }),
    prisma.purchaseOrder.count({ where: { ...scope, deliveryDate: { lt: start }, status: { notIn: ["FULLY_RECEIVED", "CANCELLED", "CLOSED"] } } }),
    prisma.purchaseOrder.count({ where: { ...scope, status: { in: ["SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } } }),
    prisma.purchaseOrder.count({ where: { ...scope, status: { notIn: ["FULLY_RECEIVED", "CANCELLED", "CLOSED"] } } }),
    prisma.purchaseOrder.findMany({ where: { ...scope, poDate: { gte: daysAgo(14) } }, select: { poDate: true }, take: 2000 }),
    prisma.purchaseOrder.count({ where: { ...scope, poDate: { gte: daysAgo(60), lt: monthStart() } } }),
  ]);

  const byStatus = await prisma.purchaseOrder.groupBy({ by: ["status"], where: scope, _count: { _all: true } });

  const dueSoon = await prisma.purchaseOrder.findMany({
    where: { ...scope, deliveryDate: { not: null }, status: { notIn: ["FULLY_RECEIVED", "CANCELLED", "CLOSED"] } },
    select: { id: true, poNumber: true, status: true, deliveryDate: true, totalAmount: true, vendor: { select: { name: true } } },
    orderBy: { deliveryDate: "asc" }, take: 12,
  });
  const now = Date.now();
  const actionItems = dueSoon.map((p) => {
    const dd = p.deliveryDate!.getTime();
    const overdueDays = Math.floor((now - dd) / 86_400_000);
    return {
      title: p.poNumber, subtitle: p.vendor?.name || "—",
      meta: overdueDays > 0 ? `${overdueDays}d overdue` : overdueDays === 0 ? "Due today" : `Due in ${-overdueDays}d`,
      urgency: overdueDays > 0 ? "critical" : overdueDays === 0 ? "warning" : "info",
      route: "/purchase-orders",
    };
  });

  return {
    kpis: [
      { key: "raisedToday", label: "POs Raised Today", value: raisedToday, icon: "pi-file-edit", tone: "info" },
      { key: "raisedMonth", label: "POs This Month", value: raisedMonth, icon: "pi-calendar", tone: "info", delta: delta(raisedMonth, prevMonthCount) },
      { key: "deadlineToday", label: "Deadlines Today", value: deadlineToday, icon: "pi-flag", tone: deadlineToday > 0 ? "warning" : "good" },
      { key: "overdue", label: "Overdue POs", value: overdue, icon: "pi-exclamation-triangle", tone: overdue > 0 ? "critical" : "good" },
    ],
    trend: { title: "POs raised (14 days)", labels: buckets.map((b) => b.label), series: [{ name: "POs", color: 1, values: bucketize(poDates14.map((p) => p.poDate), buckets) }] },
    donut: { title: "PO pipeline by status", slices: byStatus.map((s) => ({ name: s.status, value: s._count._all })) },
    actions: [{
      key: "deadlines", label: "POs needing follow-up", severity: overdue > 0 ? "critical" : deadlineToday > 0 ? "warning" : "good",
      items: actionItems,
    }],
  };
}

// ── IT ───────────────────────────────────────────────────────────────────────
async function itWidgets(deptId: number) {
  const [owned, assignedOut, byCategoryRaw, byStatusRaw] = await Promise.all([
    prisma.asset.count({ where: { departmentId: deptId } }),
    prisma.asset.count({ where: { departmentId: deptId, targetDepartmentId: { not: null, notIn: [deptId] } } }),
    prisma.asset.groupBy({ by: ["assetCategoryId"], where: { departmentId: deptId }, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ["status"], where: { departmentId: deptId }, _count: { _all: true } }),
  ]);
  const cats = await prisma.assetCategory.findMany({ where: { id: { in: byCategoryRaw.map((b) => b.assetCategoryId) } }, select: { id: true, name: true } });
  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  const assignedList = await prisma.asset.findMany({
    where: { departmentId: deptId, targetDepartmentId: { not: null, notIn: [deptId] } },
    select: { assetId: true, assetName: true, status: true, targetDepartment: { select: { name: true } }, allottedTo: { select: { name: true } } },
    take: 12,
  });
  // Unassigned in-store assets (IT's backlog to deploy).
  const unassigned = await prisma.asset.findMany({
    where: { departmentId: deptId, status: "IN_STORE", allottedToId: null },
    select: { assetId: true, assetName: true, assetCategory: { select: { name: true } } }, take: 12,
  });

  return {
    kpis: [
      { key: "owned", label: "Total Assets Owned", value: owned, icon: "pi-database", tone: "info" },
      { key: "assignedOut", label: "Assigned to Other Depts", value: assignedOut, icon: "pi-share-alt", tone: "info" },
      { key: "unassigned", label: "Awaiting Deployment", value: unassigned.length, icon: "pi-inbox", tone: unassigned.length ? "warning" : "good" },
    ],
    donut: { title: "Assets by status", slices: byStatusRaw.map((s) => ({ name: s.status, value: s._count._all })) },
    bars: { title: "Assets by category", items: byCategoryRaw.map((b) => ({ name: catMap.get(b.assetCategoryId) || "—", value: b._count._all })).sort((a, b) => b.value - a.value).slice(0, 8) },
    tables: {
      assignedToOthers: assignedList.map((a) => ({ assetId: a.assetId, assetName: a.assetName, toDept: a.targetDepartment?.name || "—", endUser: a.allottedTo?.name || "—" })),
    },
    actions: [{
      key: "deploy", label: "Assets awaiting deployment", severity: unassigned.length ? "warning" : "good",
      items: unassigned.map((u) => ({ title: u.assetName, subtitle: u.assetCategory?.name || "—", meta: u.assetId, urgency: "info", route: "/assets/view" })),
    }],
  };
}

// ── MAINTENANCE & BIOMEDICAL ─────────────────────────────────────────────────
async function maintenanceWidgets(deptId: number, biomedical: boolean) {
  const now = new Date();
  const soon = inDays(30);
  const assetIds = (await prisma.asset.findMany({ where: { departmentId: deptId }, select: { id: true } })).map((a) => a.id);
  const inIds = assetIds.length ? { in: assetIds } : { in: [-1] };
  const buckets = dayBuckets(14);

  const [openTickets, inProgress, resolvedToday, slaBreached, pmDue, calDue, down,
    openedDates, resolvedDates, prevOpen, criticalTickets, pmList, calList] = await Promise.all([
    prisma.ticket.count({ where: { departmentId: deptId, status: "OPEN" } }),
    prisma.ticket.count({ where: { departmentId: deptId, status: "IN_PROGRESS" } }),
    prisma.ticket.count({ where: { departmentId: deptId, status: "RESOLVED", updatedAt: { gte: todayRange().start } } }),
    prisma.ticket.count({ where: { departmentId: deptId, slaBreached: true, status: { notIn: ["CLOSED", "RESOLVED"] } } }),
    prisma.maintenanceSchedule.count({ where: { assetId: inIds, isActive: true, nextDueAt: { lte: soon } } }),
    prisma.calibrationSchedule.count({ where: { assetId: inIds, isActive: true, nextDueAt: { lte: soon } } }),
    prisma.ticket.count({ where: { departmentId: deptId, downtimeStart: { not: null }, downtimeEnd: null } }),
    prisma.ticket.findMany({ where: { departmentId: deptId, createdAt: { gte: daysAgo(14) } }, select: { createdAt: true }, take: 3000 }),
    prisma.ticket.findMany({ where: { departmentId: deptId, status: { in: ["RESOLVED", "CLOSED"] }, updatedAt: { gte: daysAgo(14) } }, select: { updatedAt: true }, take: 3000 }),
    prisma.ticket.count({ where: { departmentId: deptId, status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt: { gte: daysAgo(14), lt: daysAgo(7) } } }),
    prisma.ticket.findMany({ where: { departmentId: deptId, status: { notIn: ["CLOSED", "RESOLVED"] } }, select: { id: true, ticketId: true, issueType: true, priority: true, slaBreached: true, status: true, createdAt: true, asset: { select: { assetName: true } } }, orderBy: [{ slaBreached: "desc" }, { priority: "desc" }, { createdAt: "asc" }], take: 12 }),
    prisma.maintenanceSchedule.findMany({ where: { assetId: inIds, isActive: true, nextDueAt: { lte: soon } }, select: { nextDueAt: true, asset: { select: { assetId: true, assetName: true } } }, orderBy: { nextDueAt: "asc" }, take: 8 }),
    prisma.calibrationSchedule.findMany({ where: { assetId: inIds, isActive: true, nextDueAt: { lte: soon } }, select: { nextDueAt: true, asset: { select: { assetId: true, assetName: true } } }, orderBy: { nextDueAt: "asc" }, take: 8 }),
  ]);

  const resolved = await prisma.ticket.findMany({ where: { departmentId: deptId, downtimeStart: { not: null }, downtimeEnd: { not: null } }, select: { downtimeStart: true, downtimeEnd: true }, orderBy: { updatedAt: "desc" }, take: 200 });
  let mttrHours: number | null = null;
  if (resolved.length) {
    const totalMs = resolved.reduce((s, t) => s + (t.downtimeEnd!.getTime() - t.downtimeStart!.getTime()), 0);
    mttrHours = Math.round((totalMs / resolved.length / 3_600_000) * 10) / 10;
  }
  const [warrantyExp, amcExp] = await Promise.all([
    prisma.warranty.count({ where: { assetId: inIds, isUnderWarranty: true, warrantyEnd: { gte: now, lte: soon } } }),
    prisma.serviceContract.count({ where: { assetId: inIds, endDate: { gte: now, lte: soon } } }),
  ]);

  const active = openTickets + inProgress;
  const resolvedTotal = await prisma.ticket.count({ where: { departmentId: deptId, status: { in: ["RESOLVED", "CLOSED"] } } });
  const slaCompliance = pct(resolvedTotal, resolvedTotal + slaBreached);

  const nowMs = Date.now();
  const dueItem = (d: any, kind: string) => {
    const days = Math.floor((d.nextDueAt.getTime() - nowMs) / 86_400_000);
    return { title: d.asset?.assetName || "—", subtitle: `${kind} • ${d.asset?.assetId || ""}`, meta: days < 0 ? `${-days}d overdue` : days === 0 ? "Due today" : `in ${days}d`, urgency: days < 0 ? "critical" : days <= 3 ? "warning" : "info", route: kind === "PM" ? "/preventive-maintenance" : "/calibration" };
  };

  return {
    biomedical,
    kpis: [
      { key: "openTickets", label: "Open Tickets", value: openTickets, icon: "pi-ticket", tone: openTickets > 0 ? "warning" : "good", delta: delta(active, prevOpen) },
      { key: "inProgress", label: "In Progress", value: inProgress, icon: "pi-spinner", tone: "info" },
      { key: "slaBreached", label: "SLA Breached", value: slaBreached, icon: "pi-exclamation-triangle", tone: slaBreached > 0 ? "critical" : "good" },
      { key: "down", label: "Currently Down", value: down, icon: "pi-power-off", tone: down > 0 ? "critical" : "good" },
      { key: "mttr", label: "Avg MTTR", value: mttrHours, unit: "h", icon: "pi-clock", tone: "info" },
      { key: "resolvedToday", label: "Resolved Today", value: resolvedToday, icon: "pi-check-circle", tone: "good" },
    ],
    gauges: [{ key: "sla", label: "SLA Compliance", value: slaCompliance ?? 100, max: 100, unit: "%", available: slaCompliance !== null }],
    trend: {
      title: "Tickets: opened vs resolved (14 days)", labels: buckets.map((b) => b.label),
      series: [
        { name: "Opened", color: 6, values: bucketize(openedDates.map((t) => t.createdAt), buckets) },
        { name: "Resolved", color: 2, values: bucketize(resolvedDates.map((t) => t.updatedAt), buckets) },
      ],
    },
    chips: [
      { label: "PM Due (30d)", value: pmDue, icon: "pi-calendar", severity: pmDue > 0 ? "warning" : "good" },
      { label: "Calibration Due (30d)", value: calDue, icon: "pi-sliders-h", severity: calDue > 0 ? "warning" : "good" },
      { label: "Warranty Expiring", value: warrantyExp, icon: "pi-verified", severity: warrantyExp > 0 ? "warning" : "good" },
      { label: "AMC/CMC Expiring", value: amcExp, icon: "pi-file", severity: amcExp > 0 ? "warning" : "good" },
    ],
    actions: [
      {
        key: "tickets", label: "Tickets needing attention", severity: slaBreached > 0 ? "critical" : openTickets > 0 ? "warning" : "good",
        items: criticalTickets.map((t) => ({ title: t.ticketId, subtitle: `${t.asset?.assetName || "—"} • ${t.issueType}`, meta: t.slaBreached ? "SLA breached" : t.priority, urgency: t.slaBreached ? "critical" : t.priority === "HIGH" || t.priority === "CRITICAL" ? "warning" : "info", route: "/ticket/view" })),
      },
      {
        key: "schedules", label: "Upcoming PM & calibration", severity: (pmList.length + calList.length) ? "warning" : "good",
        items: [...pmList.map((d) => dueItem(d, "PM")), ...calList.map((d) => dueItem(d, "Calibration"))]
          .sort((a, b) => (a.urgency === "critical" ? -1 : 1)).slice(0, 12),
      },
    ],
  };
}

// ── GENERIC ──────────────────────────────────────────────────────────────────
async function genericWidgets(deptId: number) {
  const [total, active, inStore, inMaintenance, openTickets, byStatusRaw] = await Promise.all([
    prisma.asset.count({ where: { departmentId: deptId } }),
    prisma.asset.count({ where: { departmentId: deptId, status: "ACTIVE" } }),
    prisma.asset.count({ where: { departmentId: deptId, status: "IN_STORE" } }),
    prisma.asset.count({ where: { departmentId: deptId, status: "IN_MAINTENANCE" } }),
    prisma.ticket.count({ where: { departmentId: deptId, status: "OPEN" } }),
    prisma.asset.groupBy({ by: ["status"], where: { departmentId: deptId }, _count: { _all: true } }),
  ]);
  return {
    kpis: [
      { key: "total", label: "Total Assets", value: total, icon: "pi-database", tone: "info" },
      { key: "active", label: "Active", value: active, icon: "pi-check-circle", tone: "good" },
      { key: "inStore", label: "In Store", value: inStore, icon: "pi-box", tone: "info" },
      { key: "inMaintenance", label: "In Maintenance", value: inMaintenance, icon: "pi-wrench", tone: inMaintenance > 0 ? "warning" : "good" },
      { key: "openTickets", label: "Open Tickets", value: openTickets, icon: "pi-ticket", tone: openTickets > 0 ? "warning" : "good" },
    ],
    donut: { title: "Assets by status", slices: byStatusRaw.map((s) => ({ name: s.status, value: s._count._all })) },
    actions: [],
  };
}

// ── Main endpoint ────────────────────────────────────────────────────────────
export const getDepartmentDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    // An HOD may now run several departments, so ?departmentId is honoured for
    // them too — the resolver rejects any they don't answer for.
    const { departmentId: deptId, forbidden } = await resolveDashboardDepartment(user, req.query.departmentId);
    if (forbidden) { res.status(403).json({ message: "Not your department" }); return; }
    if (!deptId) { res.status(400).json({ message: "No department to load a dashboard for" }); return; }

    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { id: true, name: true, dashboardProfile: true } });
    if (!dept) { res.status(404).json({ message: "Department not found" }); return; }

    const responsibleDepartments = await getResponsibleDepartments(user);

    const profile = (PROFILES.includes(dept.dashboardProfile as Profile) ? dept.dashboardProfile : "GENERIC") as Profile;

    let data: any;
    switch (profile) {
      case "STORES": data = await storesWidgets(deptId); break;
      case "PURCHASE": data = await purchaseWidgets(deptId); break;
      case "IT": data = await itWidgets(deptId); break;
      case "MAINTENANCE": data = await maintenanceWidgets(deptId, false); break;
      case "BIOMEDICAL": data = await maintenanceWidgets(deptId, true); break;
      default: data = await genericWidgets(deptId);
    }

    res.json({ departmentId: deptId, departmentName: dept.name, departments: responsibleDepartments, profile, data });
  } catch (e: any) {
    console.error("getDepartmentDashboard error:", e);
    res.status(500).json({ message: e.message || "Failed to load dashboard" });
  }
};

// ── Profile assignment (Admin) ───────────────────────────────────────────────
function isAdmin(user: any): boolean {
  return ["ADMIN", "CEO_COO", "OPERATIONS", "FINANCE", "CFO"].includes((user?.role || "").toUpperCase());
}

export const getProfiles = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAdmin(req.user)) { res.status(403).json({ message: "Admin only" }); return; }
    const depts = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, dashboardProfile: true }, orderBy: { name: "asc" } });
    res.json({ profiles: PROFILES, departments: depts });
  } catch (e) {
    console.error("getProfiles error:", e);
    res.status(500).json({ message: "Failed to load profiles" });
  }
};

export const setProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAdmin(req.user)) { res.status(403).json({ message: "Admin only" }); return; }
    const departmentId = Number(req.params.departmentId);
    const profile = String(req.body?.profile || "").toUpperCase();
    if (profile && !PROFILES.includes(profile as Profile)) { res.status(400).json({ message: "Invalid profile" }); return; }
    const updated = await prisma.department.update({ where: { id: departmentId }, data: { dashboardProfile: profile || null }, select: { id: true, name: true, dashboardProfile: true } });
    res.json(updated);
  } catch (e: any) {
    console.error("setProfile error:", e);
    res.status(500).json({ message: e.message || "Failed to set profile" });
  }
};

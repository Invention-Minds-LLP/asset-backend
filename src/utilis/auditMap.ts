import prisma from "../prismaClient";

// Shared floor-map + next-asset routing logic, used by both the internal
// auditor endpoints (asset-audit.controller) and the external auditor portal
// (external-audit.controller). Keep the algorithm in one place so the two
// flows can never drift.

const CONNECTOR_RE = /lobby|veranda|verandah|corridor|passage|foyer|hallway|hall|walkway|reception/i;
const isConnector = (room?: string | null) => !!room && CONNECTOR_RE.test(room);

export type MappedItem = {
  itemId: number;
  assetId: number;
  assetCode: string | null;
  assetName: string | null;
  category: string;
  status: string;
  scannedAt: Date | null;
  room: string | null;
  planX: number | null;
  planY: number | null;
};

// Resolves the audit's floor plan and maps every item to its current pin
// coordinates (read from the location module's AssetLocation rows).
export const buildAuditMap = async (auditId: number) => {
  const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
  if (!audit) return null;

  const items = await prisma.assetAuditItem.findMany({
    where: { auditId },
    include: {
      asset: {
        select: {
          id: true,
          assetId: true,
          assetName: true,
          assetCategory: { select: { name: true } },
        },
      },
    },
  });

  const assetIds = items.map((i) => i.assetId);
  const locs = assetIds.length
    ? await prisma.assetLocation.findMany({
        where: { assetId: { in: assetIds }, isActive: true },
        select: {
          assetId: true,
          room: true,
          planX: true,
          planY: true,
          floorPlanId: true,
        },
        orderBy: { id: "desc" },
      })
    : [];

  // Latest active location per asset.
  const locByAsset = new Map<number, (typeof locs)[number]>();
  for (const l of locs) if (!locByAsset.has(l.assetId)) locByAsset.set(l.assetId, l);

  // Resolve the plan: prefer the audit's stored floorPlanId, else the modal
  // floorPlanId across the items' pins.
  let planId = (audit as any).floorPlanId ?? null;
  if (!planId) {
    const counts = new Map<number, number>();
    for (const l of locs) if (l.floorPlanId) counts.set(l.floorPlanId, (counts.get(l.floorPlanId) ?? 0) + 1);
    let best = 0;
    for (const [pid, n] of counts) if (n > best) { best = n; planId = pid; }
  }
  const plan = planId
    ? await (prisma as any).floorPlan.findUnique({ where: { id: planId } })
    : null;

  const placed: MappedItem[] = [];
  const unplaced: MappedItem[] = [];
  for (const it of items) {
    const l = locByAsset.get(it.assetId);
    const base: MappedItem = {
      itemId: it.id,
      assetId: it.assetId,
      assetCode: it.asset?.assetId ?? null,
      assetName: it.asset?.assetName ?? null,
      category: it.asset?.assetCategory?.name ?? "",
      status: it.status,
      scannedAt: it.scannedAt,
      room: l?.room ?? null,
      planX: null,
      planY: null,
    };
    const pinnedHere = l && l.planX != null && l.planY != null && (!plan || l.floorPlanId === plan.id);
    if (pinnedHere) {
      placed.push({ ...base, planX: l!.planX, planY: l!.planY });
    } else {
      unplaced.push(base);
    }
  }

  return { audit, plan, placed, unplaced };
};

// Greedy nearest-neighbour route over PENDING pinned items: finish the current
// room first, then step to the nearest real room; lobby/veranda/corridor are
// de-prioritised pass-through spaces. Returns the next item + the full route.
export const computeNextItem = (
  plan: any,
  placed: MappedItem[],
  fromItemId?: number | null
) => {
  const W = plan?.width || 100;
  const H = plan?.height || 100;
  const norm = (i: MappedItem) => ({ x: ((i.planX ?? 0) / 100) * W, y: ((i.planY ?? 0) / 100) * H });

  const pending = placed
    .filter((i) => i.status === "PENDING")
    .map((i) => ({ ...i, _x: norm(i).x, _y: norm(i).y }));

  if (!pending.length) return { next: null, route: [] as any[] };

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  type P = (typeof pending)[number];
  const nearest = (cur: { x: number; y: number }, arr: P[]): P =>
    arr.reduce<{ item: P; d: number }>(
      (best, i) => {
        const d = dist(cur, { x: i._x, y: i._y });
        return d < best.d ? { item: i, d } : best;
      },
      { item: arr[0], d: Infinity }
    ).item;
  const centroid = (arr: P[]) => ({
    x: arr.reduce((s, i) => s + i._x, 0) / arr.length,
    y: arr.reduce((s, i) => s + i._y, 0) / arr.length,
  });
  const groupByRoom = (arr: P[]) => {
    const m = new Map<string, P[]>();
    for (const i of arr) {
      const k = i.room || "__none__";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()].map(([room, items]) => ({
      room: room === "__none__" ? null : room,
      items,
    }));
  };

  const pickNext = (cur: { x: number; y: number; room: string | null }, remaining: P[]): P => {
    // 1. Finish the current (real) room first.
    if (cur.room && !isConnector(cur.room)) {
      const sameRoom = remaining.filter((i) => i.room === cur.room);
      if (sameRoom.length) return nearest(cur, sameRoom);
    }
    // 2. Choose the next room by centroid distance; connectors only if nothing else.
    const groups = groupByRoom(remaining);
    const real = groups.filter((g) => !isConnector(g.room));
    const pool = real.length ? real : groups;
    let bestGroup = pool[0];
    let bestD = Infinity;
    for (const g of pool) {
      const d = dist(cur, centroid(g.items));
      if (d < bestD) { bestD = d; bestGroup = g; }
    }
    return nearest(cur, bestGroup.items);
  };

  // Starting position.
  let cur: { x: number; y: number; room: string | null } | null = null;
  if (fromItemId) {
    const f = pending.find((i) => i.itemId === fromItemId)
      ?? placed.find((i) => i.itemId === fromItemId && i.planX != null);
    if (f) cur = { x: norm(f).x, y: norm(f).y, room: f.room };
  }
  if (!cur) {
    const scanned = placed
      .filter((i) => i.scannedAt)
      .sort((a, b) => (b.scannedAt!.getTime() - a.scannedAt!.getTime()));
    if (scanned[0]) cur = { x: norm(scanned[0]).x, y: norm(scanned[0]).y, room: scanned[0].room };
  }
  if (!cur) {
    // Nothing scanned yet: start from a connector (entrance) centroid if any,
    // else the pending pin closest to the image origin.
    const conn = pending.filter((i) => isConnector(i.room));
    if (conn.length) {
      cur = { ...centroid(conn), room: null };
    } else {
      const start = nearest({ x: 0, y: 0 }, pending);
      cur = { x: start._x, y: start._y, room: start.room };
    }
  }

  // Build the full ordered route.
  const route: P[] = [];
  let remaining = [...pending];
  let pos = cur;
  while (remaining.length) {
    const nxt = pickNext(pos, remaining);
    route.push(nxt);
    remaining = remaining.filter((i) => i.itemId !== nxt.itemId);
    pos = { x: nxt._x, y: nxt._y, room: nxt.room };
  }

  const strip = (i: P) => ({
    itemId: i.itemId,
    assetId: i.assetId,
    assetCode: i.assetCode,
    assetName: i.assetName,
    category: i.category,
    room: i.room,
    planX: i.planX,
    planY: i.planY,
  });

  return { next: strip(route[0]), route: route.map(strip) };
};

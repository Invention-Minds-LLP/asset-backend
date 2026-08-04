import prisma from "../prismaClient";
import { asPolygon, pointInPolygon, polygonBounds, polygonCentroid } from "./geometry";

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
  // Descriptive fields the guidance assistant speaks aloud. placementLabel is
  // written by a human standing in the room ("opposite to HR department"), which
  // is better guidance than anything derivable from the drawing.
  placementLabel: string | null;
  department: string | null;
  block: string | null;
  responsible: string | null;
  qrCode: string | null;
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
          qrCode: true,
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
          placementLabel: true,
          departmentSnapshot: true,
          block: true,
          employeeResponsible: { select: { name: true, employeeID: true } },
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
      placementLabel: l?.placementLabel ?? null,
      department: l?.departmentSnapshot ?? null,
      block: l?.block ?? null,
      responsible: l?.employeeResponsible
        ? `${l.employeeResponsible.name}${l.employeeResponsible.employeeID ? ` (${l.employeeResponsible.employeeID})` : ""}`
        : null,
      qrCode: it.asset?.qrCode ?? null,
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

// ─────────────────────────────────────────────────────────────────────────────
//  ROOM-LEVEL AUDIT PROGRESS
//  Rolls the audit's items up into the floor plan's traced zones, so the map can
//  show "this room is done, that one has 3 assets still missing" instead of a
//  field of individual dots. Also returns a room walking order and the not-found
//  list, which is what the shrinkage report is really made of.
// ─────────────────────────────────────────────────────────────────────────────

type ZoneProgress = {
  id: number;
  name: string;
  roomNumber: string | null;
  department: string | null;
  kind: string;
  polygon: [number, number][];
  bounds: ReturnType<typeof polygonBounds>;
  centroid: ReturnType<typeof polygonCentroid>;
  total: number;
  verified: number;
  missing: number;
  mismatch: number;
  pending: number;
  /** 0–100. Anything not still PENDING counts as visited. */
  pct: number;
  /** Highest-severity state present, for the map's colour + icon. */
  state: "done" | "partial" | "untouched" | "issue" | "empty";
  items: { itemId: number; assetCode: string | null; assetName: string | null; status: string }[];
};

export const buildZoneProgress = async (auditId: number) => {
  const map = await buildAuditMap(auditId);
  if (!map) return null;
  const { audit, plan, placed, unplaced } = map;

  const zonesRaw = plan
    ? await (prisma as any).floorPlanZone.findMany({ where: { floorPlanId: plan.id }, orderBy: { name: "asc" } })
    : [];

  const claimed = new Set<number>();
  const zones: ZoneProgress[] = zonesRaw.map((z: any) => {
    const polygon = asPolygon(z.polygon);
    const inside = placed.filter((i) =>
      i.planX != null && i.planY != null && pointInPolygon(Number(i.planX), Number(i.planY), polygon)
    );
    inside.forEach((i) => claimed.add(i.itemId));

    const count = (s: string) => inside.filter((i) => i.status === s).length;
    const verified = count("VERIFIED");
    const missing = count("MISSING");
    const mismatch = count("MISMATCH");
    const pending = count("PENDING");
    const total = inside.length;
    const done = total - pending;

    let state: ZoneProgress["state"] = "empty";
    if (total === 0) state = "empty";
    else if (missing || mismatch) state = "issue";
    else if (pending === 0) state = "done";
    else if (done === 0) state = "untouched";
    else state = "partial";

    return {
      id: z.id,
      name: z.name,
      roomNumber: z.roomNumber ?? null,
      department: z.department ?? null,
      kind: z.kind,
      polygon,
      bounds: polygonBounds(polygon),
      centroid: polygonCentroid(polygon),
      total,
      verified,
      missing,
      mismatch,
      pending,
      pct: total ? Math.round((done / total) * 100) : 0,
      state,
      items: inside.map((i) => ({
        itemId: i.itemId,
        assetCode: i.assetCode,
        assetName: i.assetName,
        status: i.status,
      })),
    };
  });

  // Room walking order: nearest-neighbour over the centroids of rooms that still
  // have PENDING items. Corridors are pass-through, so they go last.
  const todo = zones.filter((z) => z.pending > 0 && z.centroid);
  const order: { id: number; name: string; pending: number }[] = [];
  {
    const remaining = [...todo];
    let cur = { x: 0, y: 0 };
    while (remaining.length) {
      let bestIdx = 0;
      let bestScore = Infinity;
      remaining.forEach((z, idx) => {
        const c = z.centroid!;
        const d = Math.hypot(c.x - cur.x, c.y - cur.y);
        const score = z.kind === "CORRIDOR" ? d + 1000 : d;
        if (score < bestScore) { bestScore = score; bestIdx = idx; }
      });
      const [pick] = remaining.splice(bestIdx, 1);
      order.push({ id: pick.id, name: pick.name, pending: pick.pending });
      cur = { x: pick.centroid!.x, y: pick.centroid!.y };
    }
  }

  // Pinned items that fell outside every traced room — they still need visiting,
  // they just can't be attributed to a room yet.
  const outsideZones = placed.filter((i) => !claimed.has(i.itemId));

  const notFound = placed
    .filter((i) => i.status === "MISSING" || i.status === "MISMATCH")
    .map((i) => {
      const z = zones.find((zz) => zz.items.some((it) => it.itemId === i.itemId));
      return {
        itemId: i.itemId,
        assetCode: i.assetCode,
        assetName: i.assetName,
        status: i.status,
        zoneId: z?.id ?? null,
        zoneName: z?.name ?? i.room ?? null,
        planX: i.planX,
        planY: i.planY,
      };
    });

  const totals = {
    items: placed.length + unplaced.length,
    placed: placed.length,
    unplaced: unplaced.length,
    outsideZones: outsideZones.length,
    zonesTotal: zones.length,
    zonesDone: zones.filter((z) => z.state === "done").length,
    zonesWithIssues: zones.filter((z) => z.state === "issue").length,
    maxRoomAssets: zones.length ? Math.max(...zones.map((z) => z.total)) : 0,
  };

  return { audit, plan, zones, walkingOrder: order, notFound, totals };
};

import prisma from "../prismaClient";
import { asPolygon, polygonCentroid } from "./geometry";

// ─────────────────────────────────────────────────────────────────────────────
//  AUDIT RUN PLAN
//
//  How an auditor actually walks an audit: pick a way to start (floor,
//  department, or a flat list), pick which floor, then work one asset at a time
//  while being told where the next one is.
//
//  Everything here is built from AssetLocation TEXT — floor, block, room,
//  placementLabel — not from the floor plan. Room text exists for essentially
//  every asset; pins on a traced plan exist for almost none, so routing over
//  pins silently excluded most of the audit. The plan-based router
//  (auditGuidance.ts) remains as an upgrade for sites that have traced rooms.
// ─────────────────────────────────────────────────────────────────────────────

export type RunMode = "FLOOR" | "DEPARTMENT" | "ASSET";
export const RUN_MODES: RunMode[] = ["FLOOR", "DEPARTMENT", "ASSET"];

const NO_ROOM = "No room recorded";
const UNGROUPED = "Not recorded";

/** Room numbers sort numerically — 2, 10, 1521 — with named rooms after them. */
const roomSortKey = (room: string): [number, number, string] => {
  const s = (room || "").trim();
  if (!s || s === NO_ROOM) return [2, 0, ""];       // blanks always last
  const m = s.match(/\d+/);
  return m ? [0, parseInt(m[0], 10), s] : [1, 0, s.toLowerCase()];
};

const cmpRoom = (a: string, b: string) => {
  const [ax, an, as] = roomSortKey(a);
  const [bx, bn, bs] = roomSortKey(b);
  return ax - bx || an - bn || as.localeCompare(bs);
};

type Row = {
  itemId: number;
  assetId: number;
  assetCode: string | null;
  assetName: string | null;
  category: string;
  qrCode: string | null;
  itemStatus: string;
  assetStatus: string | null;
  isRequired: boolean;
  qrStickered: boolean;
  stickerStatus: string | null;
  floor: string | null;
  block: string | null;
  room: string | null;
  placementLabel: string | null;
  placementProfile: string | null;
  placementType: string | null;
  planX: number | null;
  planY: number | null;
  department: string | null;
  responsible: string | null;
};

/** Audit items joined to their current location text. */
const loadRows = async (auditId: number): Promise<Row[]> => {
  const items = await prisma.assetAuditItem.findMany({
    where: { auditId },
    include: {
      asset: {
        select: {
          id: true,
          assetId: true,
          assetName: true,
          status: true,
          qrCode: true,
          qrStickered: true,
          assetCategory: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const assetIds = items.map((i) => i.assetId);
  const locs = assetIds.length
    ? await prisma.assetLocation.findMany({
        where: { assetId: { in: assetIds }, isActive: true },
        select: {
          assetId: true, floor: true, block: true, room: true,
          placementLabel: true, departmentSnapshot: true,
          placementProfile: true, placementType: true, planX: true, planY: true,
          employeeResponsible: { select: { name: true, employeeID: true } },
        },
        orderBy: { id: "desc" },
      })
    : [];

  const locByAsset = new Map<number, (typeof locs)[number]>();
  for (const l of locs) if (!locByAsset.has(l.assetId)) locByAsset.set(l.assetId, l);

  return items.map((it) => {
    const l = locByAsset.get(it.assetId);
    return {
      itemId: it.id,
      assetId: it.assetId,
      assetCode: it.asset?.assetId ?? null,
      assetName: it.asset?.assetName ?? null,
      category: it.asset?.assetCategory?.name ?? "",
      qrCode: it.asset?.qrCode ?? null,
      itemStatus: it.status,
      assetStatus: it.asset?.status ?? null,
      isRequired: (it as any).isRequired !== false,
      qrStickered: it.asset?.qrStickered === true,
      stickerStatus: (it as any).stickerStatus ?? null,
      floor: l?.floor ?? null,
      block: l?.block ?? null,
      room: l?.room ?? null,
      placementLabel: l?.placementLabel ?? null,
      placementProfile: l?.placementProfile ?? null,
      placementType: l?.placementType ?? null,
      planX: l?.planX == null ? null : Number(l.planX),
      planY: l?.planY == null ? null : Number(l.planY),
      department: it.asset?.department?.name ?? l?.departmentSnapshot ?? null,
      responsible: l?.employeeResponsible
        ? `${l.employeeResponsible.name}${l.employeeResponsible.employeeID ? ` (${l.employeeResponsible.employeeID})` : ""}`
        : null,
    };
  });
};

const groupKeyOf = (r: Row, mode: RunMode): string => {
  if (mode === "DEPARTMENT") return r.department?.trim() || UNGROUPED;
  if (mode === "FLOOR") {
    const f = r.floor?.trim();
    const b = r.block?.trim();
    if (!f && !b) return UNGROUPED;
    return [b, f].filter(Boolean).join(" · ");
  }
  return "All assets";
};

const roomKeyOf = (r: Row): string => r.room?.trim() || NO_ROOM;

export type PlacementFilter = "ROOM" | "OUTDOOR" | "ALL";

// Placement types that mean "not a room" — corridors, receptions, parking and
// the like. Straight from AssetLocation.placementType / placementProfile, which
// the location import already populates.
const OUTDOOR_TYPES = new Set([
  "CORRIDOR", "RECEPTION", "ENTRANCE", "STAIRWELL", "LIFT_LOBBY",
  "PARKING", "PERIMETER", "ROOFTOP", "GATE", "AREA", "OUTDOOR", "DUCT",
]);

/** Is this asset in an enclosed room, or out in a shared/outdoor space? */
export const isOutdoor = (r: Row): boolean => {
  const profile = (r.placementProfile ?? "").toUpperCase();
  if (profile === "OUTDOOR") return true;
  const type = (r.placementType ?? "").toUpperCase();
  if (type) return OUTDOOR_TYPES.has(type);
  // Nothing recorded at all: assume a room. In a hospital most assets are in
  // one, so the safe default for missing data is the common case — defaulting
  // to outdoor swept whole floors into the wrong bucket.
  return false;
};

const matchesPlacement = (r: Row, want: PlacementFilter): boolean =>
  want === "ALL" ? true : want === "OUTDOOR" ? isOutdoor(r) : !isOutdoor(r);

/**
 * Walk order when pins exist: greedy nearest-neighbour over the floor-plan
 * coordinates, so "next" really is the closest one. Only assets that are
 * actually pinned can take part — on real data most are not — so this is used
 * as an ordering hint and the rest fall back to room order.
 */
const nearestFirst = (rows: Row[]): Row[] => {
  const pinned = rows.filter((r) => r.planX != null && r.planY != null);
  if (pinned.length < 2) return rows;
  const rest = rows.filter((r) => r.planX == null || r.planY == null);

  const remaining = [...pinned];
  const out: Row[] = [];
  // Start nearest the top-left of the plan so the route is reproducible.
  let cur = { x: 0, y: 0 };
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((r, i) => {
      const d = Math.hypot((r.planX as number) - cur.x, (r.planY as number) - cur.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    const [pick] = remaining.splice(best, 1);
    out.push(pick);
    cur = { x: pick.planX as number, y: pick.planY as number };
  }
  // Unpinned assets keep their room order and follow on.
  return [...out, ...rest];
};

// ─────────────────────────────────────────────────────────────────────────────
//  ROOM → TRACED ZONE ANCHORING
//
//  Room text alone gives no sense of distance, so rooms are walked in numeric
//  order — which is only right when room numbers happen to follow the corridor.
//  Where the floor plan has the room traced, its centroid gives a real position
//  and the route can be ordered by actual proximity instead.
//
//  The join is EXACT on trimmed, case-folded text — roomNumber first, then zone
//  name. Deliberately not fuzzy: a mis-matched room sends the auditor
//  confidently to the wrong place, which is worse than no ordering at all. Same
//  reasoning as the no-turn-by-turn rule.
//
//  Degrades cleanly: fewer than two anchored rooms and everything falls back to
//  the numeric order below, unchanged.
// ─────────────────────────────────────────────────────────────────────────────

type RoomAnchor = { zoneId: number; zoneName: string; x: number; y: number };

/** Normalised key for joining AssetLocation.room to a traced zone. */
const zoneKey = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const loadRoomAnchors = async (audit: any, rows: Row[]): Promise<Map<string, RoomAnchor>> => {
  const out = new Map<string, RoomAnchor>();

  const floors = [...new Set(rows.map((r) => (r.floor ?? "").trim()).filter(Boolean))];
  const branchId = audit?.branchId ? Number(audit.branchId) : null;
  // With neither a branch nor a floor there is nothing to scope plans by, and
  // matching room "1" against every plan in the estate would be a coin flip.
  if (!branchId && !floors.length) return out;

  const planWhere: any = { isActive: true };
  if (branchId) planWhere.branchId = branchId;
  if (floors.length) planWhere.floor = { in: floors };

  const plans = await (prisma as any).floorPlan.findMany({ where: planWhere, select: { id: true } });
  if (!plans.length) return out;

  const zones = await (prisma as any).floorPlanZone.findMany({
    where: { floorPlanId: { in: plans.map((p: any) => p.id) } },
    select: { id: true, name: true, roomNumber: true, polygon: true },
  });

  for (const z of zones) {
    const c = polygonCentroid(asPolygon(z.polygon));
    if (!c) continue;
    const anchor: RoomAnchor = { zoneId: z.id, zoneName: z.name, x: c.x, y: c.y };
    // Name first so roomNumber can overwrite it — the number is the stronger
    // signal when a zone's name and another zone's number collide.
    const nameKey = zoneKey(z.name);
    if (nameKey && !out.has(nameKey)) out.set(nameKey, anchor);
    const numKey = zoneKey(z.roomNumber);
    if (numKey) out.set(numKey, anchor);
  }
  return out;
};

/**
 * No real-world scale is stored for a plan, so distance stays qualitative.
 * Saying "25 metres" from percentage coordinates would be invented precision.
 */
const proximityPhrase = (pctDistance: number): string =>
  pctDistance < 12 ? "just beside you" : pctDistance < 35 ? "a short walk away" : "at the other end of the floor";

/**
 * The order to walk the rooms in a group. Anchored rooms are sequenced by
 * greedy nearest-neighbour from the top-left of the plan (reproducible); rooms
 * the plan doesn't have keep numeric order and follow on.
 */
export const buildRoomOrder = (
  roomKeys: string[],
  anchors: Map<string, RoomAnchor>
): { order: string[]; anchored: boolean } => {
  const hasAnchor = (k: string) => k !== NO_ROOM && anchors.has(zoneKey(k));
  const anchoredKeys = roomKeys.filter(hasAnchor);
  const rest = roomKeys.filter((k) => !hasAnchor(k)).sort(cmpRoom);

  // One anchored room tells you nothing about order — don't claim plan routing.
  if (anchoredKeys.length < 2) return { order: [...roomKeys].sort(cmpRoom), anchored: false };

  const remaining = [...anchoredKeys];
  const seq: string[] = [];
  let cur = { x: 0, y: 0 };
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((k, i) => {
      const a = anchors.get(zoneKey(k))!;
      const d = Math.hypot(a.x - cur.x, a.y - cur.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    const [pick] = remaining.splice(best, 1);
    seq.push(pick);
    const a = anchors.get(zoneKey(pick))!;
    cur = { x: a.x, y: a.y };
  }
  return { order: [...seq, ...rest], anchored: true };
};

/**
 * "Which floor / department do you want to start with?" — only the ones this
 * audit actually covers, with what is left in each.
 */
export const buildStartOptions = async (auditId: number, mode: RunMode) => {
  const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
  if (!audit) return null;

  const rows = await loadRows(auditId);
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = groupKeyOf(r, mode);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }

  const groups = [...map.entries()]
    .map(([key, list]) => {
      const rooms = [...new Set(list.map(roomKeyOf))].sort(cmpRoom);
      const pending = list.filter((r) => r.itemStatus === "PENDING").length;
      return {
        key,
        label: key,
        total: list.length,
        pending,
        done: list.length - pending,
        required: list.filter((r) => r.isRequired).length,
        pendingRequired: list.filter((r) => r.isRequired && r.itemStatus === "PENDING").length,
        rooms: rooms.filter((x) => x !== NO_ROOM).length,
        indoorPending: list.filter((r) => r.itemStatus === "PENDING" && !isOutdoor(r)).length,
        outdoorPending: list.filter((r) => r.itemStatus === "PENDING" && isOutdoor(r)).length,
        pinned: list.filter((r) => r.planX != null).length,
        complete: list.every((r) => !r.isRequired || r.itemStatus !== "PENDING"),
      };
    })
    // Unfinished first — that is what the auditor is choosing between.
    .sort((a, b) => Number(a.complete) - Number(b.complete) || cmpRoom(a.key, b.key));

  return {
    auditId: audit.id,
    auditName: audit.auditName,
    auditStatus: audit.status,
    mode,
    defaultMode: ((audit as any).groupBy as RunMode) || "FLOOR",
    groups,
    totals: {
      items: rows.length,
      pending: rows.filter((r) => r.itemStatus === "PENDING").length,
      pendingRequired: rows.filter((r) => r.isRequired && r.itemStatus === "PENDING").length,
    },
  };
};

const spokenRoom = (room: string | null): string =>
  !room || room === NO_ROOM ? "" : /^\d+$/.test(room.trim()) ? `room ${room.trim()}` : room.trim();

/**
 * Does the free-text note already name the room? Placement labels are written
 * by hand and usually do ("inside room no 1140"), so prefixing the room again
 * produces "room 1140 — inside room no 1140".
 */
const noteMentionsRoom = (label: string, room: string): boolean => {
  const digits = room.match(/\d+/)?.[0];
  if (digits) return new RegExp(`\\b${digits}\\b`).test(label);
  return label.toLowerCase().includes(room.toLowerCase());
};

/** Where an asset is, as one short human sentence — never repeating itself. */
const whereText = (r: Row): string => {
  const room = (r.room ?? "").trim();
  const label = (r.placementLabel ?? "").trim();

  if (label && room && noteMentionsRoom(label, room)) return label;
  if (label && room) return `${spokenRoom(room)} — ${label}`;
  if (label) return label;
  if (room) return spokenRoom(room);
  return r.department?.trim() || "";
};

/**
 * The working run: the ordered walk through one floor/department, where the
 * auditor is in it, and what is next.
 */
export const buildRun = async (
  auditId: number,
  opts: {
    mode?: RunMode;
    group?: string | null;
    fromItemId?: number | null;
    placement?: PlacementFilter;
  } = {}
) => {
  const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
  if (!audit) return null;

  const mode: RunMode = RUN_MODES.includes(opts.mode as RunMode)
    ? (opts.mode as RunMode)
    : (((audit as any).groupBy as RunMode) || "FLOOR");

  const rows = await loadRows(auditId);

  // Pick the group: the requested one, else the first with work left.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = groupKeyOf(r, mode);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  let groupKey = opts.group && groups.has(opts.group) ? opts.group : null;
  if (!groupKey) {
    const firstOpen = [...groups.entries()].find(([, list]) =>
      list.some((r) => r.itemStatus === "PENDING")
    );
    groupKey = firstOpen ? firstOpen[0] : [...groups.keys()][0] ?? null;
  }
  const placement: PlacementFilter =
    opts.placement === "ROOM" || opts.placement === "OUTDOOR" ? opts.placement : "ALL";

  const groupRows = (groupKey ? groups.get(groupKey) ?? [] : []).filter((r) =>
    matchesPlacement(r, placement)
  );

  // Walk order: room by room, assets within a room by code, so the same audit
  // always walks the same way. Rooms the floor plan has traced are sequenced by
  // real proximity; the rest keep numeric order (see buildRoomOrder).
  const anchors = await loadRoomAnchors(audit, rows);
  const { order: roomOrder, anchored: roomsAnchored } = buildRoomOrder(
    [...new Set(groupRows.map(roomKeyOf))],
    anchors
  );
  const roomRank = new Map(roomOrder.map((k, i) => [k, i]));
  const rankOf = (r: Row) => roomRank.get(roomKeyOf(r)) ?? Number.MAX_SAFE_INTEGER;

  const byRoomThenCode = [...groupRows].sort((a, b) => {
    if (mode !== "ASSET") {
      const byRoom = rankOf(a) - rankOf(b);
      if (byRoom !== 0) return byRoom;
    }
    return String(a.assetCode ?? "").localeCompare(String(b.assetCode ?? ""));
  });

  // Outdoor/shared spaces have no meaningful room order, so walk them by the
  // floor plan when pins exist. Indoor work stays grouped room by room — nobody
  // wants to be sent back and forth between two rooms because of raw distance.
  const ordered = placement === "OUTDOOR" ? nearestFirst(byRoomThenCode) : byRoomThenCode;

  const pendingOrdered = ordered.filter((r) => r.itemStatus === "PENDING");

  // Where are we? Just after the asset last handled, else the first pending.
  let current: Row | null = null;
  if (opts.fromItemId != null) {
    const idx = ordered.findIndex((r) => r.itemId === opts.fromItemId);
    if (idx >= 0) current = ordered.slice(idx + 1).find((r) => r.itemStatus === "PENDING") ?? null;
  }
  if (!current) current = pendingOrdered[0] ?? null;

  const position = current ? pendingOrdered.findIndex((r) => r.itemId === current!.itemId) + 1 : 0;
  const next = current
    ? pendingOrdered[pendingOrdered.findIndex((r) => r.itemId === current!.itemId) + 1] ?? null
    : null;

  // Rooms in this group, in walk order, with what's left in each.
  const roomMap = new Map<string, Row[]>();
  for (const r of ordered) {
    const k = roomKeyOf(r);
    if (!roomMap.has(k)) roomMap.set(k, []);
    roomMap.get(k)!.push(r);
  }
  const rooms = [...roomMap.entries()]
    .sort(
      (a, b) =>
        (roomRank.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (roomRank.get(b[0]) ?? Number.MAX_SAFE_INTEGER)
    )
    .map(([key, list]) => {
      const anchor = key === NO_ROOM ? undefined : anchors.get(zoneKey(key));
      return {
        key,
        label: key,
        isNumbered: /^\d+$/.test(key),
        total: list.length,
        pending: list.filter((r) => r.itemStatus === "PENDING").length,
        done: list.filter((r) => r.itemStatus !== "PENDING").length,
        current: !!current && roomKeyOf(current) === key,
        // Traced on the floor plan — the UI can show these as plan-anchored and
        // zoom the map to the zone.
        zoneId: anchor?.zoneId ?? null,
        anchored: !!anchor,
      };
    });

  const sameRoomAsNext = !!current && !!next && roomKeyOf(current) === roomKeyOf(next);

  // ── spoken lines ──────────────────────────────────────────────────────────
  const speech: Record<string, string | null> = {
    start: null, asset: null, next: null, roomChange: null, groupComplete: null,
  };

  if (!current) {
    speech.groupComplete = groupKey
      ? `${groupKey} is complete. Choose another to continue.`
      : `Nothing left to check.`;
  } else {
    const roomsWithWork = rooms.filter((r) => r.pending > 0).length;
    speech.start =
      `Starting ${groupKey}. ${pendingOrdered.length} asset${pendingOrdered.length === 1 ? "" : "s"} to check` +
      `${roomsWithWork > 1 ? `, across ${roomsWithWork} rooms` : ""}.`;

    const where = whereText(current);
    speech.asset =
      `Asset ${position} of ${pendingOrdered.length}. ${current.assetName || "Unnamed asset"}.` +
      (where ? ` ${where}.` : " Location not recorded. Search the area.");

    if (next) {
      const nextWhere = sameRoomAsNext ? "same room" : whereText(next) || "location not recorded";
      speech.next = `Next: ${next.assetName || "next asset"}, ${nextWhere}.`;
      if (!sameRoomAsNext && roomKeyOf(next) !== NO_ROOM) {
        // How far, but only when both rooms are traced on the plan — otherwise
        // there is no position to measure and saying nothing is the honest move.
        const from = anchors.get(zoneKey(roomKeyOf(current)));
        const to = anchors.get(zoneKey(roomKeyOf(next)));
        const hop =
          from && to ? `, ${proximityPhrase(Math.hypot(to.x - from.x, to.y - from.y))}` : "";
        speech.roomChange =
          `Move to ${spokenRoom(roomKeyOf(next))}${hop}. ` +
          `${roomMap.get(roomKeyOf(next))!.filter((r) => r.itemStatus === "PENDING").length} asset(s) there.`;
      }
    } else {
      speech.next = `That is the last asset in ${groupKey}.`;
    }
  }

  const shape = (r: Row | null) =>
    r && {
      itemId: r.itemId,
      assetId: r.assetId,
      assetCode: r.assetCode,
      assetName: r.assetName,
      category: r.category,
      qrCode: r.qrCode,
      itemStatus: r.itemStatus,
      assetStatus: r.assetStatus,
      isRequired: r.isRequired,
      qrStickered: r.qrStickered,
      stickerStatus: r.stickerStatus,
      floor: r.floor,
      block: r.block,
      room: r.room,
      roomLabel: roomKeyOf(r),
      placementLabel: r.placementLabel,
      department: r.department,
      responsible: r.responsible,
      where: whereText(r),
    };

  return {
    auditId: audit.id,
    auditName: audit.auditName,
    auditStatus: audit.status,
    mode,
    group: groupKey,
    placement,
    // FLOOR_PLAN means the route came from real positions — either traced rooms
    // (indoor) or pins (outdoor). ROOM means numeric room order.
    orderedBy:
      roomsAnchored ||
      (placement === "OUTDOOR" && groupRows.filter((r) => r.planX != null).length > 1)
        ? "FLOOR_PLAN"
        : "ROOM",
    // How much of the route the plan actually anchored, so the UI can say
    // "12 of 20 rooms located on the plan" rather than implying full coverage.
    roomAnchoring: {
      anchored: rooms.filter((r) => r.anchored).length,
      total: rooms.filter((r) => r.key !== NO_ROOM).length,
    },
    rooms,
    assets: ordered.map(shape),
    current: shape(current),
    next: shape(next),
    sameRoomAsNext,
    progress: {
      position,
      pending: pendingOrdered.length,
      total: ordered.length,
      done: ordered.length - pendingOrdered.length,
    },
    speech,
  };
};

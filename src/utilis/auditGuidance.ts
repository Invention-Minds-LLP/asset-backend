import { buildAuditMap, buildZoneProgress, MappedItem } from "./auditMap";

// ─────────────────────────────────────────────────────────────────────────────
//  GUIDANCE MODE
//  Turns an audit into a spoken, one-thing-at-a-time task list instead of a map
//  covered in pins: finish the room you are standing in, then walk to the
//  nearest room that still has work.
//
//  Deliberate constraint: nothing here invents a turn-by-turn instruction. With
//  no door positions or corridor centre-lines, "turn left" would be a guess, and
//  a guess that is wrong twice stops being trusted. What it does say is the room,
//  the human-written landmark from placementLabel, the position in the sequence,
//  and a qualitative sense of how far the next room is.
// ─────────────────────────────────────────────────────────────────────────────

/** Reading-order sweep, so the auditor covers a room predictably. */
const sweepOrder = (items: MappedItem[]): MappedItem[] =>
  [...items].sort((a, b) => {
    const ay = Math.round((a.planY ?? 0) / 8); // 8% bands ≈ one "row" of the room
    const by = Math.round((b.planY ?? 0) / 8);
    return ay !== by ? ay - by : (a.planX ?? 0) - (b.planX ?? 0);
  });

/**
 * No real-world scale is stored for a plan, so distance stays qualitative.
 * Saying "25 metres" from percentage coordinates would be invented precision.
 */
const proximity = (pctDistance: number): { band: "adjacent" | "near" | "far"; phrase: string } => {
  if (pctDistance < 12) return { band: "adjacent", phrase: "just beside you" };
  if (pctDistance < 35) return { band: "near", phrase: "a short walk away" };
  return { band: "far", phrase: "at the other end of the floor" };
};

/** Spoken form of an asset code — the tail is enough to match a sticker by ear. */
const spokenCode = (code: string | null): string => {
  if (!code) return "";
  return code.replace(/[^A-Za-z0-9]/g, "").slice(-5).split("").join(" ");
};

type Stop = {
  id: number | null;
  name: string;
  roomNumber: string | null;
  department: string | null;
  pending: number;
  total: number;
  centroid: { x: number; y: number } | null;
  itemIds: number[];
};

export const buildGuidance = async (
  auditId: number,
  opts: { roomId?: number | null; fromItemId?: number | null; stopIndex?: number | null } = {}
) => {
  const progress = await buildZoneProgress(auditId);
  if (!progress) return null;
  const { audit, plan, zones, walkingOrder, totals } = progress;

  const map = await buildAuditMap(auditId);
  const placed: MappedItem[] = map?.placed ?? [];
  const unplaced: MappedItem[] = map?.unplaced ?? [];
  const byItemId = new Map(placed.map((i) => [i.itemId, i]));

  // Items pinned on the plan but inside no traced room still need doing, so they
  // become a synthetic final stop rather than silently disappearing.
  const zonedItemIds = new Set<number>();
  zones.forEach((z: any) => z.items.forEach((i: any) => zonedItemIds.add(i.itemId)));
  const looseItems = placed.filter((i) => !zonedItemIds.has(i.itemId));
  const loosePending = looseItems.filter((i) => i.status === "PENDING");

  const stops: Stop[] = walkingOrder
    .map((w: any) => zones.find((zz: any) => zz.id === w.id))
    .filter((z: any): z is any => !!z)
    .map((z: any) => ({
      id: z.id,
      name: z.name,
      roomNumber: z.roomNumber,
      department: z.department,
      pending: z.pending,
      total: z.total,
      centroid: z.centroid,
      itemIds: z.items.filter((i: any) => i.status === "PENDING").map((i: any) => i.itemId),
    }));
  if (loosePending.length) {
    stops.push({
      id: null,
      name: "Elsewhere on this floor",
      roomNumber: null,
      department: null,
      pending: loosePending.length,
      total: looseItems.length,
      centroid: null,
      itemIds: loosePending.map((i) => i.itemId),
    });
  }

  // Traced rooms can overlap (and hand-drawn ones will, at walls). buildZoneProgress
  // lets every zone claim a pin it contains — right for statistics — but a route
  // must not send the auditor to the same asset twice, so each item belongs to the
  // first stop that claims it.
  const claimed = new Set<number>();
  for (const s of stops) {
    s.itemIds = s.itemIds.filter((id) => !claimed.has(id));
    s.itemIds.forEach((id) => claimed.add(id));
    s.pending = s.itemIds.length;
  }
  // A room whose every asset was claimed earlier has nothing left to walk to.
  const walkable = stops.filter((s) => s.pending > 0);
  stops.length = 0;
  stops.push(...walkable);

  // Which stop are we on? An explicit position wins; else the room holding the
  // asset just handled; else the first stop on the route.
  let index = 0;
  if (opts.stopIndex != null && opts.stopIndex >= 0 && opts.stopIndex < stops.length) {
    index = opts.stopIndex;
  } else if (opts.roomId != null) {
    const i = stops.findIndex((s) => s.id === opts.roomId);
    if (i >= 0) index = i;
  } else if (opts.fromItemId != null) {
    const i = stops.findIndex((s) => s.itemIds.includes(opts.fromItemId as number));
    if (i >= 0) index = i;
  }

  const stop: Stop | null = stops[index] ?? null;
  const nextStop: Stop | null = stops[index + 1] ?? null;

  const roomItems = stop
    ? sweepOrder(stop.itemIds.map((id) => byItemId.get(id)).filter(Boolean) as MappedItem[])
    : [];
  const currentAsset = roomItems[0] ?? null;

  let hop: { band: string; phrase: string; pct: number } | null = null;
  if (stop?.centroid && nextStop?.centroid) {
    const d = Math.hypot(nextStop.centroid.x - stop.centroid.x, nextStop.centroid.y - stop.centroid.y);
    const p = proximity(d);
    hop = { band: p.band, phrase: p.phrase, pct: Math.round(d) };
  }

  // ── ready-to-speak lines ──────────────────────────────────────────────────
  const speech: Record<string, string | null> = {
    roomIntro: null,
    assetPrompt: null,
    roomComplete: null,
    allComplete: null,
    manualNote: null,
  };

  if (!stops.length) {
    speech.allComplete = "Every pinned asset has been checked. This floor is complete.";
  } else if (stop) {
    const where = stop.roomNumber ? `${stop.name}, room ${stop.roomNumber}` : stop.name;
    speech.roomIntro =
      `Room ${index + 1} of ${stops.length}. ${where}. ` +
      `${stop.pending} asset${stop.pending === 1 ? "" : "s"} to check.`;

    if (currentAsset) {
      const landmark = currentAsset.placementLabel
        ? ` ${currentAsset.placementLabel}.`
        : " Location details not recorded for this asset.";
      speech.assetPrompt =
        `Asset 1 of ${roomItems.length}. ${currentAsset.assetName || "Unnamed asset"}.${landmark}`;
    }

    if (nextStop) {
      const nextWhere = nextStop.roomNumber ? `${nextStop.name}, room ${nextStop.roomNumber}` : nextStop.name;
      speech.roomComplete =
        `${stop.name} complete. Next room, ${nextWhere}, ` +
        `${nextStop.pending} asset${nextStop.pending === 1 ? "" : "s"}` +
        `${hop ? `, ${hop.phrase}` : ""}.`;
    } else {
      speech.roomComplete = `${stop.name} complete. That was the last room on this floor.`;
    }
  }

  if (unplaced.length) {
    speech.manualNote =
      `${unplaced.length} asset${unplaced.length === 1 ? " is" : "s are"} not pinned on this plan ` +
      `and must be checked manually.`;
  }

  const shape = (i: MappedItem, n: number, of: number) => ({
    itemId: i.itemId,
    assetId: i.assetId,
    assetCode: i.assetCode,
    spokenCode: spokenCode(i.assetCode),
    qrCode: i.qrCode,
    assetName: i.assetName,
    category: i.category,
    status: i.status,
    room: i.room,
    department: i.department,
    placementLabel: i.placementLabel,
    responsible: i.responsible,
    planX: i.planX,
    planY: i.planY,
    position: { n, of },
  });

  const zonePolygon = (id: number | null) =>
    id != null ? zones.find((z: any) => z.id === id)?.polygon ?? null : null;

  return {
    audit,
    plan,
    room: stop && {
      id: stop.id,
      name: stop.name,
      roomNumber: stop.roomNumber,
      department: stop.department,
      pending: stop.pending,
      total: stop.total,
      centroid: stop.centroid,
      polygon: zonePolygon(stop.id),
      stopIndex: index,
      index: index + 1,
      of: stops.length,
    },
    assets: roomItems.map((i, n) => shape(i, n + 1, roomItems.length)),
    currentAsset: currentAsset ? shape(currentAsset, 1, roomItems.length) : null,
    nextRoom: nextStop && {
      id: nextStop.id,
      // Index is the reliable address — the "Elsewhere on this floor" stop has
      // no room id, so id alone can't reach it.
      stopIndex: index + 1,
      name: nextStop.name,
      roomNumber: nextStop.roomNumber,
      pending: nextStop.pending,
      centroid: nextStop.centroid,
      polygon: zonePolygon(nextStop.id),
      hop,
    },
    route: stops.map((s, i) => ({
      id: s.id,
      stopIndex: i,
      name: s.name,
      pending: s.pending,
      done: i < index,
      current: i === index,
    })),
    unplaced: unplaced.map((i, n) => shape(i, n + 1, unplaced.length)),
    speech,
    totals: { ...totals, roomsRemaining: stops.length },
  };
};

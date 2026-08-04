import prisma from "../prismaClient";

// ─────────────────────────────────────────────────────────────────────────────
//  AUDIT CHECKLIST
//
//  Grouped, filterable list of everything in an audit — the primary way an audit
//  is worked, in place of a plan covered in pins. Every asset in scope appears
//  whatever its lifecycle state, so an auditor can see that the machine they
//  can't find was disposed of last year rather than reporting it missing.
//
//  Lives here rather than in a controller because the internal auditor screens
//  and the external auditor portal must never drift apart.
// ─────────────────────────────────────────────────────────────────────────────

export const GROUP_MODES = ["FLOOR", "DEPARTMENT", "ASSET"];

/** Disposal requests still in flight — an asset in this state isn't "missing". */
const OPEN_DISPOSAL = ["REQUESTED", "COMMITTEE_REVIEW", "APPROVED"];

export type ChecklistFilters = {
  groupBy?: string;
  assetStatus?: string;
  itemStatus?: string;
  sticker?: string;
  q?: string;
};

/** Sticker state to show: what the audit observed beats what the record claims. */
export const stickerOf = (r: { stickerStatus?: string | null; qrStickered?: boolean }) =>
  r.stickerStatus || (r.qrStickered ? "PRESENT" : "NOT CHECKED");

export const buildChecklist = async (auditId: number, filters: ChecklistFilters = {}) => {
  const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
  if (!audit) return null;

  const requested = String(filters.groupBy ?? "").toUpperCase();
  const groupBy = GROUP_MODES.includes(requested) ? requested : ((audit as any).groupBy || "FLOOR");

  const assetStatus = String(filters.assetStatus ?? "").trim();
  const itemStatus = String(filters.itemStatus ?? "").trim();
  const sticker = String(filters.sticker ?? "").trim();
  const q = String(filters.q ?? "").trim().toLowerCase();

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
          department: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const assetIds = items.map((i) => i.assetId);

  const [locations, disposals] = await Promise.all([
    assetIds.length
      ? prisma.assetLocation.findMany({
          where: { assetId: { in: assetIds }, isActive: true },
          select: {
            assetId: true, floor: true, block: true, room: true,
            departmentSnapshot: true, placementLabel: true,
          },
          orderBy: { id: "desc" },
        })
      : [],
    assetIds.length
      ? prisma.assetDisposal.findMany({
          where: { assetId: { in: assetIds }, status: { in: OPEN_DISPOSAL } },
          select: { assetId: true, status: true, disposalType: true },
          orderBy: { id: "desc" },
        })
      : [],
  ]);

  const locByAsset = new Map<number, (typeof locations)[number]>();
  for (const l of locations) if (!locByAsset.has(l.assetId)) locByAsset.set(l.assetId, l);
  const disposalByAsset = new Map<number, (typeof disposals)[number]>();
  for (const d of disposals) if (!disposalByAsset.has(d.assetId)) disposalByAsset.set(d.assetId, d);

  const rows = items.map((it) => {
    const loc = locByAsset.get(it.assetId);
    const disposal = disposalByAsset.get(it.assetId);
    return {
      itemId: it.id,
      assetId: it.assetId,
      assetCode: it.asset?.assetId ?? null,
      assetName: it.asset?.assetName ?? null,
      category: it.asset?.assetCategory?.name ?? "",
      qrCode: it.asset?.qrCode ?? null,
      // Live status, plus what it was when the audit was raised — a difference
      // between the two is itself worth seeing.
      assetStatus: it.asset?.status ?? null,
      assetStatusAtAudit: (it as any).assetStatusAtAudit ?? null,
      statusChanged:
        !!(it as any).assetStatusAtAudit && (it as any).assetStatusAtAudit !== it.asset?.status,
      disposalRequest: disposal ? { status: disposal.status, type: disposal.disposalType } : null,
      isRequired: (it as any).isRequired !== false,
      qrStickered: it.asset?.qrStickered === true,
      stickerStatus: (it as any).stickerStatus ?? null,
      stickerCheckedAt: (it as any).stickerCheckedAt ?? null,
      itemStatus: it.status,
      scannedAt: it.scannedAt,
      remarks: it.remarks,
      floor: loc?.floor ?? null,
      block: loc?.block ?? null,
      room: loc?.room ?? null,
      placementLabel: loc?.placementLabel ?? null,
      departmentId: it.asset?.department?.id ?? null,
      department: it.asset?.department?.name ?? loc?.departmentSnapshot ?? null,
    };
  });

  // Facets come from the unfiltered set, so the chips don't disappear as soon as
  // you use them.
  const facet = (key: "assetStatus" | "itemStatus") => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = (r as any)[key] || "UNKNOWN";
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };
  const stickerFacet = new Map<string, number>();
  for (const r of rows) {
    const v = stickerOf(r);
    stickerFacet.set(v, (stickerFacet.get(v) || 0) + 1);
  }
  const facets = {
    assetStatus: facet("assetStatus"),
    itemStatus: facet("itemStatus"),
    sticker: [...stickerFacet.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
  };

  const filtered = rows.filter((r) => {
    if (assetStatus && r.assetStatus !== assetStatus) return false;
    if (itemStatus && r.itemStatus !== itemStatus) return false;
    if (sticker && stickerOf(r) !== sticker) return false;
    if (q) {
      const hay = `${r.assetName ?? ""} ${r.assetCode ?? ""} ${r.room ?? ""} ${r.department ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const keyOf = (r: (typeof rows)[number]) => {
    if (groupBy === "DEPARTMENT") return r.department || "No department";
    if (groupBy === "FLOOR") {
      const parts = [r.floor, r.block].filter(Boolean);
      return parts.length ? parts.join(" · ") : "No floor recorded";
    }
    return "All assets";
  };

  const groupMap = new Map<string, any[]>();
  for (const r of filtered) {
    const k = keyOf(r);
    if (!groupMap.has(k)) groupMap.set(k, []);
    groupMap.get(k)!.push(r);
  }

  const groups = [...groupMap.entries()]
    .map(([name, list]) => {
      const required = list.filter((r) => r.isRequired);
      const pendingRequired = required.filter((r) => r.itemStatus === "PENDING").length;
      return {
        key: name,
        name,
        total: list.length,
        required: required.length,
        pendingRequired,
        verified: list.filter((r) => r.itemStatus === "VERIFIED").length,
        missing: list.filter((r) => r.itemStatus === "MISSING").length,
        mismatch: list.filter((r) => r.itemStatus === "MISMATCH").length,
        pending: list.filter((r) => r.itemStatus === "PENDING").length,
        complete: pendingRequired === 0,
        items: list,
      };
    })
    // Unfinished groups first — that's what the auditor needs next.
    .sort((a, b) => Number(a.complete) - Number(b.complete) || a.name.localeCompare(b.name));

  const requiredRows = rows.filter((r) => r.isRequired);
  const blocking = requiredRows.filter((r) => r.itemStatus === "PENDING");

  return {
    auditId: audit.id,
    auditName: audit.auditName,
    status: audit.status,
    groupBy,
    groups,
    facets,
    totals: {
      all: rows.length,
      shown: filtered.length,
      required: requiredRows.length,
      optional: rows.length - requiredRows.length,
      verified: rows.filter((r) => r.itemStatus === "VERIFIED").length,
      missing: rows.filter((r) => r.itemStatus === "MISSING").length,
      mismatch: rows.filter((r) => r.itemStatus === "MISMATCH").length,
      pending: rows.filter((r) => r.itemStatus === "PENDING").length,
      blockingCompletion: blocking.length,
      stickerPresent: rows.filter((r) => r.stickerStatus === "PRESENT").length,
      stickerMissing: rows.filter((r) => r.stickerStatus === "MISSING").length,
      stickerDamaged: rows.filter((r) => r.stickerStatus === "DAMAGED").length,
      stickerUnchecked: rows.filter((r) => !r.stickerStatus).length,
    },
  };
};

/** Active assets still unaccounted for — these block completion, for anyone. */
export const pendingRequiredItems = (auditId: number) =>
  prisma.assetAuditItem.findMany({
    where: { auditId, status: "PENDING", isRequired: true },
    include: { asset: { select: { assetId: true, assetName: true } } },
    orderBy: { id: "asc" },
  });

/**
 * Records the QR sticker observation on the audit item and pushes it onto the
 * asset, so the stickering programme is driven by what was seen on the floor.
 * A successful scan counts as PRESENT without asking.
 */
export const STICKER_STATES = ["PRESENT", "MISSING", "DAMAGED", "NOT_APPLICABLE"];

export const resolveSticker = (stickerStatus: any, scanned: any): string | null => {
  const reported = String(stickerStatus ?? "").toUpperCase();
  if (scanned === true) return "PRESENT";
  return STICKER_STATES.includes(reported) ? reported : null;
};

export const applyStickerToAsset = async (
  sticker: string | null,
  assetId: number,
  auditId: number,
  byEmployeeId: number | null
) => {
  if (!sticker || sticker === "NOT_APPLICABLE") return;
  const present = sticker === "PRESENT";
  await prisma.asset.update({
    where: { id: assetId },
    data: {
      qrStickered: present,
      ...(present ? { qrStickeredAt: new Date(), qrStickeredById: byEmployeeId } : {}),
      qrStickeredRemarks: present ? null : `Reported ${sticker.toLowerCase()} during audit #${auditId}`,
    },
  });
};

/**
 * Records a location note captured during the audit onto the asset's active
 * location row. Only fills a blank — an auditor correcting a note they can see
 * is fine, but silently overwriting a curated one from a phone is not.
 */
export const applyLocationNote = async (note: any, assetId: number): Promise<boolean> => {
  const text = String(note ?? "").trim();
  if (!text) return false;
  const loc = await prisma.assetLocation.findFirst({
    where: { assetId, isActive: true },
    orderBy: { id: "desc" },
    select: { id: true, placementLabel: true },
  });
  if (!loc || (loc.placementLabel ?? "").trim()) return false;
  await prisma.assetLocation.update({
    where: { id: loc.id },
    data: { placementLabel: text.slice(0, 500) },
  });
  return true;
};

/**
 * Location readiness for a prospective audit scope.
 *
 * Guidance quality is decided entirely by AssetLocation, so this answers the
 * only question worth asking before audit day: how much of this scope can the
 * assistant actually direct someone to? Run against the same filters the audit
 * will use, so the numbers are the real ones.
 */
export const buildLocationReadiness = async (scope: {
  branchId?: number | null;
  departmentId?: number | null;
  floor?: string | null;
  block?: string | null;
  room?: string | null;
}) => {
  const where: any = { isActive: true, status: "APPROVED" };
  if (scope.branchId) where.branchId = Number(scope.branchId);
  if (scope.floor) where.floor = scope.floor;
  if (scope.block) where.block = scope.block;
  if (scope.room) where.room = scope.room;
  if (scope.departmentId) where.asset = { departmentId: Number(scope.departmentId) };

  const locs = await prisma.assetLocation.findMany({
    where,
    select: {
      assetId: true, floor: true, block: true, room: true,
      placementLabel: true, placementType: true, placementProfile: true,
      planX: true, floorPlanId: true,
    },
    distinct: ["assetId"],
  });

  const total = locs.length;
  const has = (f: (l: (typeof locs)[number]) => boolean) => locs.filter(f).length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const withFloor = has((l) => !!l.floor?.trim());
  const withRoom = has((l) => !!l.room?.trim());
  const withNote = has((l) => !!l.placementLabel?.trim());
  const withPlacement = has((l) => !!(l.placementType?.trim() || l.placementProfile?.trim()));
  const pinned = has((l) => l.planX != null && l.floorPlanId != null);

  // Ordered worst-first: the top item is the one to fix before audit day.
  const gaps = [
    {
      field: "Placement Label",
      missing: total - withNote,
      impact: "The assistant has no directions to speak — the auditor searches blind.",
    },
    { field: "Floor", missing: total - withFloor, impact: "Asset won't appear under any floor when starting the audit." },
    { field: "Room", missing: total - withRoom, impact: "No room ordering; these are walked last." },
    { field: "Placement Type", missing: total - withPlacement, impact: "Rooms vs outdoor split falls back to a default." },
  ].filter((g) => g.missing > 0).sort((a, b) => b.missing - a.missing);

  return {
    total,
    withFloor, withRoom, withNote, withPlacement, pinned,
    percent: {
      floor: pct(withFloor), room: pct(withRoom), note: pct(withNote),
      placement: pct(withPlacement), pinned: pct(pinned),
    },
    // A single headline: how many can be given real directions.
    guidable: withNote,
    guidablePercent: pct(withNote),
    gaps,
    verdict:
      total === 0 ? "NO_ASSETS"
        : pct(withNote) >= 80 ? "GOOD"
        : pct(withNote) >= 50 ? "PARTIAL"
        : "POOR",
  };
};

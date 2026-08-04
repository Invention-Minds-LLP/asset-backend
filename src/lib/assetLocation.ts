import { Prisma, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Keep Asset.currentBranchId (denormalized cache) in sync with the asset's
 * ACTIVE AssetLocation row — the source of truth for the asset's branch.
 *
 * MUST be called inside the SAME transaction that flips the active location
 * (deactivate old / create new). Pass null when the asset no longer has an
 * active location (e.g. external DEAD transfer). Never set currentBranchId
 * anywhere else.
 */
export async function syncCurrentBranch(
  db: Db,
  assetId: number,
  branchId: number | null
): Promise<void> {
  await db.asset.update({
    where: { id: assetId },
    data: { currentBranchId: branchId },
  });
}

/** Case/whitespace-insensitive compare for the free-text placement fields. */
const samePlace = (a?: string | null, b?: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export type PinFields = {
  floorPlanId: number | null;
  planX: number | null;
  planY: number | null;
};

/**
 * The floor-plan pin to put on a REPLACEMENT AssetLocation row.
 *
 * Every location change writes a brand-new active row, so anything not copied
 * across is silently lost — and the pin was being lost on every edit, which
 * emptied the floor map, the zone stats and audit guidance over time.
 *
 * A pin is a coordinate on one specific plan, so it only stays true while the
 * asset is in the same place. Carried forward when branch/block/floor/room are
 * all unchanged (i.e. the edit was to placement detail — mount type, coverage
 * area, responsible person); cleared when the asset actually moved, because a
 * stale pin shows it on the map in a room it has left, which is worse than
 * showing it as unpinned.
 */
export function carryFloorPlanPin(
  prev:
    | {
        branchId?: number | null;
        block?: string | null;
        floor?: string | null;
        room?: string | null;
        floorPlanId?: number | null;
        planX?: number | null;
        planY?: number | null;
      }
    | null
    | undefined,
  next: {
    branchId?: number | null;
    block?: string | null;
    floor?: string | null;
    room?: string | null;
  }
): PinFields {
  const NO_PIN: PinFields = { floorPlanId: null, planX: null, planY: null };
  if (!prev || prev.floorPlanId == null || prev.planX == null || prev.planY == null) {
    return NO_PIN;
  }

  const stillSamePlace =
    Number(prev.branchId ?? 0) === Number(next.branchId ?? 0) &&
    samePlace(prev.block, next.block) &&
    samePlace(prev.floor, next.floor) &&
    samePlace(prev.room, next.room);

  return stillSamePlace
    ? { floorPlanId: prev.floorPlanId, planX: Number(prev.planX), planY: Number(prev.planY) }
    : NO_PIN;
}

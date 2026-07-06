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

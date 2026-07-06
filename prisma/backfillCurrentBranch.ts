/**
 * One-off backfill: set Asset.currentBranchId from each asset's ACTIVE
 * AssetLocation row (the source of truth for the asset's current branch).
 * Assets with no active location are left NULL (in store / in transit).
 *
 * Idempotent — safe to re-run; only updates rows whose cached value differs.
 *
 * Run: npx ts-node --transpile-only prisma/backfillCurrentBranch.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  // Latest active location per asset (createdAt desc breaks ties if the
  // one-active-row invariant was ever violated).
  const activeLocations = await prisma.assetLocation.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: { assetId: true, branchId: true },
  });

  const branchByAsset = new Map<number, number>();
  for (const loc of activeLocations) {
    if (!branchByAsset.has(loc.assetId)) branchByAsset.set(loc.assetId, loc.branchId);
  }

  const duplicates = activeLocations.length - branchByAsset.size;
  if (duplicates > 0) {
    console.warn(`WARNING: ${duplicates} extra active AssetLocation rows found (multiple active per asset). Using the most recent per asset.`);
  }

  let updated = 0;
  let cleared = 0;

  for (const [assetId, branchId] of branchByAsset) {
    // NOTE: `NOT: { currentBranchId: branchId }` would skip NULL rows (SQL null
    // comparison), so match "different OR null" explicitly.
    const res = await prisma.asset.updateMany({
      where: {
        id: assetId,
        OR: [{ currentBranchId: null }, { currentBranchId: { not: branchId } }],
      },
      data: { currentBranchId: branchId },
    });
    updated += res.count;
  }

  // Clear stale pointers on assets that no longer have any active location.
  const stale = await prisma.asset.updateMany({
    where: {
      currentBranchId: { not: null },
      id: { notIn: Array.from(branchByAsset.keys()) },
    },
    data: { currentBranchId: null },
  });
  cleared = stale.count;

  console.log(`Assets with an active location: ${branchByAsset.size}`);
  console.log(`currentBranchId set/updated:    ${updated}`);
  console.log(`stale pointers cleared:         ${cleared}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Demo seed: distribute assets that have NO active location across the real
 * branches (Main Hospital / Invention Minds / Sankalp) so branch-wise filters
 * in listings, reports and dashboards have data to show.
 *
 * - Creates a proper ACTIVE AssetLocation row per asset (same as the app's
 *   Location tab) and sets Asset.currentBranchId in the same transaction.
 * - Weighted spread: Main Hospital gets the bulk, the rest split the remainder.
 * - Sub-assets follow their parent's branch.
 * - Idempotent: assets that already have an active location are skipped.
 *
 * Run: npx ts-node --transpile-only prisma/seedBranchLocations.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

// Branch name → share of assets (must exist in the branch table; [SEED] Test
// Hospital is intentionally left out — it keeps its existing 9 assets).
const BRANCH_WEIGHTS: Array<{ name: string; weight: number }> = [
  { name: "Main Hospital", weight: 6 },
  { name: "Invention Minds", weight: 2 },
  { name: "Sankalp", weight: 2 },
];

const BLOCKS = ["A", "B", "C"];
const FLOORS = ["Ground", "1st Floor", "2nd Floor", "3rd Floor"];

async function main() {
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchByName = new Map(branches.map((b) => [b.name, b.id]));

  const plan: number[] = []; // branchId repeated by weight → round-robin pool
  for (const w of BRANCH_WEIGHTS) {
    const id = branchByName.get(w.name);
    if (!id) {
      console.error(`Branch "${w.name}" not found — aborting.`);
      process.exit(1);
    }
    for (let i = 0; i < w.weight; i++) plan.push(id);
  }

  // Assets with no active location
  const unassigned = await prisma.asset.findMany({
    where: { locations: { none: { isActive: true } } },
    select: {
      id: true,
      assetId: true,
      parentAssetId: true,
      department: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  if (unassigned.length === 0) {
    console.log("Nothing to do — every asset already has an active location.");
    return;
  }

  // Parents/standalone first so sub-assets can follow their parent's branch.
  const parentsFirst = [
    ...unassigned.filter((a) => a.parentAssetId == null),
    ...unassigned.filter((a) => a.parentAssetId != null),
  ];

  const branchOfAsset = new Map<number, number>(); // assetId → branchId (this run)
  let cursor = 0;
  let created = 0;

  for (const asset of parentsFirst) {
    let branchId: number | undefined;

    if (asset.parentAssetId != null) {
      // Follow the parent's branch — from this run, or from the DB cache.
      branchId = branchOfAsset.get(asset.parentAssetId);
      if (!branchId) {
        const parent = await prisma.asset.findUnique({
          where: { id: asset.parentAssetId },
          select: { currentBranchId: true },
        });
        branchId = parent?.currentBranchId ?? undefined;
      }
    }
    if (!branchId) {
      branchId = plan[cursor % plan.length];
      cursor++;
    }

    // Deterministic pseudo-placement from the asset id — stable across re-runs.
    const block = BLOCKS[asset.id % BLOCKS.length];
    const floor = FLOORS[asset.id % FLOORS.length];
    const room = `R-${100 + (asset.id % 40)}`;

    await prisma.$transaction(async (tx) => {
      await tx.assetLocation.create({
        data: {
          assetId: asset.id,
          branchId: branchId!,
          block,
          floor,
          room,
          departmentSnapshot: asset.department?.name ?? null,
          status: "APPROVED",
          isActive: true,
        },
      });
      await tx.asset.update({
        where: { id: asset.id },
        data: { currentBranchId: branchId },
      });
    }, {
      // Remote MySQL on a slower network — same bump as transfer.controller.ts
      maxWait: 10_000,
      timeout: 20_000,
    });

    branchOfAsset.set(asset.id, branchId);
    created++;
    if (created % 50 === 0) console.log(`...${created}/${parentsFirst.length}`);
  }

  console.log(`Assigned ${created} assets.`);

  const groups = await prisma.asset.groupBy({ by: ["currentBranchId"], _count: { id: true } });
  const nameById = new Map(branches.map((b) => [b.id, b.name]));
  console.log("\nBranch-wise asset counts:");
  for (const g of groups) {
    const label = g.currentBranchId == null ? "(no branch)" : nameById.get(g.currentBranchId);
    console.log(`  ${label}: ${g._count.id}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

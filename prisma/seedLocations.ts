/**
 * One-off seed: give a subset of EXISTING active+APPROVED AssetLocation rows
 * real floor/block/room values (updated in place, so they stay active+approved
 * and immediately usable for audit floor/block scoping). Does NOT create new
 * rows — avoids the REQUESTED-status pitfall.
 *
 * Run: npx ts-node --transpile-only prisma/seedLocations.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

// How many assets to seed, and which branch to seed them in.
const SEED_COUNT = 60;
const BRANCH_ID = 1; // JBVM

const BLOCKS = ["A Block", "B Block"];
const FLOORS = ["Ground Floor", "First Floor", "Second Floor"];
const ROOMS = [
  "Reception",
  "ICU",
  "Ward 1",
  "Ward 2",
  "Laboratory",
  "Pharmacy",
  "Operation Theatre",
  "Store Room",
];

async function main() {
  // Only touch rows that are currently branch-only (no floor yet), so re-runs
  // don't clobber anything already placed.
  const rows = await prisma.assetLocation.findMany({
    where: { isActive: true, status: "APPROVED", branchId: BRANCH_ID, floor: null },
    select: { id: true, assetId: true },
    orderBy: { id: "asc" },
    take: SEED_COUNT,
  });

  if (!rows.length) {
    console.log("No branch-only active+approved locations left to seed. Nothing to do.");
    return;
  }

  let updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const block = BLOCKS[i % BLOCKS.length];
    const floor = FLOORS[Math.floor(i / BLOCKS.length) % FLOORS.length];
    const room = ROOMS[i % ROOMS.length];

    await prisma.assetLocation.update({
      where: { id: rows[i].id },
      data: { block, floor, room },
    });
    updated++;
  }

  // Show the resulting spread.
  const seeded = await prisma.assetLocation.findMany({
    where: { isActive: true, status: "APPROVED", branchId: BRANCH_ID, NOT: { floor: null } },
    select: { floor: true, block: true },
  });
  const spread = new Map<string, number>();
  for (const s of seeded) {
    const k = `${s.block} / ${s.floor}`;
    spread.set(k, (spread.get(k) ?? 0) + 1);
  }

  console.log(`Seeded floor/block/room on ${updated} location rows (branch ${BRANCH_ID}).`);
  console.log("Distribution (block / floor → count):");
  for (const [k, n] of [...spread.entries()].sort()) console.log(`  ${k}: ${n}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());

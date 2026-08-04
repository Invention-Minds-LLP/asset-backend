/**
 * Pins the ALREADY-seeded JBVM location rows (see seedLocations.ts) onto a
 * generated floor-plan image, so the Asset Audit floor map shows them.
 *
 * For each floor in branch JBVM it:
 *   • writes an SVG plan (two block zones) under /uploads/floor-plans
 *   • upserts a FloorPlan row for that branch+floor
 *   • sets floorPlanId + planX/planY on that floor's active+APPROVED locations,
 *     placing A-Block pins on the left, B-Block pins on the right
 *
 * Only touches rows that already have a floor (i.e. the seeded ones) and are
 * not yet pinned. Idempotent — safe to re-run.
 *
 * Run: npx ts-node --transpile-only prisma/seedFloorPins.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

const BRANCH_ID = 1; // JBVM
const FLOORS = ["Ground Floor", "First Floor", "Second Floor"];
const W = 1000;
const H = 700;

function buildSvg(floor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" stroke="#334155" stroke-width="4"/>
  <text x="24" y="40" font-family="sans-serif" font-size="24" font-weight="700" fill="#0f172a">JBVM — ${floor}</text>
  <rect x="40" y="70" width="440" height="600" rx="10" fill="#ecfdf5" stroke="#94a3b8" stroke-width="2"/>
  <text x="60" y="104" font-family="sans-serif" font-size="22" font-weight="700" fill="#475569">A Block</text>
  <rect x="520" y="70" width="440" height="600" rx="10" fill="#eff6ff" stroke="#94a3b8" stroke-width="2"/>
  <text x="540" y="104" font-family="sans-serif" font-size="22" font-weight="700" fill="#475569">B Block</text>
</svg>`;
}

// Spread N pins into a 2-column grid inside a block's X band.
function placePins(count: number, xCols: [number, number]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const rows = Math.max(1, Math.ceil(count / 2));
  for (let i = 0; i < count; i++) {
    const col = i % 2;
    const rowIdx = Math.floor(i / 2);
    const y = rows === 1 ? 50 : 22 + (rowIdx / (rows - 1)) * 64; // 22%..86%
    out.push({ x: xCols[col], y: +y.toFixed(2) });
  }
  return out;
}

async function main() {
  const dir = path.join(process.cwd(), "uploads", "floor-plans");
  fs.mkdirSync(dir, { recursive: true });

  let totalPinned = 0;

  for (const floor of FLOORS) {
    // 1. Image + FloorPlan row (upsert by name).
    const filename = `jbvm-${floor.toLowerCase().replace(/\s+/g, "-")}.svg`;
    fs.writeFileSync(path.join(dir, filename), buildSvg(floor), "utf8");
    const imageUrl = `/uploads/floor-plans/${filename}`;
    const planName = `JBVM ${floor} Plan`;

    let plan = await prisma.floorPlan.findFirst({ where: { name: planName } });
    if (!plan) {
      plan = await prisma.floorPlan.create({
        data: { name: planName, branchId: BRANCH_ID, floor, imageUrl, width: W, height: H },
      });
    } else {
      plan = await prisma.floorPlan.update({
        where: { id: plan.id },
        data: { imageUrl, width: W, height: H, isActive: true },
      });
    }

    // 2. This floor's seeded active+approved locations, split by block.
    const locs = await prisma.assetLocation.findMany({
      where: { isActive: true, status: "APPROVED", branchId: BRANCH_ID, floor },
      select: { id: true, block: true },
      orderBy: { id: "asc" },
    });
    if (!locs.length) {
      console.log(`(${floor}) no seeded locations — skipped.`);
      continue;
    }

    const aBlock = locs.filter((l) => (l.block || "").toUpperCase().startsWith("A"));
    const bBlock = locs.filter((l) => !(l.block || "").toUpperCase().startsWith("A"));

    const aPins = placePins(aBlock.length, [16, 34]); // left band
    const bPins = placePins(bBlock.length, [66, 84]); // right band

    for (let i = 0; i < aBlock.length; i++) {
      await prisma.assetLocation.update({
        where: { id: aBlock[i].id },
        data: { floorPlanId: plan.id, planX: aPins[i].x, planY: aPins[i].y },
      });
      totalPinned++;
    }
    for (let i = 0; i < bBlock.length; i++) {
      await prisma.assetLocation.update({
        where: { id: bBlock[i].id },
        data: { floorPlanId: plan.id, planX: bPins[i].x, planY: bPins[i].y },
      });
      totalPinned++;
    }

    console.log(`(${floor}) plan#${plan.id} — pinned ${aBlock.length} A-Block + ${bBlock.length} B-Block.`);
  }

  console.log(`\nDone. Total pins set: ${totalPinned}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

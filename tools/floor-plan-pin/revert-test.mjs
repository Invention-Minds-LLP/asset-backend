// Undoes everything make-test-pins.mjs + push-pins.mjs did during the test:
//   • clears floorPlanId / planX / planY on the borrowed location rows
//   • clears the block/floor that were stamped on them
//   • soft-deletes the FloorPlan rows created for the test
//
// Only touches the exact location ids recorded in out/test-plan.json, so it can
// never reach the real data or the seeded JBVM demo pins.
//
// Usage:
//   node revert-test.mjs            # dry run
//   node revert-test.mjs --commit

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, "..", "..");
const require = createRequire(path.join(BACKEND, "package.json"));
const { PrismaClient } = require("@prisma/client");
require("dotenv").config({ path: path.join(BACKEND, ".env") });

const COMMIT = process.argv.includes("--commit");
const prisma = new PrismaClient();

async function main() {
  const f = path.join(HERE, "out", "test-plan.json");
  if (!fs.existsSync(f)) {
    console.error("out/test-plan.json missing — nothing recorded to revert.");
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(f, "utf8"));
  const ids = plan.floors.flatMap((x) => x.locationIds);
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${ids.length} location rows, branch ${plan.branch}`);

  const testPlans = await prisma.floorPlan.findMany({
    where: { branchId: plan.branchId, name: { startsWith: "TEST " } },
    select: { id: true, name: true },
  });
  console.log(`  test FloorPlan rows to deactivate: ${testPlans.map((p) => `#${p.id} ${p.name}`).join(", ") || "none"}`);

  const zoneCount = testPlans.length
    ? await prisma.floorPlanZone.count({ where: { floorPlanId: { in: testPlans.map((p) => p.id) } } })
    : 0;
  console.log(`  traced zones on those plans to delete: ${zoneCount}`);

  if (!COMMIT) {
    console.log(`\nRe-run with --commit to apply.`);
    await prisma.$disconnect();
    return;
  }

  const cleared = await prisma.assetLocation.updateMany({
    where: { id: { in: ids } },
    data: { floorPlanId: null, planX: null, planY: null, block: null, floor: null },
  });
  console.log(`  cleared ${cleared.count} location rows`);

  if (testPlans.length) {
    const ids = testPlans.map((p) => p.id);
    // Zones are only cascade-deleted on a hard plan delete; the plans are soft
    // deleted here, so remove them explicitly.
    const z = await prisma.floorPlanZone.deleteMany({ where: { floorPlanId: { in: ids } } });
    console.log(`  deleted ${z.count} zones`);
    const d = await prisma.floorPlan.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    console.log(`  deactivated ${d.count} FloorPlan rows`);
  }
  console.log(`\nReverted.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});

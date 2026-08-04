// TEST HARNESS — traces a few rooms automatically so the zone features have
// something real to work with, and verifies the point-in-polygon counting the
// API does.
//
// Builds a rectangle around each named label from extract-labels.mjs, which is a
// crude stand-in for hand-tracing: good enough to prove filtering, zoom-to-room
// and the heatmap. Real zones should be traced properly in the UI.
//
// Usage:
//   node seed-test-zones.mjs                 # dry run
//   node seed-test-zones.mjs --commit
//   node seed-test-zones.mjs --commit --plan=4 --sheet=1-jmr…lower-ground…

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, "..", "..");
const require = createRequire(path.join(BACKEND, "package.json"));
const { PrismaClient } = require("@prisma/client");
require("dotenv").config({ path: path.join(BACKEND, ".env") });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const COMMIT = args.commit === "true";

// Rooms to outline, per test plan. Each entry finds the label on the sheet and
// boxes it: [half-width %, half-height %].
const TARGETS = {
  BASEMENT: {
    sheet: "1-jmr-as-built-arch-dwg-28mar2023-lower-ground-floor-plan-1",
    rooms: [
      { match: /^MEDICAL RECORDS/i, name: "Medical Records", roomNumber: "1521", department: "MRD", kind: "ROOM", w: 4.5, h: 6 },
      { match: /HEMATOLOGY LAB/i, name: "Medical Laboratory", roomNumber: "1547", department: "Medical Laboratory", kind: "ROOM", w: 5, h: 4 },
      { match: /^CT SCAN/i, name: "CT Scan", department: "RADIOLOGY", kind: "ROOM", w: 5, h: 3.5 },
      { match: /^MAIN STORE/i, name: "Main Store", roomNumber: "1525", department: "Stores", kind: "UTILITY", w: 5.5, h: 3.5 },
      { match: /DIETARY KITCHEN/i, name: "Dietary Kitchen", roomNumber: "1529", department: "Dietician", kind: "UTILITY", w: 5, h: 4.5 },
      { match: /^PHYSIOTHERAPY/i, name: "Physiotherapy", roomNumber: "1039", department: "Physiotheraphy", kind: "ROOM", w: 5, h: 3.5 },
      { match: /^CSSD/i, name: "CSSD", department: "CSSD", kind: "UTILITY", w: 5, h: 6 },
    ],
  },
  "FIRST FLOOR": {
    sheet: "3-jmr-as-built-arch-dwg-28mar2023-first-floor-plan-1",
    rooms: [
      { match: /^MICU - 11 BEDS/i, name: "MICU", roomNumber: "1140", department: "MICU", kind: "WARD", w: 6, h: 4.5 },
      { match: /^ICU WARD/i, name: "ICU Ward", department: "Nursing", kind: "WARD", w: 5, h: 3.5 },
      { match: /^LABOUR ROOM-1/i, name: "Labour Room 1", department: "Nursing OBG", kind: "OT", w: 5, h: 3.5 },
      { match: /^OT COMPLEX/i, name: "OT Complex", department: "OT", kind: "OT", w: 6, h: 5 },
      { match: /^SERVER ROOM/i, name: "Server Room", department: "Information Techonology", kind: "UTILITY", w: 4, h: 3 },
    ],
  },
  "SECOND FLOOR": {
    sheet: "wd-2nd-floor-05sept2023-1",
    rooms: [
      { match: /^NURSING DIRECTOR/i, name: "Nursing Director", department: "DNS", kind: "ROOM", w: 4, h: 3 },
      { match: /^IPD BILLING/i, name: "IPD Billing", department: "Billing", kind: "ROOM", w: 4, h: 3 },
      { match: /^HOUSE KEEPING/i, name: "House Keeping", department: "House Keeping", kind: "UTILITY", w: 4.5, h: 3.5 },
      { match: /^CHEMOTHERAPY ROOM/i, name: "Chemotherapy", kind: "WARD", w: 5, h: 4 },
    ],
  },
};

// point-in-polygon, same algorithm as src/utilis/geometry.ts
const inside = (x, y, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const clamp = (v) => Math.min(100, Math.max(0, +v.toFixed(2)));
const boxAround = (cx, cy, w, h) => [
  [clamp(cx - w), clamp(cy - h)],
  [clamp(cx + w), clamp(cy - h)],
  [clamp(cx + w), clamp(cy + h)],
  [clamp(cx - w), clamp(cy + h)],
];

const prisma = new PrismaClient();

async function main() {
  const plans = await prisma.floorPlan.findMany({
    where: { isActive: true, name: { startsWith: "TEST " } },
    select: { id: true, name: true, floor: true },
  });
  if (!plans.length) {
    console.error('No "TEST …" floor plans found — run apply-test-direct.mjs first.');
    process.exit(1);
  }
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${plans.length} test plan(s)\n`);

  for (const plan of plans) {
    const spec = TARGETS[plan.floor];
    if (!spec) { console.log(`· ${plan.floor}: no room list defined, skipping`); continue; }

    const labelsFile = path.join(HERE, "out", `labels-${spec.sheet}.json`);
    if (!fs.existsSync(labelsFile)) { console.log(`✗ ${plan.floor}: ${path.basename(labelsFile)} missing`); continue; }
    const labels = JSON.parse(fs.readFileSync(labelsFile, "utf8")).labels.filter((l) => !l.noise);

    const pins = await prisma.assetLocation.findMany({
      where: { floorPlanId: plan.id, isActive: true, planX: { not: null } },
      select: { planX: true, planY: true },
    });

    console.log(`▸ #${plan.id} ${plan.floor}  (${pins.length} pins)`);
    let made = 0, covered = 0;
    for (const room of spec.rooms) {
      const hit = labels.find((l) => room.match.test(l.text));
      if (!hit) { console.log(`    ✗ ${room.name}: no matching label on the sheet`); continue; }
      const poly = boxAround(hit.planX, hit.planY, room.w, room.h);
      const n = pins.filter((p) => inside(Number(p.planX), Number(p.planY), poly)).length;
      covered += n;
      console.log(`    ${room.name.padEnd(22)} @ ${hit.planX.toFixed(1)},${hit.planY.toFixed(1)}  →  ${n} asset(s)`);

      if (!COMMIT) continue;
      const existing = await prisma.floorPlanZone.findFirst({
        where: { floorPlanId: plan.id, name: room.name },
      });
      const data = {
        floorPlanId: plan.id,
        name: room.name,
        roomNumber: room.roomNumber || null,
        department: room.department || null,
        kind: room.kind,
        polygon: poly,
      };
      if (existing) await prisma.floorPlanZone.update({ where: { id: existing.id }, data });
      else await prisma.floorPlanZone.create({ data });
      made++;
    }
    console.log(`    ── ${covered}/${pins.length} pins land inside a traced room${COMMIT ? `, ${made} zone(s) saved` : ""}\n`);
  }

  if (!COMMIT) console.log("Re-run with --commit to write the zones.");
  else console.log("Done. revert-test.mjs --commit removes these along with the test plans.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });

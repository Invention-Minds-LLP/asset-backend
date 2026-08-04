// TEST HARNESS — not part of the normal pipeline.
//
// The real JMRH asset codes don't exist in the dev database, so there is nothing
// to pin. This borrows real assets from the connected DB and rewrites out/pins.csv
// onto them, keeping the planX/planY that the real matching produced. That lets you
// watch the whole import -> upload -> pin path work end to end before the real data
// lands.
//
// Read-only by default: it only writes out/pins-test.csv + out/test-plan.json.
// Use --apply-locations to stamp block/floor onto the borrowed rows (needed before
// push-pins can see them), and revert-test.mjs to undo everything afterwards.
//
// Usage:
//   node make-test-pins.mjs --branch=JBVM
//   node make-test-pins.mjs --branch=JBVM --apply-locations

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "out");
const BACKEND = path.join(HERE, "..", "..");

// Prisma + dotenv live in the backend, not in this tool's node_modules.
const require = createRequire(path.join(BACKEND, "package.json"));
const { PrismaClient } = require("@prisma/client");
require("dotenv").config({ path: path.join(BACKEND, ".env") });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const BRANCH = String(args.branch || "JBVM");
const APPLY = args["apply-locations"] === "true";

// ── csv helpers ──────────────────────────────────────────────────────────────
function readCsv(file) {
  const t = fs.readFileSync(file, "utf8");
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift();
  return { header: h, rows: rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))) };
}
const writeCsv = (header, rows) => {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n");
};

const prisma = new PrismaClient();

async function main() {
  const src = path.join(OUT_DIR, "pins.csv");
  if (!fs.existsSync(src)) {
    console.error("Run match.mjs first — out/pins.csv is missing.");
    process.exit(1);
  }
  const { header, rows: pins } = readCsv(src);
  console.log(`Real pins to mirror: ${pins.length}`);

  const branch = await prisma.branch.findFirst({ where: { name: BRANCH } });
  if (!branch) {
    console.error(`No branch named "${BRANCH}".`);
    process.exit(1);
  }

  // Borrow only rows that are safe to touch: active, at this branch, with NO
  // block/floor set and NOT already pinned — i.e. never part of the seeded
  // floor-pin demo, so nothing existing gets overwritten.
  const candidates = await prisma.assetLocation.findMany({
    where: {
      isActive: true,
      branchId: branch.id,
      floor: null,
      block: null,
      planX: null,
      floorPlanId: null,
    },
    select: { id: true, asset: { select: { assetId: true } } },
    orderBy: { id: "asc" },
  });
  console.log(`Safe-to-borrow locations at ${BRANCH}: ${candidates.length}`);

  const usable = candidates.filter((c) => c.asset?.assetId);
  if (usable.length < pins.length) {
    console.log(`  only ${usable.length} available — the test will cover that many pins`);
  }

  // Keep the real geometry, swap the identity.
  const out = [];
  const floors = new Map(); // planFloor -> [locationId]
  for (let i = 0; i < Math.min(pins.length, usable.length); i++) {
    const p = pins[i];
    const c = usable[i];
    out.push({
      ...p,
      "Asset ID": c.asset.assetId,
      Branch: BRANCH,
      _locationId: c.id,
    });
    if (!floors.has(p.Floor)) floors.set(p.Floor, []);
    floors.get(p.Floor).push(c.id);
  }

  fs.writeFileSync(path.join(OUT_DIR, "pins-test.csv"), writeCsv(header, out));

  const plan = {
    branch: BRANCH,
    branchId: branch.id,
    createdFor: "floor-plan-pin end-to-end test",
    floors: [...floors.entries()].map(([floor, ids]) => ({
      floor,
      pins: ids.length,
      locationIds: ids,
      png: {
        BASEMENT: "1-jmr-as-built-arch-dwg-28mar2023-lower-ground-floor-plan-1.png",
        "FIRST FLOOR": "3-jmr-as-built-arch-dwg-28mar2023-first-floor-plan-1.png",
        "SECOND FLOOR": "wd-2nd-floor-05sept2023-1.png",
      }[floor] || null,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, "test-plan.json"), JSON.stringify(plan, null, 2));

  console.log(`\nwrote out/pins-test.csv (${out.length} rows) and out/test-plan.json`);
  console.log(`\nper floor:`);
  for (const f of plan.floors) console.log(`  ${String(f.pins).padStart(3)}  ${f.floor.padEnd(13)} ${f.png ?? "(no png mapped)"}`);

  if (!APPLY) {
    console.log(`\nNothing written to the database.`);
    console.log(`Next: node make-test-pins.mjs --branch=${BRANCH} --apply-locations`);
    console.log(`      (stamps block/floor on those ${out.length} rows so push-pins can see them)`);
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const f of plan.floors) {
    const r = await prisma.assetLocation.updateMany({
      where: { id: { in: f.locationIds } },
      data: { block: "MAIN BUILDING", floor: f.floor },
    });
    n += r.count;
    console.log(`  stamped ${r.count} rows with MAIN BUILDING / ${f.floor}`);
  }
  console.log(`\n${n} location rows updated. Undo with: node revert-test.mjs`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});

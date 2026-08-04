// TEST HARNESS — writes straight through Prisma, bypassing the HTTP API, so the
// trial needs no running server and no JWT.
//
// Does the two remaining steps of the end-to-end test:
//   1. copies the converted PNGs into uploads/floor-plans/ and upserts one
//      FloorPlan row per floor, named "TEST …" so revert-test.mjs can find them
//   2. sets floorPlanId / planX / planY on each borrowed asset's active location,
//      resolving the asset the same way savePin does (visible Asset ID -> active
//      AssetLocation row)
//
// Dry run by default. Undo with: node revert-test.mjs --commit
//
// Usage:
//   node apply-test-direct.mjs
//   node apply-test-direct.mjs --commit

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, "..", "..");
const PNG_DIR = path.join(HERE, "..", "floor-plan-convert", "output");
const UPLOAD_DIR = path.join(BACKEND, "uploads", "floor-plans");

const require = createRequire(path.join(BACKEND, "package.json"));
const { PrismaClient } = require("@prisma/client");
require("dotenv").config({ path: path.join(BACKEND, ".env") });

const COMMIT = process.argv.includes("--commit");
const prisma = new PrismaClient();

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
  return rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(HERE, "out", "test-plan.json"), "utf8"));
  const pins = readCsv(path.join(HERE, "out", "pins-test.csv"));
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — branch ${plan.branch} (#${plan.branchId}), ${pins.length} pins\n`);

  // ── 1. plan images + FloorPlan rows ────────────────────────────────────────
  const planIdByFloor = {};
  for (const f of plan.floors) {
    if (!f.png) { console.log(`✗ ${f.floor}: no PNG mapped`); continue; }
    const src = path.join(PNG_DIR, f.png);
    if (!fs.existsSync(src)) { console.log(`✗ ${f.floor}: ${f.png} not found`); continue; }

    const destName = `TEST-${f.floor.toLowerCase().replace(/\s+/g, "-")}-${f.png}`;
    const name = `TEST ${f.floor} (JMRH drawing)`;
    console.log(`▸ ${f.floor}`);
    console.log(`    image  uploads/floor-plans/${destName}`);
    console.log(`    plan   "${name}"  floor="${f.floor}"  1786x1754  ${f.pins} pins`);

    if (!COMMIT) continue;

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.copyFileSync(src, path.join(UPLOAD_DIR, destName));

    const existing = await prisma.floorPlan.findFirst({ where: { name } });
    const data = {
      name,
      branchId: plan.branchId,
      floor: f.floor,
      block: null,
      imageUrl: `/uploads/floor-plans/${destName}`,
      width: 1786,
      height: 1754,
      isActive: true,
    };
    const row = existing
      ? await prisma.floorPlan.update({ where: { id: existing.id }, data })
      : await prisma.floorPlan.create({ data });
    planIdByFloor[f.floor] = row.id;
    console.log(`    -> FloorPlan #${row.id}`);
  }

  // ── 2. the pins ────────────────────────────────────────────────────────────
  let ok = 0, miss = 0;
  for (const p of pins) {
    const code = p["Asset ID"].trim();
    const asset = await prisma.asset.findFirst({ where: { assetId: code }, select: { id: true } });
    if (!asset) { console.log(`   ✗ ${code}: asset not found`); miss++; continue; }
    const loc = await prisma.assetLocation.findFirst({
      where: { assetId: asset.id, isActive: true },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!loc) { console.log(`   ✗ ${code}: no active location`); miss++; continue; }

    const floorPlanId = planIdByFloor[p.Floor];
    if (COMMIT && !floorPlanId) { console.log(`   ✗ ${code}: no plan for "${p.Floor}"`); miss++; continue; }

    if (COMMIT) {
      await prisma.assetLocation.update({
        where: { id: loc.id },
        data: { floorPlanId, planX: Number(p.planX), planY: Number(p.planY) },
      });
    }
    ok++;
  }

  console.log(`\n${COMMIT ? "pinned" : "would pin"} ${ok}   failed ${miss}`);
  if (!COMMIT) console.log(`Re-run with --commit to write.`);
  else console.log(`Undo everything with: node revert-test.mjs --commit`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});

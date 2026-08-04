// TEST HARNESS — copies the real spreadsheet's Room / Department / Placement
// Label onto the borrowed test location rows.
//
// The guidance assistant reads placementLabel aloud, so without this the test
// says "location details not recorded" for every asset and proves nothing.
// pins-test.csv already pairs each borrowed asset with the real row whose
// coordinates it inherited, so the descriptive text comes along with it.
//
// Usage:
//   node stamp-test-labels.mjs            # dry run
//   node stamp-test-labels.mjs --commit
//
// revert-test.mjs clears these along with everything else.

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

const prisma = new PrismaClient();

async function main() {
  const rows = readCsv(path.join(HERE, "out", "pins-test.csv"));
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${rows.length} rows\n`);

  let ok = 0, miss = 0, blank = 0;
  for (const r of rows) {
    const code = r["Asset ID"].trim();
    const label = (r["Placement Label"] || "").trim();
    const room = (r["Room"] || "").trim();
    const dept = (r["Department"] || "").trim();
    if (!label && !room && !dept) { blank++; continue; }

    const asset = await prisma.asset.findFirst({ where: { assetId: code }, select: { id: true } });
    if (!asset) { miss++; continue; }
    const loc = await prisma.assetLocation.findFirst({
      where: { assetId: asset.id, isActive: true },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!loc) { miss++; continue; }

    if (ok < 6) console.log(`  ${code}  room=${room || "-"}  dept=${dept || "-"}\n      "${label}"`);
    if (COMMIT) {
      await prisma.assetLocation.update({
        where: { id: loc.id },
        data: {
          room: room || null,
          departmentSnapshot: dept || null,
          placementLabel: label || null,
        },
      });
    }
    ok++;
  }

  console.log(`\n${COMMIT ? "stamped" : "would stamp"} ${ok}   no-active-location ${miss}   nothing-to-copy ${blank}`);
  if (!COMMIT) console.log("Re-run with --commit to write.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });

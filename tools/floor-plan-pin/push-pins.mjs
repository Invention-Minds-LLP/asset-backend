// Step 3 of the auto-pin pipeline — the only step that writes anything.
//
// Reads out/pins.csv and calls the existing API:
//   GET  /api/floor-plan                  -> resolve plan id from branch + floor
//   GET  /api/floor-plan/:id/pinnable     -> map visible Asset ID -> numeric asset id
//   POST /api/floor-plan/:id/pin          -> { assetId, planX, planY }
//
// It goes through the API on purpose: savePin updates the asset's ACTIVE
// AssetLocation row and refuses assets that have no location yet, so the
// location import must have run first.
//
// Usage:
//   node push-pins.mjs                       # dry run — prints what it would do
//   node push-pins.mjs --commit              # actually writes
//   node push-pins.mjs --commit --token=<JWT> --api=http://localhost:3001
//   node push-pins.mjs --commit --confidence=high,medium
//
// Token may also come from the FLOOR_PIN_TOKEN environment variable.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "out");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);

const API = String(args.api || process.env.FLOOR_PIN_API || "http://localhost:3001").replace(/\/$/, "");
const TOKEN = String(args.token || process.env.FLOOR_PIN_TOKEN || "");
const COMMIT = args.commit === "true";
const CONF = args.confidence ? String(args.confidence).split(",").map((s) => s.trim()) : null;

if (COMMIT && !TOKEN) {
  console.error("--commit needs a JWT: --token=<jwt> or FLOOR_PIN_TOKEN=<jwt>");
  process.exit(1);
}

// ── tiny CSV reader (matches what match.mjs writes: every field quoted) ──────
function readCsv(file) {
  const text = fs.readFileSync(file, "utf8");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${pathname} -> ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  const pinsFile = args.pins ? path.resolve(HERE, args.pins) : path.join(OUT_DIR, "pins.csv");
  if (!fs.existsSync(pinsFile)) {
    console.error(`Missing ${pinsFile} — run match.mjs first.`);
    process.exit(1);
  }
  let pins = readCsv(pinsFile);
  if (CONF) pins = pins.filter((p) => CONF.includes(p.confidence));
  if (!pins.length) { console.log("Nothing to push."); return; }

  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${API} — ${pins.length} pin(s)\n`);

  const plans = await api("/api/floor-plan");
  const eq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  // The plan may have been uploaded with either naming convention: the tidy
  // label ("Lower Ground") or the spreadsheet's own value ("BASEMENT"). Accept
  // both, otherwise every pin silently skips.
  const findPlan = (branch, planFloor, rawFloor) => {
    const mine = plans.filter((p) => eq(p.branch?.name, branch));
    return (
      mine.find((p) => eq(p.floor, planFloor)) ||
      mine.find((p) => eq(p.floor, rawFloor)) ||
      null
    );
  };

  const groups = new Map();
  for (const p of pins) {
    const key = `${p.Branch}||${p.planFloor}||${p.Floor}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let ok = 0, skipped = 0, failed = 0;
  for (const [key, items] of groups) {
    const [branch, floor, rawFloor] = key.split("||");
    const plan = findPlan(branch, floor, rawFloor);
    if (!plan) {
      console.log(
        `✗ ${branch} / ${floor}: no FloorPlan whose floor is "${floor}" or "${rawFloor}" ` +
          `(${items.length} pins skipped)`
      );
      skipped += items.length;
      continue;
    }

    const pinnable = await api(`/api/floor-plan/${plan.id}/pinnable`);
    const byCode = new Map(pinnable.map((a) => [String(a.assetCode).trim(), a.assetId]));
    console.log(`▸ ${branch} / ${floor} → plan #${plan.id} "${plan.name}" (${pinnable.length} assets located here)`);

    for (const it of items) {
      const code = it["Asset ID"].trim();
      const assetId = byCode.get(code);
      if (!assetId) {
        console.log(`   ✗ ${code}: not located on this plan's branch/floor — import its location first`);
        skipped++;
        continue;
      }
      if (!COMMIT) {
        console.log(`   · ${code} → ${it.planX}%, ${it.planY}%  (${it.anchor})`);
        ok++;
        continue;
      }
      try {
        await api(`/api/floor-plan/${plan.id}/pin`, {
          method: "POST",
          body: JSON.stringify({ assetId, planX: Number(it.planX), planY: Number(it.planY) }),
        });
        console.log(`   ✓ ${code} → ${it.planX}%, ${it.planY}%`);
        ok++;
      } catch (e) {
        console.log(`   ✗ ${code}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\n${COMMIT ? "pinned" : "would pin"} ${ok}   skipped ${skipped}   failed ${failed}`);
  if (!COMMIT) console.log(`Re-run with --commit --token=<JWT> to write.`);
}

main().catch((e) => {
  if (/fetch failed|ECONNREFUSED/i.test(e.message)) {
    console.error(`Cannot reach ${API} — is the backend running (npm run dev)? Override with --api=`);
  } else {
    console.error(e.message);
  }
  process.exit(1);
});

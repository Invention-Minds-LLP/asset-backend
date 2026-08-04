// Step 2 of the auto-pin pipeline.
//
// Takes the location spreadsheet (the SAME file that feeds the existing
// /api/import/locations importer) + the anchors from extract-labels.mjs +
// aliases.json, and works out a planX/planY for every asset it can.
//
// Writes nothing to the database. Output is a proposal you review first.
//
// Usage:
//   node match.mjs                       # reads ./input/assets.xlsx|.csv
//   node match.mjs --file=../../foo.xlsx
//   node match.mjs --branch="Rashtrotthana Hospital"
//
// Outputs into ./out/ :
//   pins.csv               one row per resolvable asset -> feeds push-pins.mjs
//   unmatched.csv          everything else, with the reason it failed
//   preview-pins-<slug>.html   the proposed pins drawn on the plan

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN_DIR = path.join(HERE, "input");
const OUT_DIR = path.join(HERE, "out");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);

const norm = (v) => String(v ?? "").trim();
const up = (v) => norm(v).toUpperCase();

// ── load config + anchors ────────────────────────────────────────────────────
const aliases = JSON.parse(fs.readFileSync(path.join(HERE, "aliases.json"), "utf8"));

function loadSheets() {
  const byFloor = {};
  for (const [floor, slug] of Object.entries(aliases.sheets)) {
    const f = path.join(OUT_DIR, `labels-${slug}.json`);
    if (!fs.existsSync(f)) {
      console.warn(`  ! no anchors for floor "${floor}" (${path.basename(f)} missing) — run extract-labels.mjs`);
      continue;
    }
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    byFloor[floor] = {
      slug,
      png: j.png,
      labels: j.labels.filter((l) => !l.noise),
    };
  }
  return byFloor;
}

// ── input spreadsheet ────────────────────────────────────────────────────────
function loadRows() {
  let file = args.file ? path.resolve(HERE, args.file) : null;
  if (!file) {
    fs.mkdirSync(IN_DIR, { recursive: true });
    const cand = fs
      .readdirSync(IN_DIR)
      .filter((f) => /\.(xlsx|xls|csv)$/i.test(f))
      .sort();
    if (!cand.length) {
      console.error(
        `No spreadsheet found.\n` +
          `  Put the location import file (the one with "Asset ID / Branch / Block / Floor / Room /\n` +
          `  Department / Placement Label" columns) in:\n    ${IN_DIR}\n` +
          `  or pass --file=<path>.`
      );
      process.exit(1);
    }
    file = path.join(IN_DIR, cand[0]);
  }
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames.includes("Locations") ? "Locations" : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  console.log(`Input: ${path.basename(file)} [${sheetName}] — ${rows.length} rows\n`);
  return rows;
}

// Accept the couple of header spellings that show up in the wild.
const col = (r, ...names) => {
  for (const n of names) {
    const hit = Object.keys(r).find((k) => k.trim().toLowerCase() === n.toLowerCase());
    if (hit && norm(r[hit])) return norm(r[hit]);
  }
  return "";
};

// ── matching ─────────────────────────────────────────────────────────────────
function findLabel(sheet, pattern) {
  if (!sheet) return null;
  let re;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return null;
  }
  return sheet.labels.find((l) => re.test(l.text)) || null;
}

function tryCandidates(candidates, floor, sheets) {
  for (const c of candidates || []) {
    // A candidate can instead declare "there is no drawing for this place" —
    // better an explicit reason than a pin on the wrong building.
    if (c.noPlan) return { noPlan: c.noPlan };
    const targetFloor = c.floor === "*" ? floor : c.floor;
    if (c.floor !== "*" && c.floor !== floor) continue;
    const hit = findLabel(sheets[targetFloor], c.match);
    if (hit) return { floor: targetFloor, label: hit, via: c.match };
  }
  return null;
}

function resolve(row, sheets) {
  const rawFloor = up(col(row, "Floor"));
  const rawBlock = up(col(row, "Block"));
  const room = col(row, "Room");
  const dept = col(row, "Department");
  const placement = col(row, "Placement Label", "Placement Label / Coverage Area");

  const blockRule = aliases.blocks[rawBlock];
  if (blockRule === "NO_PLAN") {
    return { ok: false, reason: `block "${rawBlock}" has no floor plan uploaded` };
  }

  const floor = aliases.floors[rawFloor];
  if (!floor) return { ok: false, reason: `floor "${rawFloor || "(blank)"}" not in aliases.floors` };
  if (!sheets[floor]) return { ok: false, reason: `no anchors extracted for floor "${floor}"` };

  // Every rule that was attempted, so unmatched.csv says what to fix rather
  // than just "no match".
  const tried = [];

  // 1. explicit room number — from the Room column, or dug out of the placement
  //    label ("inside room no 1521").
  const roomNo = room.match(/\d{3,4}/)?.[0] || placement.match(/room\s*(?:no\.?\s*)?(\d{3,4})/i)?.[1];
  if (roomNo) {
    if (!aliases.rooms[roomNo]) tried.push(`room ${roomNo} not in aliases.rooms`);
    else {
      const hit = findLabel(sheets[floor], aliases.rooms[roomNo]);
      if (hit) return { ok: true, floor, label: hit, via: `room ${roomNo}`, confidence: "high" };
      tried.push(`aliases.rooms["${roomNo}"] = /${aliases.rooms[roomNo]}/ hits nothing on ${floor}`);
    }
  }

  // 2. placement-label keywords
  const pl = placement.toLowerCase();
  let kwSeen = false;
  for (const [kw, cands] of Object.entries(aliases.keywords)) {
    if (!pl.includes(kw.toLowerCase())) continue;
    kwSeen = true;
    const hit = tryCandidates(cands, floor, sheets);
    if (hit?.noPlan) return { ok: false, reason: hit.noPlan };
    if (hit) return { ok: true, floor: hit.floor, label: hit.label, via: `label "${kw}"`, confidence: "medium" };
    tried.push(`aliases.keywords["${kw}"] has no candidate on ${floor}`);
  }
  if (!kwSeen && placement) tried.push(`no aliases.keywords entry matches placement label`);

  // 3. department alias
  const deptKey = Object.keys(aliases.departments).find(
    (k) => k.toLowerCase() === dept.toLowerCase()
  );
  if (deptKey) {
    const hit = tryCandidates(aliases.departments[deptKey], floor, sheets);
    if (hit) return { ok: true, floor: hit.floor, label: hit.label, via: `dept ${deptKey}`, confidence: "medium" };
    tried.push(`aliases.departments["${deptKey}"] has no candidate on ${floor}`);
  } else if (dept) {
    tried.push(`no aliases.departments entry for "${dept}"`);
  }

  // 4. last resort — the department name itself appears on the drawing
  if (dept.length >= 4) {
    const hit = findLabel(sheets[floor], dept.replace(/[^\w\s]/g, ".?"));
    if (hit) return { ok: true, floor, label: hit, via: `dept text`, confidence: "low" };
    tried.push(`"${dept}" is not written anywhere on the ${floor} drawing`);
  }

  if (!tried.length) tried.push("nothing to match on (no room, no department, no placement label)");
  return { ok: false, reason: tried.join("; ") };
}

// Several assets legitimately share one anchor. Fan them out on rings so they
// are individually clickable instead of stacking into one dot.
function spread(items, aspect) {
  if (items.length === 1) {
    items[0].planX = items[0].anchorX;
    items[0].planY = items[0].anchorY;
    return;
  }
  const STEP = 1.15; // % of image width per ring
  let i = 0;
  let ring = 0;
  while (i < items.length) {
    if (ring === 0) {
      const it = items[i++];
      it.planX = it.anchorX;
      it.planY = it.anchorY;
    } else {
      const n = ring * 6;
      const r = ring * STEP;
      for (let k = 0; k < n && i < items.length; k++, i++) {
        const a = (2 * Math.PI * k) / n;
        const it = items[i];
        it.planX = +Math.max(0, Math.min(100, it.anchorX + r * Math.cos(a))).toFixed(3);
        it.planY = +Math.max(0, Math.min(100, it.anchorY + r * aspect * Math.sin(a))).toFixed(3);
      }
    }
    ring++;
  }
}

function csv(header, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────
const sheets = loadSheets();
const rows = loadRows();
const branchFilter = args.branch ? String(args.branch).toLowerCase() : null;

const matched = [];
const unmatched = [];
const seen = new Map();

for (const row of rows) {
  const assetId = col(row, "Asset ID", "AssetID", "Asset Id");
  if (!assetId) continue;
  const branch = col(row, "Branch");
  if (branchFilter && branch.toLowerCase() !== branchFilter) continue;

  // Duplicate Asset IDs in the sheet: last row wins (same as the importer), but
  // shout about it when the two rows disagree.
  if (seen.has(assetId)) {
    const prev = seen.get(assetId);
    const now = `${col(row, "Block")}|${col(row, "Floor")}`;
    if (prev !== now) {
      console.warn(`  ! duplicate Asset ID ${assetId} with conflicting location: "${prev}" vs "${now}" — using the later row`);
    }
  }
  seen.set(assetId, `${col(row, "Block")}|${col(row, "Floor")}`);

  const r = resolve(row, sheets);
  const base = {
    "Asset ID": assetId,
    Branch: branch,
    Block: col(row, "Block"),
    Floor: col(row, "Floor"),
    Room: col(row, "Room"),
    Department: col(row, "Department"),
    "Placement Label": col(row, "Placement Label"),
  };

  if (!r.ok) {
    unmatched.push({ ...base, Reason: r.reason });
    continue;
  }
  matched.push({
    ...base,
    planFloor: r.floor,
    sheet: sheets[r.floor].slug,
    anchor: r.label.text.slice(0, 60),
    anchorX: r.label.planX,
    anchorY: r.label.planY,
    matchedVia: r.via,
    confidence: r.confidence,
  });
}

// De-duplicate by Asset ID (last wins), then fan out per anchor.
const byAsset = new Map();
for (const m of matched) byAsset.set(m["Asset ID"], m);
const finalMatched = [...byAsset.values()];

// Same for the misses, so the two counts add up to the number of distinct
// assets. An asset that matched on any row is not a miss.
const byMiss = new Map();
for (const u of unmatched) byMiss.set(u["Asset ID"], u);
for (const id of byAsset.keys()) byMiss.delete(id);
unmatched.length = 0;
unmatched.push(...byMiss.values());

const groups = new Map();
for (const m of finalMatched) {
  const key = `${m.sheet}@${m.anchorX},${m.anchorY}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(m);
}
for (const items of groups.values()) spread(items, 1786 / 1754);

fs.mkdirSync(OUT_DIR, { recursive: true });

const PIN_COLS = [
  "Asset ID", "Branch", "Block", "Floor", "planFloor", "sheet",
  "planX", "planY", "anchor", "matchedVia", "confidence", "Department", "Room", "Placement Label",
];
fs.writeFileSync(path.join(OUT_DIR, "pins.csv"), csv(PIN_COLS, finalMatched));
fs.writeFileSync(
  path.join(OUT_DIR, "unmatched.csv"),
  csv(["Asset ID", "Branch", "Block", "Floor", "Room", "Department", "Placement Label", "Reason"], unmatched)
);

// per-sheet visual proposal
for (const [floor, sheet] of Object.entries(sheets)) {
  const mine = finalMatched.filter((m) => m.sheet === sheet.slug);
  if (!mine.length || !sheet.png) continue;
  const dots = mine
    .map(
      (m) =>
        `<div class="p ${m.confidence}" style="left:${m.planX}%;top:${m.planY}%">` +
        `<span>${m["Asset ID"]}<br>${m.Department || ""} → ${m.anchor}</span></div>`
    )
    .join("\n");
  fs.writeFileSync(
    path.join(OUT_DIR, `preview-pins-${sheet.slug}.html`),
    `<!doctype html><meta charset="utf-8"><title>${floor} — proposed pins</title>
<style>
 body{margin:0;font:12px system-ui,sans-serif;background:#111;color:#eee}
 header{padding:10px 14px}
 .wrap{position:relative;display:inline-block;margin:0 14px 40px}
 img{display:block;max-width:100%;height:auto}
 .p{position:absolute;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;
    box-shadow:0 0 0 2px #fff}
 .high{background:#22c55e}.medium{background:#f59e0b}.low{background:#ef4444}
 .p span{position:absolute;left:14px;top:-6px;white-space:nowrap;background:#000d;
    padding:2px 5px;border-radius:3px;font-size:10px;opacity:0;pointer-events:none}
 .p:hover{z-index:9}.p:hover span{opacity:1}
</style>
<header><b>${floor}</b> — ${mine.length} proposed pins.
 <span style="color:#22c55e">■</span> room-number match
 <span style="color:#f59e0b">■</span> alias match
 <span style="color:#ef4444">■</span> weak match. Hover for the asset.</header>
<div class="wrap"><img src="${sheet.png}">
${dots}
</div>`
  );
}

// ── report ───────────────────────────────────────────────────────────────────
const total = finalMatched.length + unmatched.length;
console.log(`matched   ${finalMatched.length}/${total}`);
const byConf = {};
for (const m of finalMatched) byConf[m.confidence] = (byConf[m.confidence] || 0) + 1;
for (const [k, v] of Object.entries(byConf)) console.log(`  ${k.padEnd(7)} ${v}`);
console.log(`unmatched ${unmatched.length}/${total}`);
const byReason = {};
for (const u of unmatched) {
  const bucket = u.Reason.split(";")[0].trim(); // first rule that failed
  byReason[bucket] = (byReason[bucket] || 0) + 1;
}
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log(`\nout/pins.csv, out/unmatched.csv, out/preview-pins-*.html`);
console.log(`Review the previews, widen aliases.json, re-run. Then: node push-pins.mjs`);

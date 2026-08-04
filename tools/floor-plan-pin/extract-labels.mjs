// Step 1 of the auto-pin pipeline.
//
// Reads the same architectural PDFs that ../floor-plan-convert turned into PNGs,
// pulls every text label out of the PDF's *vector text layer* together with its
// position, and re-expresses that position in the SAME coordinate space the app
// pins in: planX / planY as 0-100 % of the cropped PNG.
//
// Geometry here mirrors convert.mjs exactly (render at DPI -> crop a fraction of
// the width -> resize). The final resize is uniform, so it does not affect the
// percentages; only the render scale and the crop offset do.
//
// Usage:
//   npm install
//   node extract-labels.mjs                       # all sheets, default geometry
//   node extract-labels.mjs --crop=0.72 --side=left --dpi=150
//   node extract-labels.mjs --only=ground
//
// Outputs, per sheet, into ./out/ :
//   labels-<slug>.json   machine-readable anchors  (feeds match.mjs)
//   labels-<slug>.csv    same thing, for eyeballing in Excel
//   preview-<slug>.html  the PNG with every anchor drawn on it, positioned with
//                        left:%/top:% — i.e. the exact same CSS the Angular
//                        floor-plan component uses for real pins. Open it in a
//                        browser: if the dots sit on the right rooms, the
//                        percentages are correct.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONVERT_DIR = path.join(HERE, "..", "floor-plan-convert");
const INPUT_DIR = path.join(CONVERT_DIR, "input");
const PNG_DIR = path.join(CONVERT_DIR, "output");
const OUT_DIR = path.join(HERE, "out");

// ── args (same defaults as convert.mjs) ──────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const CROP = clamp(Number(args.crop ?? "0.72"), 0.05, 1);
const SIDE = String(args.side ?? "left");
const DPI = Number(args.dpi ?? "150");
const ONLY = args.only ? String(args.only).toLowerCase() : null;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function slugify(name) {
  return name
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Tokens that are dimensions / door-window tags / schedule noise rather than
// room names. Kept in the JSON (flagged) but excluded from the matchable set.
const NOISE = [
  /^[\d.,\s]+$/,                          // 4150   2.40   1,200
  /^\d+\s*[xX×]\s*\d+$/,                  // 8770 X 4200
  /^(sill|lintel|opening|eq|typ|ht|no'?s?|type|size)\b/i,
  /^(W|V|VL|D|TD|DN|MoD|FD|GD|CD|LD|BD|OTD|MtD|AL|SD|FS|PS)\d*(\([A-C]\))?$/,
  /^\d+\s*(mm|m|MM|M)$/,
  /^[+-]?\d+\.\d+$/,
];
const isNoise = (s) => NOISE.some((re) => re.test(s.trim()));

// ── one sheet ────────────────────────────────────────────────────────────────
async function extract(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);

  const scale = DPI / 72;
  const viewport = page.getViewport({ scale });

  // convert.mjs rasterises to ceil(viewport) then crops CROP of the width.
  const renderW = Math.ceil(viewport.width);
  const renderH = Math.ceil(viewport.height);
  const cropW = Math.max(1, Math.round(renderW * CROP));
  let cropLeft = 0;
  if (SIDE === "right") cropLeft = renderW - cropW;
  else if (SIDE === "center") cropLeft = Math.round((renderW - cropW) / 2);
  cropLeft = clamp(cropLeft, 0, renderW - cropW);

  const tc = await page.getTextContent();

  // Text item -> device pixel box. item.transform is text-space; composing it
  // with viewport.transform gives top-left-origin device coords (y grows down).
  const raw = [];
  for (const it of tc.items) {
    const text = (it.str || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const m = pdfjs.Util.transform(viewport.transform, it.transform);
    const w = (it.width || 0) * scale;
    const h = (it.height || 0) * scale || Math.abs(m[3]) || 10;
    raw.push({
      text,
      x: m[4],              // left edge, baseline origin
      y: m[5],              // baseline, device space
      w,
      h,
      cx: m[4] + w / 2,     // horizontal centre
      cy: m[5] - h * 0.35,  // rough visual centre of the glyph box
    });
  }

  await doc.destroy();

  // Drop anything the crop removes — this is what kills the title block and the
  // door/window/ventilator schedule column.
  const inside = raw.filter((r) => r.cx >= cropLeft && r.cx <= cropLeft + cropW);

  const clustered = cluster(inside);

  const toPct = (r) => ({
    planX: +(((r.cx - cropLeft) / cropW) * 100).toFixed(3),
    planY: +((r.cy / renderH) * 100).toFixed(3),
  });

  const labels = clustered
    .map((c) => {
      const { planX, planY } = toPct(c);
      return {
        text: c.text,
        planX: clamp(planX, 0, 100),
        planY: clamp(planY, 0, 100),
        noise: isNoise(c.text),
        parts: c.parts,
      };
    })
    .sort((a, b) => a.planY - b.planY || a.planX - b.planX);

  return {
    geometry: { dpi: DPI, crop: CROP, side: SIDE, renderW, renderH, cropLeft, cropW },
    labels,
  };
}

// Join text runs that visually form one label:
//   pass 1 — same baseline, small horizontal gap   ("SEMI" + "PRIVATE")
//   pass 2 — stacked lines with overlapping x      ("DUMB" over "WAITER")
function cluster(items) {
  const byLine = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of byLine) {
    const prev = lines[lines.length - 1];
    if (
      prev &&
      Math.abs(prev.y - it.y) <= prev.h * 0.5 &&
      it.x - (prev.x + prev.w) <= prev.h * 1.2 &&
      it.x >= prev.x - prev.h
    ) {
      prev.text += " " + it.text;
      prev.parts.push(it.text);
      prev.w = it.x + it.w - prev.x;
      prev.cx = prev.x + prev.w / 2;
      continue;
    }
    lines.push({ ...it, parts: [it.text] });
  }

  const used = new Array(lines.length).fill(false);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    const group = [lines[i]];
    used[i] = true;
    for (let j = i + 1; j < lines.length; j++) {
      if (used[j]) continue;
      const last = group[group.length - 1];
      const dy = lines[j].y - last.y;
      if (dy < 0 || dy > last.h * 1.9) continue;
      const overlap =
        Math.min(last.x + last.w, lines[j].x + lines[j].w) - Math.max(last.x, lines[j].x);
      if (overlap <= 0) continue;
      group.push(lines[j]);
      used[j] = true;
    }
    const text = group.map((g) => g.text).join(" ");
    const parts = group.flatMap((g) => g.parts);
    const x = Math.min(...group.map((g) => g.x));
    const right = Math.max(...group.map((g) => g.x + g.w));
    out.push({
      text,
      parts,
      x,
      w: right - x,
      h: group[0].h,
      y: group[0].y,
      cx: (x + right) / 2,
      cy: (group[0].cy + group[group.length - 1].cy) / 2,
    });
  }
  return out;
}

// ── preview page: same positioning model as the Angular pin overlay ──────────
function previewHtml(slug, pngRelPath, result) {
  const real = result.labels.filter((l) => !l.noise);
  const dots = real
    .map(
      (l, i) =>
        `<div class="a" style="left:${l.planX}%;top:${l.planY}%" data-i="${i}">` +
        `<span>${escapeHtml(l.text)}</span></div>`
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8">
<title>${slug} — label anchors</title>
<style>
  body{margin:0;font:12px system-ui,sans-serif;background:#111;color:#eee}
  header{padding:10px 14px;position:sticky;top:0;background:#111;z-index:5}
  .wrap{position:relative;display:inline-block;margin:0 14px 40px}
  img{display:block;max-width:100%;height:auto}
  .a{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;
     background:#ff2d55;box-shadow:0 0 0 2px #fff;cursor:default}
  .a span{position:absolute;left:12px;top:-4px;white-space:nowrap;background:#000c;
     color:#fff;padding:1px 4px;border-radius:3px;font-size:10px;opacity:0;transition:.1s}
  .a:hover{z-index:10}
  .a:hover span{opacity:1}
  label{margin-left:14px;font-weight:400}
</style>
<header>
  <b>${slug}</b> — ${real.length} anchors (hover a dot for its label).
  Dots use <code>left:planX%</code> / <code>top:planY%</code>, the same CSS the app uses for pins.
  <label><input type="checkbox" id="t" checked> show labels always</label>
</header>
<div class="wrap"><img src="${pngRelPath}">
${dots}
</div>
<script>
  const cb=document.getElementById('t');
  const apply=()=>document.querySelectorAll('.a span').forEach(s=>s.style.opacity=cb.checked?1:'');
  cb.addEventListener('change',apply);apply();
</script>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    "text,planX,planY,noise",
    ...rows.map((r) => [esc(r.text), r.planX, r.planY, r.noise].join(",")),
  ].join("\n");
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Missing ${INPUT_DIR}. Put the floor-plan PDFs there (same folder convert.mjs reads).`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pdfs = fs.readdirSync(INPUT_DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  if (!pdfs.length) {
    console.error(`No PDFs in ${INPUT_DIR}.`);
    process.exit(1);
  }

  console.log(`dpi=${DPI} crop=${CROP} side=${SIDE}\n`);
  const index = [];

  for (const file of pdfs) {
    const slug = slugify(file);
    if (ONLY && !slug.includes(ONLY)) continue;
    process.stdout.write(`• ${file} … `);

    const result = await extract(path.join(INPUT_DIR, file));
    const real = result.labels.filter((l) => !l.noise);

    const png = path.join(PNG_DIR, `${slug}.png`);
    const hasPng = fs.existsSync(png);

    const payload = {
      sheet: file,
      slug,
      png: hasPng ? path.relative(OUT_DIR, png).replace(/\\/g, "/") : null,
      geometry: result.geometry,
      labelCount: real.length,
      labels: result.labels,
    };

    fs.writeFileSync(path.join(OUT_DIR, `labels-${slug}.json`), JSON.stringify(payload, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, `labels-${slug}.csv`), toCsv(result.labels));
    if (hasPng) {
      fs.writeFileSync(
        path.join(OUT_DIR, `preview-${slug}.html`),
        previewHtml(slug, payload.png, result)
      );
    }

    console.log(`${real.length} labels (+${result.labels.length - real.length} noise)${hasPng ? "" : "  [no PNG — preview skipped]"}`);
    index.push({ slug, sheet: file, labels: real.length });
  }

  fs.writeFileSync(path.join(OUT_DIR, "sheets.json"), JSON.stringify(index, null, 2));
  console.log(`\nWrote ${index.length} sheet(s) to ${OUT_DIR}`);
  console.log(`Open out/preview-*.html and check the dots land on the right rooms before matching.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

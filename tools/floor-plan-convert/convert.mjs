// Rasterize floor-plan PDFs (page 1) → crop off the title-block/schedule column
// → resize → PNG, ready to upload via POST /api/floor-plan.
//
// Usage:
//   npm install
//   node convert.mjs                      # reads ./input/*.pdf → ./output/*.png
//   node convert.mjs --crop=0.72 --side=left --width=1920 --dpi=150
//   node convert.mjs --crop=1             # no crop (full sheet)
//
// All flags are global. For a one-off sheet that needs a different crop, run it
// alone:  node convert.mjs --only=lower-ground --side=center --crop=0.5
//
// Output names are slugified from the PDF filename. The script prints the final
// width/height of each PNG — feed those to the uploader's width/height fields.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
// pdfjs legacy build is the Node-friendly one.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(HERE, "input");
const OUTPUT_DIR = path.join(HERE, "output");

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const CROP = clamp(Number(args.crop ?? "0.72"), 0.05, 1);   // fraction of width to keep
const SIDE = String(args.side ?? "left");                   // left | right | center
const TARGET_WIDTH = Number(args.width ?? "1920");          // final PNG width (px); 0 = keep
const DPI = Number(args.dpi ?? "150");                      // rasterization density
const ONLY = args.only ? String(args.only).toLowerCase() : null; // slug filter

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function slugify(name) {
  return name
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── pdfjs needs a canvas factory in Node ─────────────────────────────────────
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc, width, height) {
    cc.canvas.width = width;
    cc.canvas.height = height;
  }
  destroy(cc) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

async function renderPdfToPng(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const canvasFactory = new NodeCanvasFactory();
  const doc = await pdfjs.getDocument({ data, canvasFactory, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);

  const scale = DPI / 72; // PDF user units are 72 DPI
  const viewport = page.getViewport({ scale });
  const { canvas, context } = canvasFactory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  // White background — architectural sheets render with transparent paper.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
  const png = canvas.toBuffer("image/png");
  await doc.destroy();
  return png;
}

async function cropAndResize(pngBuffer) {
  const meta = await sharp(pngBuffer).metadata();
  const cropW = Math.max(1, Math.round(meta.width * CROP));
  let left = 0;
  if (SIDE === "right") left = meta.width - cropW;
  else if (SIDE === "center") left = Math.round((meta.width - cropW) / 2);
  left = clamp(left, 0, meta.width - cropW);

  let pipe = sharp(pngBuffer);
  if (CROP < 1) pipe = pipe.extract({ left, top: 0, width: cropW, height: meta.height });
  if (TARGET_WIDTH > 0) pipe = pipe.resize({ width: TARGET_WIDTH, withoutEnlargement: true });

  const out = await pipe.png({ compressionLevel: 9 }).toBuffer();
  const outMeta = await sharp(out).metadata();
  return { out, width: outMeta.width, height: outMeta.height };
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    console.error(`Created ${INPUT_DIR}. Drop your PDF sheets there and re-run.`);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const pdfs = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (pdfs.length === 0) {
    console.error(`No PDFs found in ${INPUT_DIR}.`);
    process.exit(1);
  }

  console.log(`crop=${CROP} side=${SIDE} width=${TARGET_WIDTH || "native"} dpi=${DPI}\n`);
  const rows = [];
  for (const file of pdfs) {
    const slug = slugify(file);
    if (ONLY && !slug.includes(ONLY)) continue;
    process.stdout.write(`• ${file} … `);
    try {
      const png = await renderPdfToPng(path.join(INPUT_DIR, file));
      const { out, width, height } = await cropAndResize(png);
      const outName = `${slug}.png`;
      fs.writeFileSync(path.join(OUTPUT_DIR, outName), out);
      console.log(`→ output/${outName}  (${width}×${height})`);
      rows.push({ outName, width, height });
    } catch (err) {
      console.log("FAILED");
      console.error(`  ${err?.message || err}`);
    }
  }

  if (rows.length) {
    console.log(`\nDone. ${rows.length} file(s) in ${OUTPUT_DIR}`);
    console.log("Use these width/height values when uploading:");
    for (const r of rows) console.log(`  ${r.outName}: width=${r.width} height=${r.height}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
//  Shrink an upload before it is stored.
//
//  Sits in front of src/lib/fileStorage.ts, so every upload path — asset photos,
//  ticket images, insurance policies, service invoices, floor plans — is
//  squeezed the same way without each controller knowing about it.
//
//  ── WHAT ACTUALLY REACHES THE TARGET ───────────────────────────────────────
//  Images do. Resizing then stepping quality down gets a photo under 50 KB
//  reliably, at the cost of detail.
//
//  PDFs are handled in two tiers, because no npm package can recompress the
//  scanned images inside one:
//
//    1. ghostscript, when the binary is on the machine. This is the only thing
//       that genuinely shrinks a scan — it downsamples the embedded images. A
//       multi-megabyte scanned policy comes back a fraction of its size.
//    2. a lossless pdf-lib rewrite otherwise (shared object streams, duplicate
//       resources dropped). Saves 5–20% on a text PDF and often nothing on a
//       scan, so a 3 MB scan stays roughly 3 MB.
//
//  Ghostscript is found automatically (gs / gswin64c / gswin32c) or named by
//  UPLOAD_GS_BINARY. It is looked for once per process; when it is absent the
//  code silently uses tier 2 and never probes again.
//
//  Anything already compressed (xlsx, docx, zip) is left alone — they are zip
//  archives, so a second pass gains nothing.
//
//  ── FAILURE IS NEVER FATAL ─────────────────────────────────────────────────
//  A corrupt image, an encrypted PDF, a format sharp does not know: the original
//  file is stored unchanged. Compression must never be the reason an upload
//  fails, because the upload is the thing the user actually asked for.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

/** Target size for images. 50 KB by default — raise it if photos come out unreadable. */
const IMAGE_TARGET_BYTES =
  Math.max(10, Number(process.env.UPLOAD_IMAGE_TARGET_KB) || 50) * 1024;

/** Longest edge an image is allowed to keep. Most of the saving comes from here. */
const MAX_DIMENSION = Math.max(320, Number(process.env.UPLOAD_IMAGE_MAX_PX) || 1600);

/** Target size for PDFs. Only reachable when ghostscript is installed. */
const PDF_TARGET_BYTES =
  Math.max(20, Number(process.env.UPLOAD_PDF_TARGET_KB) || 50) * 1024;

/** Set UPLOAD_COMPRESSION=off to store every upload exactly as received. */
const ENABLED = (process.env.UPLOAD_COMPRESSION || "").toLowerCase() !== "off";

/** A stuck ghostscript must not hold an HTTP request open forever. */
const GS_TIMEOUT_MS = Math.max(5_000, Number(process.env.UPLOAD_GS_TIMEOUT_MS) || 60_000);

// Widths and qualities are walked in order, largest/best first, and the search
// stops at the first result under target — so a small photo costs one encode.
const WIDTH_STEPS = [MAX_DIMENSION, 1280, 1024, 800, 640];
const QUALITY_STEPS = [78, 60, 45, 32];

const RASTER_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"]);

export interface CompressionResult {
  /** Bytes to store. The original buffer when nothing could be gained. */
  data: Buffer;
  /** Extension the stored file must carry — compression can change the format. */
  ext: string;
  bytesBefore: number;
  bytesAfter: number;
  /** Short, loggable explanation. */
  note: string;
}

/**
 * SVG is deliberately excluded: rasterising a floor plan to fit a byte budget
 * would throw away the vectors that make it zoomable, and an SVG is text that
 * gzip already handles on the wire. GIF is excluded because sharp would flatten
 * an animation to its first frame.
 */
function isCompressibleImage(ext: string): boolean {
  return RASTER_EXTS.has(ext);
}

async function compressImage(input: Buffer, ext: string): Promise<CompressionResult | null> {
  const meta = await sharp(input, { failOn: "none" }).metadata();

  // Transparency has to survive, and JPEG cannot carry it — WebP can, and beats
  // PNG heavily on photographic content.
  const keepAlpha = !!meta.hasAlpha;
  const outExt = keepAlpha ? ".webp" : ".jpg";

  let best: Buffer | null = null;

  for (const width of WIDTH_STEPS) {
    for (const quality of QUALITY_STEPS) {
      const pipeline = sharp(input, { failOn: "none" })
        .rotate() // honour EXIF orientation before the metadata is dropped
        .resize({ width, withoutEnlargement: true });

      const out = keepAlpha
        ? await pipeline.webp({ quality }).toBuffer()
        : await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();

      if (!best || out.length < best.length) best = out;
      if (out.length <= IMAGE_TARGET_BYTES) {
        return {
          data: out,
          ext: outExt,
          bytesBefore: input.length,
          bytesAfter: out.length,
          note: `image ${width}px q${quality}`,
        };
      }
    }
  }

  // Nothing hit the target — keep the smallest attempt rather than failing, but
  // only if it actually beat the original.
  if (best && best.length < input.length) {
    return {
      data: best,
      ext: outExt,
      bytesBefore: input.length,
      bytesAfter: best.length,
      note: `image floor reached, still over ${Math.round(IMAGE_TARGET_BYTES / 1024)} KB`,
    };
  }
  return null;
}

// ── Ghostscript ──────────────────────────────────────────────────────────────

/**
 * Resolved once per process. `undefined` means "not looked for yet", `null`
 * means "looked for and absent" — without that distinction a server without
 * ghostscript would spawn three failing processes on every single PDF upload.
 */
let gsBinaryCache: string | null | undefined;

async function resolveGhostscript(): Promise<string | null> {
  if (gsBinaryCache !== undefined) return gsBinaryCache;

  const configured = (process.env.UPLOAD_GS_BINARY || "").trim();
  const candidates = configured ? [configured] : ["gs", "gswin64c", "gswin32c"];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 10_000 });
      gsBinaryCache = candidate;
      return candidate;
    } catch {
      // Not this one — try the next spelling.
    }
  }

  console.warn(
    "mediaCompression: ghostscript not found — PDFs will only get the lossless " +
    "rewrite. Install it, or set UPLOAD_GS_BINARY, to actually shrink scans."
  );
  gsBinaryCache = null;
  return null;
}

/**
 * Quality rungs, best first. `/ebook` is 150 dpi and stays comfortably
 * readable; `/screen` is 72 dpi and is the floor — below that a scanned
 * document is no longer worth keeping, so a file that misses the target at 72
 * dpi is stored at 72 dpi rather than degraded further.
 */
const GS_SETTINGS = ["/ebook", "/screen"] as const;

async function runGhostscript(gs: string, srcPath: string, preset: string): Promise<Buffer | null> {
  const outPath = path.join(
    os.tmpdir(),
    `gs-${crypto.randomBytes(8).toString("hex")}.pdf`
  );
  try {
    await execFileAsync(
      gs,
      [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=${preset}`,
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        "-dSAFER",
        `-sOutputFile=${outPath}`,
        srcPath,
      ],
      { timeout: GS_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    );

    const out = await fs.promises.readFile(outPath);
    // Ghostscript exits 0 on some malformed input while writing a stub, so the
    // result is checked rather than trusted.
    if (out.length === 0 || out.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
    return out;
  } catch {
    return null;
  } finally {
    try { await fs.promises.unlink(outPath); } catch { /* best effort */ }
  }
}

async function compressPdf(
  input: Buffer,
  ext: string,
  srcPath: string
): Promise<CompressionResult | null> {
  const gs = await resolveGhostscript();

  if (gs) {
    let best: { data: Buffer; preset: string } | null = null;

    for (const preset of GS_SETTINGS) {
      const out = await runGhostscript(gs, srcPath, preset);
      if (!out) continue;
      if (!best || out.length < best.data.length) best = { data: out, preset };
      if (out.length <= PDF_TARGET_BYTES) break;
    }

    // Already-optimised PDFs come back bigger — ghostscript re-encodes rather
    // than passing through, so the original has to be allowed to win.
    if (best && best.data.length < input.length) {
      const missed = best.data.length > PDF_TARGET_BYTES;
      return {
        data: best.data,
        ext,
        bytesBefore: input.length,
        bytesAfter: best.data.length,
        note: `pdf ghostscript ${best.preset}${missed ? " (floor reached, still over target)" : ""}`,
      };
    }
  }

  // Fallback: lossless rewrite. An encrypted PDF throws here and is left alone —
  // rewriting one produces a file the original password no longer opens.
  const pdf = await PDFDocument.load(input, { updateMetadata: false });
  const out = Buffer.from(await pdf.save({ useObjectStreams: true }));

  if (out.length >= input.length) return null;
  return {
    data: out,
    ext,
    bytesBefore: input.length,
    bytesAfter: out.length,
    note: "pdf rewritten (lossless)",
  };
}

/**
 * Read a staged upload and return the bytes to store, plus the extension they
 * must be stored under. Always resolves — on any failure the original wins.
 */
export async function compressForUpload(
  localTempPath: string,
  originalName: string
): Promise<CompressionResult> {
  const input = await fs.promises.readFile(localTempPath);
  const ext = path.extname(originalName || localTempPath).toLowerCase();
  const untouched: CompressionResult = {
    data: input,
    ext,
    bytesBefore: input.length,
    bytesAfter: input.length,
    note: "stored as received",
  };

  if (!ENABLED) return untouched;

  try {
    let result: CompressionResult | null = null;
    if (isCompressibleImage(ext)) result = await compressImage(input, ext);
    else if (ext === ".pdf") result = await compressPdf(input, ext, localTempPath);
    return result ?? untouched;
  } catch (err) {
    console.warn(`compressForUpload: keeping original ${path.basename(originalName)} —`, err);
    return untouched;
  }
}

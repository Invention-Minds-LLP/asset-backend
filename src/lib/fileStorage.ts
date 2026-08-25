// ─────────────────────────────────────────────────────────────────────────────
//  Local file storage (replaces the old FTP-to-Hostinger upload path)
//
//  Files used to be pushed over FTP to srv680.main-hosting.eu and served from
//  https://smartassets.inventionminds.com/<folder>/<file>. Uploads now live on
//  the server's own disk under UPLOADS_DIR and are served at
//  <PUBLIC_BASE_URL>/uploads/<folder>/<file> (nginx, with express.static as the
//  in-process fallback).
//
//  ── Why PUBLIC_BASE_URL is normally EMPTY ──────────────────────────────────
//  Staff inside the premises reach the server by LAN IP; people outside reach it
//  by domain. An absolute URL stored in the database would be correct for only
//  one of them. Leaving PUBLIC_BASE_URL unset makes publicUrl() return a
//  RELATIVE path ("/uploads/ticket_images/x.jpg"), which the browser resolves
//  against whichever origin served the page — so the same database row works on
//  both networks. Set PUBLIC_BASE_URL only where an absolute URL is unavoidable
//  (e.g. a link inside an outgoing email).
//
//  Existing rows still hold absolute https://smartassets.inventionminds.com/...
//  URLs from the FTP era. Nothing rewrites them; they keep resolving as before.
//  Only new uploads are stored as relative paths.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import os from "os";
import path from "path";
import { compressForUpload } from "./mediaCompression";

// Root directory for uploaded files.
//
// ALWAYS set UPLOADS_DIR in production, to a path OUTSIDE the application
// directory (e.g. /var/smartassets/uploads). The <cwd>/uploads fallback is for
// local development only: a fresh clone, an `rsync --delete` deploy or
// `git clean -fdx` would wipe uploads stored inside the repo, taking every
// contract document and ticket photo with them.
export const UPLOADS_DIR =
  (process.env.UPLOADS_DIR && process.env.UPLOADS_DIR.trim()) ||
  path.join(process.cwd(), "uploads");

// Normalise a legacy "/public_html/smartassets/ticket_images/x.jpg" (or a plain
// "ticket_images/x.jpg") down to the sub-path "ticket_images/x.jpg", so the old
// call sites can pass the strings they already build.
export function toSubPath(remoteOrSubPath: string): string {
  let p = String(remoteOrSubPath || "").replace(/\\/g, "/").trim();
  p = p.replace(/^\/?public_html\//i, "");   // drop "/public_html/"
  p = p.replace(/^smartassets\//i, "");      // drop the site folder
  p = p.replace(/^\/+/, "");                 // drop any remaining leading slashes
  return p;
}

/**
 * Give an uploaded file a collision-proof name.
 *
 * The FTP code wrote `${originalFileName}` for tickets, assets and maintenance
 * reports — two people uploading "photo.jpg" meant the second silently replaced
 * the first, and the earlier record then displayed the wrong image.
 */
export function uniqueFileName(originalName: string): string {
  const clean = String(originalName || "file")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^\w.\-]+/g, "_");
  return `${Date.now()}-${clean}`;
}

/**
 * Move a freshly-uploaded temp file (from multer/formidable) into permanent
 * storage and remove the temp copy. `remoteOrSubPath` may be a legacy
 * "/public_html/<folder>/<file>" or a plain "<folder>/<file>".
 * Returns the stored sub-path.
 */
export async function saveLocal(localTempPath: string, remoteOrSubPath: string): Promise<string> {
  let sub = toSubPath(remoteOrSubPath);

  // Backstop. The intakes reject blocked formats up front for a clean message,
  // but this is the one place every upload passes through, so a route added
  // later without a filter still cannot store one.
  const blocked = blockedUploadExtension(sub);
  if (blocked) {
    try { await fs.promises.unlink(localTempPath); } catch { /* best effort */ }
    throw new UnsupportedUploadTypeError(blocked);
  }

  // Every upload is squeezed on the way in — see src/lib/mediaCompression.ts.
  // This is the single chokepoint through which all of them pass, so putting it
  // here is what stops one controller quietly storing full-size originals.
  const compressed = await compressForUpload(localTempPath, sub);

  // Compression may change the format (a transparent PNG comes back as WebP),
  // and the stored name has to follow the bytes or the file will not open.
  const currentExt = path.extname(sub);
  if (compressed.ext && compressed.ext !== currentExt) {
    sub = `${sub.slice(0, sub.length - currentExt.length)}${compressed.ext}`;
  }

  const dest = path.join(UPLOADS_DIR, sub);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, compressed.data);
  // The FTP path never cleaned these up, so src/temp grew without bound.
  try { await fs.promises.unlink(localTempPath); } catch { /* best effort */ }
  return sub;
}

/** Public URL for a stored file. Relative unless PUBLIC_BASE_URL is set. */
export function publicUrl(remoteOrSubPath: string): string {
  const sub = toSubPath(remoteOrSubPath);
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/uploads/${sub}`;
}

/** Save then return the public URL — what nearly every call site wants. */
export async function saveAndGetUrl(localTempPath: string, remoteOrSubPath: string): Promise<string> {
  const sub = await saveLocal(localTempPath, remoteOrSubPath);
  return publicUrl(sub);
}

// ── What may be stored ───────────────────────────────────────────────────────

/**
 * Formats refused at every upload point.
 *
 * A Word document is an editable working file, not a record: two people can
 * hold different versions of the same "signed" contract and neither can prove
 * which was attached. PDF is the format that stays what it was when it was
 * uploaded, so a .docx is converted rather than stored.
 */
export const BLOCKED_UPLOAD_EXTENSIONS = [".docx"];

export class UnsupportedUploadTypeError extends Error {
  /** Read by the global error handler so this surfaces as 400, not 500. */
  readonly status = 400;
  constructor(ext: string) {
    super(`${ext} files are not accepted. Save it as a PDF and upload that instead.`);
    this.name = "UnsupportedUploadTypeError";
  }
}

/** The blocked extension, or null when the file is fine. */
export function blockedUploadExtension(fileName: string): string | null {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return BLOCKED_UPLOAD_EXTENSIONS.includes(ext) ? ext : null;
}

/** Ready-made multer fileFilter. Compose with a format-specific one where needed. */
export function rejectBlockedUploads(
  _req: unknown,
  file: { originalname: string },
  cb: (error: Error | null, acceptFile?: boolean) => void
): void {
  const blocked = blockedUploadExtension(file.originalname);
  if (blocked) return cb(new UnsupportedUploadTypeError(blocked));
  cb(null, true);
}

/**
 * Where multer and formidable put a file while it is still arriving.
 *
 * Deliberately NOT inside UPLOADS_DIR: that directory is served at /uploads, so
 * a half-written or rejected file parked there would be publicly fetchable for
 * as long as it existed. Everything here is moved out (or unlinked) the moment
 * the request finishes.
 */
export const TEMP_UPLOAD_DIR =
  (process.env.UPLOAD_TEMP_DIR && process.env.UPLOAD_TEMP_DIR.trim()) ||
  path.join(os.tmpdir(), "smartassets-uploads");

/** Create the temp directory if needed and return it. Safe to call at import time. */
export function tempUploadDir(): string {
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  return TEMP_UPLOAD_DIR;
}

/**
 * One-call intake for a finished multipart upload: give it a collision-proof
 * name, move it under UPLOADS_DIR/<folder>, and return the URL to store.
 *
 * Every upload path goes through here so there is exactly one answer to "where
 * do files live" — writing to <cwd>/uploads directly breaks the moment
 * UPLOADS_DIR points somewhere else, which is what production is told to do.
 */
export async function saveUpload(
  localTempPath: string,
  folder: string,
  originalName: string
): Promise<string> {
  return saveAndGetUrl(localTempPath, `${folder}/${uniqueFileName(originalName)}`);
}

/** Delete a stored file. A missing file is not an error. */
export async function deleteLocal(remoteOrSubPath: string): Promise<void> {
  const dest = path.join(UPLOADS_DIR, toSubPath(remoteOrSubPath));
  try {
    await fs.promises.unlink(dest);
  } catch (err: any) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

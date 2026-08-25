import multer from "multer";
import path from "path";
import * as XLSX from "xlsx";
import { tempUploadDir } from "../lib/fileStorage";

const ALLOWED_EXTS = [".xlsx", ".xls"];
const ALLOWED_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream", // some browsers send this for .xlsx
];

const excelFileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const extOk = ALLOWED_EXTS.includes(ext);
  const mimeOk = ALLOWED_MIMES.includes(file.mimetype);
  if (extOk && mimeOk) return cb(null, true);
  cb(new Error(`Invalid file type. Only Excel (${ALLOWED_EXTS.join(", ")}) is allowed. Received "${file.originalname}" (${file.mimetype}).`));
};

/**
 * Multer instance enforcing .xlsx/.xls + 25 MB cap. Use for all import routes.
 *
 * Staged in the temp directory, not under UPLOADS_DIR: an import sheet is
 * parsed and discarded, and "uploads/" put it inside the tree served at
 * /uploads, where anyone could fetch a supplier price list by guessing a name.
 */
export const excelUpload = multer({
  dest: tempUploadDir(),
  fileFilter: excelFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * Validate that a worksheet contains all required column headers (case-insensitive,
 * trimmed). Returns a result object — caller decides how to surface the error.
 */
export function validateColumns(
  sheet: XLSX.WorkSheet,
  required: string[],
): { ok: true } | { ok: false; missing: string[]; found: string[] } {
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1, defval: "" });
  const headerRow = (rows[0] as any[] | undefined) ?? [];
  const found = headerRow.map(h => String(h ?? "").trim().toLowerCase()).filter(Boolean);
  const requiredNorm = required.map(r => r.trim().toLowerCase());
  const missing = requiredNorm.filter(r => !found.includes(r));
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing, found };
}

/** Validate that a workbook has all required sheet names. */
export function validateSheets(
  workbook: XLSX.WorkBook,
  required: string[],
): { ok: true } | { ok: false; missing: string[]; found: string[] } {
  const found = workbook.SheetNames;
  const missing = required.filter(r => !found.includes(r));
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing, found };
}

/** Express middleware that catches multer file-filter errors and returns a clean 400. */
export function handleUploadError(err: any, _req: any, res: any, next: any): void {
  if (err && (err.message?.includes("Invalid file type") || err.code === "LIMIT_FILE_SIZE")) {
    res.status(400).json({ message: err.message });
    return;
  }
  next(err);
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.excelUpload = void 0;
exports.validateColumns = validateColumns;
exports.validateSheets = validateSheets;
exports.handleUploadError = handleUploadError;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const XLSX = __importStar(require("xlsx"));
const ALLOWED_EXTS = [".xlsx", ".xls"];
const ALLOWED_MIMES = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream", // some browsers send this for .xlsx
];
const excelFileFilter = (_req, file, cb) => {
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    const extOk = ALLOWED_EXTS.includes(ext);
    const mimeOk = ALLOWED_MIMES.includes(file.mimetype);
    if (extOk && mimeOk)
        return cb(null, true);
    cb(new Error(`Invalid file type. Only Excel (${ALLOWED_EXTS.join(", ")}) is allowed. Received "${file.originalname}" (${file.mimetype}).`));
};
/** Multer instance enforcing .xlsx/.xls + 25 MB cap. Use for all import routes. */
exports.excelUpload = (0, multer_1.default)({
    dest: "uploads/",
    fileFilter: excelFileFilter,
    limits: { fileSize: 25 * 1024 * 1024 },
});
/**
 * Validate that a worksheet contains all required column headers (case-insensitive,
 * trimmed). Returns a result object — caller decides how to surface the error.
 */
function validateColumns(sheet, required) {
    var _a;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headerRow = (_a = rows[0]) !== null && _a !== void 0 ? _a : [];
    const found = headerRow.map(h => String(h !== null && h !== void 0 ? h : "").trim().toLowerCase()).filter(Boolean);
    const requiredNorm = required.map(r => r.trim().toLowerCase());
    const missing = requiredNorm.filter(r => !found.includes(r));
    if (missing.length === 0)
        return { ok: true };
    return { ok: false, missing, found };
}
/** Validate that a workbook has all required sheet names. */
function validateSheets(workbook, required) {
    const found = workbook.SheetNames;
    const missing = required.filter(r => !found.includes(r));
    if (missing.length === 0)
        return { ok: true };
    return { ok: false, missing, found };
}
/** Express middleware that catches multer file-filter errors and returns a clean 400. */
function handleUploadError(err, _req, res, next) {
    var _a;
    if (err && (((_a = err.message) === null || _a === void 0 ? void 0 : _a.includes("Invalid file type")) || err.code === "LIMIT_FILE_SIZE")) {
        res.status(400).json({ message: err.message });
        return;
    }
    next(err);
}

"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAssetId = generateAssetId;
exports.generateSubAssetId = generateSubAssetId;
exports.getFYStringFromDate = getFYStringFromDate;
exports.generateLegacyAssetId = generateLegacyAssetId;
exports.getFYString = getFYString;
exports.getHospitalCode = getHospitalCode;
exports.getOrgCode = getOrgCode;
exports.getPrefix = getPrefix;
const prismaClient_1 = __importDefault(require("../prismaClient"));
/**
 * Generates a standardized Asset ID in the format:
 * AST-{ORG_CODE}-{PROC}-{CAT}-FY{YYYY}-{YY}-{NNNNN}
 *
 * Example: AST-JMRH-PUR-MED-FY2026-27-00001  (Purchase, Medical)
 *          AST-JMRH-DON-ITE-FY2026-27-00001  (Donation, IT Equipment)
 *          AST-JMRH-PUR-FUR-FY2022-23-00001  (Legacy asset, Furniture)
 *
 * If category code is not available, falls back to the old format without CAT:
 *          AST-JMRH-PUR-FY2026-27-00001
 *
 * For sub-assets: {PARENT_ASSET_ID}-{NNN}
 * Example: AST-JMRH-PUR-MED-FY2026-27-00001-001
 */
/** Map modeOfProcurement values to 3-letter codes used in Asset IDs */
const PROC_CODE = {
    PURCHASE: "PUR",
    DONATION: "DON",
    LEASE: "LES",
    RENTAL: "RNT",
    GRANT: "GRT",
};
function getFYString() {
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEnd = fyStart + 1;
    return `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
}
function getOrgCode() {
    return process.env.HOSPITAL_CODE || "SA";
}
/** @deprecated kept for backward compatibility */
function getHospitalCode() {
    return getOrgCode();
}
/**
 * Resolve a short code (3-4 chars) for a category.
 * Priority: AssetCategory.code (if set) → first 3 chars of name → empty string.
 */
function resolveCategoryCode(categoryId, db) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!categoryId)
            return "";
        const client = db || prismaClient_1.default;
        const cat = yield client.assetCategory.findUnique({
            where: { id: categoryId },
            select: { code: true, name: true },
        });
        if (!cat)
            return "";
        if (cat.code)
            return cat.code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
        return cat.name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 3);
    });
}
function buildPrefix(procCode, catCode, fyStr) {
    const org = getOrgCode();
    if (catCode) {
        return `AST-${org}-${procCode}-${catCode}-${fyStr}-`;
    }
    return `AST-${org}-${procCode}-${fyStr}-`;
}
/** Old-style prefix without category (backward compat) */
function getPrefix(modeOfProcurement) {
    var _a;
    const procCode = (_a = PROC_CODE[(modeOfProcurement || "PURCHASE").toUpperCase()]) !== null && _a !== void 0 ? _a : "PUR";
    return buildPrefix(procCode, "", getFYString());
}
/**
 * Generate the next asset ID for a top-level asset.
 *
 * New format: AST-{ORG}-{PROC}-{CAT}-FY{YYYY}-{YY}-{NNNNN}
 *
 * @param modeOfProcurement - PURCHASE | DONATION | LEASE | RENTAL | GRANT
 * @param tx                - Prisma transaction client (optional)
 * @param opts.categoryId   - AssetCategory.id — used to derive 3-letter category code
 * @param opts.purchaseDate - For legacy/individualized assets: use this date's FY instead of current FY
 */
function generateAssetId(modeOfProcurement, tx, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const db = tx || prismaClient_1.default;
        const procCode = (_a = PROC_CODE[(modeOfProcurement || "PURCHASE").toUpperCase()]) !== null && _a !== void 0 ? _a : "PUR";
        const catCode = yield resolveCategoryCode(opts === null || opts === void 0 ? void 0 : opts.categoryId, db);
        const fyStr = (opts === null || opts === void 0 ? void 0 : opts.purchaseDate)
            ? getFYStringFromDate(new Date(opts.purchaseDate))
            : getFYString();
        const prefix = buildPrefix(procCode, catCode, fyStr);
        const existing = yield db.asset.findMany({
            where: { assetId: { startsWith: prefix }, parentAssetId: null },
            select: { assetId: true },
        });
        let maxSeq = 0;
        for (const row of existing) {
            const seqStr = row.assetId.slice(prefix.length);
            const seq = parseInt(seqStr, 10);
            if (!isNaN(seq) && seq > maxSeq)
                maxSeq = seq;
        }
        return `${prefix}${(maxSeq + 1).toString().padStart(5, "0")}`;
    });
}
/**
 * Generate the next sub-asset ID based on the parent asset.
 * Format: {PARENT_ASSET_ID}-{NNN}
 * Example: AST-HC-FY2026-27-00001-001
 */
function generateSubAssetId(parentAssetId, parentDbId, tx) {
    return __awaiter(this, void 0, void 0, function* () {
        const db = tx || prismaClient_1.default;
        const existingSubs = yield db.asset.findMany({
            where: { parentAssetId: parentDbId },
            select: { assetId: true },
        });
        let maxSeq = 0;
        const subPrefix = `${parentAssetId}-`;
        for (const item of existingSubs) {
            if (item.assetId.startsWith(subPrefix)) {
                const suffix = item.assetId.slice(subPrefix.length);
                const seq = parseInt(suffix, 10);
                if (!isNaN(seq) && seq > maxSeq)
                    maxSeq = seq;
            }
        }
        return `${subPrefix}${(maxSeq + 1).toString().padStart(3, "0")}`;
    });
}
/**
 * Derive financial year string from a given date (not today).
 * Used for legacy assets where purchaseDate drives the FY.
 * Format: FY2021-22
 */
function getFYStringFromDate(date) {
    const fyStart = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    const fyEnd = fyStart + 1;
    return `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
}
/**
 * Generate a legacy/individualized asset ID using the SAME format as normal assets
 * but with the purchase date's FY instead of the current FY.
 *
 * Format: AST-{ORG}-{PROC}-{CAT}-FY{YYYY}-{YY}-{NNNNN}  (same as live assets)
 *
 * @param purchaseDate  - determines the FY segment
 * @param tx            - Prisma transaction client (optional)
 * @param categoryId    - AssetCategory.id for the category code segment
 * @param modeOfProcurement - defaults to "PURCHASE"
 */
function generateLegacyAssetId(purchaseDate, tx, categoryId, modeOfProcurement) {
    return __awaiter(this, void 0, void 0, function* () {
        const refDate = purchaseDate ? new Date(purchaseDate) : new Date();
        return generateAssetId(modeOfProcurement || "PURCHASE", tx, {
            categoryId: categoryId !== null && categoryId !== void 0 ? categoryId : null,
            purchaseDate: refDate,
        });
    });
}

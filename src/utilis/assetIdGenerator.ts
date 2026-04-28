import prisma from "../prismaClient";

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
const PROC_CODE: Record<string, string> = {
  PURCHASE: "PUR",
  DONATION: "DON",
  LEASE:    "LES",
  RENTAL:   "RNT",
  GRANT:    "GRT",
};

function getFYString(): string {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEnd = fyStart + 1;
  return `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
}

function getOrgCode(): string {
  return process.env.HOSPITAL_CODE || "SA";
}

/** @deprecated kept for backward compatibility */
function getHospitalCode(): string {
  return getOrgCode();
}

/**
 * Resolve a short code (3-4 chars) for a category.
 * Priority: AssetCategory.code (if set) → first 3 chars of name → empty string.
 */
async function resolveCategoryCode(categoryId: number | null | undefined, db?: any): Promise<string> {
  if (!categoryId) return "";
  const client = db || prisma;
  const cat = await client.assetCategory.findUnique({
    where: { id: categoryId },
    select: { code: true, name: true },
  });
  if (!cat) return "";
  if (cat.code) return cat.code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return cat.name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 3);
}

function buildPrefix(procCode: string, catCode: string, fyStr: string): string {
  const org = getOrgCode();
  if (catCode) {
    return `AST-${org}-${procCode}-${catCode}-${fyStr}-`;
  }
  return `AST-${org}-${procCode}-${fyStr}-`;
}

/** Old-style prefix without category (backward compat) */
function getPrefix(modeOfProcurement?: string): string {
  const procCode = PROC_CODE[(modeOfProcurement || "PURCHASE").toUpperCase()] ?? "PUR";
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
export async function generateAssetId(
  modeOfProcurement?: string,
  tx?: any,
  opts?: { categoryId?: number | null; purchaseDate?: Date | null },
): Promise<string> {
  const db = tx || prisma;
  const procCode = PROC_CODE[(modeOfProcurement || "PURCHASE").toUpperCase()] ?? "PUR";

  const catCode = await resolveCategoryCode(opts?.categoryId, db);

  const fyStr = opts?.purchaseDate
    ? getFYStringFromDate(new Date(opts.purchaseDate))
    : getFYString();

  const prefix = buildPrefix(procCode, catCode, fyStr);

  const existing = await db.asset.findMany({
    where: { assetId: { startsWith: prefix }, parentAssetId: null },
    select: { assetId: true },
  });

  let maxSeq = 0;
  for (const row of existing) {
    const seqStr = row.assetId.slice(prefix.length);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return `${prefix}${(maxSeq + 1).toString().padStart(5, "0")}`;
}

/**
 * Generate the next sub-asset ID based on the parent asset.
 * Format: {PARENT_ASSET_ID}-{NNN}
 * Example: AST-HC-FY2026-27-00001-001
 */
export async function generateSubAssetId(parentAssetId: string, parentDbId: number, tx?: any): Promise<string> {
  const db = tx || prisma;

  const existingSubs = await db.asset.findMany({
    where: { parentAssetId: parentDbId },
    select: { assetId: true },
  });

  let maxSeq = 0;
  const subPrefix = `${parentAssetId}-`;

  for (const item of existingSubs) {
    if (item.assetId.startsWith(subPrefix)) {
      const suffix = item.assetId.slice(subPrefix.length);
      const seq = parseInt(suffix, 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  return `${subPrefix}${(maxSeq + 1).toString().padStart(3, "0")}`;
}

/**
 * Derive financial year string from a given date (not today).
 * Used for legacy assets where purchaseDate drives the FY.
 * Format: FY2021-22
 */
export function getFYStringFromDate(date: Date): string {
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
export async function generateLegacyAssetId(
  purchaseDate: Date | string | null,
  tx?: any,
  categoryId?: number | null,
  modeOfProcurement?: string,
): Promise<string> {
  const refDate = purchaseDate ? new Date(purchaseDate) : new Date();
  return generateAssetId(modeOfProcurement || "PURCHASE", tx, {
    categoryId: categoryId ?? null,
    purchaseDate: refDate,
  });
}

/**
 * Generate a permanent stores reference ID, assigned when a stores user
 * fills the asset's basic details. Lives alongside the regular `assetId`
 * (which still flows TEMP- → AST- via the HOD acknowledgement workflow).
 *
 * Format: STR-{ORG}-{CAT}-FY{YYYY}-{YY}-{NNNNN}
 * Example: STR-JMRH-MED-FY2026-27-00001
 *
 * Sequence is per-FY across all categories (pool of stores drafts in that FY).
 */
export async function generateStoreAssetId(
  categoryId?: number | null,
  tx?: any,
): Promise<string> {
  const db = tx || prisma;
  const org = getOrgCode();
  const catCode = await resolveCategoryCode(categoryId ?? null, db);
  const fyStr = getFYString();

  const prefix = catCode
    ? `STR-${org}-${catCode}-${fyStr}-`
    : `STR-${org}-${fyStr}-`;

  const existing = await db.asset.findMany({
    where: { storeAssetId: { startsWith: prefix } },
    select: { storeAssetId: true },
  });

  let maxSeq = 0;
  for (const row of existing) {
    if (!row.storeAssetId) continue;
    const seqStr = row.storeAssetId.slice(prefix.length);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return `${prefix}${(maxSeq + 1).toString().padStart(5, "0")}`;
}

export { getFYString, getHospitalCode, getOrgCode, getPrefix };

import prisma from "../prismaClient";

/**
 * Generates a standardized Asset ID in the format:
 * AST-{ORG_CODE}-{PROC}-FY{YYYY}-{YY}-{NNNNN}
 *
 * Example: AST-SA-PUR-FY2026-27-00001  (Purchase)
 *          AST-SA-DON-FY2026-27-00001  (Donation)
 *          AST-SA-LES-FY2026-27-00001  (Lease)
 *          AST-SA-RNT-FY2026-27-00001  (Rental)
 *          AST-SA-GRT-FY2026-27-00001  (Grant)
 *
 * For sub-assets: {PARENT_ASSET_ID}-{NNN}
 * Example: AST-SA-PUR-FY2026-27-00001-001
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

/** @deprecated kept for backward compatibility — prefer generateAssetId(mode, tx) */
function getHospitalCode(): string {
  return getOrgCode();
}

function getPrefix(modeOfProcurement?: string): string {
  const procCode = PROC_CODE[(modeOfProcurement || "PURCHASE").toUpperCase()] ?? "PUR";
  return `AST-${getOrgCode()}-${procCode}-${getFYString()}-`;
}

/**
 * Generate the next asset ID for a top-level asset.
 * Format: AST-{ORG_CODE}-{PROC}-FY{YYYY}-{YY}-{NNNNN}
 */
export async function generateAssetId(modeOfProcurement?: string, tx?: any): Promise<string> {
  const prefix = getPrefix(modeOfProcurement);
  const db = tx || prisma;

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
 * Generate a legacy asset ID using the purchase-year FY + L marker.
 * Format: AST-{HOSPITAL_CODE}-FY{YYYY}-{YY}-L-{NNNNN}
 * Example: AST-JMRH-FY2021-22-L-00001
 *
 * Uses a separate counter per FY so it never clashes with live IDs.
 */
export async function generateLegacyAssetId(purchaseDate: Date | string | null, tx?: any): Promise<string> {
  const db = tx || prisma;
  const hospitalCode = getHospitalCode();

  // If no purchaseDate, fall back to current FY with L marker
  const refDate = purchaseDate ? new Date(purchaseDate) : new Date();
  const fyStr = getFYStringFromDate(refDate);

  const prefix = `AST-${hospitalCode}-${fyStr}-L-`;

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

export { getFYString, getHospitalCode, getOrgCode, getPrefix };

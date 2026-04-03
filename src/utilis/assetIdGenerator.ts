import prisma from "../prismaClient";

/**
 * Generates a standardized Asset ID in the format:
 * AST-{HOSPITAL_CODE}-FY{YYYY}-{YY}-{NNNNN}
 *
 * Example: AST-HC-FY2026-27-00001
 *
 * For sub-assets: {PARENT_ASSET_ID}-{NNN}
 * Example: AST-HC-FY2026-27-00001-001
 */

function getFYString(): string {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEnd = fyStart + 1;
  return `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
}

function getHospitalCode(): string {
  return process.env.HOSPITAL_CODE || "SA";
}

function getPrefix(): string {
  return `AST-${getHospitalCode()}-${getFYString()}-`;
}

/**
 * Generate the next asset ID for a top-level asset.
 * Format: AST-{HOSPITAL_CODE}-FY{YYYY}-{YY}-{NNNNN}
 */
export async function generateAssetId(tx?: any): Promise<string> {
  const prefix = getPrefix();
  const db = tx || prisma;

  const existing = await db.asset.findMany({
    where: { assetId: { startsWith: prefix }, parentAssetId: null },
    select: { assetId: true },
  });

  let maxSeq = 0;
  for (const row of existing) {
    // Extract the sequence number (last segment after the prefix)
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

export { getFYString, getHospitalCode, getPrefix };

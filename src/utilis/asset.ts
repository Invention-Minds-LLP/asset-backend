import prisma from "../prismaClient";

export async function requireAssetByAssetId(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { assetId } });
  if (!asset) throw new Error("Asset not found");
  return asset; // asset.id is the FK value
}
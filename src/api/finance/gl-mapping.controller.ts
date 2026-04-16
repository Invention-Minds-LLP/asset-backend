import { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

const prisma = new PrismaClient();

const include = {
  assetCategory: true,
  fixedAssetAccount: true,
  accDepAccount: true,
  depExpenseAccount: true,
  disposalAccount: true,
  maintenanceAccount: true,
  insuranceAccount: true,
};

// GET /api/finance/gl-mappings
export async function getGLMappings(req: AuthenticatedRequest, res: Response) {
  try {
    const mappings = await prisma.assetGLMapping.findMany({ include });
    res.json(mappings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load GL mappings" });
  }
}

// GET /api/finance/gl-mappings/:categoryId
export async function getGLMappingByCategory(req: AuthenticatedRequest, res: Response) {
  const categoryId = Number(req.params.categoryId);
  try {
    const mapping = await prisma.assetGLMapping.findUnique({ where: { assetCategoryId: categoryId }, include });
    res.json(mapping || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load GL mapping" });
  }
}

// PUT /api/finance/gl-mappings/:categoryId  (upsert)
export async function upsertGLMapping(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE") {
    res.status(403).json({ error: "FINANCE role required" }); return;
  }
  const categoryId = Number(req.params.categoryId);
  const { fixedAssetAccountId, accDepAccountId, depExpenseAccountId, disposalAccountId, maintenanceAccountId, insuranceAccountId } = req.body;
  try {
    const data = {
      fixedAssetAccountId: fixedAssetAccountId || null,
      accDepAccountId: accDepAccountId || null,
      depExpenseAccountId: depExpenseAccountId || null,
      disposalAccountId: disposalAccountId || null,
      maintenanceAccountId: maintenanceAccountId || null,
      insuranceAccountId: insuranceAccountId || null,
    };
    const mapping = await prisma.assetGLMapping.upsert({
      where: { assetCategoryId: categoryId },
      create: { assetCategoryId: categoryId, ...data },
      update: data,
      include,
    });
    res.json(mapping);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save GL mapping" });
  }
}

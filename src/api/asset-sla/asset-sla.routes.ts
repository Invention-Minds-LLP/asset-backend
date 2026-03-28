import { Router } from "express";
import {
  createAssetSlaMatrix,
  getAllAssetSlaMatrix,
  getAssetSlaMatrixByCategory,
  getAssetSlaMatrixByCategoryAndSla,
  updateAssetSlaMatrix,
  deleteAssetSlaMatrix
} from "./asset-sla.controller";

const router = Router();

router.get("/", getAllAssetSlaMatrix);
router.post("/", createAssetSlaMatrix);
router.get("/category/:assetCategoryId", getAssetSlaMatrixByCategory);
router.get("/category/:assetCategoryId/sla/:slaCategory", getAssetSlaMatrixByCategoryAndSla);
router.put("/:id", updateAssetSlaMatrix);
router.delete("/:id", deleteAssetSlaMatrix);

export default router;
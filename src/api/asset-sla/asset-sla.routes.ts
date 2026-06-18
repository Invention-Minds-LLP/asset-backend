import { Router } from "express";
import {
  createAssetSlaMatrix,
  getAllAssetSlaMatrix,
  getAssetSlaMatrixByCategory,
  getAssetSlaMatrixByCategoryAndSla,
  updateAssetSlaMatrix,
  deleteAssetSlaMatrix
} from "./asset-sla.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getAllAssetSlaMatrix);
router.post("/", authenticateToken, createAssetSlaMatrix);
router.get("/category/:assetCategoryId", authenticateToken, getAssetSlaMatrixByCategory);
router.get("/category/:assetCategoryId/sla/:slaCategory", authenticateToken, getAssetSlaMatrixByCategoryAndSla);
router.put("/:id", authenticateToken, updateAssetSlaMatrix);
router.delete("/:id", authenticateToken, deleteAssetSlaMatrix);

export default router;
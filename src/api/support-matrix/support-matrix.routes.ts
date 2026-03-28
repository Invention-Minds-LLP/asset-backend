import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createSupportMatrixEntry,
  getAllSupportMatrix,
  getSupportMatrixByAsset,
  getSupportMatrixByCategory,
  updateSupportMatrixEntry,
  deleteSupportMatrixEntry,
  bulkUpsertSupportMatrix,
} from "./support-matrix.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllSupportMatrix);
router.post("/", authenticateToken, createSupportMatrixEntry);
router.post("/bulk", authenticateToken, bulkUpsertSupportMatrix);
router.get("/asset/:assetId", authenticateToken, getSupportMatrixByAsset);
router.get("/category/:assetCategoryId", authenticateToken, getSupportMatrixByCategory);
router.put("/:id", authenticateToken, updateSupportMatrixEntry);
router.delete("/:id", authenticateToken, deleteSupportMatrixEntry);

export default router;

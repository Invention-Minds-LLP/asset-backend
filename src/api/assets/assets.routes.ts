import express from "express";
import { getAllAssets, getAssetById, createAsset, updateAsset, deleteAsset, getAssetByAssetId, uploadAssetImage } from "./assets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllAssets);
router.get('/:assetId', authenticateToken, getAssetByAssetId);
router.get("/:id",authenticateToken, getAssetById);
router.post("/",authenticateToken, createAsset);
router.put("/:id",authenticateToken, updateAsset);
router.delete("/:id",authenticateToken, deleteAsset);
router.post('/:assetId/upload-image', uploadAssetImage);

export default router;

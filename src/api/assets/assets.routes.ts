import express from "express";
import { getAllAssets, getAssetById, createAsset, updateAsset, deleteAsset, getAssetByAssetId, uploadAssetImage, updateAssetAssignment, getAssetSpecifications, createAssetSpecification, updateAssetSpecification, getAssetScanDetails } from "./assets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllAssets);
router.get('/:assetId', authenticateToken, getAssetByAssetId);
router.patch("/:id/assignment", authenticateToken, updateAssetAssignment);

router.get("/scan/:assetId", getAssetScanDetails);

router.get("/:id",authenticateToken, getAssetById);
router.post("/",authenticateToken, createAsset);
router.put("/:id",authenticateToken, updateAsset);
router.delete("/:id",authenticateToken, deleteAsset);
router.post('/:assetId/upload-image', uploadAssetImage);
router.get('/:assetId/specifications', getAssetSpecifications);
router.post('/specifications', createAssetSpecification);
router.put('/specifications/:id', updateAssetSpecification);

export default router;

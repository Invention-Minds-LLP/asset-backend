import express from "express";
import { getAllAssets, getAllAssetsForDropdown, getAssetById, createAsset, updateAsset, deleteAsset, getAssetByAssetId, uploadAssetImage, updateAssetAssignment, getAssetSpecifications, createAssetSpecification, updateAssetSpecification, getAssetScanDetails, hodApproveAsset } from "./assets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllAssets);
router.get("/all-dropdown", authenticateToken, getAllAssetsForDropdown);
router.get('/:assetId', authenticateToken, getAssetByAssetId);
router.patch("/:id/assignment", authenticateToken, updateAssetAssignment);

router.get("/scan/:assetId", getAssetScanDetails);

router.get("/:id",authenticateToken, getAssetById);
router.post("/",authenticateToken, createAsset);
router.put("/:id",authenticateToken, updateAsset);
router.delete("/:id",authenticateToken, deleteAsset);
router.post('/:assetId/upload-image', uploadAssetImage);
router.post('/:id/hod-approval', authenticateToken, hodApproveAsset);
router.get('/:assetId/specifications', getAssetSpecifications);
router.post('/specifications', createAssetSpecification);
router.put('/specifications/:id', updateAssetSpecification);

export default router;

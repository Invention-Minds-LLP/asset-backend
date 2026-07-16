import express from "express";
import { getAllAssets, getAllAssetsForDropdown, getAssetsPaginated, getAssetById, createAsset, updateAsset, deleteAsset, getAssetByAssetId, uploadAssetImage, updateAssetAssignment, getAssetSpecifications, createAssetSpecification, updateAssetSpecification, getAssetScanSummary, getAssetScanDetails, hodApproveAsset, updateAssetMakeModel, getAssetSupervisors, setAssetSupervisors } from "./assets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllAssets);
router.get("/all-dropdown", authenticateToken, getAllAssetsForDropdown);
router.get("/paginated", authenticateToken, getAssetsPaginated);
router.get('/:assetId', authenticateToken, getAssetByAssetId);
router.patch("/:id/assignment", authenticateToken, updateAssetAssignment);

// Public: name + code only, shown on the QR scan landing before login.
router.get("/scan/:assetId/summary", getAssetScanSummary);
// Full details require login.
router.get("/scan/:assetId", authenticateToken, getAssetScanDetails);

router.get("/:id",authenticateToken, getAssetById);
router.post("/",authenticateToken, createAsset);
router.put("/:id",authenticateToken, updateAsset);
router.patch("/:id/make-model", authenticateToken, updateAssetMakeModel);
router.delete("/:id",authenticateToken, deleteAsset);
router.post('/:assetId/upload-image', authenticateToken, uploadAssetImage);
router.post('/:id/hod-approval', authenticateToken, hodApproveAsset);
router.get('/:id/supervisors', authenticateToken, getAssetSupervisors);
router.put('/:id/supervisors', authenticateToken, setAssetSupervisors);
router.get('/:assetId/specifications', authenticateToken, getAssetSpecifications);
router.post('/specifications', authenticateToken, createAssetSpecification);
router.put('/specifications/:id', authenticateToken, updateAssetSpecification);

export default router;

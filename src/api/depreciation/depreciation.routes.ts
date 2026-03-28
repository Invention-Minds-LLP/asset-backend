import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();
import {
    addDepreciation,
    updateDepreciation,
    runDepreciationForAsset,
    calculateDepreciation,
    batchDepreciationPreview,
    runBatchDepreciation,
    getAllDepreciations,
    getDepreciationLogs,
} from "./depreciation.controller";

// Standalone depreciation management page
router.get("/all", authenticateToken, getAllDepreciations);
router.get("/logs", authenticateToken, getDepreciationLogs);
router.get("/batch-preview", authenticateToken, batchDepreciationPreview);
router.post("/batch-run", authenticateToken, runBatchDepreciation);

router.post("/assets/:assetId/depreciation", authenticateToken, addDepreciation);
router.put("/depreciation/:id", authenticateToken, updateDepreciation);

router.get("/assets/:assetId/depreciation/calc", authenticateToken, calculateDepreciation);

router.post("/depreciation/run-batch", authenticateToken, runDepreciationForAsset);

export default router;

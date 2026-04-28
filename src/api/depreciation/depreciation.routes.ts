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
    getBatchRuns,
    approveBatchRun,
    rejectBatchRun,
    getAllDepreciations,
    getDepreciationLogs,
    runAssetDepreciation,
    getDepreciableAssets,
    getDepreciationSchedule,
    getRoundOffImpact,
    backfillDepreciationLogs,
} from "./depreciation.controller";

// Standalone depreciation management page
router.get("/all", authenticateToken, getAllDepreciations);
router.get("/logs", authenticateToken, getDepreciationLogs);
router.get("/batch-preview", authenticateToken, batchDepreciationPreview);
router.post("/batch-run", authenticateToken, runBatchDepreciation);
router.get("/batch-runs", authenticateToken, getBatchRuns);
router.post("/batch-runs/:runId/approve", authenticateToken, approveBatchRun);
router.post("/batch-runs/:runId/reject", authenticateToken, rejectBatchRun);

// Per-asset and filtered runs
router.get("/depreciable-assets", authenticateToken, getDepreciableAssets);
router.get("/roundoff-impact", authenticateToken, getRoundOffImpact);
router.get("/schedule/:assetId", authenticateToken, getDepreciationSchedule);
router.post("/asset-run", authenticateToken, runAssetDepreciation);

router.post("/assets/:assetId/depreciation", authenticateToken, addDepreciation);
router.put("/depreciation/:id", authenticateToken, updateDepreciation);

router.get("/assets/:assetId/depreciation/calc", authenticateToken, calculateDepreciation);

router.post("/depreciation/run-batch", authenticateToken, runDepreciationForAsset);

// Backfill historical depreciation logs for existing assets
router.post("/backfill-logs", authenticateToken, backfillDepreciationLogs);

export default router;

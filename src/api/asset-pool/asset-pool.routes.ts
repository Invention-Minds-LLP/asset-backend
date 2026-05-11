import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { excelUpload, handleUploadError } from "../../utilis/excelImportHelpers";
import {
    listPools, createPool, getPool, updatePool,
    addAdjustment, getPoolSummary,
    addDepreciationSchedule, listDepreciationSchedules,
    getProportionalDep, getPoolActivity,
    downloadFaRegisterTemplate, importFaRegister,
    downloadIndividualAssetsTemplate, importIndividualAssets,
    resetAllPools,
} from "./asset-pool.controller";

const router = Router();

router.get("/summary", authenticateToken, getPoolSummary);
router.get("/fa-register-template", authenticateToken, downloadFaRegisterTemplate);
router.post("/import-fa-register", authenticateToken, excelUpload.single("file"), handleUploadError, importFaRegister);
router.get("/individual-assets-template", authenticateToken, downloadIndividualAssetsTemplate);
router.post("/import-individual-assets", authenticateToken, excelUpload.single("file"), handleUploadError, importIndividualAssets);
router.delete("/reset", authenticateToken, resetAllPools);
router.get("/", authenticateToken, listPools);
router.post("/", authenticateToken, createPool);
router.get("/:id", authenticateToken, getPool);
router.put("/:id", authenticateToken, updatePool);
router.post("/:id/adjustment", authenticateToken, addAdjustment);
router.get("/:id/depreciation-schedule", authenticateToken, listDepreciationSchedules);
router.post("/:id/depreciation-schedule", authenticateToken, addDepreciationSchedule);
router.get("/:id/proportional-dep", authenticateToken, getProportionalDep);
router.get("/:id/activity", authenticateToken, getPoolActivity);

export default router;

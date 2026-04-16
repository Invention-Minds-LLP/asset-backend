import { Router } from "express";
import multer from "multer";
import { authenticateToken } from "../../middleware/authMiddleware";
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
const upload = multer({ dest: "uploads/" });

router.get("/summary", authenticateToken, getPoolSummary);
router.get("/fa-register-template", authenticateToken, downloadFaRegisterTemplate);
router.post("/import-fa-register", authenticateToken, upload.single("file"), importFaRegister);
router.get("/individual-assets-template", authenticateToken, downloadIndividualAssetsTemplate);
router.post("/import-individual-assets", authenticateToken, upload.single("file"), importIndividualAssets);
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

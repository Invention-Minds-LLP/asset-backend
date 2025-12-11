import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();
import {
    addDepreciation,
    updateDepreciation,
    calculateDepreciation,
    runAnnualDepreciation
} from "./depreciation.controller";

router.post("/assets/:assetId/depreciation", authenticateToken, addDepreciation);
router.put("/depreciation/:id", authenticateToken, updateDepreciation);

router.get("/assets/:assetId/depreciation/calc", authenticateToken, calculateDepreciation);

router.post("/depreciation/run-batch", authenticateToken, runAnnualDepreciation);

export default router;

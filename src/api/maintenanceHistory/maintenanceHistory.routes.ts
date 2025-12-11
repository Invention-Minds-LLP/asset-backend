import express from "express";
import { getMaintenanceHistory, createMaintenanceRecord, uploadMaintenanceReport } from "./maintenanceHistory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getMaintenanceHistory);
router.post("/",authenticateToken, createMaintenanceRecord);
router.post("/upload-report", authenticateToken, uploadMaintenanceReport);
router.get("/:assetId", authenticateToken, getMaintenanceHistory)

export default router;

import express from "express";
import {
  getMaintenanceHistory,
  createMaintenanceRecord,
  uploadMaintenanceReport,
  getMaintenanceHistoryByAsset,
} from "./maintenanceHistory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getMaintenanceHistory);
router.post("/", authenticateToken, createMaintenanceRecord);
router.post("/upload-report", authenticateToken, uploadMaintenanceReport);

// ✅ this should call getMaintenanceHistoryByAsset (your old router called getMaintenanceHistory by mistake)
router.get("/:assetId", authenticateToken, getMaintenanceHistoryByAsset);

export default router;
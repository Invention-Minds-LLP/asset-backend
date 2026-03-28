import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createCalibrationSchedule,
  getAllCalibrationSchedules,
  getCalibrationSchedulesByAsset,
  updateCalibrationSchedule,
  deleteCalibrationSchedule,
  getDueCalibrations,
  logCalibrationHistory,
  getCalibrationHistoryByAsset,
  createCalibrationTemplate,
  getAllCalibrationTemplates,
  addCalibrationTemplateItems,
  updateCalibrationTemplate,
  deleteCalibrationTemplate,
} from "./calibration.controller";

const router = express.Router();

// ── Schedules ──────────────────────────────────────────────────────────────────
router.get("/schedules", authenticateToken, getAllCalibrationSchedules);
router.post("/schedules", authenticateToken, createCalibrationSchedule);
router.get("/schedules/due", authenticateToken, getDueCalibrations);
router.get("/schedules/asset/:assetId", authenticateToken, getCalibrationSchedulesByAsset);
router.put("/schedules/:id", authenticateToken, updateCalibrationSchedule);
router.delete("/schedules/:id", authenticateToken, deleteCalibrationSchedule);

// ── History ────────────────────────────────────────────────────────────────────
router.post("/history", authenticateToken, logCalibrationHistory);
router.get("/history/asset/:assetId", authenticateToken, getCalibrationHistoryByAsset);

// ── Checklist Templates ────────────────────────────────────────────────────────
router.get("/templates", authenticateToken, getAllCalibrationTemplates);
router.post("/templates", authenticateToken, createCalibrationTemplate);
router.put("/templates/:id", authenticateToken, updateCalibrationTemplate);
router.delete("/templates/:id", authenticateToken, deleteCalibrationTemplate);
router.post("/templates/:templateId/items", authenticateToken, addCalibrationTemplateItems);

export default router;

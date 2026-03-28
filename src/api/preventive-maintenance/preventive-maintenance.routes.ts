import express from "express";
import {
  createSchedule,
  getAllSchedules,
  getDueSchedules,
  executeMaintenance,
  getHistoryByAsset,
  getServiceContract,
  triggerPMNotifications,
  getCalendarView,
  rescheduleMaintenance,
  updateSchedule,
  getAllMaintenanceHistory,
} from "./preventive-maintenance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

// Calendar view
router.get("/calendar", authenticateToken, getCalendarView);

// All maintenance history (paginated + CSV)
router.get("/history/all", authenticateToken, getAllMaintenanceHistory);

// Schedule
router.post("/schedule", authenticateToken, createSchedule);
router.get("/schedule", authenticateToken, getAllSchedules);
router.get("/schedule/due", authenticateToken, getDueSchedules);
router.put("/schedule/:id", authenticateToken, updateSchedule);
router.put("/schedule/:id/reschedule", authenticateToken, rescheduleMaintenance);

// Execute PM
router.post("/execute", authenticateToken, executeMaintenance);

// History
router.get("/history/:assetId", authenticateToken, getHistoryByAsset);

// AMC / CMC
router.get("/contract/:assetId", authenticateToken, getServiceContract);

// Notifications (cron/manual)
router.post("/notify", authenticateToken, triggerPMNotifications);

export default router;
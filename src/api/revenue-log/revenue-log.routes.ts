import express from "express";
import {
  getRateCard,
  upsertRateCard,
  getDailyLogs,
  upsertDailyLog,
  deleteDailyLog,
  verifyDailyLog,
  getUtilizationSummary,
  getOeeDetail,
  getRevenueSummary,
  getUtilizationDashboard,
  getMissingLogs,
  getDowntimeAnalysis,
  getLeaderboard,
  getShiftAnalysis,
  getCalibrationInfo,
} from "./revenue-log.controller";
import { authenticateToken, requireRole } from "../../middleware/authMiddleware";

const router = express.Router();

const requireRateCardAdmin = requireRole("ADMIN", "OPERATIONS", "FINANCE");
const requireLogAdmin = requireRole("ADMIN", "OPERATIONS");
// Verify: role check lives in the controller (supervisors may be identified by Employee.role).

// ── Static routes (BEFORE parameterized routes) ─────────────────────────────
router.get("/dashboard", authenticateToken, getUtilizationDashboard);
router.get("/missing-logs", authenticateToken, getMissingLogs);
router.get("/leaderboard", authenticateToken, getLeaderboard);

// ── Rate Card ───────────────────────────────────────────────────────────────
router.get("/rate-card/:assetId", authenticateToken, getRateCard);
router.post("/rate-card/:assetId", authenticateToken, requireRateCardAdmin, upsertRateCard);

// ── Daily Usage Logs ────────────────────────────────────────────────────────
router.get("/daily/:assetId", authenticateToken, getDailyLogs);
router.post("/daily/:assetId", authenticateToken, upsertDailyLog);
router.delete("/daily/:logId", authenticateToken, requireLogAdmin, deleteDailyLog);
router.patch("/daily/:logId/verify", authenticateToken, verifyDailyLog);

// ── Analytics (parameterized) ───────────────────────────────────────────────
router.get("/utilization/:assetId", authenticateToken, getUtilizationSummary);
router.get("/oee/:assetId", authenticateToken, getOeeDetail);
router.get("/revenue-summary/:assetId", authenticateToken, getRevenueSummary);
router.get("/downtime-analysis/:assetId", authenticateToken, getDowntimeAnalysis);
router.get("/shift-analysis/:assetId", authenticateToken, getShiftAnalysis);
router.get("/calibration-info/:assetId", authenticateToken, getCalibrationInfo);

export default router;

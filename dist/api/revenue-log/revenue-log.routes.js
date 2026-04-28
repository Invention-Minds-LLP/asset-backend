"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const revenue_log_controller_1 = require("./revenue-log.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
// ── Static routes (BEFORE parameterized routes) ─────────────────────────────
router.get("/dashboard", authMiddleware_1.authenticateToken, revenue_log_controller_1.getUtilizationDashboard);
router.get("/missing-logs", authMiddleware_1.authenticateToken, revenue_log_controller_1.getMissingLogs);
router.get("/leaderboard", authMiddleware_1.authenticateToken, revenue_log_controller_1.getLeaderboard);
// ── Rate Card ───────────────────────────────────────────────────────────────
router.get("/rate-card/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getRateCard);
router.post("/rate-card/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.upsertRateCard);
// ── Daily Usage Logs ────────────────────────────────────────────────────────
router.get("/daily/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getDailyLogs);
router.post("/daily/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.upsertDailyLog);
router.delete("/daily/:logId", authMiddleware_1.authenticateToken, revenue_log_controller_1.deleteDailyLog);
router.patch("/daily/:logId/verify", authMiddleware_1.authenticateToken, revenue_log_controller_1.verifyDailyLog);
// ── Analytics (parameterized) ───────────────────────────────────────────────
router.get("/utilization/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getUtilizationSummary);
router.get("/oee/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getOeeDetail);
router.get("/revenue-summary/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getRevenueSummary);
router.get("/downtime-analysis/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getDowntimeAnalysis);
router.get("/shift-analysis/:assetId", authMiddleware_1.authenticateToken, revenue_log_controller_1.getShiftAnalysis);
exports.default = router;

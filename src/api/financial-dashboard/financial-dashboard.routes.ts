import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getFilterOptions,
  getFinancialSummary,
  getFYBreakdown,
  getMonthlyAssets,
  getCostTrend,
} from "./financial-dashboard.controller";

const router = Router();

router.get("/filters", authenticateToken, getFilterOptions);
router.get("/summary", authenticateToken, getFinancialSummary);
router.get("/fy-breakdown", authenticateToken, getFYBreakdown);
router.get("/monthly-assets", authenticateToken, getMonthlyAssets);
router.get("/cost-trend", authenticateToken, getCostTrend);

export default router;

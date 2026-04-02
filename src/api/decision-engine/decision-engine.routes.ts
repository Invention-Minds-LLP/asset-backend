import express from "express";
import {
  evaluateSingleAsset,
  evaluateAllAssets,
  getAssetHistory,
  getConfigs,
  upsertConfig,
  getDashboardSummary,
} from "./decision-engine.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

// Dashboard KPI summary
router.get("/dashboard-summary", authenticateToken, getDashboardSummary);

// Bulk evaluate all active assets
router.get("/evaluate-all", authenticateToken, evaluateAllAssets);

// Evaluate a single asset
router.get("/evaluate/:id", authenticateToken, evaluateSingleAsset);

// Evaluation history for an asset
router.get("/history/:assetId", authenticateToken, getAssetHistory);

// Config CRUD
router.get("/config", authenticateToken, getConfigs);
router.post("/config", authenticateToken, upsertConfig);

export default router;

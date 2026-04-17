import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getDashboardStats,
  getLookupData,
  getAssetLifecycleSummary,
  getExpiryAlerts,
} from "./master.controller";
import { resetAllAssets } from "./reset-assets";

const router = express.Router();

// Dashboard – aggregated stats (role-filtered)
router.get("/dashboard", authenticateToken, getDashboardStats);

// Lookup – all master data for dropdowns/selects (public within auth)
router.get("/lookup", authenticateToken, getLookupData);

// Asset lifecycle – full 360° view of a single asset
router.get("/asset-lifecycle/:assetId", authenticateToken, getAssetLifecycleSummary);

// Expiry alerts – warranties/insurance/contracts/calibrations due within N days
router.get("/expiry-alerts", authenticateToken, getExpiryAlerts);

// Reset – delete all asset data and reset auto-increment (dev/staging only)
router.delete("/reset-assets", authenticateToken, resetAllAssets);

export default router;

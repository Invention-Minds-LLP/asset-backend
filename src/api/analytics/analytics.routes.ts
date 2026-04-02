import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAssetTCO,
  getAssetTurnover,
  getCfoDashboard,
  getCooDashboard,
  getIdleCapitalAnalysis,
  getInStoreAging,
  getUncoveredAssets,
} from "./analytics.controller";

const router = Router();

router.get("/tco", authenticateToken, getAssetTCO);
router.get("/asset-turnover", authenticateToken, getAssetTurnover);
router.get("/cfo-dashboard", authenticateToken, getCfoDashboard);
router.get("/coo-dashboard", authenticateToken, getCooDashboard);
router.get("/idle-capital", authenticateToken, getIdleCapitalAnalysis);
router.get("/in-store-aging", authenticateToken, getInStoreAging);
router.get("/uncovered-assets", authenticateToken, getUncoveredAssets);

export default router;

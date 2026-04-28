import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAssetRegisterReport,
  getMaintenanceCostReport,
  getTicketAnalyticsReport,
  getExpiryReport,
  getDepreciationReport,
  getInventoryStockReport,
  getFixedAssetsSchedule,
  getCategoryAssetDetail,
  getConsolidatedAssetReport,
} from "./reports.controller";

const router = Router();

router.get("/asset-register", authenticateToken, getAssetRegisterReport);
router.get("/maintenance-cost", authenticateToken, getMaintenanceCostReport);
router.get("/ticket-analytics", authenticateToken, getTicketAnalyticsReport);
router.get("/expiry", authenticateToken, getExpiryReport);
router.get("/depreciation", authenticateToken, getDepreciationReport);
router.get("/inventory-stock", authenticateToken, getInventoryStockReport);
router.get("/fixed-assets-schedule", authenticateToken, getFixedAssetsSchedule);
router.get("/fixed-assets-schedule/category-detail", authenticateToken, getCategoryAssetDetail);
router.get("/consolidated", authenticateToken, getConsolidatedAssetReport);

export default router;

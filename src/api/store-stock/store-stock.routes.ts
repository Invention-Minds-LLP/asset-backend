import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getStockByStore,
  getStockSummary,
  getLowStockAlerts,
  adjustStock,
  getStockMovements,
} from "./store-stock.controller";

const router = Router();

// Static routes must come before parameterized routes
router.get("/summary/all", authenticateToken, getStockSummary);
router.get("/alerts/low-stock", authenticateToken, getLowStockAlerts);

router.get("/:storeId", authenticateToken, getStockByStore);
router.post("/:storeId/adjust", authenticateToken, adjustStock);
router.get("/:storeId/movements", authenticateToken, getStockMovements);

export default router;

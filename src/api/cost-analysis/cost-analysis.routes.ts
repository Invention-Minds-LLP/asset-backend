import express from "express";
import {
  getAssetCostAnalysis,
  getDepreciationAlerts,
  getRevenueEntries,
  addRevenueEntry,
  deleteRevenueEntry,
} from "./cost-analysis.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/alerts", authenticateToken, getDepreciationAlerts);
router.get("/:id", authenticateToken, getAssetCostAnalysis);
router.get("/:id/revenue", authenticateToken, getRevenueEntries);
router.post("/:id/revenue", authenticateToken, addRevenueEntry);
router.delete("/revenue/:entryId", authenticateToken, deleteRevenueEntry);

export default router;

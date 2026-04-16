import express from "express";
import {
  getAssetCostAnalysis,
  getDepreciationAlerts,
  getRevenueEntries,
  addRevenueEntry,
  deleteRevenueEntry,
  getAllocations,
  addAllocation,
  updateAllocation,
  deleteAllocation,
} from "./cost-analysis.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/alerts", authenticateToken, getDepreciationAlerts);
router.get("/:id", authenticateToken, getAssetCostAnalysis);
router.get("/:id/revenue", authenticateToken, getRevenueEntries);
router.post("/:id/revenue", authenticateToken, addRevenueEntry);
router.delete("/revenue/:entryId", authenticateToken, deleteRevenueEntry);
router.get("/:id/allocations", authenticateToken, getAllocations);
router.post("/:id/allocations", authenticateToken, addAllocation);
router.put("/allocations/:entryId", authenticateToken, updateAllocation);
router.delete("/allocations/:entryId", authenticateToken, deleteAllocation);

export default router;

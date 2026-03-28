import express from "express";
import {
  getAllWarranties,
  getWarrantyById,
  createWarranty,
  updateWarranty,
  deleteWarranty,
  getWarrantyByAssetId,
  renewWarranty,
  getWarrantyHistoryByAssetId,
  getWarrantyStats,
} from "./warranty.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllWarranties);
router.get("/stats", authenticateToken, getWarrantyStats);
router.get("/by-asset/:assetId", authenticateToken, getWarrantyByAssetId);
router.get("/:id",authenticateToken, getWarrantyById);
router.post("/",authenticateToken, createWarranty);
router.put("/:id",authenticateToken, updateWarranty);
router.delete("/:id",authenticateToken, deleteWarranty);
router.post("/:assetId/renew", renewWarranty);
router.get("/:assetId/history", getWarrantyHistoryByAssetId);



export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createGatePass,
  getAllGatePasses,
  getGatePassById,
  updateGatePass,
  updateGatePassStatus,
  deleteGatePass,
  getGatePassesByAsset,
  getOverdueGatePasses,
} from "./gate-pass.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllGatePasses);
router.post("/", authenticateToken, createGatePass);
router.get("/overdue", authenticateToken, getOverdueGatePasses);
router.get("/asset/:assetId", authenticateToken, getGatePassesByAsset);
router.get("/:id", authenticateToken, getGatePassById);
router.put("/:id", authenticateToken, updateGatePass);
router.patch("/:id/status", authenticateToken, updateGatePassStatus);
router.delete("/:id", authenticateToken, deleteGatePass);

export default router;

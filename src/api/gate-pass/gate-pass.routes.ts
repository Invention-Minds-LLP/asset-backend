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
  getPendingApproval,
  getSecurityQueue,
  submitForApproval,
  approveGatePass,
  rejectGatePass,
  gateOutGatePass,
  gateInGatePass,
  downloadGatePassPdf,
} from "./gate-pass.controller";

const router = express.Router();

// Lists / inboxes (specific routes first to avoid /:id collisions)
router.get("/", authenticateToken, getAllGatePasses);
router.get("/overdue", authenticateToken, getOverdueGatePasses);
router.get("/pending-approval", authenticateToken, getPendingApproval);
router.get("/security-queue", authenticateToken, getSecurityQueue);
router.get("/asset/:assetId", authenticateToken, getGatePassesByAsset);

// Single record
router.get("/:id", authenticateToken, getGatePassById);
router.get("/:id/pdf", authenticateToken, downloadGatePassPdf);

// Create + edit
router.post("/", authenticateToken, createGatePass);
router.put("/:id", authenticateToken, updateGatePass);
router.delete("/:id", authenticateToken, deleteGatePass);

// Lifecycle transitions
router.post("/:id/submit", authenticateToken, submitForApproval);
router.post("/:id/approve", authenticateToken, approveGatePass);
router.post("/:id/reject", authenticateToken, rejectGatePass);
router.post("/:id/gate-out", authenticateToken, gateOutGatePass);
router.post("/:id/gate-in", authenticateToken, gateInGatePass);

// Generic close/cancel
router.patch("/:id/status", authenticateToken, updateGatePassStatus);

export default router;

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
  securityClearGatePass,
  gateOutGatePass,
  gateInGatePass,
  downloadGatePassPdf,
  downloadGatePassLabel,
  getSecurityHistory,
  getLabelQueue,
  getGatePassByNo,
} from "./gate-pass.controller";
import { denySecurityApproval, requireSecuritySupervisor } from "./gate-pass.guards";

const router = express.Router();

// Lists / inboxes (specific routes first to avoid /:id collisions)
router.get("/", authenticateToken, getAllGatePasses);
router.get("/overdue", authenticateToken, getOverdueGatePasses);
router.get("/pending-approval", authenticateToken, getPendingApproval);
router.get("/security-queue", authenticateToken, requireSecuritySupervisor, getSecurityQueue);
router.get("/security-history", authenticateToken, requireSecuritySupervisor, getSecurityHistory);
router.get("/label-queue", authenticateToken, getLabelQueue);
router.get("/asset/:assetId", authenticateToken, getGatePassesByAsset);
// QR deep-link target + the scan screen's paste box. Open to any authenticated
// user, including security executives — scanning is how they identify a parcel.
router.get("/scan/:gatePassNo", authenticateToken, getGatePassByNo);

// Single record
router.get("/:id", authenticateToken, getGatePassById);
router.get("/:id/pdf", authenticateToken, downloadGatePassPdf);
// Label print is open to both security roles — it's the executive's whole job.
router.get("/:id/label", authenticateToken, downloadGatePassLabel);

// Create + edit
router.post("/", authenticateToken, createGatePass);
router.put("/:id", authenticateToken, updateGatePass);
router.delete("/:id", authenticateToken, deleteGatePass);

// Lifecycle transitions
router.post("/:id/submit", authenticateToken, submitForApproval);
router.post("/:id/approve", authenticateToken, denySecurityApproval, approveGatePass);
router.post("/:id/reject", authenticateToken, denySecurityApproval, rejectGatePass);
// Desk clearance first (items verified, transport recorded), then the parcel
// is labelled, and only then does gate-out record the actual departure.
router.post("/:id/security-clear", authenticateToken, requireSecuritySupervisor, securityClearGatePass);
router.post("/:id/gate-out", authenticateToken, requireSecuritySupervisor, gateOutGatePass);
router.post("/:id/gate-in", authenticateToken, requireSecuritySupervisor, gateInGatePass);

// Generic close/cancel
router.patch("/:id/status", authenticateToken, updateGatePassStatus);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  listRequests,
  getRequest,
  listCandidates,
  previewRequest,
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  retryGlEntry,
} from "./reclassification.controller";

const router = express.Router();

// Roles are checked in the controller: FINANCE/CFO raise, the CFO (not the
// requester) approves or rejects, the requester cancels, Finance/CFO re-try a
// failed GL entry. Reading is limited to FINANCE, CFO and ADMIN.
router.get("/", authenticateToken, listRequests);
router.get("/candidates", authenticateToken, listCandidates);
router.post("/preview", authenticateToken, previewRequest);
router.post("/", authenticateToken, createRequest);
router.get("/:id", authenticateToken, getRequest);
router.post("/:id/approve", authenticateToken, approveRequest);
router.post("/:id/reject", authenticateToken, rejectRequest);
router.post("/:id/cancel", authenticateToken, cancelRequest);
router.post("/:id/post-gl", authenticateToken, retryGlEntry);

export default router;

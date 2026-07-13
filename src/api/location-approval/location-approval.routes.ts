import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  requestLocationChange,
  getPendingApprovals,
  getMyRequests,
  approveLocationChange,
  rejectLocationChange,
} from "./location-approval.controller";

const router = express.Router();

router.post("/request", authenticateToken, requestLocationChange);
router.get("/pending", authenticateToken, getPendingApprovals);
router.get("/my-requests", authenticateToken, getMyRequests);
router.post("/:id/approve", authenticateToken, approveLocationChange);
router.post("/:id/reject", authenticateToken, rejectLocationChange);

export default router;

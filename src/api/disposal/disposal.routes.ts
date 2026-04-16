import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllDisposals,
  getDisposalById,
  requestDisposal,
  reviewDisposal,
  approveDisposal,
  rejectDisposal,
  completeDisposal,
  getDisposalSubAssets,
} from "./disposal.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllDisposals);
router.get("/:id", authenticateToken, getDisposalById);
router.post("/", authenticateToken, requestDisposal);
router.put("/:id/review", authenticateToken, reviewDisposal);
router.put("/:id/approve", authenticateToken, approveDisposal);
router.put("/:id/reject", authenticateToken, rejectDisposal);
router.put("/:id/complete", authenticateToken, completeDisposal);
router.get("/:id/sub-assets", authenticateToken, getDisposalSubAssets);

export default router;

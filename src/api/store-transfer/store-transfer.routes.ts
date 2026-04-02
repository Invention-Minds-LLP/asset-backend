import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllTransfers,
  getTransferById,
  createTransfer,
  approveTransfer,
  markInTransit,
  receiveTransfer,
  cancelTransfer,
} from "./store-transfer.controller";

const router = Router();

router.get("/", authenticateToken, getAllTransfers);
router.post("/", authenticateToken, createTransfer);

router.get("/:id", authenticateToken, getTransferById);

router.patch("/:id/approve", authenticateToken, approveTransfer);
router.patch("/:id/in-transit", authenticateToken, markInTransit);
router.patch("/:id/receive", authenticateToken, receiveTransfer);
router.patch("/:id/cancel", authenticateToken, cancelTransfer);

export default router;

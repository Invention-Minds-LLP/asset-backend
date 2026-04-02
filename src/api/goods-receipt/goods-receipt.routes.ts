import express from "express";
import {
  getAllGoodsReceipts,
  getGoodsReceiptById,
  createGoodsReceipt,
  inspectGRA,
  acceptGRA,
  rejectGRA,
} from "./goods-receipt.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllGoodsReceipts);
router.get("/:id", authenticateToken, getGoodsReceiptById);
router.post("/", authenticateToken, createGoodsReceipt);
router.patch("/:id/inspect", authenticateToken, inspectGRA);
router.patch("/:id/accept", authenticateToken, acceptGRA);
router.patch("/:id/reject", authenticateToken, rejectGRA);

export default router;

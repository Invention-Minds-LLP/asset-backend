import express from "express";
import {
  getAllPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  createPOFromIndent,
  updatePurchaseOrder,
  approvePO,
  sendToVendor,
  cancelPO,
  amendPO,
  getPOAmendments,
} from "./purchase-order.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllPurchaseOrders);
router.get("/:id", authenticateToken, getPurchaseOrderById);
router.post("/", authenticateToken, createPurchaseOrder);
router.post("/from-indent/:indentId", authenticateToken, createPOFromIndent);
router.put("/:id", authenticateToken, updatePurchaseOrder);
router.patch("/:id/approve", authenticateToken, approvePO);
router.patch("/:id/send", authenticateToken, sendToVendor);
router.patch("/:id/cancel", authenticateToken, cancelPO);
router.patch("/:id/amend", authenticateToken, amendPO);
router.get("/:id/amendments", authenticateToken, getPOAmendments);

export default router;

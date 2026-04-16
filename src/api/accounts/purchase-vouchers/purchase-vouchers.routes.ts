import { Router } from "express";
import { authenticateToken } from "../../../middleware/authMiddleware";
import {
  getAllPurchaseVouchers,
  getPurchaseVoucherById,
  createPurchaseVoucher,
  updatePurchaseVoucher,
  approvePurchaseVoucher,
  postPurchaseVoucher,
  cancelPurchaseVoucher,
} from "./purchase-vouchers.controller";

const router = Router();

router.use(authenticateToken);

router.get("/", getAllPurchaseVouchers);
router.get("/:id", getPurchaseVoucherById);
router.post("/", createPurchaseVoucher);
router.put("/:id", updatePurchaseVoucher);
router.patch("/:id/approve", approvePurchaseVoucher);
router.patch("/:id/post", postPurchaseVoucher);
router.patch("/:id/cancel", cancelPurchaseVoucher);

export default router;

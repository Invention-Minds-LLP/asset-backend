import { Router } from "express";
import { authenticateToken } from "../../../middleware/authMiddleware";
import {
  getAllPaymentVouchers,
  getPaymentVoucherById,
  createPaymentVoucher,
  updatePaymentVoucher,
  approvePaymentVoucher,
  postPaymentVoucher,
  cancelPaymentVoucher,
} from "./payment-vouchers.controller";

const router = Router();

router.use(authenticateToken);

router.get("/", getAllPaymentVouchers);
router.get("/:id", getPaymentVoucherById);
router.post("/", createPaymentVoucher);
router.put("/:id", updatePaymentVoucher);
router.patch("/:id/approve", approvePaymentVoucher);
router.patch("/:id/post", postPaymentVoucher);
router.patch("/:id/cancel", cancelPaymentVoucher);

export default router;

import express from "express";
import {
  mobileLogin,
  getMobileDashboard,
  getMobileAssetList,
  getMyAssets,
  mobileRaiseTicket,
  getMobileProfile,
  mobileRequestOtp,
  mobileVerifyOtp,
  externalRequestOtp,
  externalVerifyOtp,
} from "./mobile-auth.controller";
import { mobileAuth } from "../../middleware/mobileAuthMiddleware";

const router = express.Router();

// Password login (no OTP) — Employee ID + password, for QA / Play review.
router.post("/login", mobileLogin);

// Internal employee OTP login. Two-step flow: request-otp emails a 6-digit
// code; verify-otp trades that code for a JWT.
router.post("/login/request-otp", mobileRequestOtp);
router.post("/login/verify-otp", mobileVerifyOtp);

// External auditor OTP login (Batch D). Email-based identity, looked up
// against the ExternalAuditor master (ACTIVE only). Returns a shorter-TTL
// JWT carrying userType=EXTERNAL.
router.post("/external/request-otp", externalRequestOtp);
router.post("/external/verify-otp", externalVerifyOtp);

router.get("/dashboard", mobileAuth, getMobileDashboard);
router.get("/assets", mobileAuth, getMobileAssetList);
router.get("/assets/mine", mobileAuth, getMyAssets);
router.post("/raise-ticket", mobileAuth, mobileRaiseTicket);
router.get("/profile", mobileAuth, getMobileProfile);

export default router;

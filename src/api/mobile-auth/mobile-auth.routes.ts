import express from "express";
import {
  mobileLogin,
  getMobileDashboard,
  getMobileAssetList,
  mobileRaiseTicket,
  getMobileProfile,
  mobileRequestOtp,
  mobileVerifyOtp,
} from "./mobile-auth.controller";
import { mobileAuth } from "../../middleware/mobileAuthMiddleware";

const router = express.Router();

// Password login — still operational through Batch A. Will be removed in
// the Batch B cleanup pass once mobile UI fully switches to OTP.
router.post("/login", mobileLogin);

// OTP login (new). Two-step flow: request-otp emails a 6-digit code; verify-otp
// trades that code for a JWT with the same response shape as /login.
router.post("/login/request-otp", mobileRequestOtp);
router.post("/login/verify-otp", mobileVerifyOtp);

router.get("/dashboard", mobileAuth, getMobileDashboard);
router.get("/assets", mobileAuth, getMobileAssetList);
router.post("/raise-ticket", mobileAuth, mobileRaiseTicket);
router.get("/profile", mobileAuth, getMobileProfile);

export default router;

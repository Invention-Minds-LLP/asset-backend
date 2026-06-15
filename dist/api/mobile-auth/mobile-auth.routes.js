"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mobile_auth_controller_1 = require("./mobile-auth.controller");
const mobileAuthMiddleware_1 = require("../../middleware/mobileAuthMiddleware");
const router = express_1.default.Router();
// Password login (no OTP) — Employee ID + password, for QA / Play review.
router.post("/login", mobile_auth_controller_1.mobileLogin);
// Internal employee OTP login. Two-step flow: request-otp emails a 6-digit
// code; verify-otp trades that code for a JWT.
router.post("/login/request-otp", mobile_auth_controller_1.mobileRequestOtp);
router.post("/login/verify-otp", mobile_auth_controller_1.mobileVerifyOtp);
// External auditor OTP login (Batch D). Email-based identity, looked up
// against the ExternalAuditor master (ACTIVE only). Returns a shorter-TTL
// JWT carrying userType=EXTERNAL.
router.post("/external/request-otp", mobile_auth_controller_1.externalRequestOtp);
router.post("/external/verify-otp", mobile_auth_controller_1.externalVerifyOtp);
router.get("/dashboard", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMobileDashboard);
router.get("/assets", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMobileAssetList);
router.get("/assets/mine", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMyAssets);
router.post("/raise-ticket", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.mobileRaiseTicket);
router.get("/profile", mobileAuthMiddleware_1.mobileAuth, mobile_auth_controller_1.getMobileProfile);
exports.default = router;

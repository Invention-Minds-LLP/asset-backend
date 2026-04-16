import express from "express";
import { mobileLogin, getMobileDashboard, getMobileAssetList, mobileRaiseTicket, getMobileProfile } from "./mobile-auth.controller";
import { mobileAuth } from "../../middleware/mobileAuthMiddleware";

const router = express.Router();

router.post("/login", mobileLogin);
router.get("/dashboard", mobileAuth, getMobileDashboard);
router.get("/assets", mobileAuth, getMobileAssetList);
router.post("/raise-ticket", mobileAuth, mobileRaiseTicket);
router.get("/profile", mobileAuth, getMobileProfile);

export default router;

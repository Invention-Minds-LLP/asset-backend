import express from "express";
import {
  endAllSessions,
  extendTrial,
  getTrial,
  getTrialLogins,
  getTrialStatus,
  getViolations,
  reactivateTrial,
  resetLockedIp,
  revokeTrial,
  upsertTrial,
} from "./trial.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
import { requireTrialAdmin } from "../../middleware/trialAdminMiddleware";

const router = express.Router();

// Read-only countdown for the demo user's banner — normal login is enough.
router.get("/status", authenticateToken, getTrialStatus);

// Everything below is ours: TRIAL_ADMIN_KEY header, not the client's admin JWT.
router.get("/", requireTrialAdmin, getTrial);
router.put("/", requireTrialAdmin, upsertTrial);
router.post("/extend", requireTrialAdmin, extendTrial);
router.post("/revoke", requireTrialAdmin, revokeTrial);
router.post("/reactivate", requireTrialAdmin, reactivateTrial);
router.post("/reset-ip", requireTrialAdmin, resetLockedIp);
router.post("/end-sessions", requireTrialAdmin, endAllSessions);
router.get("/violations", requireTrialAdmin, getViolations);
router.get("/logins", requireTrialAdmin, getTrialLogins);

export default router;

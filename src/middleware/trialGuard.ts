import { NextFunction, Request, Response } from "express";
import {
  clientIp,
  evaluateTrial,
  getTrialLicense,
  recordTrialViolation,
  trialEnabled,
} from "../lib/trial";

// Paths that must keep answering after the trial dies:
//  - /api/trial/*  → the control API used to extend, revoke or inspect it
//  - /api/health   → the Cloud Scheduler keep-warm ping (a failing ping would
//                    look like an outage and defeat the cold-start fix)
const BYPASS = [/^\/api\/trial(\/|$)/, /^\/api\/health(\/|$)/];

/**
 * Single checkpoint in front of every API route. Blocks the whole application
 * the moment the demo expires or is revoked.
 *
 * Mounted globally, so the first line matters: on a production instance
 * TRIAL_ENABLED is unset and this returns immediately — no DB read, no measurable
 * cost, no behavioural change.
 */
export const trialGuard = async (req: Request, res: Response, next: NextFunction) => {
  if (!trialEnabled()) return next();
  if (!req.path.startsWith("/api")) return next();
  if (BYPASS.some((rx) => rx.test(req.path))) return next();

  const license = await getTrialLicense();
  const verdict = evaluateTrial(license);
  if (verdict.ok) return next();

  recordTrialViolation({
    reason: verdict.code === "TRIAL_REVOKED" ? "REVOKED" : "EXPIRED",
    employeeId: (req as any).user?.employeeID ?? null,
    ipAddress: clientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
    path: req.path,
  });

  // 403, never 401: the frontend interceptor logs out on 401, which would bounce
  // the user to the login screen instead of showing why they were stopped.
  res.status(403).json({ code: verdict.code, message: verdict.message });
};

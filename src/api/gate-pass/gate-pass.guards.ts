import { RequestHandler } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

/**
 * Gate-pass route guards.
 *
 * These are deliberately written as DENY rules, not allow-lists.
 *
 * Before this, every gate-pass route was authentication-only — any logged-in
 * user could approve, gate-out or gate-in. An allow-list would be the stricter
 * fix, but User.role isn't uniformly populated across existing deployments
 * (some accounts carry "user" rather than "HOD"/"OPERATIONS"), so allow-listing
 * management roles would silently lock working users out of live approvals.
 *
 * These rules therefore close the specific hole that matters — outsourced
 * security staff holding logins — and leave every other user exactly as they
 * were. Tightening to a strict allow-list is a follow-up once User.role is
 * known-clean in production.
 */

const SECURITY = "SECURITY";
const SUPERVISOR = "SUPERVISOR";
const ADMIN = "ADMIN";

/**
 * Security staff must not approve or reject gate passes — that's the requesting
 * department's HOD. Without this, an outsourced guard could authorise the very
 * pass they are about to hand out at the gate.
 */
export const denySecurityApproval: RequestHandler = (req, res, next) => {
  const user = (req as AuthenticatedRequest).user;
  if (user?.role === SECURITY) {
    res.status(403).json({
      message: "Security accounts cannot approve or reject gate passes. This is the department HOD's decision.",
    });
    return;
  }
  next();
};

/**
 * Physical gate actions (gate-out / gate-in) and the security history are for
 * the security SUPERVISOR. A security EXECUTIVE's job is printing the label and
 * sticking it on the parcel, so they are blocked here.
 *
 * Note this only constrains SECURITY accounts. ADMIN passes explicitly, and
 * non-security users are untouched — in deployments with no security accounts
 * yet, whoever performs gate-out today keeps working.
 */
export const requireSecuritySupervisor: RequestHandler = (req, res, next) => {
  const user = (req as AuthenticatedRequest).user;
  if (user?.role === ADMIN) { next(); return; }

  if (user?.role === SECURITY && user?.employeeRole !== SUPERVISOR) {
    res.status(403).json({
      message: "This action is restricted to security supervisors. Your account is set up for label printing only.",
    });
    return;
  }
  next();
};

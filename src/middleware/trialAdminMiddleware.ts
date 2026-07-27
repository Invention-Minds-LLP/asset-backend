import { NextFunction, Request, Response } from "express";
import crypto from "crypto";

export const TRIAL_ADMIN_HEADER = "x-trial-admin-key";

/**
 * Guards the trial control API with a shared secret held only by us — deliberately
 * NOT the normal admin JWT. The demo client gets an admin login inside their own
 * instance; if that were enough to reach these endpoints they could extend or
 * un-revoke their own trial.
 */
export const requireTrialAdmin = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.TRIAL_ADMIN_KEY;

  // Refuse rather than fall back to "open" — an unset key must not mean anyone
  // can revoke the licence.
  if (!expected) {
    res.status(503).json({ message: "Trial administration is not configured on this instance." });
    return;
  }

  const provided = String(req.headers[TRIAL_ADMIN_HEADER] ?? "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ message: "Invalid trial admin key" });
    return;
  }

  next();
};

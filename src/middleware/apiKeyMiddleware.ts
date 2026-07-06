import { Request, Response, NextFunction } from "express";

// Guard for machine-to-machine ingest endpoints (CCTV marker reader, and later
// the RFID reader). These callers are field devices/services, not logged-in
// users, so they authenticate with a shared secret in the `x-api-key` header
// rather than a JWT. Set SCAN_INGEST_API_KEY in .env / the deployment env.
const SCAN_INGEST_API_KEY = process.env.SCAN_INGEST_API_KEY;

export const requireScanApiKey = (req: Request, res: Response, next: NextFunction) => {
  if (!SCAN_INGEST_API_KEY) {
    // Fail closed: if the key isn't configured the endpoint stays locked rather
    // than silently accepting anonymous scans.
    console.error("[apiKey] SCAN_INGEST_API_KEY is not set — rejecting ingest request");
    res.status(503).json({ message: "Scan ingest is not configured" });
    return;
  }

  const provided = req.headers["x-api-key"];
  if (provided !== SCAN_INGEST_API_KEY) {
    res.status(401).json({ message: "Unauthorized: invalid or missing API key" });
    return;
  }

  next();
};

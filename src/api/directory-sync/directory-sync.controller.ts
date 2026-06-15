import { Response } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { syncAllToDirectory } from "../../utilis/directory";

// POST /api/directory-sync/run
// Admin-triggered backfill: pushes all Employee IDs + external-auditor emails
// to the tenant directory now (instead of waiting for the nightly cron).
export const runDirectorySync = async (req: AuthenticatedRequest, res: Response) => {
  const role = (req.user?.role || "").toUpperCase();
  if (!["ADMIN", "OPERATIONS", "CEO", "COO", "CEO_COO"].includes(role)) {
    res.status(403).json({ message: "Forbidden: admin only" });
    return;
  }

  const result = await syncAllToDirectory();
  res.status(result.ok ? 200 : 502).json(result);
};

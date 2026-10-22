// DPDP download gate. Every API response that is a file (export, report CSV/
// Excel, template, PDF, label) must carry:
//   X-Download-Grant  — 60-min JWT from email OTP (POST /api/download-otp/verify)
//   X-Download-Ticket — 2-min single-use JWT from captcha + reason
//                       (POST /api/download-otp/authorize → DownloadLog row)
// The ticket is consumed by stamping DownloadLog.servedAt, so one reason/captcha
// buys exactly one file.
//
// Mounted globally (index.ts) after softAuth and before the routers, so the
// whole inventory of file routes lives in ONE list below instead of being
// sprinkled over 15 routers. Unauthenticated calls fall through untouched —
// the router's own authenticateToken still answers 401.
//
// Kill switch: DOWNLOAD_GATE_ENABLED=false.

import { Request, Response, NextFunction } from "express";
import prisma from "../prismaClient";
import { isValidDownloadGrant, readDownloadTicket } from "../lib/accountSecurity";

type Rule = (path: string, query: Record<string, any>) => boolean;

const FILE_ROUTES: RegExp[] = [
  /^\/api\/export\/[^/]+$/, // data-export hub (79 reports)
  /^\/api\/import\/(legacy-template|checklists\/template|sub-assets-template|locations-template|locations-export|departments-template)$/,
  /^\/api\/asset-pool\/(fa-register-template|individual-assets-template)$/,
  /^\/api\/vendors\/template$/,
  /^\/api\/finance\/export-batches\/[^/]+\/download$/,
  /^\/api\/reconciliation\/[^/]+\/export$/,
  /^\/api\/gate-pass\/[^/]+\/(pdf|label)$/,
  /^\/api\/calibration\/history\/[^/]+\/pdf$/,
  /^\/api\/pm-checklist\/run\/[^/]+\/pdf$/,
];

const RULES: Rule[] = [
  (path) => FILE_ROUTES.some((re) => re.test(path)),
  // /api/reports/*?export=csv|excel|combined
  (path, q) => path.startsWith("/api/reports/") && !!q.export,
  // Any list endpoint with ?exportCsv=true (assets, tickets, vendors, warranties…)
  (_path, q) => String(q.exportCsv) === "true",
];

export const isDownloadRequest = (req: Request): boolean =>
  req.method === "GET" && RULES.some((rule) => rule(req.path, req.query as Record<string, any>));

export async function downloadGate(req: Request, res: Response, next: NextFunction) {
  if (process.env.DOWNLOAD_GATE_ENABLED === "false" || !isDownloadRequest(req)) return next();

  const userId = Number((req as any).softUser?.userId);
  if (!userId) return next(); // not authenticated → router's authenticateToken rejects

  if (!isValidDownloadGrant(req.headers["x-download-grant"], userId)) {
    res.status(428).json({ message: "Email OTP verification is required to download.", code: "DOWNLOAD_OTP_REQUIRED" });
    return;
  }
  try {
    const logId = readDownloadTicket(req.headers["x-download-ticket"], userId);
    const consumed = logId
      ? await prisma.downloadLog.updateMany({
          where: { id: logId, userId, servedAt: null },
          data: { servedAt: new Date(), serverRoute: req.originalUrl.slice(0, 1000) },
        })
      : { count: 0 };
    if (consumed.count !== 1) {
      res.status(428).json({
        message: "Please complete the captcha and reason for this download.",
        code: "DOWNLOAD_REASON_REQUIRED",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

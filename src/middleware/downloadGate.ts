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
import { DownloadStamp, stampFile } from "../lib/downloadStamp";

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

    // Footer: unique ref (employee + IST time + their Nth download) written
    // into the file itself. Physical sticker labels are left clean.
    if (!NO_STAMP.some((re) => re.test(req.path))) {
      const log = await prisma.downloadLog.findUnique({
        where: { id: logId! },
        select: { refCode: true, downloadNo: true, employeeID: true, name: true, createdAt: true },
      });
      if (log?.refCode && log.downloadNo) {
        const stamp: DownloadStamp = {
          refCode: log.refCode, downloadNo: log.downloadNo,
          employeeID: log.employeeID, name: log.name, at: log.createdAt,
        };
        stampResponse(res, stamp, { footerRow: !TEMPLATE_ROUTES.some((re) => re.test(req.path)) });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Gate-pass label = a sticker for a label printer; a footer would ruin it.
const NO_STAMP: RegExp[] = [/^\/api\/gate-pass\/[^/]+\/label$/];

// Workbooks that are filled in and uploaded back: footer goes in the printed
// page footer + file properties only, never as a row (it would import as data).
const TEMPLATE_ROUTES: RegExp[] = [
  /^\/api\/import\//,
  /^\/api\/asset-pool\/(fa-register-template|individual-assets-template)$/,
  /^\/api\/vendors\/template$/,
];

/**
 * Buffers whatever the handler writes (res.send, res.write/end, or a piped
 * pdfkit / ExcelJS stream), stamps the footer in by content type, then sends
 * it with a corrected Content-Length. Failing to stamp never blocks the file —
 * it is logged and the original goes out. Non-2xx responses pass untouched.
 */
function stampResponse(res: Response, stamp: DownloadStamp, opts: { footerRow: boolean }) {
  const chunks: Buffer[] = [];
  const origEnd = res.end.bind(res) as (...a: any[]) => Response;
  const toBuf = (chunk: any, enc?: any) =>
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === "string" ? (enc as BufferEncoding) : "utf8");

  (res as any).write = (chunk: any, enc?: any, cb?: any) => {
    if (chunk != null) chunks.push(toBuf(chunk, enc));
    const done = typeof enc === "function" ? enc : cb;
    if (typeof done === "function") process.nextTick(done);
    return true;
  };

  (res as any).end = (chunk?: any, enc?: any, cb?: any) => {
    if (typeof chunk === "function") { cb = chunk; chunk = undefined; }
    else if (typeof enc === "function") { cb = enc; enc = undefined; }
    if (chunk != null) chunks.push(toBuf(chunk, enc));
    const body = Buffer.concat(chunks);

    (async () => {
      let out = body;
      if (res.statusCode >= 200 && res.statusCode < 300 && body.length) {
        try {
          out = await stampFile(body, String(res.getHeader("content-type") || ""), stamp, opts);
        } catch (err) {
          console.error(`[downloadGate] footer stamp failed for ${stamp.refCode}:`, err);
        }
      }
      if (!res.headersSent) {
        res.setHeader("Content-Length", out.length);
        res.removeHeader("ETag");
        res.setHeader("X-Download-Ref", stamp.refCode);
      }
      origEnd(out, cb);
    })();
    return res;
  };
}

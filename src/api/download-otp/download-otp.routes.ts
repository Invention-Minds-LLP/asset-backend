// DPDP download verification: email OTP → grant, captcha + reason → ticket,
// and the admin audit view of every download.
import express, { Response } from "express";
import prisma from "../../prismaClient";
import { authenticateToken, requireRole } from "../../middleware/authMiddleware";
import {
  SecurityError,
  createCaptcha,
  isValidDownloadGrant,
  maskEmail,
  sendDownloadOtp,
  signDownloadGrant,
  signDownloadTicket,
  verifyCaptcha,
  verifyDownloadOtp,
} from "../../lib/accountSecurity";
import { buildRefCode, footerText } from "../../lib/downloadStamp";

const router = express.Router();
router.use(authenticateToken);

const MIN_REASON = 5;
const MAX_REASON = 500;

function sendError(res: Response, error: unknown, label: string) {
  if (error instanceof SecurityError) {
    res.status(error.status).json({ message: error.message, code: error.code });
    return;
  }
  console.error(`[download-otp] ${label} failed:`, error);
  res.status(500).json({ message: "Internal server error" });
}

// POST /api/download-otp/request — email a 6-digit code to the employee's email.
router.post("/request", async (req: any, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.user.userId) },
      select: { employeeID: true, employee: { select: { email: true, name: true } } },
    });
    const email = user?.employee?.email?.trim();
    if (!user || !email) {
      throw new SecurityError(409, "No email is registered for your account. Please ask your administrator to add one.");
    }
    const { expiresAt } = await sendDownloadOtp(user.employeeID, email, user.employee?.name);
    res.json({ sentTo: maskEmail(email), expiresAt });
  } catch (error) {
    sendError(res, error, "request");
  }
});

// POST /api/download-otp/verify { otp } → { grant, expiresAt } (60 min)
router.post("/verify", async (req: any, res) => {
  try {
    await verifyDownloadOtp(req.user.employeeID, req.body?.otp);
    res.json(signDownloadGrant(Number(req.user.userId)));
  } catch (error) {
    sendError(res, error, "verify");
  }
});

// GET /api/download-otp/captcha → { captchaId, image, prompt, grid }
router.get("/captcha", async (req: any, res) => {
  try {
    res.json(await createCaptcha(Number(req.user.userId)));
  } catch (error) {
    sendError(res, error, "captcha");
  }
});

// POST /api/download-otp/authorize  (X-Download-Grant header)
// { captchaId, captchaAnswer: number[], reason, label, page } → { logId, ticket }
router.post("/authorize", async (req: any, res) => {
  try {
    const userId = Number(req.user.userId);
    if (!isValidDownloadGrant(req.headers["x-download-grant"], userId)) {
      throw new SecurityError(428, "Email OTP verification is required to download.", "DOWNLOAD_OTP_REQUIRED");
    }
    await verifyCaptcha(req.body?.captchaId, req.body?.captchaAnswer, userId);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < MIN_REASON) {
      throw new SecurityError(400, `Please enter a reason (at least ${MIN_REASON} characters).`);
    }
    const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 191) : "";
    const page = typeof req.body?.page === "string" ? req.body.page.slice(0, 191) : null;
    // Footer ref: this user's Nth download. Retried on the (rare) collision of
    // two simultaneous downloads by the same person getting the same number.
    let log: { id: string; refCode: string | null; downloadNo: number | null; createdAt: Date } | null = null;
    for (let attempt = 0; attempt < 3 && !log; attempt++) {
      const at = new Date();
      const downloadNo = (await prisma.downloadLog.count({ where: { userId } })) + 1 + attempt;
      try {
        log = await prisma.downloadLog.create({
          data: {
            userId,
            employeeID: req.user.employeeID,
            name: req.user.name ?? null,
            role: req.user.role,
            label: label || "Unlabelled download",
            page,
            reason: reason.slice(0, MAX_REASON),
            ipAddress: (req.ip || "").slice(0, 64) || null,
            userAgent: String(req.headers["user-agent"] || "").slice(0, 1000) || null,
            downloadNo,
            refCode: buildRefCode(req.user.employeeID, downloadNo, at),
            createdAt: at,
          },
          select: { id: true, refCode: true, downloadNo: true, createdAt: true },
        });
      } catch (err: any) {
        if (err?.code !== "P2002" || attempt === 2) throw err; // unique refCode clash → next number
      }
    }
    const stamp = {
      refCode: log!.refCode!, downloadNo: log!.downloadNo!, employeeID: req.user.employeeID,
      name: req.user.name ?? null, at: log!.createdAt,
    };
    res.json({
      logId: log!.id,
      ticket: signDownloadTicket(userId, log!.id),
      refCode: stamp.refCode,
      downloadNo: stamp.downloadNo,
      // Ready-made footer line for files the browser builds itself (CSV, print).
      footer: footerText(stamp),
    });
  } catch (error) {
    sendError(res, error, "authorize");
  }
});

// GET /api/download-otp/logs?page&pageSize&search&from&to — admin audit view.
router.get("/logs", requireRole("ADMIN", "CEO_COO"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const from = typeof req.query.from === "string" && req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    const to = typeof req.query.to === "string" && req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : null;

    const where: any = {};
    if (search) {
      where.OR = [
        { refCode: { contains: search } },
        { employeeID: { contains: search } },
        { name: { contains: search } },
        { label: { contains: search } },
        { reason: { contains: search } },
      ];
    }
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [data, total] = await Promise.all([
      prisma.downloadLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, refCode: true, downloadNo: true,
          employeeID: true, name: true, role: true, label: true, page: true, reason: true,
          ipAddress: true, serverRoute: true, servedAt: true, createdAt: true,
        },
      }),
      prisma.downloadLog.count({ where }),
    ]);
    res.json({ data, total, page, pageSize });
  } catch (error) {
    sendError(res, error, "logs");
  }
});

export default router;

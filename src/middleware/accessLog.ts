// API access logging + suspicious-request detection.
//
// Two middlewares, mounted (in index.ts) BEFORE the route handlers:
//
//   softAuth     — decodes a JWT *if one is present*, but NEVER rejects. It only
//                  sets req.user so the logger knows whether the call was
//                  authenticated. The real gate is still authenticateToken on
//                  each protected route; this is purely informational.
//
//   accessLogger — on response finish, records one entry per /api request to the
//                  apiaccesslog table (all requests, or only flagged ones, per
//                  ACCESS_LOG_ALL_TO_DB) and feeds flagged requests into the
//                  security alert buffer. Optionally also to a daily JSONL file.
//
// Everything here is best-effort: logging must never break or slow a request, so
// DB/file writes are fire-and-forget with swallowed errors, and the whole thing
// is gated by ACCESS_LOG_ENABLED.

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import prisma from "../prismaClient";
import { classifyRequest, noteSecurityEvent, isFileProbe, securityConfig } from "../lib/securityAlert";

const JWT_SECRET = process.env.JWT_SECRET as string;

interface DecodedUser {
  userId?: number;
  employeeID?: string;
  employeeDbId?: number;
  [k: string]: any;
}

/* ── softAuth ────────────────────────────────────────────────────────────── */

export function softAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (token) {
    try {
      (req as any).softUser = jwt.verify(token, JWT_SECRET) as DecodedUser;
    } catch {
      // Invalid/expired token: leave it unset → counted as anonymous. We do NOT
      // reject here; protected routes' authenticateToken will.
    }
  }
  next();
}

/* ── file sink (opt-in; off by default — Cloud Run FS is ephemeral) ───────── */

const LOG_DIR = path.join(process.cwd(), "logs");
let logDirReady = false;
function ensureLogDir() {
  if (logDirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logDirReady = true;
  } catch (e) {
    console.error("[accessLog] could not create log dir:", e);
  }
}

function writeFileLine(now: Date, entry: Record<string, unknown>) {
  ensureLogDir();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const file = path.join(LOG_DIR, `access-${y}-${m}-${d}.jsonl`);
  fs.appendFile(file, JSON.stringify(entry) + "\n", (err) => {
    if (err) console.error("[accessLog] file append failed:", err.message);
  });
}

/* ── accessLogger ────────────────────────────────────────────────────────── */

export function accessLogger(req: Request, res: Response, next: NextFunction) {
  if (!securityConfig.enabled) return next();

  const rawUrl = req.originalUrl;
  const rawPath = rawUrl.split("?")[0];
  const isApi = rawUrl.startsWith("/api");
  // A non-/api request for a backend file path (.env, .git, dumps…) is a probe.
  const probe = !isApi && isFileProbe(rawPath);

  // Log API traffic and file-probe attempts only; skip /uploads and root noise.
  if (!isApi && !probe) return next();

  const startedAt = Date.now();

  res.on("finish", () => {
    const now = new Date();
    const durationMs = Date.now() - startedAt;
    const user = (req as any).softUser as DecodedUser | undefined;
    const userId = Number(user?.userId) || null;
    const employeeID = user?.employeeID ?? null;
    const isAnonymous = !user;
    const ip = (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "") || null;
    const userAgent = req.get("user-agent") || null;
    const statusCode = res.statusCode;

    const rules = classifyRequest({ path: rawPath, rawUrl, statusCode, isAnonymous });
    if (probe) rules.push("FILE_PROBE");
    const suspicious = rules.length > 0;
    const reason = suspicious ? rules.join(",") : null;

    // 1) File sink — opt-in.
    if (securityConfig.logToFile) {
      writeFileLine(now, {
        t: now.toISOString(),
        method: req.method,
        path: rawPath,
        status: statusCode,
        ms: durationMs,
        ip,
        userId,
        anon: isAnonymous,
        suspicious,
        reason,
        ua: userAgent,
      });
    }

    // 2) DB sink — all requests, or only flagged ones, per config.
    if (securityConfig.logAllToDb || suspicious) {
      prisma.apiAccessLog
        .create({
          data: {
            method: req.method,
            path: rawPath,
            statusCode,
            durationMs,
            ip,
            userAgent,
            userId,
            employeeID,
            isAnonymous,
            suspicious,
            reason,
          },
        })
        .catch((e) => console.error("[accessLog] db insert failed:", e?.message || e));
    }

    // 3) Alert buffer — only flagged requests.
    if (suspicious) {
      noteSecurityEvent({
        rules,
        ip: ip || "unknown",
        path: rawPath,
        userAgent: userAgent || undefined,
        when: now,
      });
    }
  });

  next();
}

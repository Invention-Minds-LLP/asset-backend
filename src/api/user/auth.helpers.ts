import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../../prismaClient";

const JWT_SECRET = process.env.JWT_SECRET as string;

// Short-lived access token (kept in memory on the client). Long-lived refresh
// token (httpOnly cookie, hashed server-side) mints new access tokens silently.
export const ACCESS_TTL = process.env.ACCESS_TTL || "15m";
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TTL_DAYS || 7);

export const REFRESH_COOKIE = "rt";
export const CSRF_COOKIE = "csrf";

export interface AccessPayload {
  userId: number;
  employeeID: string;
  employeeDbId?: number;
  role: string;
  name?: string;
  departmentId?: number | null;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL } as jwt.SignOptions);
}

// Cookie flags are decided PER REQUEST from how the request arrived, so ONE
// backend serves both access methods at once:
//   • http://LAN  → Secure=false, SameSite=Lax   (must be same-site: same host)
//   • https://pub → Secure=true,  SameSite=None  (works cross-site too)
// `Secure` reflects the request protocol; behind a TLS-terminating reverse
// proxy this needs `app.set('trust proxy', true)` so req.secure / X-Forwarded-
// Proto are honoured. COOKIE_DOMAIN stays optional for a shared parent domain.
function cookieBaseOptions(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const isHttps = req.secure || forwardedProto === "https";
  // SameSite=None is only valid with Secure (i.e. HTTPS); over HTTP use Lax.
  const sameSite: "lax" | "none" = isHttps ? "none" : "lax";
  return { secure: isHttps, sameSite, domain: process.env.COOKIE_DOMAIN || undefined, path: "/" };
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// Create a refresh token, persist only its hash, and return the raw value.
export async function createRefreshToken(userId: number, req: Request): Promise<string> {
  const raw = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt,
      userAgent: (req.headers["user-agent"] as string) || null,
      ipAddress: req.ip || null,
    },
  });
  return raw;
}

// Validate a raw refresh token; returns the userId if valid, else null.
export async function validateRefreshToken(raw: string | undefined): Promise<{ id: number; userId: number } | null> {
  if (!raw) return null;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  return { id: row.id, userId: row.userId };
}

export async function revokeRefreshTokenById(id: number) {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeRefreshTokenByRaw(raw: string | undefined) {
  if (!raw) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

export function setRefreshCookie(res: Response, raw: string, req: Request) {
  res.cookie(REFRESH_COOKIE, raw, {
    ...cookieBaseOptions(req),
    httpOnly: true,
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response, req: Request) {
  res.clearCookie(REFRESH_COOKIE, { ...cookieBaseOptions(req), httpOnly: true });
}

// Double-submit CSRF: a readable (non-httpOnly) cookie the client echoes back in
// the X-CSRF-Token header on cookie-authenticated POSTs (/refresh, /logout).
export function issueCsrfCookie(res: Response, req: Request): string {
  const token = crypto.randomBytes(24).toString("hex");
  res.cookie(CSRF_COOKIE, token, { ...cookieBaseOptions(req), httpOnly: false, maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000 });
  return token;
}

export function csrfOk(req: Request): boolean {
  const cookie = (req as any).cookies?.[CSRF_COOKIE];
  const header = req.headers["x-csrf-token"];
  return !!cookie && !!header && cookie === header;
}

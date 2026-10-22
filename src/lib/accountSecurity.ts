// DPDP account security — Google Authenticator (TOTP) at web login, and the
// download gate (email OTP → 60-min grant, then picture captcha + reason →
// single-use ticket per download). Ported from DocMinds' account-security
// service and adapted to Smart Assets (User/Employee split, LoginOtp table,
// DB-backed captcha so it works across Cloud Run instances).

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import sharp from "sharp";
import prisma from "../prismaClient";
import { sendEmail } from "../utilis/notificationHelper";

const JWT_SECRET = process.env.JWT_SECRET as string;

const CHALLENGE_TTL = "10m";
const DOWNLOAD_GRANT_TTL_MIN = 60;
const DOWNLOAD_TICKET_TTL = "2m";
const CAPTCHA_TTL_MS = 3 * 60 * 1000;
const EMAIL_OTP_TTL_MIN = 5;
const EMAIL_OTP_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_OTP_MAX_PER_WINDOW = 5;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
// LoginOtp rows for downloads use their own identifierType so they can never be
// confused with (or consume) a mobile login code.
const DOWNLOAD_OTP_TYPE = "DOWNLOAD";
const TOTP_ISSUER = process.env.MFA_ISSUER || "Smart Assets";

authenticator.options = { window: 1 }; // accept ±30s clock drift

export class SecurityError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/* ── Which accounts need Google Authenticator ────────────────────────────── */

// Exempt roles are matched against BOTH User.role and Employee.role, so a
// SECURITY login and an EXECUTIVE/SUPERVISOR employee are skipped — unless the
// login itself carries an admin/management User.role, which always needs 2FA.
const MFA_EXEMPT_ROLES = (process.env.MFA_EXEMPT_ROLES || "EXECUTIVE,SUPERVISOR,SECURITY")
  .split(",")
  .map((r) => r.trim().toUpperCase())
  .filter(Boolean);
const ALWAYS_MFA_USER_ROLES = ["ADMIN", "CEO_COO", "CFO", "FINANCE", "OPERATIONS", "HOD"];

export const mfaEnabled = (): boolean => process.env.MFA_ENABLED !== "false";

export function requiresMfa(userRole?: string | null, employeeRole?: string | null): boolean {
  if (!mfaEnabled()) return false;
  const ur = String(userRole || "").toUpperCase();
  const er = String(employeeRole || "").toUpperCase();
  if (ALWAYS_MFA_USER_ROLES.includes(ur)) return true;
  if (MFA_EXEMPT_ROLES.includes(ur) || MFA_EXEMPT_ROLES.includes(er)) return false;
  return true;
}

/* ── TOTP secret encryption (AES-256-GCM) ────────────────────────────────── */

function encKey(): Buffer {
  const raw = process.env.MFA_ENC_KEY;
  if (!raw) throw new Error("MFA_ENC_KEY is not configured");
  return crypto.createHash("sha256").update(raw).digest();
}
function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/* ── Login challenge token (password OK, TOTP pending) ───────────────────── */

interface ChallengePayload {
  userId: number;
  purpose: "login_challenge";
}

export function signChallenge(userId: number): string {
  const payload: ChallengePayload = { userId, purpose: "login_challenge" };
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: CHALLENGE_TTL } as jwt.SignOptions);
}

export function readChallenge(token: unknown): number {
  try {
    const p = jwt.verify(String(token ?? ""), JWT_SECRET, { algorithms: ["HS256"] }) as ChallengePayload;
    if (p.purpose !== "login_challenge" || !p.userId) throw new Error("bad purpose");
    return p.userId;
  } catch {
    throw new SecurityError(401, "Your login session has expired. Please sign in again.");
  }
}

/* ── Google Authenticator ────────────────────────────────────────────────── */

export async function getMfaSetup(user: {
  id: number;
  employeeID: string;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
}): Promise<{ qrDataUrl: string; manualKey: string }> {
  let secret: string;
  if (user.totpSecret && !user.totpEnabledAt) {
    secret = decryptSecret(user.totpSecret); // keep the same secret across retries
  } else {
    secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(secret), totpEnabledAt: null },
    });
  }
  const uri = authenticator.keyuri(user.employeeID, TOTP_ISSUER, secret);
  return { qrDataUrl: await QRCode.toDataURL(uri), manualKey: secret };
}

export async function verifyMfaCode(
  user: { id: number; totpSecret: string | null; totpEnabledAt: Date | null },
  code: unknown
): Promise<void> {
  const token = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token) || !user.totpSecret) {
    throw new SecurityError(400, "Enter the 6-digit code from Google Authenticator.");
  }
  if (!authenticator.verify({ token, secret: decryptSecret(user.totpSecret) })) {
    throw new SecurityError(401, "Incorrect authenticator code.");
  }
  if (!user.totpEnabledAt) {
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
  }
}

/** Admin reset: next login shows a fresh QR. */
export async function resetMfa(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null } });
}

/* ── Email OTP for downloads (stored in LoginOtp) ────────────────────────── */

const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
};

export async function sendDownloadOtp(employeeID: string, email: string, name?: string | null): Promise<{ expiresAt: Date }> {
  const since = new Date(Date.now() - EMAIL_OTP_WINDOW_MS);
  const recent = await prisma.loginOtp.count({
    where: { identifier: employeeID, identifierType: DOWNLOAD_OTP_TYPE, createdAt: { gte: since } },
  });
  if (recent >= EMAIL_OTP_MAX_PER_WINDOW) {
    throw new SecurityError(429, "Too many OTP requests. Please wait a few minutes and try again.");
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MIN * 60 * 1000);
  // Only the newest OTP is usable.
  await prisma.loginOtp.updateMany({
    where: { identifier: employeeID, identifierType: DOWNLOAD_OTP_TYPE, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.loginOtp.create({
    data: { identifier: employeeID, identifierType: DOWNLOAD_OTP_TYPE, otpHash: sha256(otp), expiresAt },
  });
  await sendEmail({
    to: email,
    subject: `Smart Assets download verification code: ${otp}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
             <p>Hi ${name || "there"},</p>
             <p>Your Smart Assets verification code for <b>downloading a file</b> is:</p>
             <p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#1d4ed8">${otp}</p>
             <p>It expires in ${EMAIL_OTP_TTL_MIN} minutes.</p>
             <p style="color:#6b7280">If you did not request this, contact your administrator immediately.</p>
           </div>`,
  });
  return { expiresAt };
}

export async function verifyDownloadOtp(employeeID: string, otp: unknown): Promise<void> {
  const code = String(otp ?? "").trim();
  if (!/^\d{6}$/.test(code)) throw new SecurityError(400, "Please enter the 6-digit OTP.");
  const row = await prisma.loginOtp.findFirst({
    where: { identifier: employeeID, identifierType: DOWNLOAD_OTP_TYPE, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw new SecurityError(410, "This OTP has expired. Please request a new one.");
  }
  // Reserve an attempt atomically so parallel guesses can't exceed the cap.
  const reserved = await prisma.loginOtp.updateMany({
    where: { id: row.id, consumedAt: null, attempts: { lt: EMAIL_OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count !== 1) throw new SecurityError(429, "Too many wrong attempts. Please request a new OTP.");
  const given = Buffer.from(sha256(code), "hex");
  const stored = Buffer.from(row.otpHash, "hex");
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    const left = EMAIL_OTP_MAX_ATTEMPTS - (row.attempts + 1);
    if (left <= 0) throw new SecurityError(429, "Too many wrong attempts. Please request a new OTP.");
    throw new SecurityError(400, `Incorrect OTP. ${left} attempt${left === 1 ? "" : "s"} left.`);
  }
  const consumed = await prisma.loginOtp.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw new SecurityError(410, "This OTP was already used. Please request a new one.");
}

/* ── Download grant (60 min, after email OTP) ────────────────────────────── */

export function signDownloadGrant(userId: number): { grant: string; expiresAt: Date } {
  const grant = jwt.sign({ userId, purpose: "download" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: `${DOWNLOAD_GRANT_TTL_MIN}m`,
  } as jwt.SignOptions);
  return { grant, expiresAt: new Date(Date.now() + DOWNLOAD_GRANT_TTL_MIN * 60 * 1000) };
}

export function isValidDownloadGrant(grant: unknown, userId: number): boolean {
  if (typeof grant !== "string" || !grant) return false;
  try {
    const p = jwt.verify(grant, JWT_SECRET, { algorithms: ["HS256"] }) as { userId: number; purpose: string };
    return p.purpose === "download" && p.userId === userId;
  } catch {
    return false;
  }
}

/* ── Per-download ticket (2 min; single use via DownloadLog.servedAt) ────── */

export function signDownloadTicket(userId: number, logId: string): string {
  return jwt.sign({ userId, purpose: "download_ticket", logId }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: DOWNLOAD_TICKET_TTL,
  } as jwt.SignOptions);
}

export function readDownloadTicket(ticket: unknown, userId: number): string | null {
  if (typeof ticket !== "string" || !ticket) return null;
  try {
    const p = jwt.verify(ticket, JWT_SECRET, { algorithms: ["HS256"] }) as {
      userId: number;
      purpose: string;
      logId: string;
    };
    return p.purpose === "download_ticket" && p.userId === userId ? p.logId : null;
  } catch {
    return null;
  }
}

/* ── Picture captcha ─────────────────────────────────────────────────────── */
// 3×3 grid drawn as SVG, rasterised to PNG with sharp so the shapes are never
// in the DOM. "Select every tile that contains a <shape>". The answer lives
// only server-side (hashed in DownloadCaptcha) and is consumed on first try.

const CAPTCHA_GRID = 3;
const CAPTCHA_TILE = 96;
const CAPTCHA_GAP = 4;
type CaptchaShape = "circle" | "square" | "triangle" | "star" | "heart" | "plus";
const CAPTCHA_SHAPES: Record<CaptchaShape, { label: string; draw: (s: number) => string }> = {
  circle: { label: "circle", draw: (s) => `<circle r="${(s / 2).toFixed(1)}"/>` },
  square: {
    label: "square",
    draw: (s) =>
      `<rect x="${(-s / 2).toFixed(1)}" y="${(-s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}"/>`,
  },
  triangle: {
    label: "triangle",
    draw: (s) =>
      `<polygon points="0,${(-s / 2).toFixed(1)} ${(s / 2).toFixed(1)},${(s * 0.4).toFixed(1)} ${(-s / 2).toFixed(1)},${(s * 0.4).toFixed(1)}"/>`,
  },
  star: {
    label: "star",
    draw: (s) => {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? s / 2 : s / 5;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
      });
      return `<polygon points="${pts.join(" ")}"/>`;
    },
  },
  heart: {
    label: "heart",
    draw: (s) => {
      const f = (n: number) => (n * s).toFixed(1);
      return `<path d="M0 ${f(0.38)} C${f(-0.62)} ${f(-0.08)},${f(-0.28)} ${f(-0.58)},0 ${f(-0.2)} C${f(0.28)} ${f(-0.58)},${f(0.62)} ${f(-0.08)},0 ${f(0.38)}Z"/>`;
    },
  },
  plus: {
    label: "plus sign",
    draw: (s) => {
      const a = s / 2,
        b = s / 6;
      const pts = [[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]];
      return `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`;
    },
  },
};
const SHAPE_KEYS = Object.keys(CAPTCHA_SHAPES) as CaptchaShape[];

const rnd = (min: number, max: number) => min + (crypto.randomInt(0, 1_000_000) / 1_000_000) * (max - min);
const darkColor = () =>
  `hsl(${Math.floor(rnd(0, 360))},${Math.floor(rnd(45, 80))}%,${Math.floor(rnd(18, 38))}%)`;
const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

function shapeSvg(shape: CaptchaShape, cx: number, cy: number, size: number): string {
  const color = darkColor();
  const outline = crypto.randomInt(0, 3) === 0;
  const style = outline
    ? `fill="none" stroke="${color}" stroke-width="${rnd(3, 5).toFixed(1)}"`
    : `fill="${color}" stroke="${darkColor()}" stroke-width="${rnd(0.5, 2).toFixed(1)}"`;
  return (
    `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rnd(-40, 40).toFixed(1)}) skewX(${rnd(-12, 12).toFixed(1)})" ${style} opacity="${rnd(0.8, 1).toFixed(2)}">` +
    `${CAPTCHA_SHAPES[shape].draw(size)}</g>`
  );
}

function captchaGridSvg(target: CaptchaShape, targetTiles: Set<number>): string {
  const size = CAPTCHA_GRID * CAPTCHA_TILE + (CAPTCHA_GRID + 1) * CAPTCHA_GAP;
  const parts: string[] = [`<rect width="${size}" height="${size}" fill="#e2e8f0"/>`];
  const others = SHAPE_KEYS.filter((s) => s !== target);
  for (let i = 0; i < CAPTCHA_GRID * CAPTCHA_GRID; i++) {
    const x = CAPTCHA_GAP + (i % CAPTCHA_GRID) * (CAPTCHA_TILE + CAPTCHA_GAP);
    const y = CAPTCHA_GAP + Math.floor(i / CAPTCHA_GRID) * (CAPTCHA_TILE + CAPTCHA_GAP);
    const hue = Math.floor(rnd(0, 360));
    parts.push(
      `<rect x="${x}" y="${y}" width="${CAPTCHA_TILE}" height="${CAPTCHA_TILE}" rx="6" fill="hsl(${hue},${Math.floor(rnd(35, 60))}%,${Math.floor(rnd(80, 90))}%)"/>`
    );
    for (let k = 0; k < 4; k++) {
      parts.push(
        `<line x1="${(x + rnd(0, CAPTCHA_TILE)).toFixed(1)}" y1="${(y + rnd(0, CAPTCHA_TILE)).toFixed(1)}" x2="${(x + rnd(0, CAPTCHA_TILE)).toFixed(1)}" y2="${(y + rnd(0, CAPTCHA_TILE)).toFixed(1)}" stroke="hsl(${hue},40%,${Math.floor(rnd(55, 70))}%)" stroke-width="${rnd(1, 3).toFixed(1)}"/>`
      );
    }
    const shapes: CaptchaShape[] = targetTiles.has(i)
      ? [target, ...(crypto.randomInt(0, 2) ? [others[crypto.randomInt(0, others.length)]] : [])]
      : Array.from({ length: 1 + crypto.randomInt(0, 2) }, () => others[crypto.randomInt(0, others.length)]);
    shuffle(shapes).forEach((shape, idx) => {
      const big = shapes.length === 1;
      const s = big ? rnd(44, 62) : rnd(30, 42);
      const cx = x + (big ? CAPTCHA_TILE / 2 + rnd(-10, 10) : idx === 0 ? rnd(26, 40) : rnd(56, 70));
      const cy = y + (big ? CAPTCHA_TILE / 2 + rnd(-10, 10) : rnd(28, 68));
      parts.push(shapeSvg(shape, cx, cy, s));
    });
  }
  for (let i = 0; i < 5; i++) {
    parts.push(
      `<path d="M${rnd(-10, 40)} ${rnd(0, size)} C${rnd(60, 140)} ${rnd(-40, size + 40)},${rnd(160, 240)} ${rnd(-40, size + 40)},${rnd(size - 40, size + 10)} ${rnd(0, size)}" stroke="${darkColor()}" stroke-width="${rnd(1, 2.2).toFixed(1)}" fill="none" opacity="0.45"/>`
    );
  }
  for (let i = 0; i < 260; i++) {
    parts.push(
      `<circle cx="${rnd(0, size).toFixed(1)}" cy="${rnd(0, size).toFixed(1)}" r="${rnd(0.6, 1.8).toFixed(1)}" fill="${darkColor()}" opacity="0.5"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${parts.join("")}</svg>`;
}

const answerKey = (tiles: number[]): string => [...new Set(tiles)].sort((a, b) => a - b).join(",");

export async function createCaptcha(userId: number) {
  // Opportunistic cleanup of expired rows.
  prisma.downloadCaptcha.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  const target = SHAPE_KEYS[crypto.randomInt(0, SHAPE_KEYS.length)];
  const tileCount = CAPTCHA_GRID * CAPTCHA_GRID;
  const targetTiles = new Set(
    shuffle(Array.from({ length: tileCount }, (_, i) => i)).slice(0, 2 + crypto.randomInt(0, 3)) // 2–4 tiles
  );
  const png = await sharp(Buffer.from(captchaGridSvg(target, targetTiles))).png().toBuffer();
  const row = await prisma.downloadCaptcha.create({
    data: {
      userId,
      answerHash: sha256(answerKey([...targetTiles])),
      expiresAt: new Date(Date.now() + CAPTCHA_TTL_MS),
    },
    select: { id: true },
  });
  return {
    captchaId: row.id,
    image: `data:image/png;base64,${png.toString("base64")}`,
    prompt: `Select every tile that contains a ${CAPTCHA_SHAPES[target].label}`,
    grid: CAPTCHA_GRID,
  };
}

/** Checks (and always consumes) a captcha. */
export async function verifyCaptcha(captchaId: unknown, answer: unknown, userId: number): Promise<void> {
  const entry =
    typeof captchaId === "string" && captchaId
      ? await prisma.downloadCaptcha.findUnique({ where: { id: captchaId } })
      : null;
  if (entry) await prisma.downloadCaptcha.delete({ where: { id: entry.id } }).catch(() => {});
  if (!entry || entry.userId !== userId || entry.expiresAt.getTime() < Date.now()) {
    throw new SecurityError(410, "The captcha has expired. Please try the new one.");
  }
  const tiles = Array.isArray(answer) ? answer.map(Number) : [];
  const valid =
    tiles.length > 0 && tiles.every((t) => Number.isInteger(t) && t >= 0 && t < CAPTCHA_GRID * CAPTCHA_GRID);
  if (!valid || sha256(answerKey(tiles)) !== entry.answerHash) {
    throw new SecurityError(400, "Incorrect selection. Please try the new picture.");
  }
}

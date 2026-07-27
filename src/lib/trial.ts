import type { Request } from "express";
import prisma from "../prismaClient";

// ─────────────────────────────────────────────────────────────────────────────
// Demo / trial licensing.
//
// The whole subsystem is opt-in per deployment via TRIAL_ENABLED=true. A paying
// client's .env simply omits it, so `trialEnabled()` is false, every helper here
// short-circuits, and not a single extra query runs. Every check also FAILS OPEN
// (missing row, malformed row, DB error → allow) so a licensing bug can never
// lock a customer out of their own system.
// ─────────────────────────────────────────────────────────────────────────────

export type TrialCode =
  | "OK"
  | "TRIAL_EXPIRED"
  | "TRIAL_REVOKED"
  | "TRIAL_IP_BLOCKED"
  | "TRIAL_USER_NOT_ALLOWED";

export type TrialViolationReason =
  | "EXPIRED"
  | "REVOKED"
  | "IP_BLOCKED"
  | "NEW_IP"
  | "USER_NOT_ALLOWED"
  | "SESSION_TAKEOVER";

export interface TrialVerdict {
  ok: boolean;
  code: TrialCode;
  message: string;
}

export type TrialLicenseRow = Awaited<ReturnType<typeof prisma.trialLicense.findFirst>>;

export const trialEnabled = (): boolean => process.env.TRIAL_ENABLED === "true";

// The license is read once per window and held in memory — the guard runs on
// every request and must not add a query to each one. The window is also the
// worst-case delay before a revoke takes effect; drop TRIAL_CACHE_MS if you want
// the kill switch to bite faster.
const CACHE_MS = Number(process.env.TRIAL_CACHE_MS ?? 60_000);

let cached: { at: number; value: TrialLicenseRow } = { at: 0, value: null };

/** Force the next read to hit the DB. Call after any write to the license. */
export const invalidateTrialCache = (): void => {
  cached = { at: 0, value: null };
};

export async function getTrialLicense(): Promise<TrialLicenseRow> {
  if (!trialEnabled()) return null;

  const now = Date.now();
  if (cached.at && now - cached.at < CACHE_MS) return cached.value;

  try {
    const value = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });
    cached = { at: now, value };
    return value;
  } catch (err) {
    console.error("[trial] license read failed — allowing request:", err);
    return null;
  }
}

// ── IP handling ──────────────────────────────────────────────────────────────

/**
 * Express reports IPv4 addresses in IPv4-mapped IPv6 form ("::ffff:49.207.1.2")
 * depending on how the request reached the socket, so the same visitor can be
 * recorded two different ways. Normalise before storing or comparing.
 */
export function normalizeIp(raw: string | null | undefined): string {
  let ip = (raw ?? "").trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

export function clientIp(req: Request): string {
  return normalizeIp(req.ip ?? req.socket?.remoteAddress ?? "");
}

const ipv4ToLong = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255 || part.trim() === "") return null;
    out = out * 256 + n;
  }
  return out >>> 0;
};

/** Matches an IP against an exact address, an IPv4 CIDR, or an octet wildcard. */
export function ipMatches(ip: string, pattern: string): boolean {
  const p = (pattern ?? "").trim();
  if (!p || !ip) return false;
  if (p === ip) return true;

  if (p.includes("/")) {
    const [base, bitsRaw] = p.split("/");
    const bits = Number(bitsRaw);
    const a = ipv4ToLong(ip);
    const b = ipv4ToLong(base);
    if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }

  if (p.includes("*")) {
    const pat = p.split(".");
    const parts = ip.split(".");
    if (pat.length !== 4 || parts.length !== 4) return false;
    return pat.every((seg, i) => seg === "*" || seg === parts[i]);
  }

  return false;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * IP verdict for a login attempt.
 *
 * `blocked` only ever comes back true in LOCK_FIRST / ALLOWLIST mode. ALERT mode
 * is the sane default for a demo: broadband and mobile networks hand out new
 * addresses constantly, so hard IP locking mostly locks out the person you are
 * trying to sell to. `newIp` still fires, which is what surfaces sharing.
 */
export function checkTrialIp(
  license: NonNullable<TrialLicenseRow>,
  ip: string
): { blocked: boolean; newIp: boolean } {
  const mode = license.ipMode || "OFF";
  if (mode === "OFF" || !ip) return { blocked: false, newIp: false };

  if (mode === "ALLOWLIST") {
    const list = asStringArray(license.allowedIps);
    // An empty allowlist is a misconfiguration, not an instruction to block
    // everyone — treat it as "not configured yet".
    if (!list.length) return { blocked: false, newIp: false };
    const hit = list.some((pattern) => ipMatches(ip, pattern));
    return { blocked: !hit, newIp: !hit };
  }

  if (mode === "LOCK_FIRST") {
    if (!license.lockedIp) return { blocked: false, newIp: false }; // first login binds it
    const different = normalizeIp(license.lockedIp) !== ip;
    return { blocked: different, newIp: different };
  }

  // ALERT
  const known = normalizeIp(license.lockedIp);
  return { blocked: false, newIp: !!known && known !== ip };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export function evaluateTrial(license: TrialLicenseRow, now: Date = new Date()): TrialVerdict {
  if (!license) return { ok: true, code: "OK", message: "" };

  if (license.status === "REVOKED") {
    return {
      ok: false,
      code: "TRIAL_REVOKED",
      message: "This demo access has been withdrawn. Please contact Invention Minds.",
    };
  }

  if (license.expiresAt && license.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: "TRIAL_EXPIRED",
      message: "Your demo period has ended. Please contact Invention Minds to continue.",
    };
  }

  return { ok: true, code: "OK", message: "" };
}

/** Small payload the client app polls for the countdown banner. */
export function trialStatusPayload(license: TrialLicenseRow) {
  if (!trialEnabled() || !license) return { trial: false as const };

  const verdict = evaluateTrial(license);
  const msLeft = license.expiresAt.getTime() - Date.now();

  return {
    trial: true as const,
    clientName: license.clientName,
    status: license.status,
    expiresAt: license.expiresAt,
    active: verdict.ok,
    code: verdict.code,
    message: verdict.message,
    hoursLeft: Math.max(0, Math.floor(msLeft / 3_600_000)),
    daysLeft: Math.max(0, Math.ceil(msLeft / 86_400_000)),
  };
}

// ── Violation log ────────────────────────────────────────────────────────────

// The SPA polls, so a blocked client would write hundreds of identical rows a
// minute. Collapse repeats of the same (reason, ip) inside this window.
const VIOLATION_THROTTLE_MS = 60_000;
const lastLogged = new Map<string, number>();

export function recordTrialViolation(data: {
  reason: TrialViolationReason;
  employeeId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  path?: string | null;
  detail?: string | null;
  throttle?: boolean;
}): void {
  if (!trialEnabled()) return;

  if (data.throttle !== false) {
    const key = `${data.reason}|${data.ipAddress ?? ""}|${data.employeeId ?? ""}`;
    const now = Date.now();
    const prev = lastLogged.get(key);
    if (prev && now - prev < VIOLATION_THROTTLE_MS) return;
    lastLogged.set(key, now);
    // Bounded so a hostile client can't grow the map without limit.
    if (lastLogged.size > 500) lastLogged.clear();
  }

  prisma.trialViolation
    .create({
      data: {
        reason: data.reason,
        employeeId: data.employeeId ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ? String(data.userAgent).slice(0, 500) : null,
        path: data.path ?? null,
        detail: data.detail ?? null,
      },
    })
    .catch((err) => console.error("[trial] violation log failed:", err));
}

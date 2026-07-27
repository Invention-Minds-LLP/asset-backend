import { Request, Response } from "express";
import prisma from "../../prismaClient";
import {
  asStringArray,
  getTrialLicense,
  invalidateTrialCache,
  normalizeIp,
  trialEnabled,
  trialStatusPayload,
} from "../../lib/trial";

const IP_MODES = ["OFF", "ALERT", "LOCK_FIRST", "ALLOWLIST"];

/**
 * Countdown banner feed for the demo user. Safe to expose to any logged-in user —
 * it carries dates and a status, nothing that lets them change the terms.
 */
export const getTrialStatus = async (_req: Request, res: Response) => {
  try {
    const license = await getTrialLicense();
    res.json(trialStatusPayload(license));
  } catch (err) {
    console.error("[trial] status failed:", err);
    res.status(500).json({ message: "Failed to read trial status" });
  }
};

/** Full licence — admin key only. */
export const getTrial = async (_req: Request, res: Response) => {
  try {
    const license = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });
    const [activeSessions, violationCount] = await Promise.all([
      prisma.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.trialViolation.count(),
    ]);

    res.json({
      enabled: trialEnabled(),
      license,
      status: trialStatusPayload(license),
      activeSessions,
      violationCount,
    });
  } catch (err) {
    console.error("[trial] get failed:", err);
    res.status(500).json({ message: "Failed to read trial licence" });
  }
};

interface UpsertTrialBody {
  clientName?: string;
  status?: string;
  startsAt?: string;
  expiresAt?: string;
  singleSession?: boolean;
  allowedEmployeeIds?: string[];
  ipMode?: string;
  allowedIps?: string[];
  lockedIp?: string | null;
  notes?: string | null;
}

/** Create the licence, or update the existing one. Admin key only. */
export const upsertTrial = async (req: Request, res: Response) => {
  try {
    const body = req.body as UpsertTrialBody;
    const existing = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });

    if (body.ipMode && !IP_MODES.includes(body.ipMode)) {
      res.status(400).json({ message: `ipMode must be one of ${IP_MODES.join(", ")}` });
      return;
    }
    if (body.status && !["ACTIVE", "REVOKED"].includes(body.status)) {
      res.status(400).json({ message: "status must be ACTIVE or REVOKED" });
      return;
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : existing?.expiresAt;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      res.status(400).json({ message: "A valid expiresAt is required" });
      return;
    }

    const data = {
      clientName: body.clientName ?? existing?.clientName ?? "Demo",
      status: body.status ?? existing?.status ?? "ACTIVE",
      startsAt: body.startsAt ? new Date(body.startsAt) : existing?.startsAt ?? new Date(),
      expiresAt,
      singleSession: body.singleSession ?? existing?.singleSession ?? true,
      allowedEmployeeIds: body.allowedEmployeeIds
        ? asStringArray(body.allowedEmployeeIds)
        : existing?.allowedEmployeeIds ?? [],
      ipMode: body.ipMode ?? existing?.ipMode ?? "ALERT",
      allowedIps: body.allowedIps ? asStringArray(body.allowedIps) : existing?.allowedIps ?? [],
      lockedIp:
        body.lockedIp === undefined ? existing?.lockedIp ?? null : normalizeIp(body.lockedIp) || null,
      notes: body.notes === undefined ? existing?.notes ?? null : body.notes,
    };

    const license = existing
      ? await prisma.trialLicense.update({ where: { id: existing.id }, data })
      : await prisma.trialLicense.create({ data });

    invalidateTrialCache();
    res.json({ message: "Trial licence saved", license });
  } catch (err) {
    console.error("[trial] upsert failed:", err);
    res.status(500).json({ message: "Failed to save trial licence" });
  }
};

/**
 * Push the expiry out by N days. Extends from *now* when the trial has already
 * lapsed, so re-activating a dead demo gives the client the full extra window
 * rather than silently expiring again.
 */
export const extendTrial = async (req: Request, res: Response) => {
  try {
    const days = Number(req.body?.days);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      res.status(400).json({ message: "days must be a number between 1 and 365" });
      return;
    }

    const existing = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });
    if (!existing) {
      res.status(404).json({ message: "No trial licence on this instance" });
      return;
    }

    const now = new Date();
    const base = existing.expiresAt > now ? existing.expiresAt : now;
    const expiresAt = new Date(base.getTime() + days * 86_400_000);

    const license = await prisma.trialLicense.update({
      where: { id: existing.id },
      data: { expiresAt, status: "ACTIVE" },
    });

    invalidateTrialCache();
    res.json({ message: `Trial extended by ${days} day(s)`, license });
  } catch (err) {
    console.error("[trial] extend failed:", err);
    res.status(500).json({ message: "Failed to extend trial" });
  }
};

/**
 * Kill switch. Flips the licence to REVOKED and drops every live session, so the
 * client is locked out immediately instead of riding their current access token
 * until it expires.
 */
export const revokeTrial = async (_req: Request, res: Response) => {
  try {
    const existing = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });
    if (!existing) {
      res.status(404).json({ message: "No trial licence on this instance" });
      return;
    }

    const license = await prisma.trialLicense.update({
      where: { id: existing.id },
      data: { status: "REVOKED" },
    });
    const killed = await prisma.refreshToken.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });

    invalidateTrialCache();
    res.json({ message: "Trial revoked", sessionsEnded: killed.count, license });
  } catch (err) {
    console.error("[trial] revoke failed:", err);
    res.status(500).json({ message: "Failed to revoke trial" });
  }
};

/** Undo a revoke. Does not move the expiry — use extend for that. */
export const reactivateTrial = async (_req: Request, res: Response) => {
  try {
    const existing = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });
    if (!existing) {
      res.status(404).json({ message: "No trial licence on this instance" });
      return;
    }

    const license = await prisma.trialLicense.update({
      where: { id: existing.id },
      data: { status: "ACTIVE" },
    });

    invalidateTrialCache();
    res.json({ message: "Trial reactivated", license });
  } catch (err) {
    console.error("[trial] reactivate failed:", err);
    res.status(500).json({ message: "Failed to reactivate trial" });
  }
};

/** Clears the bound IP so the next successful login re-binds (LOCK_FIRST mode). */
export const resetLockedIp = async (_req: Request, res: Response) => {
  try {
    const existing = await prisma.trialLicense.findFirst({ orderBy: { id: "asc" } });
    if (!existing) {
      res.status(404).json({ message: "No trial licence on this instance" });
      return;
    }

    const license = await prisma.trialLicense.update({
      where: { id: existing.id },
      data: { lockedIp: null },
    });

    invalidateTrialCache();
    res.json({ message: "Locked IP cleared — the next login will re-bind it", license });
  } catch (err) {
    console.error("[trial] reset ip failed:", err);
    res.status(500).json({ message: "Failed to clear locked IP" });
  }
};

/** Access log: rejections plus new-IP / second-device signals. */
export const getViolations = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const reason = req.query.reason ? String(req.query.reason) : undefined;

    const violations = await prisma.trialViolation.findMany({
      where: reason ? { reason } : undefined,
      orderBy: { occurredAt: "desc" },
      take: limit,
    });

    res.json({ count: violations.length, violations });
  } catch (err) {
    console.error("[trial] violations failed:", err);
    res.status(500).json({ message: "Failed to read violations" });
  }
};

/** Recent logins with their IPs — the other half of the sharing picture. */
export const getTrialLogins = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logins = await prisma.loginHistory.findMany({
      orderBy: { attemptedAt: "desc" },
      take: limit,
      include: { user: { select: { employeeID: true, username: true } } },
    });

    res.json({
      count: logins.length,
      logins: logins.map((l) => ({
        id: l.id,
        attemptedAt: l.attemptedAt,
        success: l.success,
        ipAddress: normalizeIp(l.ipAddress),
        userAgent: l.userAgent,
        employeeID: l.user?.employeeID ?? null,
        username: l.user?.username ?? null,
      })),
    });
  } catch (err) {
    console.error("[trial] logins failed:", err);
    res.status(500).json({ message: "Failed to read login history" });
  }
};

/** Ends every live session without touching the licence. */
export const endAllSessions = async (_req: Request, res: Response) => {
  try {
    const killed = await prisma.refreshToken.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.json({ message: "All sessions ended", sessionsEnded: killed.count });
  } catch (err) {
    console.error("[trial] end sessions failed:", err);
    res.status(500).json({ message: "Failed to end sessions" });
  }
};

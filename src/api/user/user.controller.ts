import { Request, Response } from "express";
import prisma from "../../prismaClient";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  signAccessToken,
  createRefreshToken,
  validateRefreshToken,
  revokeRefreshTokenById,
  revokeRefreshTokenByRaw,
  rotateUserSession,
  setRefreshCookie,
  clearRefreshCookie,
  issueCsrfCookie,
  csrfOk,
  REFRESH_COOKIE,
} from "./auth.helpers";
import {
  asStringArray,
  checkTrialIp,
  evaluateTrial,
  getTrialLicense,
  invalidateTrialCache,
  normalizeIp,
  recordTrialViolation,
  trialEnabled,
} from "../../lib/trial";

// Validated at startup by src/config/validateEnv.ts — no insecure fallback.
const JWT_SECRET = process.env.JWT_SECRET as string;

/**
 * Trial rules applied at the moment of login: is the demo still valid, is this
 * employee on the permitted list, is the IP acceptable, and is anyone else
 * already signed in as them.
 *
 * Runs only after the password has been verified, so it never leaks trial state
 * to someone guessing credentials. Returns true when it has already answered the
 * request and the caller must stop.
 */
async function enforceTrialOnLogin(
  user: { id: number; employeeID: string },
  ip: string,
  userAgent: string,
  res: Response
): Promise<boolean> {
  const license = await getTrialLicense();

  const verdict = evaluateTrial(license);
  if (!verdict.ok) {
    recordTrialViolation({
      reason: verdict.code === "TRIAL_REVOKED" ? "REVOKED" : "EXPIRED",
      employeeId: user.employeeID,
      ipAddress: ip,
      userAgent,
      path: "/api/users/login",
    });
    res.status(403).json({ code: verdict.code, message: verdict.message });
    return true;
  }

  if (!license) return false;

  // Named-user demo: only the evaluator we agreed on can sign in.
  const allowed = asStringArray(license.allowedEmployeeIds);
  if (allowed.length && !allowed.includes(user.employeeID)) {
    recordTrialViolation({
      reason: "USER_NOT_ALLOWED",
      employeeId: user.employeeID,
      ipAddress: ip,
      userAgent,
      detail: `permitted: ${allowed.join(", ")}`,
    });
    res.status(403).json({
      code: "TRIAL_USER_NOT_ALLOWED",
      message: "This login is not enabled for the demo. Please contact Invention Minds.",
    });
    return true;
  }

  const { blocked, newIp } = checkTrialIp(license, ip);
  if (blocked) {
    recordTrialViolation({
      reason: "IP_BLOCKED",
      employeeId: user.employeeID,
      ipAddress: ip,
      userAgent,
      detail: `mode=${license.ipMode} bound=${license.lockedIp ?? "-"}`,
    });
    res.status(403).json({
      code: "TRIAL_IP_BLOCKED",
      message: "This demo is restricted to an approved network. Please contact Invention Minds.",
    });
    return true;
  }
  if (newIp) {
    // ALERT mode: let them in, but leave a trail that the network changed.
    recordTrialViolation({
      reason: "NEW_IP",
      employeeId: user.employeeID,
      ipAddress: ip,
      userAgent,
      detail: `previously seen from ${license.lockedIp ?? "-"}`,
    });
  }

  // LOCK_FIRST binds on the first successful login rather than up front, so we
  // don't have to know the client's address before the demo starts.
  if (license.ipMode === "LOCK_FIRST" && !license.lockedIp && ip) {
    await prisma.trialLicense.update({ where: { id: license.id }, data: { lockedIp: ip } });
    invalidateTrialCache();
  } else if (license.ipMode === "ALERT" && !license.lockedIp && ip) {
    // ALERT mode still needs a baseline to compare against.
    await prisma.trialLicense.update({ where: { id: license.id }, data: { lockedIp: ip } });
    invalidateTrialCache();
  }

  // One live session per user. Revoking beats IP matching for "only one person":
  // if the password gets shared, the second person's login ejects the first.
  if (license.singleSession) {
    const live = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ipAddress: true },
    });

    if (live.length) {
      await prisma.refreshToken.updateMany({
        where: { id: { in: live.map((t) => t.id) } },
        data: { revokedAt: new Date() },
      });

      // Only worth reporting when the ejected session came from somewhere else —
      // the same person reopening their browser is not a violation.
      const elsewhere = live.find((t) => normalizeIp(t.ipAddress) !== ip);
      if (elsewhere) {
        recordTrialViolation({
          reason: "SESSION_TAKEOVER",
          employeeId: user.employeeID,
          ipAddress: ip,
          userAgent,
          detail: `ejected an active session from ${normalizeIp(elsewhere.ipAddress) || "unknown"}`,
          throttle: false,
        });
      }
    }
  }

  return false;
}

export const loginUser = async (req: Request, res: Response) => {
  const { employeeId, password } = req.body;

  if (!employeeId || !password) {
    res.status(400).json({ message: "Employee ID and password are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { employeeID: employeeId }, include: { employee: true }, });

  const clientIp = req.ip; // or req.headers["x-forwarded-for"]
  const userAgent = req.headers["user-agent"] || "unknown";

  if (!user) {
    res.status(401).json({ message: "Invalid username or password" });
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  // Log the login attempt BEFORE responding:
  await prisma.loginHistory.create({
    data: {
      userId: user.id,
      attemptedAt: new Date(),
      ipAddress: clientIp,
      userAgent,
      success: isPasswordValid,
    },
  });

  if (!isPasswordValid) {
    res.status(401).json({ message: "Invalid username or password" });
    return
  }

  // Deactivated employees cannot sign in. Checked after the password so we
  // don't reveal account state to someone guessing credentials.
  if (user.employee?.isActive === false) {
    res.status(403).json({ message: "Your account is inactive. Please contact your administrator." });
    return;
  }

  // Demo/trial gate. Entirely inert unless TRIAL_ENABLED=true on this instance —
  // a paying client's deployment never enters this block.
  if (trialEnabled()) {
    const blocked = await enforceTrialOnLogin(user, normalizeIp(clientIp), userAgent, res);
    if (blocked) return;
  }

  // Successful login → update lastLogin
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  // Start a fresh single web session: stamp the user and revoke prior refresh
  // tokens. Runs before createRefreshToken below so THIS login's token survives.
  // Any session already open elsewhere is ejected on its next request.
  const sid = await rotateUserSession(user.id);

  // Short-lived access token (returned in the body → held in memory on the client).
  const token = signAccessToken({
    userId: user.id,
    employeeID: user.employeeID,
    employeeDbId: user.employee?.id,
    role: user.role,
    name: user.employee?.name,
    departmentId: user.employee?.departmentId,
    sid,
  });

  // Long-lived refresh token → httpOnly cookie (hashed in DB) + CSRF cookie.
  const refresh = await createRefreshToken(user.id, req);
  setRefreshCookie(res, refresh, req);
  issueCsrfCookie(res, req);

  res.json({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      username: user.username,
      employeeID: user.employeeID,
      employeeDbId: user.employee.id,
      role: user.role,
      name: user.employee?.name,
      lastLogin: new Date(),
      departmentId: user.employee?.departmentId
    },
  });
  return;
};

// Silent refresh: swap the httpOnly refresh cookie for a fresh access token.
// Rotates the refresh token (revoke old, issue new) so a stolen one has a short
// life and reuse can be detected.
export const refreshAccessToken = async (req: Request, res: Response) => {
  const raw = (req as any).cookies?.[REFRESH_COOKIE] as string | undefined;

  if (!csrfOk(req)) {
    res.status(403).json({ message: "Invalid CSRF token" });
    return;
  }

  const valid = await validateRefreshToken(raw);
  if (!valid) {
    clearRefreshCookie(res, req);
    res.status(401).json({ message: "Session expired. Please log in again." });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: valid.userId }, include: { employee: true } });
  if (!user || user.employee?.isActive === false) {
    await revokeRefreshTokenById(valid.id);
    clearRefreshCookie(res, req);
    res.status(401).json({ message: "Account inactive. Please log in again." });
    return;
  }

  // Rotate the refresh token.
  await revokeRefreshTokenById(valid.id);
  const nextRefresh = await createRefreshToken(user.id, req);
  setRefreshCookie(res, nextRefresh, req);
  issueCsrfCookie(res, req);

  // Re-issue with the session's CURRENT stamp so a legitimate rolling session
  // keeps working. If a login elsewhere had already rotated it, this refresh
  // would not reach here — the old refresh token was revoked and rejected above.
  const token = signAccessToken({
    userId: user.id,
    employeeID: user.employeeID,
    employeeDbId: user.employee?.id,
    role: user.role,
    name: user.employee?.name,
    departmentId: user.employee?.departmentId,
    sid: user.activeSessionId ?? undefined,
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      employeeID: user.employeeID,
      employeeDbId: user.employee?.id,
      role: user.role,
      name: user.employee?.name,
      departmentId: user.employee?.departmentId,
    },
  });
};

// Logout: revoke the refresh token server-side and clear the cookie.
export const logoutUser = async (req: Request, res: Response) => {
  if (!csrfOk(req)) {
    res.status(403).json({ message: "Invalid CSRF token" });
    return;
  }
  const raw = (req as any).cookies?.[REFRESH_COOKIE] as string | undefined;
  await revokeRefreshTokenByRaw(raw);
  clearRefreshCookie(res, req);
  res.json({ message: "Logged out" });
};

export const resetPassword = async (req: Request, res: Response) => {
  const { employeeID, newPassword } = req.body;

  if (!employeeID || !newPassword) {
    res.status(400).json({ message: "employeeID and newPassword are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { employeeID } });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { employeeID },
    data: { passwordHash: hashedPassword },
  });

  res.json({ message: "Password reset successful" });
};

export const getAllUsers = async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({ include: { employee: true } });
  res.json(users);
};

export const createUser = async (req: Request, res: Response) => {
  const { username, password, role, employeeID } = req.body;

  if (!username || !password || !role || !employeeID) {
    res.status(400).json({ message: "Missing required fields" });
    return
  }

  const hashedPassword = await bcrypt.hash(password, 10); // ✅ hash the password securely

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hashedPassword, // ✅ store the hashed password
      role,
      employeeID: employeeID,       // assuming your User.employeeID is linked to Employee.employeeId (string)
    },
  });

  res.status(201).json(user);
  return
};

export const deleteUser = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.user.delete({ where: { id } });
  res.status(204).send();
};

// Partial-patch user fields (username, role). Password changes go via /reset-password.
export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { username, role } = req.body ?? {};
    const data: any = {};
    if (username !== undefined) {
      const u = String(username).trim();
      if (!u) {
        res.status(400).json({ message: "username cannot be empty" });
        return;
      }
      data.username = u;
    }
    if (role !== undefined) {
      const r = String(role).trim();
      if (!r) {
        res.status(400).json({ message: "role cannot be empty" });
        return;
      }
      data.role = r;
    }
    console.log("updateUser data:", data);
    if (Object.keys(data).length === 0) {
      res.status(400).json({ message: "No editable fields provided" });
      return;
    }
    const user = await prisma.user.update({
      where: { id },
      data,
      include: { employee: true },
    });
    // Strip password hash from response
    const { passwordHash, ...safe } = user as any;
    res.json(safe);
  } catch (err: any) {
    console.error("updateUser error:", err);
    res.status(500).json({ message: err.message || "Failed to update user" });
  }
};

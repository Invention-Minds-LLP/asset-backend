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
  setRefreshCookie,
  clearRefreshCookie,
  issueCsrfCookie,
  csrfOk,
  REFRESH_COOKIE,
} from "./auth.helpers";

// Validated at startup by src/config/validateEnv.ts — no insecure fallback.
const JWT_SECRET = process.env.JWT_SECRET as string;

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

  // Successful login → update lastLogin
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  // Short-lived access token (returned in the body → held in memory on the client).
  const token = signAccessToken({
    userId: user.id,
    employeeID: user.employeeID,
    employeeDbId: user.employee?.id,
    role: user.role,
    name: user.employee?.name,
    departmentId: user.employee?.departmentId,
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

  const token = signAccessToken({
    userId: user.id,
    employeeID: user.employeeID,
    employeeDbId: user.employee?.id,
    role: user.role,
    name: user.employee?.name,
    departmentId: user.employee?.departmentId,
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

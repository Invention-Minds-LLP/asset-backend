import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import prisma from "../prismaClient";

// Validated at startup by src/config/validateEnv.ts — no insecure fallback.
const JWT_SECRET = process.env.JWT_SECRET as string;

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload; // you can type this properly if you like
}

export interface AuthUserPayload {
  id: number;
  userId: number;
  employeeID: string;      // Employee.employeeID (string)
  employeeDbId: number;    // Employee.id (int)
  role: string;
  name?: string;
  departmentId?: number;   // present on the decoded JWT (set in authenticateToken)
}


export const authenticateToken = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
    const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
     res.status(401).json({ message: "Unauthorized: No token provided" });
     return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
        req.user = {
      // `id` is the Employee.id, matching mobileAuthMiddleware and every
      // *ById column in the schema (they all FK to Employee). It was missing
      // here, so controllers reading req.user.id — audit's conductedById /
      // verifiedById / qrStickeredById, disposal's requestedById /
      // approvedById / completedById, cost-analysis's recordedById — silently
      // persisted NULL for every web request.
      id: decoded.employeeDbId,
      userId: decoded.userId,
      employeeID: decoded.employeeID,
      employeeDbId: decoded.employeeDbId,
      role: decoded.role,
      name: decoded.name,
      departmentId: decoded.departmentId
    };

    // A still-valid token must not outlive the employee's access: re-check the
    // ACTIVE flag on every request so deactivating someone ejects them right
    // away (the frontend interceptor logs out on 401). Same guarantee the
    // external-auditor middleware gives. Fails open if the row can't be
    // resolved, so a data anomaly never locks anyone out.
    //
    // Same query also enforces single web session: the token carries the stamp
    // (`sid`) it was minted with; a login elsewhere overwrites User.activeSessionId,
    // so a stale stamp here means this device has been superseded. Fails OPEN when
    // either side is missing — tokens issued before this feature, or mobile tokens
    // (no sid), are never blocked by it.
    if (decoded.userId) {
      const account = await prisma.user.findUnique({
        where: { id: Number(decoded.userId) },
        select: { activeSessionId: true, employee: { select: { isActive: true } } },
      });

      if (account?.employee?.isActive === false) {
        res.status(401).json({ message: "Your account is inactive. Please contact your administrator." });
        return;
      }

      if (
        decoded.sid &&
        account?.activeSessionId &&
        decoded.sid !== account.activeSessionId
      ) {
        res.status(401).json({
          message: "You have been signed out because this account was used to log in on another device.",
        });
        return;
      }
    }

 // attach decoded payload to request
    next();
     return
  } catch (error) {
    console.error("JWT verification failed:", error);
    // 401 (not 403): an invalid/expired token means "not authenticated" —
    // the frontend interceptor logs out ONLY on 401. 403 is reserved for
    // authenticated users lacking permission (e.g. management-only pages)
    // and must NOT end the session.
    res.status(401).json({ message: "Unauthorized: Invalid token" });
    return;
  }
};

import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
};
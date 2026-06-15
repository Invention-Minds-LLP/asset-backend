import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import prisma from "../prismaClient";

// Validated at startup by src/config/validateEnv.ts — no insecure fallback.
const JWT_SECRET = process.env.JWT_SECRET as string;

export interface ExternalAuditorRequest extends Request {
  externalAuditor?: {
    id: number;
    email: string;
  };
}

// Auth middleware for external auditor routes. Differs from `mobileAuth` /
// `authenticateToken` in two ways:
//   1. Requires the JWT's userType claim to be 'EXTERNAL'.
//   2. Re-checks ExternalAuditor.status === 'ACTIVE' on EVERY request, so a
//      mid-session deactivation cuts off access immediately.
//
// The per-request DB lookup costs ~1 query/req. Acceptable: external auditor
// traffic is low volume and the security guarantee is worth it.
export const externalAuditorAuth = async (
  req: ExternalAuditorRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

    if (!token) {
      res.status(401).json({ message: "Unauthorized: No token provided" });
      return;
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      res.status(403).json({ message: "Forbidden: Invalid token" });
      return;
    }

    if (decoded.userType !== "EXTERNAL" || !decoded.externalAuditorId) {
      res.status(403).json({ message: "Forbidden: Wrong token type" });
      return;
    }

    const auditor = await prisma.externalAuditor.findUnique({
      where: { id: Number(decoded.externalAuditorId) },
      select: { id: true, email: true, status: true },
    });

    if (!auditor || auditor.status !== "ACTIVE") {
      res.status(401).json({ message: "Account no longer available." });
      return;
    }

    req.externalAuditor = { id: auditor.id, email: auditor.email };
    next();
  } catch (error: any) {
    console.error("externalAuditorAuth error:", error);
    res.status(500).json({ message: "Auth check failed" });
  }
};

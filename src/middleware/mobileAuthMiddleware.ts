import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";

export interface MobileAuthRequest extends Request {
  user?: {
    id: number;
    userId: number;
    employeeID: string;
    employeeDbId: number;
    role: string;
    name?: string;
    departmentId?: number;
  };
}

export const mobileAuth = (
  req: any,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader?.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: "Unauthorized: No token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = {
      id: decoded.employeeDbId,
      userId: decoded.userId,
      employeeID: decoded.employeeID,
      employeeDbId: decoded.employeeDbId,
      role: decoded.role,
      name: decoded.name,
      departmentId: decoded.departmentId,
    };
    next();
  } catch (error: any) {
    console.error("Mobile JWT error:", error.message);
    res.status(403).json({ message: "Invalid or expired token", error: error.message });
    return;
  }
};

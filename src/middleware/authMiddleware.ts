import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret"; // make sure to store in .env

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
}


export const authenticateToken = (
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
      userId: decoded.userId,
      employeeID: decoded.employeeID,
      employeeDbId: decoded.employeeDbId,
      role: decoded.role,
      name: decoded.name,
      departmentId: decoded.departmentId
    };
 // attach decoded payload to request
    next();
     return
  } catch (error) {
    console.error("JWT verification failed:", error);
     res.status(403).json({ message: "Forbidden: Invalid token" });
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
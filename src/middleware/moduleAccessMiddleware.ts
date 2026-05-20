import { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";

// Validated at startup by src/config/validateEnv.ts.
const JWT_SECRET = process.env.JWT_SECRET as string;

// Map API path prefix → AppModule.name. The longest matching prefix wins, so
// e.g. /api/store-stock resolves before /api/store.
const MODULE_BY_PREFIX: [string, string][] = [
  ["/api/asset-indent", "asset-indent"],
  ["/api/assets", "asset-master"],
  ["/api/sub-assets", "asset-master"],
  ["/api/assignments", "asset-master"],
  ["/api/transfers", "asset-master"],
  ["/api/disposal", "asset-master"],
  ["/api/store-transfer", "store-management"],
  ["/api/store-stock", "store-management"],
  ["/api/store", "store-management"],
  ["/api/inventory", "store-management"],
  ["/api/tickets", "maintenance"],
  ["/api/work-order", "maintenance"],
  ["/api/preventive-maintenance", "maintenance"],
  ["/api/pm-checklist", "maintenance"],
  ["/api/calibration", "maintenance"],
  ["/api/warranties", "contracts-coverage"],
  ["/api/insurance", "contracts-coverage"],
  ["/api/service-contracts", "contracts-coverage"],
  ["/api/vendor-performance", "contracts-coverage"],
  ["/api/financial-dashboard", "finance-analytics"],
  ["/api/cost-analysis", "finance-analytics"],
  ["/api/decision-engine", "finance-analytics"],
  ["/api/reports", "finance-analytics"],
  ["/api/export", "finance-analytics"],
  ["/api/gate-pass", "operations"],
  ["/api/acknowledgement", "operations"],
  ["/api/asset-audit", "operations"],
  ["/api/employee-exit", "operations"],
  ["/api/documents", "operations"],
  ["/api/knowledge-base", "operations"],
  ["/api/rca", "operations"],
];

// ── Server-side module-access enforcement ───────────────────────────────────
// Mounted once, globally, before the feature routers. It mirrors the resolution
// in module-access (getMyAccess):
//   • ADMIN  → always allowed
//   • employee-level permissions override role-level permissions
//   • no permissions configured at all → open access (fail open)
// It only ever returns 403 when permissions ARE configured for the caller and
// the requested module is not among them. On any error / missing token it
// falls through to next() so the route's own auth middleware handles it.
export const moduleAccessGuard: RequestHandler = async (req, res, next) => {
  try {
    const matches = MODULE_BY_PREFIX.filter(([p]) => req.path.startsWith(p));
    if (matches.length === 0) return next();
    const moduleName = matches.sort((a, b) => b[0].length - a[0].length)[0][1];

    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return next(); // route's authenticateToken will reject

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return next(); // route's authenticateToken will reject
    }

    const role = decoded.role === "user" ? "EXECUTIVE" : decoded.role;
    if (role === "ADMIN") return next();

    const employeeDbId = decoded.employeeDbId;

    const module = await prisma.appModule.findUnique({
      where: { name: moduleName },
      include: { subItems: { select: { id: true } } },
    });
    if (!module) return next(); // unknown module → don't block

    const [employeePerms, rolePerms] = await Promise.all([
      prisma.modulePermission.findMany({
        where: { employeeId: employeeDbId },
        select: { moduleId: true, moduleItemId: true, canAccess: true },
      }),
      prisma.modulePermission.findMany({
        where: { role, canAccess: true },
        select: { moduleId: true, moduleItemId: true, canAccess: true },
      }),
    ]);

    // Employee permissions, when present, fully override role permissions.
    const activePerms = employeePerms.length ? employeePerms : rolePerms;
    if (activePerms.length === 0) return next(); // nothing configured → open

    const subItemIds = new Set(module.subItems.map((s) => s.id));
    const allowed = activePerms.some((p) => {
      if (p.canAccess === false) return false;
      if (p.moduleId === module.id) return true;
      if (p.moduleItemId && subItemIds.has(p.moduleItemId)) return true;
      return false;
    });

    if (allowed) return next();
    res.status(403).json({ message: "You do not have access to this module." });
  } catch (err) {
    console.error("moduleAccessGuard error:", err);
    next(); // fail open — never hard-block on a middleware error
  }
};

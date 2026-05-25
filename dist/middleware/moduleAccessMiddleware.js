"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.moduleAccessGuard = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
// Validated at startup by src/config/validateEnv.ts.
const JWT_SECRET = process.env.JWT_SECRET;
// Map API path prefix → AppModule.name. The longest matching prefix wins, so
// e.g. /api/store-stock resolves before /api/store.
const MODULE_BY_PREFIX = [
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
const moduleAccessGuard = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const matches = MODULE_BY_PREFIX.filter(([p]) => req.path.startsWith(p));
        if (matches.length === 0)
            return next();
        const moduleName = matches.sort((a, b) => b[0].length - a[0].length)[0][1];
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(" ")[1];
        if (!token)
            return next(); // route's authenticateToken will reject
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        }
        catch (_b) {
            return next(); // route's authenticateToken will reject
        }
        const role = decoded.role === "user" ? "EXECUTIVE" : decoded.role;
        if (role === "ADMIN")
            return next();
        const employeeDbId = decoded.employeeDbId;
        const module = yield prismaClient_1.default.appModule.findUnique({
            where: { name: moduleName },
            include: { subItems: { select: { id: true } } },
        });
        if (!module)
            return next(); // unknown module → don't block
        const [employeePerms, rolePerms] = yield Promise.all([
            prismaClient_1.default.modulePermission.findMany({
                where: { employeeId: employeeDbId },
                select: { moduleId: true, moduleItemId: true, canAccess: true },
            }),
            prismaClient_1.default.modulePermission.findMany({
                where: { role, canAccess: true },
                select: { moduleId: true, moduleItemId: true, canAccess: true },
            }),
        ]);
        // Employee permissions, when present, fully override role permissions.
        const activePerms = employeePerms.length ? employeePerms : rolePerms;
        if (activePerms.length === 0)
            return next(); // nothing configured → open
        const subItemIds = new Set(module.subItems.map((s) => s.id));
        const allowed = activePerms.some((p) => {
            if (p.canAccess === false)
                return false;
            if (p.moduleId === module.id)
                return true;
            if (p.moduleItemId && subItemIds.has(p.moduleItemId))
                return true;
            return false;
        });
        if (allowed)
            return next();
        res.status(403).json({ message: "You do not have access to this module." });
    }
    catch (err) {
        console.error("moduleAccessGuard error:", err);
        next(); // fail open — never hard-block on a middleware error
    }
});
exports.moduleAccessGuard = moduleAccessGuard;

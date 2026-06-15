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
exports.externalAuditorAuth = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
// Validated at startup by src/config/validateEnv.ts — no insecure fallback.
const JWT_SECRET = process.env.JWT_SECRET;
// Auth middleware for external auditor routes. Differs from `mobileAuth` /
// `authenticateToken` in two ways:
//   1. Requires the JWT's userType claim to be 'EXTERNAL'.
//   2. Re-checks ExternalAuditor.status === 'ACTIVE' on EVERY request, so a
//      mid-session deactivation cuts off access immediately.
//
// The per-request DB lookup costs ~1 query/req. Acceptable: external auditor
// traffic is low volume and the security guarantee is worth it.
const externalAuditorAuth = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const header = req.headers.authorization;
        const token = (header === null || header === void 0 ? void 0 : header.startsWith("Bearer ")) ? header.slice("Bearer ".length) : null;
        if (!token) {
            res.status(401).json({ message: "Unauthorized: No token provided" });
            return;
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        }
        catch (_a) {
            res.status(403).json({ message: "Forbidden: Invalid token" });
            return;
        }
        if (decoded.userType !== "EXTERNAL" || !decoded.externalAuditorId) {
            res.status(403).json({ message: "Forbidden: Wrong token type" });
            return;
        }
        const auditor = yield prismaClient_1.default.externalAuditor.findUnique({
            where: { id: Number(decoded.externalAuditorId) },
            select: { id: true, email: true, status: true },
        });
        if (!auditor || auditor.status !== "ACTIVE") {
            res.status(401).json({ message: "Account no longer available." });
            return;
        }
        req.externalAuditor = { id: auditor.id, email: auditor.email };
        next();
    }
    catch (error) {
        console.error("externalAuditorAuth error:", error);
        res.status(500).json({ message: "Auth check failed" });
    }
});
exports.externalAuditorAuth = externalAuditorAuth;

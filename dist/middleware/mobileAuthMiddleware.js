"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mobileAuth = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";
const mobileAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer '))
        ? authHeader.slice(7)
        : authHeader === null || authHeader === void 0 ? void 0 : authHeader.split(' ')[1];
    if (!token) {
        res.status(401).json({ message: "Unauthorized: No token provided" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
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
    }
    catch (error) {
        console.error("Mobile JWT error:", error.message);
        res.status(403).json({ message: "Invalid or expired token", error: error.message });
        return;
    }
};
exports.mobileAuth = mobileAuth;

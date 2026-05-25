"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const user_controller_1 = require("./user.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const validate_1 = require("../../middleware/validate");
const router = express_1.default.Router();
// ── Request schemas (security-critical auth/user endpoints) ──────────────────
const loginSchema = zod_1.z.object({
    employeeId: zod_1.z.string().min(1, "Employee ID is required"),
    password: zod_1.z.string().min(1, "Password is required"),
});
const createUserSchema = zod_1.z.object({
    password: zod_1.z.string().min(6, "Password must be at least 6 characters"),
});
const resetPasswordSchema = zod_1.z.object({
    employeeID: zod_1.z.string().min(1, "employeeID is required"),
    newPassword: zod_1.z.string().min(6, "New password must be at least 6 characters"),
});
router.get("/", authMiddleware_1.authenticateToken, user_controller_1.getAllUsers);
router.post("/", (0, validate_1.validateBody)(createUserSchema), user_controller_1.createUser);
router.put("/:id", authMiddleware_1.authenticateToken, user_controller_1.updateUser);
router.delete("/:id", authMiddleware_1.authenticateToken, user_controller_1.deleteUser);
router.put("/reset-password", authMiddleware_1.authenticateToken, (0, validate_1.validateBody)(resetPasswordSchema), user_controller_1.resetPassword);
router.post("/login", (0, validate_1.validateBody)(loginSchema), user_controller_1.loginUser);
exports.default = router;

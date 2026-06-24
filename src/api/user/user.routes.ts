import express from "express";
import { z } from "zod";
import { getAllUsers, createUser, updateUser, deleteUser, loginUser, resetPassword } from "./user.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
import { validateBody } from "../../middleware/validate";

const router = express.Router();

// ── Request schemas (security-critical auth/user endpoints) ──────────────────
const loginSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  password: z.string().min(1, "Password is required"),
});

const createUserSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const resetPasswordSchema = z.object({
  employeeID: z.string().min(1, "employeeID is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

router.get("/", authenticateToken, getAllUsers);
router.post("/", validateBody(createUserSchema), createUser);

router.put("/reset-password", authenticateToken, validateBody(resetPasswordSchema), resetPassword);
router.post("/login", validateBody(loginSchema), loginUser);

router.put("/:id", authenticateToken, updateUser);
router.delete("/:id", authenticateToken, deleteUser);

export default router;

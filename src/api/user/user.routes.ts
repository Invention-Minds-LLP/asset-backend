import express from "express";
import { z } from "zod";
import { getAllUsers, createUser, updateUser, deleteUser, loginUser, resetPassword, refreshAccessToken, logoutUser, provisionUsersForEmployees } from "./user.controller";
import { authenticateToken, requireRole } from "../../middleware/authMiddleware";
import { validateBody } from "../../middleware/validate";

const router = express.Router();

// Roles allowed to manage login accounts (create, edit, delete, reset password,
// bulk-provision). Everything on this router hands out or takes away access, so
// it must not be reachable by an ordinary authenticated employee.
//
// ADMIN is the system administrator. CEO_COO is included because a deployment
// may have no ADMIN account available — narrow this to ADMIN alone once the
// client confirms a dedicated administrator exists.
const requireUserAdmin = requireRole("ADMIN", "CEO_COO");

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

// Account creation is an administrative action. It was previously mounted with
// no guard at all, which left anyone who could reach the API able to mint a
// login with any role they chose.
router.post("/", authenticateToken, requireUserAdmin, validateBody(createUserSchema), createUser);

// Bulk back-fill of logins for employees that have none. Dry run by default;
// must be above "/:id" so it isn't captured as an id.
router.post("/provision", authenticateToken, requireUserAdmin, provisionUsersForEmployees);

// Sets a new password without proving the old one, so it is an administrator
// tool, not self-service. Authentication alone let any signed-in employee
// overwrite anyone else's password — including an administrator's.
router.put("/reset-password", authenticateToken, requireUserAdmin, validateBody(resetPasswordSchema), resetPassword);

router.post("/login", validateBody(loginSchema), loginUser);
// Cookie-authenticated (refresh cookie + CSRF header), no bearer token required.
router.post("/refresh", refreshAccessToken);
router.post("/logout", logoutUser);

router.put("/:id", authenticateToken, requireUserAdmin, updateUser);
router.delete("/:id", authenticateToken, requireUserAdmin, deleteUser);

export default router;

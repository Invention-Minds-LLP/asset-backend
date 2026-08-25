import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getDepartmentDashboard,
  getProfiles,
  setProfile,
} from "./department-dashboard.controller";

const router = express.Router();

// Admin: list departments + their assigned profiles / assign a profile.
router.get("/profiles", authenticateToken, getProfiles);
router.put("/profile/:departmentId", authenticateToken, setProfile);

// The dashboard for the caller's department (Admin may pass ?departmentId).
router.get("/", authenticateToken, getDepartmentDashboard);

export default router;

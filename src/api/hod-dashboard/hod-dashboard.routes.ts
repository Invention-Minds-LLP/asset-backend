import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { getHodDashboard, getHodDashboardList } from "./hod-dashboard.controller";

const router = express.Router();

// HOD assignment dashboard for the caller's department (Admin may pass ?departmentId).
router.get("/", authenticateToken, getHodDashboard);
// Drill-down list behind a KPI/gap tile (?key=...&departmentId=...).
router.get("/list", authenticateToken, getHodDashboardList);

export default router;

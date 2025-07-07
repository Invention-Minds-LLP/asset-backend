import express from "express";
import { getMaintenanceHistory, createMaintenanceRecord } from "./maintenanceHistory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getMaintenanceHistory);
router.post("/",authenticateToken, createMaintenanceRecord);

export default router;

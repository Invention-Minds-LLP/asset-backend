import express from "express";
import { getAllLoginHistory, getUserActivityStats } from "./loginHistory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllLoginHistory);
router.get("/stats", authenticateToken, getUserActivityStats);

export default router;

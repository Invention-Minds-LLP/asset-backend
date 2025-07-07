import express from "express";
import { getAllLoginHistory } from "./loginHistory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllLoginHistory);

export default router;

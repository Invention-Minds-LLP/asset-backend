import { Router } from "express";
import { authenticateToken } from "../../../middleware/authMiddleware";
import { getAccountsSummary } from "./accounts-summary.controller";

const router = Router();

router.use(authenticateToken);
router.get("/", getAccountsSummary);

export default router;

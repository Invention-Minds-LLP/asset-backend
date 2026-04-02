import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getSlaBreachAlerts,
  getRepeatTickets,
  getEscalationSummary,
} from "./hierarchy-config.controller";

const router = Router();

router.get("/sla-breach-alerts", authenticateToken, getSlaBreachAlerts);
router.get("/repeat-tickets", authenticateToken, getRepeatTickets);
router.get("/escalation-summary", authenticateToken, getEscalationSummary);

export default router;

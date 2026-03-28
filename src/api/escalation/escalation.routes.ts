import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createEscalationRule,
  getAllEscalationRules,
  getEscalationRuleById,
  updateEscalationRule,
  deleteEscalationRule,
  bulkUpsertEscalationMatrix,
  getTicketEscalations,
  triggerTicketEscalation,
  checkAndEscalateTickets,
} from "./escalation.controller";

const router = express.Router();

// ── Escalation Matrix Rules ────────────────────────────────────────────────────
router.get("/rules", authenticateToken, getAllEscalationRules);
router.post("/rules", authenticateToken, createEscalationRule);
router.post("/rules/bulk", authenticateToken, bulkUpsertEscalationMatrix);
router.get("/rules/:id", authenticateToken, getEscalationRuleById);
router.put("/rules/:id", authenticateToken, updateEscalationRule);
router.delete("/rules/:id", authenticateToken, deleteEscalationRule);

// ── Ticket Escalations ─────────────────────────────────────────────────────────
router.get("/ticket/:ticketId", authenticateToken, getTicketEscalations);
router.post("/ticket/:ticketId/trigger", authenticateToken, triggerTicketEscalation);

// ── Auto SLA Escalation (cron/manual) ─────────────────────────────────────────
router.post("/check-and-escalate", authenticateToken, checkAndEscalateTickets);

export default router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const escalation_controller_1 = require("./escalation.controller");
const router = express_1.default.Router();
// ── Escalation Matrix Rules ────────────────────────────────────────────────────
router.get("/rules", authMiddleware_1.authenticateToken, escalation_controller_1.getAllEscalationRules);
router.post("/rules", authMiddleware_1.authenticateToken, escalation_controller_1.createEscalationRule);
router.post("/rules/bulk", authMiddleware_1.authenticateToken, escalation_controller_1.bulkUpsertEscalationMatrix);
router.get("/rules/:id", authMiddleware_1.authenticateToken, escalation_controller_1.getEscalationRuleById);
router.put("/rules/:id", authMiddleware_1.authenticateToken, escalation_controller_1.updateEscalationRule);
router.delete("/rules/:id", authMiddleware_1.authenticateToken, escalation_controller_1.deleteEscalationRule);
// ── Ticket Escalations ─────────────────────────────────────────────────────────
router.get("/ticket/:ticketId", authMiddleware_1.authenticateToken, escalation_controller_1.getTicketEscalations);
router.post("/ticket/:ticketId/trigger", authMiddleware_1.authenticateToken, escalation_controller_1.triggerTicketEscalation);
// ── Auto SLA Escalation (cron/manual) ─────────────────────────────────────────
router.post("/check-and-escalate", authMiddleware_1.authenticateToken, escalation_controller_1.checkAndEscalateTickets);
exports.default = router;

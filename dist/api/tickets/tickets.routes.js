"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tickets_controller_1 = require("./tickets.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, tickets_controller_1.getAllTickets);
router.post("/", authMiddleware_1.authenticateToken, tickets_controller_1.createTicket);
router.get("/my-assigned", authMiddleware_1.authenticateToken, tickets_controller_1.getMyAssignedTickets);
router.get("/my-raised", authMiddleware_1.authenticateToken, tickets_controller_1.getMyRaisedTickets);
router.put("/:id", authMiddleware_1.authenticateToken, tickets_controller_1.updateTicket);
router.delete("/:id", authMiddleware_1.authenticateToken, tickets_controller_1.deleteTicket);
router.get("/:ticketId", authMiddleware_1.authenticateToken, tickets_controller_1.getTicketById);
//Upload image should be protected
router.post("/:ticketId/upload-image", authMiddleware_1.authenticateToken, tickets_controller_1.uploadTicketImage);
// Assignment endpoints
router.get("/:id/assignment-history", authMiddleware_1.authenticateToken, tickets_controller_1.getAssignmentHistory);
router.post("/:id/assign", authMiddleware_1.authenticateToken, tickets_controller_1.assignTicket);
router.post("/:id/reassign", authMiddleware_1.authenticateToken, tickets_controller_1.reassignTicket);
router.patch('/:id/complete-work', authMiddleware_1.authenticateToken, tickets_controller_1.completeTicketWork);
router.patch('/:id/resolve', authMiddleware_1.authenticateToken, tickets_controller_1.resolveTicket);
router.post('/:id/collection-note', authMiddleware_1.authenticateToken, tickets_controller_1.addCollectionNote);
// Terminate / Close
router.post("/:id/terminate", authMiddleware_1.authenticateToken, tickets_controller_1.terminateTicket);
router.post("/:id/close", authMiddleware_1.authenticateToken, tickets_controller_1.closeTicket);
router.post("/:id/transfer", authMiddleware_1.authenticateToken, tickets_controller_1.requestTicketTransfer);
router.get("/transfers/pending", authMiddleware_1.authenticateToken, tickets_controller_1.getPendingTransferApprovals);
router.post("/:id/transfers/:transferId/approve", authMiddleware_1.authenticateToken, tickets_controller_1.approveTicketTransfer);
router.post("/:id/transfers/:transferId/reject", authMiddleware_1.authenticateToken, tickets_controller_1.rejectTicketTransfer);
router.post("/:id/transfers/:transferId/complete", authMiddleware_1.authenticateToken, tickets_controller_1.completeTicketTransfer);
router.get("/:id/transfers", authMiddleware_1.authenticateToken, tickets_controller_1.getTransferHistory);
router.get("/:id/metrics", authMiddleware_1.authenticateToken, tickets_controller_1.getTicketMetrics);
exports.default = router;

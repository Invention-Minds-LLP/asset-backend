import express from "express";
import {
  getAllTickets,
  getTicketById,
  createTicket,
  updateTicket,
  deleteTicket,
  uploadTicketImage,
  assignTicket,
  reassignTicket,
  terminateTicket,
  closeTicket,
  getAssignmentHistory,
  requestTicketTransfer,
  rejectTicketTransfer,
  getTransferHistory,
  completeTicketTransfer,
  approveTicketTransfer,
  getMyAssignedTickets,
  getMyRaisedTickets,
  getPendingTransferApprovals,
  getTicketMetrics,
  completeTicketWork,
  resolveTicket,
  addCollectionNote
} from "./tickets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllTickets);


router.post("/", authenticateToken, createTicket);

router.get("/my-assigned", authenticateToken, getMyAssignedTickets);
router.get("/my-raised", authenticateToken, getMyRaisedTickets);

router.put("/:id", authenticateToken, updateTicket);

router.delete("/:id", authenticateToken, deleteTicket);


router.get("/:ticketId", authenticateToken, getTicketById);

//Upload image should be protected
router.post("/:ticketId/upload-image", authenticateToken, uploadTicketImage);


// Assignment endpoints
router.get("/:id/assignment-history", authenticateToken, getAssignmentHistory);
router.post("/:id/assign", authenticateToken, assignTicket);
router.post("/:id/reassign", authenticateToken, reassignTicket);

router.patch('/:id/complete-work', authenticateToken, completeTicketWork);
router.patch('/:id/resolve', authenticateToken, resolveTicket);
router.post('/:id/collection-note', authenticateToken, addCollectionNote);

// Terminate / Close
router.post("/:id/terminate", authenticateToken, terminateTicket);
router.post("/:id/close", authenticateToken, closeTicket);

router.post("/:id/transfer", authenticateToken, requestTicketTransfer);
router.get("/transfers/pending",authenticateToken, getPendingTransferApprovals);
router.post("/:id/transfers/:transferId/approve", authenticateToken, approveTicketTransfer);
router.post("/:id/transfers/:transferId/reject", authenticateToken, rejectTicketTransfer);
router.post("/:id/transfers/:transferId/complete", authenticateToken, completeTicketTransfer);
router.get("/:id/transfers", authenticateToken, getTransferHistory);
router.get("/:id/metrics", authenticateToken, getTicketMetrics);

export default router;
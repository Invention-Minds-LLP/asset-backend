import express from "express";
import { getAllTickets, getTicketById, createTicket, updateTicket, deleteTicket, uploadTicketImage } from "./tickets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllTickets);
router.post('/:ticketId/upload-image', uploadTicketImage);
router.get("/:ticketId",authenticateToken, getTicketById);
router.post("/",authenticateToken, createTicket);
router.put("/:id",authenticateToken, updateTicket);
router.delete("/:id",authenticateToken, deleteTicket);


export default router;

import express from "express";
import { getAllTickets, getTicketById, createTicket, updateTicket, deleteTicket } from "./tickets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllTickets);
router.get("/:id",authenticateToken, getTicketById);
router.post("/",authenticateToken, createTicket);
router.put("/:id",authenticateToken, updateTicket);
router.delete("/:id",authenticateToken, deleteTicket);

export default router;

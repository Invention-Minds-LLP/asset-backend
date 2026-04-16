import express from "express";
import {
  getAllRca,
  getRcaByTicket,
  getRcaById,
  createRca,
  updateRca,
  deleteRca,
} from "./rca.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllRca);
router.get("/ticket/:ticketId", authenticateToken, getRcaByTicket);
router.get("/:id", authenticateToken, getRcaById);
router.post("/", authenticateToken, createRca);
router.put("/:id", authenticateToken, updateRca);
router.delete("/:id", authenticateToken, deleteRca);

export default router;

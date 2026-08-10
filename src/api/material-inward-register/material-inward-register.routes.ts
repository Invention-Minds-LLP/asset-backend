import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllInwardEntries,
  getInwardEntryById,
  createInwardEntry,
  updateInwardEntry,
  updateInwardStatus,
  deleteInwardEntry,
} from "./material-inward-register.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllInwardEntries);
router.get("/:id", authenticateToken, getInwardEntryById);
router.post("/", authenticateToken, createInwardEntry);
router.put("/:id", authenticateToken, updateInwardEntry);
router.patch("/:id/status", authenticateToken, updateInwardStatus);
router.delete("/:id", authenticateToken, deleteInwardEntry);

export default router;

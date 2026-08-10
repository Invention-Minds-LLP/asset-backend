import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllIdCardEntries,
  getIdCardEntryById,
  createIdCardEntry,
  updateIdCardEntry,
  deleteIdCardEntry,
} from "./id-card-register.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllIdCardEntries);
router.get("/:id", authenticateToken, getIdCardEntryById);
router.post("/", authenticateToken, createIdCardEntry);
router.put("/:id", authenticateToken, updateIdCardEntry);
router.delete("/:id", authenticateToken, deleteIdCardEntry);

export default router;

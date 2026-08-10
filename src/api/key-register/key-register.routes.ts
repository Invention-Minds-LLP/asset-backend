import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllKeyEntries,
  getKeyEntryById,
  createKeyEntry,
  updateKeyEntry,
  deleteKeyEntry,
} from "./key-register.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllKeyEntries);
router.get("/:id", authenticateToken, getKeyEntryById);
router.post("/", authenticateToken, createKeyEntry);
router.put("/:id", authenticateToken, updateKeyEntry);
router.delete("/:id", authenticateToken, deleteKeyEntry);

export default router;

import express from "express";
import { authenticateToken, requireRole } from "../../middleware/authMiddleware";
import {
  getAllItems,
  createItem,
  updateItem,
  deleteItem,
} from "./item-master.controller";

const router = express.Router();

// Anyone signed in may READ the master — the asset and indent forms pick from it.
// Only ADMIN/FINANCE may change it, so the list stays a controlled vocabulary.
const requireItemAdmin = requireRole("ADMIN", "FINANCE");

router.get("/", authenticateToken, getAllItems);
router.post("/", authenticateToken, requireItemAdmin, createItem);
router.put("/:id", authenticateToken, requireItemAdmin, updateItem);
router.delete("/:id", authenticateToken, requireItemAdmin, deleteItem);

export default router;

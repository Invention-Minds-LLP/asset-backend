import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllRentalEntries,
  getRentalEntryById,
  createRentalEntry,
  updateRentalEntry,
  deleteRentalEntry,
} from "./rental-asset-register.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllRentalEntries);
router.get("/:id", authenticateToken, getRentalEntryById);
router.post("/", authenticateToken, createRentalEntry);
router.put("/:id", authenticateToken, updateRentalEntry);
router.delete("/:id", authenticateToken, deleteRentalEntry);

export default router;

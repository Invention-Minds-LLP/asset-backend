import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllSubTypes,
  createSubType,
  updateSubType,
  deleteSubType,
  getSubTypeSummary,
} from "./asset-subtype.controller";

const router = express.Router();

// HOD/Admin summary — asset counts per sub-type (source + target dept)
router.get("/summary", authenticateToken, getSubTypeSummary);

router.get("/", authenticateToken, getAllSubTypes);
router.post("/", authenticateToken, createSubType);
router.put("/:id", authenticateToken, updateSubType);
router.delete("/:id", authenticateToken, deleteSubType);

export default router;

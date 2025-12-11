import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch
} from "./branches.controller";

const router = express.Router();

// ------------------------
// ROUTES
// ------------------------
router.get("/", authenticateToken, getBranches);
router.post("/", authenticateToken, createBranch);
router.put("/:id", authenticateToken, updateBranch);
router.delete("/:id", authenticateToken, deleteBranch);

export default router;

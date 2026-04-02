import express from "express";
import {
  listApprovalConfigs,
  createApprovalConfig,
  updateApprovalConfig,
  deleteApprovalConfig,
  seedApprovalConfigs,
  getRequiredLevel,
} from "./approval-config.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, listApprovalConfigs);
router.post("/", authenticateToken, createApprovalConfig);
router.post("/seed", authenticateToken, seedApprovalConfigs);
router.get("/required-level", authenticateToken, getRequiredLevel);
router.put("/:id", authenticateToken, updateApprovalConfig);
router.delete("/:id", authenticateToken, deleteApprovalConfig);

export default router;

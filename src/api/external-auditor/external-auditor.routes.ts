import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  listExternalAuditors,
  getExternalAuditor,
  createExternalAuditor,
  updateExternalAuditor,
  deactivateExternalAuditor,
} from "./external-auditor.controller";

const router = express.Router();

router.get("/", authenticateToken, listExternalAuditors);
router.get("/:id", authenticateToken, getExternalAuditor);
router.post("/", authenticateToken, createExternalAuditor);
router.put("/:id", authenticateToken, updateExternalAuditor);
router.delete("/:id", authenticateToken, deactivateExternalAuditor);

export default router;

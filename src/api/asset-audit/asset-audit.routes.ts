import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllAudits,
  getAuditById,
  createAudit,
  startAudit,
  verifyItem,
  completeAudit,
  getAuditSummary,
} from "./asset-audit.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllAudits);
router.get("/:id", authenticateToken, getAuditById);
router.post("/", authenticateToken, createAudit);
router.put("/:id/start", authenticateToken, startAudit);
router.put("/items/:itemId/verify", authenticateToken, verifyItem);
router.put("/:id/complete", authenticateToken, completeAudit);
router.get("/:id/summary", authenticateToken, getAuditSummary);

export default router;

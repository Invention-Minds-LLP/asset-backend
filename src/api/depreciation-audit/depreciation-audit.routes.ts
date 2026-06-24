import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  listAudits,
  getAuditStatus,
  getAuditableYears,
  getPreview,
  createAudit,
  cfoApprove,
  cfoReject,
} from "./depreciation-audit.controller";

const router = Router();

router.get("/", authenticateToken, listAudits);
router.get("/status", authenticateToken, getAuditStatus);
router.get("/years", authenticateToken, getAuditableYears);
router.get("/preview", authenticateToken, getPreview);
router.post("/", authenticateToken, createAudit);
router.post("/:id/cfo-approve", authenticateToken, cfoApprove);
router.post("/:id/reject", authenticateToken, cfoReject);

export default router;

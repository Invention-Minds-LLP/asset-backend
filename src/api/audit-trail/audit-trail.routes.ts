import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { getAuditLogs, getAuditLogsByEntity } from "./audit-trail.controller";

const router = Router();

router.get("/", authenticateToken, getAuditLogs);
router.get("/:entityType/:entityId", authenticateToken, getAuditLogsByEntity);

export default router;

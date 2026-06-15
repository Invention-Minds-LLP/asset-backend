import express from "express";
import { externalAuditorAuth } from "../../middleware/externalAuditorMiddleware";
import {
  listMyAudits,
  getMyAuditById,
  getMyAuditFloorMap,
  getMyAuditNextItem,
  startMyAudit,
  verifyMyAuditItem,
  completeMyAudit,
} from "./external-audit.controller";

const router = express.Router();

// All routes under /api/mobile/external/* require an external auditor JWT
// and re-check the master record's ACTIVE status on every request.
router.use(externalAuditorAuth);

router.get("/audits", listMyAudits);
router.get("/audits/:id", getMyAuditById);
router.get("/audits/:id/floor-map", getMyAuditFloorMap);
router.get("/audits/:id/next-item", getMyAuditNextItem);
router.put("/audits/:id/start", startMyAudit);
router.put("/audits/:id/complete", completeMyAudit);
router.put("/audit-items/:itemId/verify", verifyMyAuditItem);

export default router;

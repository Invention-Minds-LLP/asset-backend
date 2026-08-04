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
  getAuditLocationOptions,
  getScopeFloors,
  getScopeBlocks,
  getScopeRooms,
  getScopeCategories,
  getScopePreview,
  getFloorMap,
  getZoneProgress,
  getChecklist,
  getLocationReadiness,
  getStartOptions,
  getRun,
  getCompletionCheck,
  getGuidance,
  getNextItem,
  getMyAudits,
} from "./asset-audit.controller";

const router = express.Router();

router.get("/locations", authenticateToken, getAuditLocationOptions);
router.get("/location-readiness", authenticateToken, getLocationReadiness);
router.get("/scope/floors", authenticateToken, getScopeFloors);
router.get("/scope/blocks", authenticateToken, getScopeBlocks);
router.get("/scope/rooms", authenticateToken, getScopeRooms);
router.get("/scope/categories", authenticateToken, getScopeCategories);
router.get("/scope/preview", authenticateToken, getScopePreview);
router.get("/my", authenticateToken, getMyAudits);
router.get("/", authenticateToken, getAllAudits);
router.get("/:id", authenticateToken, getAuditById);
router.post("/", authenticateToken, createAudit);
router.put("/:id/start", authenticateToken, startAudit);
router.put("/items/:itemId/verify", authenticateToken, verifyItem);
router.put("/:id/complete", authenticateToken, completeAudit);
router.get("/:id/summary", authenticateToken, getAuditSummary);
router.get("/:id/floor-map", authenticateToken, getFloorMap);
router.get("/:id/checklist", authenticateToken, getChecklist);
router.get("/:id/start-options", authenticateToken, getStartOptions);
router.get("/:id/run", authenticateToken, getRun);
router.get("/:id/completion-check", authenticateToken, getCompletionCheck);
router.get("/:id/zone-progress", authenticateToken, getZoneProgress);
router.get("/:id/guidance", authenticateToken, getGuidance);
router.get("/:id/next-item", authenticateToken, getNextItem);

export default router;

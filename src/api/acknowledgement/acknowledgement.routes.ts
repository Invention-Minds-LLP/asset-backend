import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createAcknowledgementTemplate,
  getAllAcknowledgementTemplates,
  getAcknowledgementTemplateById,
  updateAcknowledgementTemplate,
  deleteAcknowledgementTemplate,
  addAcknowledgementItems,
  createAcknowledgementRun,
  submitAcknowledgementRun,
  getRunsByAsset,
  getRunById,
  getPendingAcknowledgements,
} from "./acknowledgement.controller";

const router = express.Router();

// ── Templates ──────────────────────────────────────────────────────────────────
router.get("/templates", authenticateToken, getAllAcknowledgementTemplates);
router.post("/templates", authenticateToken, createAcknowledgementTemplate);
router.get("/templates/:id", authenticateToken, getAcknowledgementTemplateById);
router.put("/templates/:id", authenticateToken, updateAcknowledgementTemplate);
router.delete("/templates/:id", authenticateToken, deleteAcknowledgementTemplate);
router.post("/templates/:templateId/items", authenticateToken, addAcknowledgementItems);

// ── Runs ───────────────────────────────────────────────────────────────────────
router.get("/runs/my-pending", authenticateToken, getPendingAcknowledgements);
router.get("/runs/asset/:assetId", authenticateToken, getRunsByAsset);
router.get("/runs/:id", authenticateToken, getRunById);
router.post("/runs", authenticateToken, createAcknowledgementRun);
router.post("/runs/:runId/submit", authenticateToken, submitAcknowledgementRun);

export default router;

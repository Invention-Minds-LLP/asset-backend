import express from "express";
import {
  createTemplate,
  addChecklistItems,
  getTemplates,
  createChecklistRun,
  submitChecklistRun,
  getRunsByAsset,
  getRunById,
  getRunPdf,
} from "./pm-checklist.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

// Templates
router.post("/template", authenticateToken, createTemplate);
router.get("/template", authenticateToken, getTemplates);
router.post("/template/:templateId/items", authenticateToken, addChecklistItems);

// Runs
router.post("/run", authenticateToken, createChecklistRun);
router.post("/run/:runId/submit", authenticateToken, submitChecklistRun);

// Fetch
router.get("/run/asset/:assetId", authenticateToken, getRunsByAsset);
router.get("/run/:runId/pdf", authenticateToken, getRunPdf);
router.get("/run/:id", authenticateToken, getRunById);

export default router;
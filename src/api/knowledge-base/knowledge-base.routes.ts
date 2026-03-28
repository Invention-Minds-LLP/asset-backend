import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { searchKnowledgeBase, suggestSimilarIssues, getKnowledgeBaseStats } from "./knowledge-base.controller";

const router = express.Router();

router.get("/search", authenticateToken, searchKnowledgeBase);
router.get("/suggest", authenticateToken, suggestSimilarIssues);
router.get("/stats", authenticateToken, getKnowledgeBaseStats);

export default router;

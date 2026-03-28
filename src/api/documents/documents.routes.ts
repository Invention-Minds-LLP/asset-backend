import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  uploadDocument,
  getDocuments,
  getDocumentById,
  deleteDocument,
  getDocumentsByAsset,
  getAllDocumentsPaginated,
  getDocumentStats,
} from "./documents.controller";

const router = express.Router();

router.get("/all", authenticateToken, getAllDocumentsPaginated);
router.get("/stats", authenticateToken, getDocumentStats);
router.get("/", authenticateToken, getDocuments);
router.post("/upload", authenticateToken, uploadDocument);
router.get("/asset/:assetId", authenticateToken, getDocumentsByAsset);
router.get("/:id", authenticateToken, getDocumentById);
router.delete("/:id", authenticateToken, deleteDocument);

export default router;

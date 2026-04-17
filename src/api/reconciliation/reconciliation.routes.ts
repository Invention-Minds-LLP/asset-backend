import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  runReconciliation,
  getVarianceReport,
  getSnapshotDetail,
  resolveSnapshot,
  exportSnapshot,
} from "./reconciliation.controller";

const router = Router();

router.get("/",                authenticateToken, getVarianceReport);
router.get("/:id",             authenticateToken, getSnapshotDetail);
router.get("/:id/export",      authenticateToken, exportSnapshot);
router.post("/run",            authenticateToken, runReconciliation);
router.put("/:id/resolve",     authenticateToken, resolveSnapshot);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { duplicateAsset, bulkUpdateStatus, getQRBulkPrintData } from "./quick-actions.controller";

const router = express.Router();

router.post("/duplicate-asset/:id", authenticateToken, duplicateAsset);
router.put("/bulk-status", authenticateToken, bulkUpdateStatus);
router.post("/qr-bulk-print", authenticateToken, getQRBulkPrintData);

export default router;

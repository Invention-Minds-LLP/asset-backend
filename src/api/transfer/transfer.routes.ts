import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();
import {
    transferAsset,
    getTransferHistory,
  } from "./transfer.controller";
  
  router.post("/assets/transfer", authenticateToken, transferAsset);
  router.get("/assets/:assetId/transfer-history", authenticateToken, getTransferHistory);
  
  // CRON or manual trigger
  // router.post("/assets/transfer/auto-expire", authenticateToken, autoExpireTransfers);
  export default router;
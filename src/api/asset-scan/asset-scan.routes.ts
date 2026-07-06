import express from "express";
import { requireScanApiKey } from "../../middleware/apiKeyMiddleware";
import { ingestScan } from "./asset-scan.controller";

const router = express.Router();

// Machine-to-machine ingest for the CCTV marker reader (and future RFID reader).
// Authenticated by shared API key, not JWT — the caller is a device, not a user.
router.post("/ingest", requireScanApiKey, ingestScan);

export default router;

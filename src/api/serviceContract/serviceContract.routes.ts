import express from "express";
import {
  createServiceContract,
  updateServiceContract,
  getContractsByAsset,
  expireContracts,
  uploadContractDocument,
  getAllServiceContracts,
  getServiceContractStats,
  logServiceVisit,
  getServiceVisits,
  approveVisitCharge,
} from "./serviceContract.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

// Standalone service contracts page
router.get("/all", authenticateToken, getAllServiceContracts);
router.get("/stats", authenticateToken, getServiceContractStats);

router.post("/", authenticateToken, createServiceContract);
router.put("/:id", authenticateToken, updateServiceContract);
router.get("/asset/:assetId", authenticateToken, getContractsByAsset);

// optional cron/manual trigger
router.post("/expire", authenticateToken, expireContracts);
router.post("/upload-doc", authenticateToken, uploadContractDocument);

// Service visit routes
router.post("/:contractId/visits", authenticateToken, logServiceVisit);
router.get("/:contractId/visits", authenticateToken, getServiceVisits);
router.patch("/visits/:visitId/approve-charge", authenticateToken, approveVisitCharge);

export default router;
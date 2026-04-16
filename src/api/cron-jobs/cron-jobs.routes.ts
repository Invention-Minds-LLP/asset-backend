import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  checkWarrantyExpiry,
  checkInsuranceExpiry,
  checkSLABreach,
  checkMaintenanceSLABreach,
  checkContractExpiry,
  checkAssetActivation,
  runAllChecks,
} from "./cron-jobs.controller";

const router = express.Router();

router.post("/warranty-expiry", authenticateToken, checkWarrantyExpiry);
router.post("/insurance-expiry", authenticateToken, checkInsuranceExpiry);
router.post("/sla-breach", authenticateToken, checkSLABreach);
router.post("/maintenance-sla-breach", authenticateToken, checkMaintenanceSLABreach);
router.post("/contract-expiry", authenticateToken, checkContractExpiry);
router.post("/asset-activation", authenticateToken, checkAssetActivation);
router.post("/run-all", authenticateToken, runAllChecks);

export default router;

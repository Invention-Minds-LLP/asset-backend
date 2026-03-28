import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  checkWarrantyExpiry,
  checkInsuranceExpiry,
  checkSLABreach,
  checkContractExpiry,
  runAllChecks,
} from "./cron-jobs.controller";

const router = express.Router();

router.post("/warranty-expiry", authenticateToken, checkWarrantyExpiry);
router.post("/insurance-expiry", authenticateToken, checkInsuranceExpiry);
router.post("/sla-breach", authenticateToken, checkSLABreach);
router.post("/contract-expiry", authenticateToken, checkContractExpiry);
router.post("/run-all", authenticateToken, runAllChecks);

export default router;

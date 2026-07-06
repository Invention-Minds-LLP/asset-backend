import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  checkWarrantyExpiry,
  checkInsuranceExpiry,
  checkSLABreach,
  checkMaintenanceSLABreach,
  checkContractExpiry,
  checkCalibrationDue,
  checkMaintenanceDue,
  checkLowStock,
  checkAssetActivation,
  checkGatePassOverdue,
  checkAssetStaleLocation,
  runAllChecks,
} from "./cron-jobs.controller";
import {
  runYearEndDepreciation,
  runQuarterlyPreview,
  runPreAuditSnapshot,
} from "./depreciation-cron.controller";

const router = express.Router();

router.post("/warranty-expiry", authenticateToken, checkWarrantyExpiry);
router.post("/insurance-expiry", authenticateToken, checkInsuranceExpiry);
router.post("/sla-breach", authenticateToken, checkSLABreach);
router.post("/maintenance-sla-breach", authenticateToken, checkMaintenanceSLABreach);
router.post("/contract-expiry", authenticateToken, checkContractExpiry);
router.post("/calibration-due", authenticateToken, checkCalibrationDue);
router.post("/maintenance-due", authenticateToken, checkMaintenanceDue);
router.post("/low-stock", authenticateToken, checkLowStock);
router.post("/asset-activation", authenticateToken, checkAssetActivation);
router.post("/gate-pass-overdue", authenticateToken, checkGatePassOverdue);
router.post("/asset-not-returned", authenticateToken, checkAssetStaleLocation);
router.post("/run-all", authenticateToken, runAllChecks);

// ── Depreciation cron jobs ───────────────────────────────────────────────
router.post("/year-end-depreciation", authenticateToken, runYearEndDepreciation);
router.post("/quarterly-preview",     authenticateToken, runQuarterlyPreview);
router.post("/pre-audit-snapshot",    authenticateToken, runPreAuditSnapshot);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import multer from "multer";

const storage = multer.diskStorage({
  destination: "uploads/insurance",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname)
  }
});

export const upload = multer({ storage });


const router = express.Router();

import {
  addInsurancePolicy,
  updateInsurancePolicy,
  getInsuranceHistory,
  markInsuranceExpired,
  uploadInsuranceDocument,
  renewInsurancePolicy,
  updateClaimStatus,
  createInsuranceClaim,
  getClaimsByAsset,
  getAllInsurancePolicies,
  getAllInsuranceClaims,
  getInsuranceStats,
} from "./insurance.controller";

// Standalone insurance management pages
router.get("/all", authenticateToken, getAllInsurancePolicies);
router.get("/claims/all", authenticateToken, getAllInsuranceClaims);
router.get("/stats", authenticateToken, getInsuranceStats);

router.post("/", authenticateToken, addInsurancePolicy);
router.put("/:id", authenticateToken, updateInsurancePolicy);
router.get("/asset/:id", authenticateToken, getInsuranceHistory);
router.post("/expire-check", authenticateToken, markInsuranceExpired);

// RENEWAL
router.post("/renew", authenticateToken, renewInsurancePolicy);

// CLAIM
router.post("/claim", authenticateToken, createInsuranceClaim);
router.put("/claim/:id", authenticateToken, updateClaimStatus);
router.get(
  "/claims/:assetId",
  authenticateToken,
  getClaimsByAsset
);
router.post(
  "/:id/upload",
  authenticateToken,
  upload.single("document"),
  uploadInsuranceDocument
);
export default router;

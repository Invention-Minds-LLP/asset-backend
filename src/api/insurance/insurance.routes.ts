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
    uploadInsuranceDocument
  } from "./insurance.controller";
  
  router.post("/insurance", authenticateToken, addInsurancePolicy);
  router.put("/insurance/:id", authenticateToken, updateInsurancePolicy);
  router.get("/insurance/asset/:assetId", authenticateToken, getInsuranceHistory);
  router.post("/insurance/expire-check", authenticateToken, markInsuranceExpired);
  
  router.post(
    "/insurance/:id/upload",
    authenticateToken,
    upload.single("document"),
    uploadInsuranceDocument
  );
  export default router;
  
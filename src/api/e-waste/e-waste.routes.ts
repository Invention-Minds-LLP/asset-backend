import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import multer from "multer";
import { rejectBlockedUploads, tempUploadDir } from "../../lib/fileStorage";
import {
  getAllEWaste,
  getEWasteById,
  hodSign,
  operationsSign,
  securitySign,
  updateEWasteDetails,
  uploadRecyclerCert,
} from "./e-waste.controller";

// multer only stages the file; the controller hands it to fileStorage.ts, which
// owns where uploads actually live.
const upload = multer({
  dest: tempUploadDir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: rejectBlockedUploads,
});

const router = Router();

router.get("/",          authenticateToken, getAllEWaste);
router.get("/:id",       authenticateToken, getEWasteById);
router.put("/:id/hod-sign",         authenticateToken, hodSign);
router.put("/:id/operations-sign",  authenticateToken, operationsSign);
router.put("/:id/security-sign",    authenticateToken, securitySign);
router.put("/:id/details",          authenticateToken, updateEWasteDetails);
router.post("/:id/upload-cert",     authenticateToken, upload.single("file"), uploadRecyclerCert);

export default router;

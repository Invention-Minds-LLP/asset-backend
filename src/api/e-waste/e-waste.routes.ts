import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  getAllEWaste,
  getEWasteById,
  hodSign,
  operationsSign,
  securitySign,
  updateEWasteDetails,
  uploadRecyclerCert,
} from "./e-waste.controller";

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), "uploads", "e-waste");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB

const router = Router();

router.get("/",          authenticateToken, getAllEWaste);
router.get("/:id",       authenticateToken, getEWasteById);
router.put("/:id/hod-sign",         authenticateToken, hodSign);
router.put("/:id/operations-sign",  authenticateToken, operationsSign);
router.put("/:id/security-sign",    authenticateToken, securitySign);
router.put("/:id/details",          authenticateToken, updateEWasteDetails);
router.post("/:id/upload-cert",     authenticateToken, upload.single("file"), uploadRecyclerCert);

export default router;

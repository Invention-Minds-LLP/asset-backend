import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { upload, getAll, getById, create, approve, reject, markPaid, uploadDoc, getStats } from "./service-invoices.controller";

const router = Router();

router.get("/stats",       authenticateToken, getStats);
router.get("/",            authenticateToken, getAll);
router.get("/:id",         authenticateToken, getById);
router.post("/",           authenticateToken, create);
router.put("/:id/approve", authenticateToken, approve);
router.put("/:id/reject",  authenticateToken, reject);
router.put("/:id/mark-paid", authenticateToken, markPaid);
router.post("/:id/upload", authenticateToken, upload.single("file"), uploadDoc);

export default router;

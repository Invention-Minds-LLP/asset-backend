import express from "express";
import {
  listMaterialRequests,
  createMaterialRequest,
  approveMaterialRequest,
  rejectMaterialRequest,
  deliverMaterialRequest,
} from "./material-request.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, listMaterialRequests);
router.post("/", authenticateToken, createMaterialRequest);
router.patch("/:id/approve", authenticateToken, approveMaterialRequest);
router.patch("/:id/reject", authenticateToken, rejectMaterialRequest);
router.patch("/:id/deliver", authenticateToken, deliverMaterialRequest);

export default router;

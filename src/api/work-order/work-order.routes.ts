import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  updateWorkOrder,
  approveWorkOrder,
  startWorkOrder,
  issueMaterial,
  completeWorkOrder,
  issueWCC,
  closeWorkOrder,
  cancelWorkOrder,
} from "./work-order.controller";

const router = Router();

router.get("/", authenticateToken, getAllWorkOrders);
router.post("/", authenticateToken, createWorkOrder);

router.get("/:id", authenticateToken, getWorkOrderById);
router.put("/:id", authenticateToken, updateWorkOrder);

router.patch("/:id/approve", authenticateToken, approveWorkOrder);
router.patch("/:id/start", authenticateToken, startWorkOrder);
router.post("/:id/issue-material", authenticateToken, issueMaterial);
router.patch("/:id/complete", authenticateToken, completeWorkOrder);
router.post("/:id/wcc", authenticateToken, issueWCC);
router.patch("/:id/close", authenticateToken, closeWorkOrder);
router.patch("/:id/cancel", authenticateToken, cancelWorkOrder);

export default router;

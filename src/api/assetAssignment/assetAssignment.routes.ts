// backend/routes/assetAssignments.routes.ts
import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
    initiateDepartmentAcknowledgement,
    getMyPendingAcknowledgements,
    acknowledgeAssignment,
    rejectAssignment,
    hodAssignSupervisor,
    supervisorAssignTargetDepartment,
    targetHodAssignEndUser,
    supervisorAssignEndUser,
    getAssetAssignmentHistory,
    getAssetAssignmentState,
    resendAcknowledgement,
    getAssignmentChecklist,
} from "./assetAssignment.controller";
import multer from "multer";

const upload = multer({ dest: "uploads/" });

const router = Router();

// Flow
router.post("/:assetId/initiate-hod-ack", authenticateToken, initiateDepartmentAcknowledgement);
router.post("/:assetId/assign/supervisor", authenticateToken, hodAssignSupervisor);

// target dept flow
router.post("/:assetId/assign/target-department", authenticateToken, supervisorAssignTargetDepartment);
router.post("/:assetId/assign/target-end-user", authenticateToken, targetHodAssignEndUser);

// no-target flow (optional direct end user)
router.post("/:assetId/assign/end-user", authenticateToken, supervisorAssignEndUser);

// Acks
router.get("/my/pending", authenticateToken, getMyPendingAcknowledgements);
router.post(
    "/:assignmentId/acknowledge",
    upload.single("photo"),
    authenticateToken,
    acknowledgeAssignment
);
router.post("/:assignmentId/reject", authenticateToken, rejectAssignment);

router.post("/:assetId/resend", authenticateToken, resendAcknowledgement);

// State + history
router.get("/:assetId/assignments/history", authenticateToken, getAssetAssignmentHistory);
router.get("/:assetId/assignments/state", authenticateToken, getAssetAssignmentState);
router.get(
  "/:assignmentId/checklist",
  authenticateToken,
  getAssignmentChecklist
);

export default router;
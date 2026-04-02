"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/routes/assetAssignments.routes.ts
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const assetAssignment_controller_1 = require("./assetAssignment.controller");
const multer_1 = __importDefault(require("multer"));
const upload = (0, multer_1.default)({ dest: "uploads/" });
const router = (0, express_1.Router)();
// Flow
router.post("/:assetId/initiate-hod-ack", authMiddleware_1.authenticateToken, assetAssignment_controller_1.initiateDepartmentAcknowledgement);
router.post("/:assetId/assign/supervisor", authMiddleware_1.authenticateToken, assetAssignment_controller_1.hodAssignSupervisor);
// target dept flow
router.post("/:assetId/assign/target-department", authMiddleware_1.authenticateToken, assetAssignment_controller_1.supervisorAssignTargetDepartment);
router.post("/:assetId/assign/target-end-user", authMiddleware_1.authenticateToken, assetAssignment_controller_1.targetHodAssignEndUser);
// no-target flow (optional direct end user)
router.post("/:assetId/assign/end-user", authMiddleware_1.authenticateToken, assetAssignment_controller_1.supervisorAssignEndUser);
// Acks
router.get("/my/pending", authMiddleware_1.authenticateToken, assetAssignment_controller_1.getMyPendingAcknowledgements);
router.post("/:assignmentId/acknowledge", upload.single("photo"), authMiddleware_1.authenticateToken, assetAssignment_controller_1.acknowledgeAssignment);
router.post("/:assignmentId/reject", authMiddleware_1.authenticateToken, assetAssignment_controller_1.rejectAssignment);
router.post("/:assetId/resend", authMiddleware_1.authenticateToken, assetAssignment_controller_1.resendAcknowledgement);
// State + history
router.get("/:assetId/assignments/history", authMiddleware_1.authenticateToken, assetAssignment_controller_1.getAssetAssignmentHistory);
router.get("/:assetId/assignments/state", authMiddleware_1.authenticateToken, assetAssignment_controller_1.getAssetAssignmentState);
router.get("/:assignmentId/checklist", authMiddleware_1.authenticateToken, assetAssignment_controller_1.getAssignmentChecklist);
exports.default = router;

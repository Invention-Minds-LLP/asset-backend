"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const gate_pass_controller_1 = require("./gate-pass.controller");
const router = express_1.default.Router();
// Lists / inboxes (specific routes first to avoid /:id collisions)
router.get("/", authMiddleware_1.authenticateToken, gate_pass_controller_1.getAllGatePasses);
router.get("/overdue", authMiddleware_1.authenticateToken, gate_pass_controller_1.getOverdueGatePasses);
router.get("/pending-approval", authMiddleware_1.authenticateToken, gate_pass_controller_1.getPendingApproval);
router.get("/security-queue", authMiddleware_1.authenticateToken, gate_pass_controller_1.getSecurityQueue);
router.get("/asset/:assetId", authMiddleware_1.authenticateToken, gate_pass_controller_1.getGatePassesByAsset);
// Single record
router.get("/:id", authMiddleware_1.authenticateToken, gate_pass_controller_1.getGatePassById);
router.get("/:id/pdf", authMiddleware_1.authenticateToken, gate_pass_controller_1.downloadGatePassPdf);
// Create + edit
router.post("/", authMiddleware_1.authenticateToken, gate_pass_controller_1.createGatePass);
router.put("/:id", authMiddleware_1.authenticateToken, gate_pass_controller_1.updateGatePass);
router.delete("/:id", authMiddleware_1.authenticateToken, gate_pass_controller_1.deleteGatePass);
// Lifecycle transitions
router.post("/:id/submit", authMiddleware_1.authenticateToken, gate_pass_controller_1.submitForApproval);
router.post("/:id/approve", authMiddleware_1.authenticateToken, gate_pass_controller_1.approveGatePass);
router.post("/:id/reject", authMiddleware_1.authenticateToken, gate_pass_controller_1.rejectGatePass);
router.post("/:id/gate-out", authMiddleware_1.authenticateToken, gate_pass_controller_1.gateOutGatePass);
router.post("/:id/gate-in", authMiddleware_1.authenticateToken, gate_pass_controller_1.gateInGatePass);
// Generic close/cancel
router.patch("/:id/status", authMiddleware_1.authenticateToken, gate_pass_controller_1.updateGatePassStatus);
exports.default = router;

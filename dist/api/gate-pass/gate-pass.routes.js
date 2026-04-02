"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const gate_pass_controller_1 = require("./gate-pass.controller");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, gate_pass_controller_1.getAllGatePasses);
router.post("/", authMiddleware_1.authenticateToken, gate_pass_controller_1.createGatePass);
router.get("/overdue", authMiddleware_1.authenticateToken, gate_pass_controller_1.getOverdueGatePasses);
router.get("/asset/:assetId", authMiddleware_1.authenticateToken, gate_pass_controller_1.getGatePassesByAsset);
router.get("/:id", authMiddleware_1.authenticateToken, gate_pass_controller_1.getGatePassById);
router.put("/:id", authMiddleware_1.authenticateToken, gate_pass_controller_1.updateGatePass);
router.patch("/:id/status", authMiddleware_1.authenticateToken, gate_pass_controller_1.updateGatePassStatus);
router.delete("/:id", authMiddleware_1.authenticateToken, gate_pass_controller_1.deleteGatePass);
exports.default = router;

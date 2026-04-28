"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const asset_audit_controller_1 = require("./asset-audit.controller");
const router = express_1.default.Router();
router.get("/locations", authMiddleware_1.authenticateToken, asset_audit_controller_1.getAuditLocationOptions);
router.get("/", authMiddleware_1.authenticateToken, asset_audit_controller_1.getAllAudits);
router.get("/:id", authMiddleware_1.authenticateToken, asset_audit_controller_1.getAuditById);
router.post("/", authMiddleware_1.authenticateToken, asset_audit_controller_1.createAudit);
router.put("/:id/start", authMiddleware_1.authenticateToken, asset_audit_controller_1.startAudit);
router.put("/items/:itemId/verify", authMiddleware_1.authenticateToken, asset_audit_controller_1.verifyItem);
router.put("/:id/complete", authMiddleware_1.authenticateToken, asset_audit_controller_1.completeAudit);
router.get("/:id/summary", authMiddleware_1.authenticateToken, asset_audit_controller_1.getAuditSummary);
exports.default = router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const external_auditor_controller_1 = require("./external-auditor.controller");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, external_auditor_controller_1.listExternalAuditors);
router.get("/:id", authMiddleware_1.authenticateToken, external_auditor_controller_1.getExternalAuditor);
router.post("/", authMiddleware_1.authenticateToken, external_auditor_controller_1.createExternalAuditor);
router.put("/:id", authMiddleware_1.authenticateToken, external_auditor_controller_1.updateExternalAuditor);
router.delete("/:id", authMiddleware_1.authenticateToken, external_auditor_controller_1.deactivateExternalAuditor);
exports.default = router;

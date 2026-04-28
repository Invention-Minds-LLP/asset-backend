"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const approval_config_controller_1 = require("./approval-config.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, approval_config_controller_1.listApprovalConfigs);
router.post("/", authMiddleware_1.authenticateToken, approval_config_controller_1.createApprovalConfig);
router.post("/seed", authMiddleware_1.authenticateToken, approval_config_controller_1.seedApprovalConfigs);
router.get("/required-level", authMiddleware_1.authenticateToken, approval_config_controller_1.getRequiredLevel);
router.put("/:id", authMiddleware_1.authenticateToken, approval_config_controller_1.updateApprovalConfig);
router.delete("/:id", authMiddleware_1.authenticateToken, approval_config_controller_1.deleteApprovalConfig);
exports.default = router;

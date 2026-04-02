"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const quick_actions_controller_1 = require("./quick-actions.controller");
const router = express_1.default.Router();
router.post("/duplicate-asset/:id", authMiddleware_1.authenticateToken, quick_actions_controller_1.duplicateAsset);
router.put("/bulk-status", authMiddleware_1.authenticateToken, quick_actions_controller_1.bulkUpdateStatus);
router.post("/qr-bulk-print", authMiddleware_1.authenticateToken, quick_actions_controller_1.getQRBulkPrintData);
exports.default = router;

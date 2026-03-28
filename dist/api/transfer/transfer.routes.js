"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
const transfer_controller_1 = require("./transfer.controller");
router.post("/assets/transfer", authMiddleware_1.authenticateToken, transfer_controller_1.transferAsset);
router.get("/assets/:assetId/transfer-history", authMiddleware_1.authenticateToken, transfer_controller_1.getTransferHistory);
// CRON or manual trigger
// router.post("/assets/transfer/auto-expire", authenticateToken, autoExpireTransfers);
exports.default = router;

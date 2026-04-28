"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const disposal_controller_1 = require("./disposal.controller");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, disposal_controller_1.getAllDisposals);
router.get("/:id", authMiddleware_1.authenticateToken, disposal_controller_1.getDisposalById);
router.post("/", authMiddleware_1.authenticateToken, disposal_controller_1.requestDisposal);
router.put("/:id/review", authMiddleware_1.authenticateToken, disposal_controller_1.reviewDisposal);
router.put("/:id/approve", authMiddleware_1.authenticateToken, disposal_controller_1.approveDisposal);
router.put("/:id/reject", authMiddleware_1.authenticateToken, disposal_controller_1.rejectDisposal);
router.put("/:id/complete", authMiddleware_1.authenticateToken, disposal_controller_1.completeDisposal);
router.get("/:id/sub-assets", authMiddleware_1.authenticateToken, disposal_controller_1.getDisposalSubAssets);
exports.default = router;

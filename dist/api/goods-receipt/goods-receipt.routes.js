"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const goods_receipt_controller_1 = require("./goods-receipt.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, goods_receipt_controller_1.getAllGoodsReceipts);
router.get("/:id", authMiddleware_1.authenticateToken, goods_receipt_controller_1.getGoodsReceiptById);
router.post("/", authMiddleware_1.authenticateToken, goods_receipt_controller_1.createGoodsReceipt);
router.patch("/:id/inspect", authMiddleware_1.authenticateToken, goods_receipt_controller_1.inspectGRA);
router.patch("/:id/accept", authMiddleware_1.authenticateToken, goods_receipt_controller_1.acceptGRA);
router.patch("/:id/reject", authMiddleware_1.authenticateToken, goods_receipt_controller_1.rejectGRA);
exports.default = router;

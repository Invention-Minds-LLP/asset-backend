"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const warranty_controller_1 = require("./warranty.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, warranty_controller_1.getAllWarranties);
router.get("/by-asset/:assetId", authMiddleware_1.authenticateToken, warranty_controller_1.getWarrantyByAssetId);
router.get("/:id", authMiddleware_1.authenticateToken, warranty_controller_1.getWarrantyById);
router.post("/", authMiddleware_1.authenticateToken, warranty_controller_1.createWarranty);
router.put("/:id", authMiddleware_1.authenticateToken, warranty_controller_1.updateWarranty);
router.delete("/:id", authMiddleware_1.authenticateToken, warranty_controller_1.deleteWarranty);
exports.default = router;

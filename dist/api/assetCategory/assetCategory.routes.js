"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const assetCategory_controller_1 = require("./assetCategory.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, assetCategory_controller_1.getAllCategories);
router.post("/", authMiddleware_1.authenticateToken, assetCategory_controller_1.createCategory);
router.delete("/:id", authMiddleware_1.authenticateToken, assetCategory_controller_1.deleteCategory);
exports.default = router;

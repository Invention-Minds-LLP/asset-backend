"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const asset_indent_controller_1 = require("./asset-indent.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, asset_indent_controller_1.getAllIndents);
router.get("/:id", authMiddleware_1.authenticateToken, asset_indent_controller_1.getIndentById);
router.post("/", authMiddleware_1.authenticateToken, asset_indent_controller_1.createIndent);
router.patch("/:id/hod-approval", authMiddleware_1.authenticateToken, asset_indent_controller_1.hodApproveIndent);
router.patch("/:id/management-approval", authMiddleware_1.authenticateToken, asset_indent_controller_1.managementApproveIndent);
router.patch("/:id/fulfill", authMiddleware_1.authenticateToken, asset_indent_controller_1.fulfillIndent);
router.delete("/:id", authMiddleware_1.authenticateToken, asset_indent_controller_1.cancelIndent);
exports.default = router;

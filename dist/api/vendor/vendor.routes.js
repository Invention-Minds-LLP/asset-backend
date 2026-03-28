"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const vendor_controller_1 = require("./vendor.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, vendor_controller_1.getAllVendors);
router.post("/", authMiddleware_1.authenticateToken, vendor_controller_1.createVendor);
router.put("/:id", authMiddleware_1.authenticateToken, vendor_controller_1.updateVendor);
router.delete("/:id", authMiddleware_1.authenticateToken, vendor_controller_1.deleteVendor);
exports.default = router;

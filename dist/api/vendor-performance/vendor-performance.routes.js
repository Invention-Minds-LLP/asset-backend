"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const vendor_performance_controller_1 = require("./vendor-performance.controller");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, vendor_performance_controller_1.getVendorPerformance);
router.put("/:id/rating", authMiddleware_1.authenticateToken, vendor_performance_controller_1.updateVendorRating);
exports.default = router;

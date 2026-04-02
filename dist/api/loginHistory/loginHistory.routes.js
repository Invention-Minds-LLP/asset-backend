"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const loginHistory_controller_1 = require("./loginHistory.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, loginHistory_controller_1.getAllLoginHistory);
router.get("/stats", authMiddleware_1.authenticateToken, loginHistory_controller_1.getUserActivityStats);
exports.default = router;

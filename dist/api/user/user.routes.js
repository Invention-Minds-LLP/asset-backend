"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const user_controller_1 = require("./user.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, user_controller_1.getAllUsers);
router.post("/", user_controller_1.createUser);
router.delete("/:id", authMiddleware_1.authenticateToken, user_controller_1.deleteUser);
router.put("/reset-password", authMiddleware_1.authenticateToken, user_controller_1.resetPassword);
router.post("/login", user_controller_1.loginUser);
exports.default = router;

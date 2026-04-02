"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const employee_exit_controller_1 = require("./employee-exit.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, employee_exit_controller_1.getAllExits);
router.get("/employee/:employeeId", authMiddleware_1.authenticateToken, employee_exit_controller_1.getExitByEmployee);
router.get("/:id", authMiddleware_1.authenticateToken, employee_exit_controller_1.getExitById);
router.post("/", authMiddleware_1.authenticateToken, employee_exit_controller_1.initiateExit);
router.patch("/:id/return-asset", authMiddleware_1.authenticateToken, employee_exit_controller_1.returnAsset);
router.patch("/:id/complete", authMiddleware_1.authenticateToken, employee_exit_controller_1.completeExit);
exports.default = router;

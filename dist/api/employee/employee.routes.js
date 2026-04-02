"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const employee_controller_1 = require("./employee.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, employee_controller_1.getAllEmployees);
router.post("/", employee_controller_1.createEmployee);
router.get('/:employeeID/department', employee_controller_1.getDepartmentNameByEmployeeID);
router.delete("/:id", authMiddleware_1.authenticateToken, employee_controller_1.deleteEmployee);
router.get("/:id/assets", authMiddleware_1.authenticateToken, employee_controller_1.getEmployeeAssets);
exports.default = router;

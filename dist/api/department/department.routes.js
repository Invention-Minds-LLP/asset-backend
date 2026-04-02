"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const department_controller_1 = require("./department.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, department_controller_1.getAllDepartments);
router.post("/", authMiddleware_1.authenticateToken, department_controller_1.createDepartment);
router.put("/:id", authMiddleware_1.authenticateToken, department_controller_1.updateDepartment);
router.delete("/:id", authMiddleware_1.authenticateToken, department_controller_1.deleteDepartment);
router.get("/:id/assets", authMiddleware_1.authenticateToken, department_controller_1.getDepartmentAssets);
exports.default = router;

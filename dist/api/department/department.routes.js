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
router.post("/", department_controller_1.createDepartment);
router.delete("/:id", authMiddleware_1.authenticateToken, department_controller_1.deleteDepartment);
exports.default = router;

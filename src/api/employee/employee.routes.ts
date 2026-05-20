import express from "express";
import { getAllEmployees, createEmployee, updateEmployee, deleteEmployee, getDepartmentNameByEmployeeID, getEmployeeAssets } from "./employee.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
const router = express.Router();

router.get("/", authenticateToken, getAllEmployees);
router.post("/", createEmployee);
router.put("/:id", authenticateToken, updateEmployee);
router.get('/:employeeID/department', getDepartmentNameByEmployeeID);

router.delete("/:id", authenticateToken, deleteEmployee);
router.get("/:id/assets", authenticateToken, getEmployeeAssets);

export default router;

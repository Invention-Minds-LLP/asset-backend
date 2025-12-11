import express from "express";
import { getAllEmployees, createEmployee, deleteEmployee, getDepartmentNameByEmployeeID } from "./employee.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
const router = express.Router();

router.get("/",authenticateToken, getAllEmployees);
router.post("/", createEmployee);
router.get('/:employeeID/department', getDepartmentNameByEmployeeID);

router.delete("/:id",authenticateToken, deleteEmployee);

export default router;

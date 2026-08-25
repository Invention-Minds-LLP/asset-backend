import express from "express";
import { getAllEmployees, createEmployee, updateEmployee, deleteEmployee, getDepartmentNameByEmployeeID, getEmployeeAssets, getMyDepartments, getEmployeeDepartments, setEmployeeDepartments } from "./employee.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
const router = express.Router();

router.get("/", authenticateToken, getAllEmployees);
// Declared before "/:employeeID/department" so the literal path wins the match.
router.get("/my-departments", authenticateToken, getMyDepartments);
router.post("/", createEmployee);
router.put("/:id", authenticateToken, updateEmployee);
router.get('/:employeeID/department', getDepartmentNameByEmployeeID);

// Which departments an employee answers for (admin-managed).
router.get("/:id/departments", authenticateToken, getEmployeeDepartments);
router.put("/:id/departments", authenticateToken, setEmployeeDepartments);

router.delete("/:id", authenticateToken, deleteEmployee);
router.get("/:id/assets", authenticateToken, getEmployeeAssets);

export default router;

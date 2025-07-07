import express from "express";
import { getAllEmployees, createEmployee, deleteEmployee } from "./employee.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
const router = express.Router();

router.get("/",authenticateToken, getAllEmployees);
router.post("/", createEmployee);
router.delete("/:id",authenticateToken, deleteEmployee);

export default router;

import express from "express";
import { getAllDepartments, createDepartment, deleteDepartment } from "./department.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllDepartments);
router.post("/",authenticateToken, createDepartment);
router.delete("/:id",authenticateToken, deleteDepartment);

export default router;

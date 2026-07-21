import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getMyColumns,
  getColumnsForDept,
  setColumnsForDept,
} from "./department-columns.controller";

const router = express.Router();

// Effective columns for the current user's department (used to render the table).
router.get("/mine", authenticateToken, getMyColumns);
router.get("/:departmentId", authenticateToken, getColumnsForDept);
router.put("/:departmentId", authenticateToken, setColumnsForDept);

export default router;

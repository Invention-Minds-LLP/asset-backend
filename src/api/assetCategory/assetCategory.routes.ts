import express from "express";
import { getAllCategories, createCategory, deleteCategory } from "./assetCategory.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllCategories);
router.post("/",authenticateToken, createCategory);
router.delete("/:id",authenticateToken, deleteCategory);

export default router;

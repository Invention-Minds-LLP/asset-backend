import express from "express";
import {
  getAllWarranties,
  getWarrantyById,
  createWarranty,
  updateWarranty,
  deleteWarranty,
} from "./warranty.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllWarranties);
router.get("/:id",authenticateToken, getWarrantyById);
router.post("/",authenticateToken, createWarranty);
router.put("/:id",authenticateToken, updateWarranty);
router.delete("/:id",authenticateToken, deleteWarranty);

export default router;

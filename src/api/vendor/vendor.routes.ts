import express from "express";
import { getAllVendors, createVendor, deleteVendor } from "./vendor.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
const router = express.Router();

router.get("/",authenticateToken, getAllVendors);
router.post("/",authenticateToken, createVendor);
router.delete("/:id",authenticateToken, deleteVendor);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { getVendorPerformance, updateVendorRating } from "./vendor-performance.controller";

const router = express.Router();

router.get("/", authenticateToken, getVendorPerformance);
router.put("/:id/rating", authenticateToken, updateVendorRating);

export default router;

import express from "express";
import { getAllVendors, createVendor, deleteVendor, updateVendor, importVendors, vendorUpload } from "./vendor.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
const router = express.Router();

router.get("/",authenticateToken, getAllVendors);
router.post("/",authenticateToken, createVendor);
router.post("/import", authenticateToken, vendorUpload.single("file"), importVendors);
router.put("/:id", authenticateToken, updateVendor);
router.delete("/:id",authenticateToken, deleteVendor);

export default router;

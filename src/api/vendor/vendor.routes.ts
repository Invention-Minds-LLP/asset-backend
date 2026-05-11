import express from "express";
import { getAllVendors, createVendor, deleteVendor, updateVendor, importVendors, vendorUpload, downloadVendorTemplate } from "./vendor.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
import { handleUploadError } from "../../utilis/excelImportHelpers";
const router = express.Router();

router.get("/",authenticateToken, getAllVendors);
router.get("/template", authenticateToken, downloadVendorTemplate);
router.post("/",authenticateToken, createVendor);
router.post("/import", authenticateToken, vendorUpload.single("file"), handleUploadError, importVendors);
router.put("/:id", authenticateToken, updateVendor);
router.delete("/:id",authenticateToken, deleteVendor);

export default router;

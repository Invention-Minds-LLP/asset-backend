"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const vendor_controller_1 = require("./vendor.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const excelImportHelpers_1 = require("../../utilis/excelImportHelpers");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, vendor_controller_1.getAllVendors);
router.get("/template", authMiddleware_1.authenticateToken, vendor_controller_1.downloadVendorTemplate);
router.post("/", authMiddleware_1.authenticateToken, vendor_controller_1.createVendor);
router.post("/import", authMiddleware_1.authenticateToken, vendor_controller_1.vendorUpload.single("file"), excelImportHelpers_1.handleUploadError, vendor_controller_1.importVendors);
router.put("/:id", authMiddleware_1.authenticateToken, vendor_controller_1.updateVendor);
router.delete("/:id", authMiddleware_1.authenticateToken, vendor_controller_1.deleteVendor);
exports.default = router;

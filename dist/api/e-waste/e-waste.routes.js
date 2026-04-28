"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const e_waste_controller_1 = require("./e-waste.controller");
// Ensure upload directory exists
const uploadDir = path_1.default.join(process.cwd(), "uploads", "e-waste");
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});
const upload = (0, multer_1.default)({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB
const router = (0, express_1.Router)();
router.get("/", authMiddleware_1.authenticateToken, e_waste_controller_1.getAllEWaste);
router.get("/:id", authMiddleware_1.authenticateToken, e_waste_controller_1.getEWasteById);
router.put("/:id/hod-sign", authMiddleware_1.authenticateToken, e_waste_controller_1.hodSign);
router.put("/:id/operations-sign", authMiddleware_1.authenticateToken, e_waste_controller_1.operationsSign);
router.put("/:id/security-sign", authMiddleware_1.authenticateToken, e_waste_controller_1.securitySign);
router.put("/:id/details", authMiddleware_1.authenticateToken, e_waste_controller_1.updateEWasteDetails);
router.post("/:id/upload-cert", authMiddleware_1.authenticateToken, upload.single("file"), e_waste_controller_1.uploadRecyclerCert);
exports.default = router;

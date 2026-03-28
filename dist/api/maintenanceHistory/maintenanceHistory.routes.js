"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const maintenanceHistory_controller_1 = require("./maintenanceHistory.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, maintenanceHistory_controller_1.getMaintenanceHistory);
router.post("/", authMiddleware_1.authenticateToken, maintenanceHistory_controller_1.createMaintenanceRecord);
router.post("/upload-report", authMiddleware_1.authenticateToken, maintenanceHistory_controller_1.uploadMaintenanceReport);
// ✅ this should call getMaintenanceHistoryByAsset (your old router called getMaintenanceHistory by mistake)
router.get("/:assetId", authMiddleware_1.authenticateToken, maintenanceHistory_controller_1.getMaintenanceHistoryByAsset);
exports.default = router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const preventive_maintenance_controller_1 = require("./preventive-maintenance.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
// Schedule
router.post("/schedule", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.createSchedule);
router.get("/schedule", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.getAllSchedules);
router.get("/schedule/due", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.getDueSchedules);
// Execute PM
router.post("/execute", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.executeMaintenance);
// History
router.get("/history/:assetId", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.getHistoryByAsset);
// AMC / CMC
router.get("/contract/:assetId", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.getServiceContract);
// Notifications (cron/manual)
router.post("/notify", authMiddleware_1.authenticateToken, preventive_maintenance_controller_1.triggerPMNotifications);
exports.default = router;

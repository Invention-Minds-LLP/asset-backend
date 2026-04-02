"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const calibration_controller_1 = require("./calibration.controller");
const router = express_1.default.Router();
// ── Schedules ──────────────────────────────────────────────────────────────────
router.get("/schedules", authMiddleware_1.authenticateToken, calibration_controller_1.getAllCalibrationSchedules);
router.post("/schedules", authMiddleware_1.authenticateToken, calibration_controller_1.createCalibrationSchedule);
router.get("/schedules/due", authMiddleware_1.authenticateToken, calibration_controller_1.getDueCalibrations);
router.get("/schedules/asset/:assetId", authMiddleware_1.authenticateToken, calibration_controller_1.getCalibrationSchedulesByAsset);
router.put("/schedules/:id", authMiddleware_1.authenticateToken, calibration_controller_1.updateCalibrationSchedule);
router.delete("/schedules/:id", authMiddleware_1.authenticateToken, calibration_controller_1.deleteCalibrationSchedule);
// ── History ────────────────────────────────────────────────────────────────────
router.post("/history", authMiddleware_1.authenticateToken, calibration_controller_1.logCalibrationHistory);
router.get("/history/asset/:assetId", authMiddleware_1.authenticateToken, calibration_controller_1.getCalibrationHistoryByAsset);
// ── Checklist Templates ────────────────────────────────────────────────────────
router.get("/templates", authMiddleware_1.authenticateToken, calibration_controller_1.getAllCalibrationTemplates);
router.post("/templates", authMiddleware_1.authenticateToken, calibration_controller_1.createCalibrationTemplate);
router.put("/templates/:id", authMiddleware_1.authenticateToken, calibration_controller_1.updateCalibrationTemplate);
router.delete("/templates/:id", authMiddleware_1.authenticateToken, calibration_controller_1.deleteCalibrationTemplate);
router.post("/templates/:templateId/items", authMiddleware_1.authenticateToken, calibration_controller_1.addCalibrationTemplateItems);
exports.default = router;

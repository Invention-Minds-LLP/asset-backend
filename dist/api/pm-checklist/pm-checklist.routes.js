"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const pm_checklist_controller_1 = require("./pm-checklist.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
// Templates
router.post("/template", authMiddleware_1.authenticateToken, pm_checklist_controller_1.createTemplate);
router.get("/template", authMiddleware_1.authenticateToken, pm_checklist_controller_1.getTemplates);
router.post("/template/:templateId/items", authMiddleware_1.authenticateToken, pm_checklist_controller_1.addChecklistItems);
// Runs
router.post("/run", authMiddleware_1.authenticateToken, pm_checklist_controller_1.createChecklistRun);
router.post("/run/:runId/submit", authMiddleware_1.authenticateToken, pm_checklist_controller_1.submitChecklistRun);
// Fetch
router.get("/run/asset/:assetId", authMiddleware_1.authenticateToken, pm_checklist_controller_1.getRunsByAsset);
router.get("/run/:runId/pdf", authMiddleware_1.authenticateToken, pm_checklist_controller_1.getRunPdf);
router.get("/run/:id", authMiddleware_1.authenticateToken, pm_checklist_controller_1.getRunById);
exports.default = router;

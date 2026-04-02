"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const acknowledgement_controller_1 = require("./acknowledgement.controller");
const router = express_1.default.Router();
// ── Templates ──────────────────────────────────────────────────────────────────
router.get("/templates", authMiddleware_1.authenticateToken, acknowledgement_controller_1.getAllAcknowledgementTemplates);
router.post("/templates", authMiddleware_1.authenticateToken, acknowledgement_controller_1.createAcknowledgementTemplate);
router.get("/templates/:id", authMiddleware_1.authenticateToken, acknowledgement_controller_1.getAcknowledgementTemplateById);
router.put("/templates/:id", authMiddleware_1.authenticateToken, acknowledgement_controller_1.updateAcknowledgementTemplate);
router.delete("/templates/:id", authMiddleware_1.authenticateToken, acknowledgement_controller_1.deleteAcknowledgementTemplate);
router.post("/templates/:templateId/items", authMiddleware_1.authenticateToken, acknowledgement_controller_1.addAcknowledgementItems);
// ── Runs ───────────────────────────────────────────────────────────────────────
router.get("/runs/my-pending", authMiddleware_1.authenticateToken, acknowledgement_controller_1.getPendingAcknowledgements);
router.get("/runs/asset/:assetId", authMiddleware_1.authenticateToken, acknowledgement_controller_1.getRunsByAsset);
router.get("/runs/:id", authMiddleware_1.authenticateToken, acknowledgement_controller_1.getRunById);
router.post("/runs", authMiddleware_1.authenticateToken, acknowledgement_controller_1.createAcknowledgementRun);
router.post("/runs/:runId/submit", authMiddleware_1.authenticateToken, acknowledgement_controller_1.submitAcknowledgementRun);
exports.default = router;

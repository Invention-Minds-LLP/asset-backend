"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const decision_engine_controller_1 = require("./decision-engine.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
// Dashboard KPI summary
router.get("/dashboard-summary", authMiddleware_1.authenticateToken, decision_engine_controller_1.getDashboardSummary);
// Bulk evaluate all active assets
router.get("/evaluate-all", authMiddleware_1.authenticateToken, decision_engine_controller_1.evaluateAllAssets);
// Evaluate a single asset
router.get("/evaluate/:id", authMiddleware_1.authenticateToken, decision_engine_controller_1.evaluateSingleAsset);
// Evaluation history for an asset
router.get("/history/:assetId", authMiddleware_1.authenticateToken, decision_engine_controller_1.getAssetHistory);
// Config CRUD
router.get("/config", authMiddleware_1.authenticateToken, decision_engine_controller_1.getConfigs);
router.post("/config", authMiddleware_1.authenticateToken, decision_engine_controller_1.upsertConfig);
exports.default = router;

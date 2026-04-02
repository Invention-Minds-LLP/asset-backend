"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cost_analysis_controller_1 = require("./cost-analysis.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/alerts", authMiddleware_1.authenticateToken, cost_analysis_controller_1.getDepreciationAlerts);
router.get("/:id", authMiddleware_1.authenticateToken, cost_analysis_controller_1.getAssetCostAnalysis);
router.get("/:id/revenue", authMiddleware_1.authenticateToken, cost_analysis_controller_1.getRevenueEntries);
router.post("/:id/revenue", authMiddleware_1.authenticateToken, cost_analysis_controller_1.addRevenueEntry);
router.delete("/revenue/:entryId", authMiddleware_1.authenticateToken, cost_analysis_controller_1.deleteRevenueEntry);
exports.default = router;

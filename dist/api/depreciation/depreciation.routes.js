"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
const depreciation_controller_1 = require("./depreciation.controller");
// Standalone depreciation management page
router.get("/all", authMiddleware_1.authenticateToken, depreciation_controller_1.getAllDepreciations);
router.get("/logs", authMiddleware_1.authenticateToken, depreciation_controller_1.getDepreciationLogs);
router.get("/batch-preview", authMiddleware_1.authenticateToken, depreciation_controller_1.batchDepreciationPreview);
router.post("/batch-run", authMiddleware_1.authenticateToken, depreciation_controller_1.runBatchDepreciation);
router.post("/assets/:assetId/depreciation", authMiddleware_1.authenticateToken, depreciation_controller_1.addDepreciation);
router.put("/depreciation/:id", authMiddleware_1.authenticateToken, depreciation_controller_1.updateDepreciation);
router.get("/assets/:assetId/depreciation/calc", authMiddleware_1.authenticateToken, depreciation_controller_1.calculateDepreciation);
router.post("/depreciation/run-batch", authMiddleware_1.authenticateToken, depreciation_controller_1.runDepreciationForAsset);
exports.default = router;

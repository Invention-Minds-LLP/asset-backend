"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const master_controller_1 = require("./master.controller");
const reset_assets_1 = require("./reset-assets");
const router = express_1.default.Router();
// Dashboard – aggregated stats (role-filtered)
router.get("/dashboard", authMiddleware_1.authenticateToken, master_controller_1.getDashboardStats);
// Lookup – all master data for dropdowns/selects (public within auth)
router.get("/lookup", authMiddleware_1.authenticateToken, master_controller_1.getLookupData);
// Asset lifecycle – full 360° view of a single asset
router.get("/asset-lifecycle/:assetId", authMiddleware_1.authenticateToken, master_controller_1.getAssetLifecycleSummary);
// Expiry alerts – warranties/insurance/contracts/calibrations due within N days
router.get("/expiry-alerts", authMiddleware_1.authenticateToken, master_controller_1.getExpiryAlerts);
// Reset – delete all asset data and reset auto-increment (dev/staging only)
router.delete("/reset-assets", authMiddleware_1.authenticateToken, reset_assets_1.resetAllAssets);
exports.default = router;

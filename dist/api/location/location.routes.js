"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
const location_controller_1 = require("./location.controller");
router.post("/", authMiddleware_1.authenticateToken, location_controller_1.addAssetLocation);
router.put("/:locationId", authMiddleware_1.authenticateToken, location_controller_1.updateCurrentLocation);
router.get("/assets/:assetId/location/current", authMiddleware_1.authenticateToken, location_controller_1.getCurrentLocation);
router.get("/assets/:assetId/location/history", authMiddleware_1.authenticateToken, location_controller_1.getLocationHistory);
// Branch Master
router.post("/branches", authMiddleware_1.authenticateToken, location_controller_1.createBranch);
router.get("/branches", authMiddleware_1.authenticateToken, location_controller_1.getBranches);
exports.default = router;

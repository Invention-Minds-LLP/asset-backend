"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const serviceContract_controller_1 = require("./serviceContract.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.post("/", authMiddleware_1.authenticateToken, serviceContract_controller_1.createServiceContract);
router.put("/:id", authMiddleware_1.authenticateToken, serviceContract_controller_1.updateServiceContract);
router.get("/asset/:assetId", authMiddleware_1.authenticateToken, serviceContract_controller_1.getContractsByAsset);
// optional cron/manual trigger
router.post("/expire", authMiddleware_1.authenticateToken, serviceContract_controller_1.expireContracts);
router.post("/upload-doc", authMiddleware_1.authenticateToken, serviceContract_controller_1.uploadContractDocument);
exports.default = router;

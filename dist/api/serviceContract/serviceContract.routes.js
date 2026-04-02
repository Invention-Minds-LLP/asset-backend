"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const serviceContract_controller_1 = require("./serviceContract.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
// Standalone service contracts page
router.get("/all", authMiddleware_1.authenticateToken, serviceContract_controller_1.getAllServiceContracts);
router.get("/stats", authMiddleware_1.authenticateToken, serviceContract_controller_1.getServiceContractStats);
router.post("/", authMiddleware_1.authenticateToken, serviceContract_controller_1.createServiceContract);
router.put("/:id", authMiddleware_1.authenticateToken, serviceContract_controller_1.updateServiceContract);
router.get("/asset/:assetId", authMiddleware_1.authenticateToken, serviceContract_controller_1.getContractsByAsset);
// optional cron/manual trigger
router.post("/expire", authMiddleware_1.authenticateToken, serviceContract_controller_1.expireContracts);
router.post("/upload-doc", authMiddleware_1.authenticateToken, serviceContract_controller_1.uploadContractDocument);
// Service visit routes
router.post("/:contractId/visits", authMiddleware_1.authenticateToken, serviceContract_controller_1.logServiceVisit);
router.get("/:contractId/visits", authMiddleware_1.authenticateToken, serviceContract_controller_1.getServiceVisits);
router.patch("/visits/:visitId/approve-charge", authMiddleware_1.authenticateToken, serviceContract_controller_1.approveVisitCharge);
exports.default = router;

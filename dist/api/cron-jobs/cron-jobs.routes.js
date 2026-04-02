"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const cron_jobs_controller_1 = require("./cron-jobs.controller");
const router = express_1.default.Router();
router.post("/warranty-expiry", authMiddleware_1.authenticateToken, cron_jobs_controller_1.checkWarrantyExpiry);
router.post("/insurance-expiry", authMiddleware_1.authenticateToken, cron_jobs_controller_1.checkInsuranceExpiry);
router.post("/sla-breach", authMiddleware_1.authenticateToken, cron_jobs_controller_1.checkSLABreach);
router.post("/maintenance-sla-breach", authMiddleware_1.authenticateToken, cron_jobs_controller_1.checkMaintenanceSLABreach);
router.post("/contract-expiry", authMiddleware_1.authenticateToken, cron_jobs_controller_1.checkContractExpiry);
router.post("/run-all", authMiddleware_1.authenticateToken, cron_jobs_controller_1.runAllChecks);
exports.default = router;

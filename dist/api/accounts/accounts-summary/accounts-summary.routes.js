"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../../middleware/authMiddleware");
const accounts_summary_controller_1 = require("./accounts-summary.controller");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticateToken);
router.get("/", accounts_summary_controller_1.getAccountsSummary);
exports.default = router;

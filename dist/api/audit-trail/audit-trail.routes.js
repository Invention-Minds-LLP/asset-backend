"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const audit_trail_controller_1 = require("./audit-trail.controller");
const router = (0, express_1.Router)();
router.get("/", authMiddleware_1.authenticateToken, audit_trail_controller_1.getAuditLogs);
router.get("/:entityType/:entityId", authMiddleware_1.authenticateToken, audit_trail_controller_1.getAuditLogsByEntity);
exports.default = router;

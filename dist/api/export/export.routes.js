"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const export_controller_1 = require("./export.controller");
const router = (0, express_1.Router)();
// Single dispatcher route — see export.controller for the supported `:report` keys.
router.get("/:report", authMiddleware_1.authenticateToken, export_controller_1.exportReport);
exports.default = router;

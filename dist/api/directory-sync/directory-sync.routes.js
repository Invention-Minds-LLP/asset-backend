"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const directory_sync_controller_1 = require("./directory-sync.controller");
const router = (0, express_1.Router)();
router.post("/run", authMiddleware_1.authenticateToken, directory_sync_controller_1.runDirectorySync);
exports.default = router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tenant_config_controller_1 = require("./tenant-config.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.post("/seed", authMiddleware_1.authenticateToken, tenant_config_controller_1.seedDefaults);
router.get("/", authMiddleware_1.authenticateToken, tenant_config_controller_1.getAllConfigs);
router.get("/:key", authMiddleware_1.authenticateToken, tenant_config_controller_1.getByKey);
router.put("/:key", authMiddleware_1.authenticateToken, tenant_config_controller_1.upsertConfig);
exports.default = router;

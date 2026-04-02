"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const knowledge_base_controller_1 = require("./knowledge-base.controller");
const router = express_1.default.Router();
router.get("/search", authMiddleware_1.authenticateToken, knowledge_base_controller_1.searchKnowledgeBase);
router.get("/suggest", authMiddleware_1.authenticateToken, knowledge_base_controller_1.suggestSimilarIssues);
router.get("/stats", authMiddleware_1.authenticateToken, knowledge_base_controller_1.getKnowledgeBaseStats);
exports.default = router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const documents_controller_1 = require("./documents.controller");
const router = express_1.default.Router();
router.get("/all", authMiddleware_1.authenticateToken, documents_controller_1.getAllDocumentsPaginated);
router.get("/stats", authMiddleware_1.authenticateToken, documents_controller_1.getDocumentStats);
router.get("/", authMiddleware_1.authenticateToken, documents_controller_1.getDocuments);
router.post("/upload", authMiddleware_1.authenticateToken, documents_controller_1.uploadDocument);
router.get("/asset/:assetId", authMiddleware_1.authenticateToken, documents_controller_1.getDocumentsByAsset);
router.get("/:id", authMiddleware_1.authenticateToken, documents_controller_1.getDocumentById);
router.delete("/:id", authMiddleware_1.authenticateToken, documents_controller_1.deleteDocument);
exports.default = router;

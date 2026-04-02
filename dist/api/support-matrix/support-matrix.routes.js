"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const support_matrix_controller_1 = require("./support-matrix.controller");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, support_matrix_controller_1.getAllSupportMatrix);
router.post("/", authMiddleware_1.authenticateToken, support_matrix_controller_1.createSupportMatrixEntry);
router.post("/bulk", authMiddleware_1.authenticateToken, support_matrix_controller_1.bulkUpsertSupportMatrix);
router.get("/asset/:assetId", authMiddleware_1.authenticateToken, support_matrix_controller_1.getSupportMatrixByAsset);
router.get("/category/:assetCategoryId", authMiddleware_1.authenticateToken, support_matrix_controller_1.getSupportMatrixByCategory);
router.put("/:id", authMiddleware_1.authenticateToken, support_matrix_controller_1.updateSupportMatrixEntry);
router.delete("/:id", authMiddleware_1.authenticateToken, support_matrix_controller_1.deleteSupportMatrixEntry);
exports.default = router;

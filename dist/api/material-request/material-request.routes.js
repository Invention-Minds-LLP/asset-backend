"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const material_request_controller_1 = require("./material-request.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, material_request_controller_1.listMaterialRequests);
router.post("/", authMiddleware_1.authenticateToken, material_request_controller_1.createMaterialRequest);
router.patch("/:id/approve", authMiddleware_1.authenticateToken, material_request_controller_1.approveMaterialRequest);
router.patch("/:id/reject", authMiddleware_1.authenticateToken, material_request_controller_1.rejectMaterialRequest);
router.patch("/:id/deliver", authMiddleware_1.authenticateToken, material_request_controller_1.deliverMaterialRequest);
exports.default = router;

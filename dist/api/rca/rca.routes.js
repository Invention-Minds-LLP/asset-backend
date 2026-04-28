"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const rca_controller_1 = require("./rca.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.get("/", authMiddleware_1.authenticateToken, rca_controller_1.getAllRca);
router.get("/ticket/:ticketId", authMiddleware_1.authenticateToken, rca_controller_1.getRcaByTicket);
router.get("/:id", authMiddleware_1.authenticateToken, rca_controller_1.getRcaById);
router.post("/", authMiddleware_1.authenticateToken, rca_controller_1.createRca);
router.put("/:id", authMiddleware_1.authenticateToken, rca_controller_1.updateRca);
router.delete("/:id", authMiddleware_1.authenticateToken, rca_controller_1.deleteRca);
exports.default = router;

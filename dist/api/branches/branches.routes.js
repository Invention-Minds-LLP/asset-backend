"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const branches_controller_1 = require("./branches.controller");
const router = express_1.default.Router();
// ------------------------
// ROUTES
// ------------------------
router.get("/", authMiddleware_1.authenticateToken, branches_controller_1.getBranches);
router.post("/", authMiddleware_1.authenticateToken, branches_controller_1.createBranch);
router.put("/:id", authMiddleware_1.authenticateToken, branches_controller_1.updateBranch);
router.delete("/:id", authMiddleware_1.authenticateToken, branches_controller_1.deleteBranch);
exports.default = router;

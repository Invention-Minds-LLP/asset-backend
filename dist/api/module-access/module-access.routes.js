"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const module_access_controller_1 = require("./module-access.controller");
const router = express_1.default.Router();
// Seed (one-time setup)
router.post("/seed", authMiddleware_1.authenticateToken, module_access_controller_1.seedDefaultModules);
router.post("/reset-and-reseed", authMiddleware_1.authenticateToken, module_access_controller_1.resetAndReseed);
// App Modules CRUD
router.get("/modules", authMiddleware_1.authenticateToken, module_access_controller_1.getAllModules);
router.post("/modules", authMiddleware_1.authenticateToken, module_access_controller_1.createModule);
router.put("/modules/:id", authMiddleware_1.authenticateToken, module_access_controller_1.updateModule);
router.delete("/modules/:id", authMiddleware_1.authenticateToken, module_access_controller_1.deleteModule);
// Module Items
router.post("/modules/:moduleId/items", authMiddleware_1.authenticateToken, module_access_controller_1.addModuleItem);
router.put("/modules/:moduleId/items/:itemId", authMiddleware_1.authenticateToken, module_access_controller_1.updateModuleItem);
router.delete("/modules/:moduleId/items/:itemId", authMiddleware_1.authenticateToken, module_access_controller_1.deleteModuleItem);
// Permissions
router.get("/permissions", authMiddleware_1.authenticateToken, module_access_controller_1.getPermissions);
router.post("/permissions", authMiddleware_1.authenticateToken, module_access_controller_1.setPermission);
router.post("/permissions/bulk", authMiddleware_1.authenticateToken, module_access_controller_1.bulkSetPermissions);
router.delete("/permissions/:id", authMiddleware_1.authenticateToken, module_access_controller_1.deletePermission);
// Current user's access
router.get("/my-access", authMiddleware_1.authenticateToken, module_access_controller_1.getMyAccess);
exports.default = router;

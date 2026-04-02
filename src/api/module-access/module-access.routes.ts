import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  seedDefaultModules,
  resetAndReseed,
  getAllModules,
  createModule,
  updateModule,
  deleteModule,
  addModuleItem,
  updateModuleItem,
  deleteModuleItem,
  getPermissions,
  setPermission,
  bulkSetPermissions,
  deletePermission,
  getMyAccess,
} from "./module-access.controller";

const router = express.Router();

// Seed (one-time setup)
router.post("/seed", authenticateToken, seedDefaultModules);
router.post("/reset-and-reseed", authenticateToken, resetAndReseed);

// App Modules CRUD
router.get("/modules", authenticateToken, getAllModules);
router.post("/modules", authenticateToken, createModule);
router.put("/modules/:id", authenticateToken, updateModule);
router.delete("/modules/:id", authenticateToken, deleteModule);

// Module Items
router.post("/modules/:moduleId/items", authenticateToken, addModuleItem);
router.put("/modules/:moduleId/items/:itemId", authenticateToken, updateModuleItem);
router.delete("/modules/:moduleId/items/:itemId", authenticateToken, deleteModuleItem);

// Permissions
router.get("/permissions", authenticateToken, getPermissions);
router.post("/permissions", authenticateToken, setPermission);
router.post("/permissions/bulk", authenticateToken, bulkSetPermissions);
router.delete("/permissions/:id", authenticateToken, deletePermission);

// Current user's access
router.get("/my-access", authenticateToken, getMyAccess);

export default router;

import express from "express";
import {
  getAllStores,
  getStoreById,
  createStore,
  updateStore,
  deleteStore,
  getStoreLocations,
  createStoreLocation,
  getStoreHierarchy,
} from "./store.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/hierarchy/tree", authenticateToken, getStoreHierarchy);
router.get("/", authenticateToken, getAllStores);
router.get("/:id", authenticateToken, getStoreById);
router.post("/", authenticateToken, createStore);
router.put("/:id", authenticateToken, updateStore);
router.delete("/:id", authenticateToken, deleteStore);
router.get("/:id/locations", authenticateToken, getStoreLocations);
router.post("/:id/locations", authenticateToken, createStoreLocation);

export default router;

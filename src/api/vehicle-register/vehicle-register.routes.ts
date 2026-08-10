import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllVehicleEntries,
  getVehicleEntryById,
  createVehicleEntry,
  updateVehicleEntry,
  deleteVehicleEntry,
} from "./vehicle-register.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllVehicleEntries);
router.get("/:id", authenticateToken, getVehicleEntryById);
router.post("/", authenticateToken, createVehicleEntry);
router.put("/:id", authenticateToken, updateVehicleEntry);
router.delete("/:id", authenticateToken, deleteVehicleEntry);

export default router;

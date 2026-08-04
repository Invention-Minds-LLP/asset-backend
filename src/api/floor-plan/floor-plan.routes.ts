import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  floorPlanUpload,
  uploadFloorPlan,
  listFloorPlans,
  getFloorPlanWithPins,
  getPinnableAssets,
  savePin,
  removePin,
  deleteFloorPlan,
  listZones,
  createZone,
  updateZone,
  deleteZone,
  getZoneStats,
} from "./floor-plan.controller";

const router = Router();

router.get("/", authenticateToken, listFloorPlans);
router.post("/", authenticateToken, floorPlanUpload.single("file"), uploadFloorPlan);
router.get("/:id", authenticateToken, getFloorPlanWithPins);
router.get("/:id/pinnable", authenticateToken, getPinnableAssets);
router.post("/:id/pin", authenticateToken, savePin);
router.delete("/:id/pin/:assetId", authenticateToken, removePin);

// Zones (traced rooms / areas)
router.get("/:id/zones", authenticateToken, listZones);
router.get("/:id/zone-stats", authenticateToken, getZoneStats);
router.post("/:id/zones", authenticateToken, createZone);
router.put("/:id/zones/:zoneId", authenticateToken, updateZone);
router.delete("/:id/zones/:zoneId", authenticateToken, deleteZone);

router.delete("/:id", authenticateToken, deleteFloorPlan);

export default router;

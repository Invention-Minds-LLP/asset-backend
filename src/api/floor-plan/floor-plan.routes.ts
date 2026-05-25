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
} from "./floor-plan.controller";

const router = Router();

router.get("/", authenticateToken, listFloorPlans);
router.post("/", authenticateToken, floorPlanUpload.single("file"), uploadFloorPlan);
router.get("/:id", authenticateToken, getFloorPlanWithPins);
router.get("/:id/pinnable", authenticateToken, getPinnableAssets);
router.post("/:id/pin", authenticateToken, savePin);
router.delete("/:id/pin/:assetId", authenticateToken, removePin);
router.delete("/:id", authenticateToken, deleteFloorPlan);

export default router;

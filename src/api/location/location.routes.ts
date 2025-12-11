import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

import {
    addAssetLocation,
    updateCurrentLocation,
    getCurrentLocation,
    getLocationHistory,
    createBranch,
    getBranches
  } from "./location.controller";
  
  router.post("/assets/location", authenticateToken, addAssetLocation);
  router.put("/assets/location/:locationId", authenticateToken, updateCurrentLocation);
  
  router.get("/assets/:assetId/location/current", authenticateToken, getCurrentLocation);
  router.get("/assets/:assetId/location/history", authenticateToken, getLocationHistory);
  
  // Branch Master
  router.post("/branches", authenticateToken, createBranch);
  router.get("/branches", authenticateToken, getBranches);
  export default router;
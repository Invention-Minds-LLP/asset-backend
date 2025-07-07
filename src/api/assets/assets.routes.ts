import express from "express";
import { getAllAssets, getAssetById, createAsset, updateAsset, deleteAsset } from "./assets.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllAssets);
router.get("/:id",authenticateToken, getAssetById);
router.post("/",authenticateToken, createAsset);
router.put("/:id",authenticateToken, updateAsset);
router.delete("/:id",authenticateToken, deleteAsset);

export default router;

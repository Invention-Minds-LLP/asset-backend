import express from "express";
import { getAllConfigs, getByKey, upsertConfig, seedDefaults } from "./tenant-config.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.post("/seed", authenticateToken, seedDefaults);
router.get("/", authenticateToken, getAllConfigs);
router.get("/:key", authenticateToken, getByKey);
router.put("/:key", authenticateToken, upsertConfig);

export default router;

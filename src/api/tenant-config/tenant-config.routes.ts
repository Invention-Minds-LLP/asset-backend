import express from "express";
import {
  getAllConfigs, getByKey, upsertConfig, seedDefaults,
  listDeadKeys, pruneDeadKeys,
} from "./tenant-config.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.post("/seed", authenticateToken, seedDefaults);
// Declared before "/:key" so these are not read as key names.
router.get("/dead-keys", authenticateToken, listDeadKeys);
router.post("/prune-dead-keys", authenticateToken, pruneDeadKeys);
router.get("/", authenticateToken, getAllConfigs);
router.get("/:key", authenticateToken, getByKey);
router.put("/:key", authenticateToken, upsertConfig);

export default router;

import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  migrateSingleAsset,
  migrateBulk,
  migrateProportional,
  listMigratedAssets,
  revertMigration,
} from "./legacy-migration.controller";

const router = Router();

router.get("/list",            authenticateToken, listMigratedAssets);
router.post("/single",         authenticateToken, migrateSingleAsset);
router.post("/bulk",           authenticateToken, migrateBulk);
router.post("/proportional",   authenticateToken, migrateProportional);
router.delete("/:assetId",     authenticateToken, revertMigration);

export default router;

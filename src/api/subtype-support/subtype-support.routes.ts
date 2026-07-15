import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getSupportConfigs,
  upsertSupportConfig,
  deleteSupportConfig,
} from "./subtype-support.controller";

const router = express.Router();

router.get("/", authenticateToken, getSupportConfigs);
router.post("/", authenticateToken, upsertSupportConfig);
router.delete("/:id", authenticateToken, deleteSupportConfig);

export default router;

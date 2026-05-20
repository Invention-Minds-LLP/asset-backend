import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { exportReport } from "./export.controller";

const router = Router();

// Single dispatcher route — see export.controller for the supported `:report` keys.
router.get("/:report", authenticateToken, exportReport);

export default router;

import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { runDirectorySync } from "./directory-sync.controller";

const router = Router();

router.post("/run", authenticateToken, runDirectorySync);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllGensetLogs,
  getGensetLogById,
  createGensetLog,
  updateGensetLog,
  deleteGensetLog,
} from "./genset-log.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllGensetLogs);
router.get("/:id", authenticateToken, getGensetLogById);
router.post("/", authenticateToken, createGensetLog);
router.put("/:id", authenticateToken, updateGensetLog);
router.delete("/:id", authenticateToken, deleteGensetLog);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getAllElectricityLogs,
  getElectricityLogById,
  createElectricityLog,
  updateElectricityLog,
  deleteElectricityLog,
} from "./electricity-log.controller";

const router = express.Router();

router.get("/", authenticateToken, getAllElectricityLogs);
router.get("/:id", authenticateToken, getElectricityLogById);
router.post("/", authenticateToken, createElectricityLog);
router.put("/:id", authenticateToken, updateElectricityLog);
router.delete("/:id", authenticateToken, deleteElectricityLog);

export default router;

import express from "express";
import {
  getAllExits,
  getExitById,
  initiateExit,
  returnAsset,
  completeExit,
  getExitByEmployee,
} from "./employee-exit.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllExits);
router.get("/employee/:employeeId", authenticateToken, getExitByEmployee);
router.get("/:id", authenticateToken, getExitById);
router.post("/", authenticateToken, initiateExit);
router.patch("/:id/return-asset", authenticateToken, returnAsset);
router.patch("/:id/complete", authenticateToken, completeExit);

export default router;

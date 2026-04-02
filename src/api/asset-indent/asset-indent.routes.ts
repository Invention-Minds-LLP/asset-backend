import express from "express";
import {
  getAllIndents,
  getIndentById,
  createIndent,
  hodApproveIndent,
  managementApproveIndent,
  fulfillIndent,
  cancelIndent,
} from "./asset-indent.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getAllIndents);
router.get("/:id", authenticateToken, getIndentById);
router.post("/", authenticateToken, createIndent);
router.patch("/:id/hod-approval", authenticateToken, hodApproveIndent);
router.patch("/:id/management-approval", authenticateToken, managementApproveIndent);
router.patch("/:id/fulfill", authenticateToken, fulfillIndent);
router.delete("/:id", authenticateToken, cancelIndent);

export default router;

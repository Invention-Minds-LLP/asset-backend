import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { listYears, previewYear, submitYear, approveYear, rejectYear, undoYear } from "./fy-close.controller";

const router = express.Router();

// Roles are checked in the controller (FINANCE submits, CFO approves/rejects/
// undoes), matching the other finance modules. Undo only works within 24 hours
// of finalizing; there is no general reopen.
router.get("/", authenticateToken, listYears);
router.get("/:fiscalYear/preview", authenticateToken, previewYear);
router.post("/:fiscalYear/submit", authenticateToken, submitYear);
router.post("/:fiscalYear/approve", authenticateToken, approveYear);
router.post("/:fiscalYear/reject", authenticateToken, rejectYear);
router.post("/:fiscalYear/undo", authenticateToken, undoYear);

export default router;

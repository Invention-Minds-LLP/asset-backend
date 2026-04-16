import { Router } from "express";
import { authenticateToken } from "../../../middleware/authMiddleware";
import {
  getAllJournalEntries,
  getJournalEntryById,
  createJournalEntry,
  getAccountLedger,
} from "./journal-entries.controller";

const router = Router();

router.use(authenticateToken);

router.get("/ledger", getAccountLedger);
router.get("/", getAllJournalEntries);
router.get("/:id", getJournalEntryById);
router.post("/", createJournalEntry);

export default router;

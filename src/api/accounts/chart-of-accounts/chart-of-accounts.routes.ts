import { Router } from "express";
import { authenticateToken } from "../../../middleware/authMiddleware";
import {
  getAllAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccountsDropdown,
} from "./chart-of-accounts.controller";

const router = Router();

router.use(authenticateToken);

router.get("/dropdown", getAccountsDropdown);
router.get("/", getAllAccounts);
router.get("/:id", getAccountById);
router.post("/", createAccount);
router.put("/:id", updateAccount);
router.delete("/:id", deleteAccount);

export default router;

import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { globalSearch } from "./global-search.controller";

const router = express.Router();

router.get("/", authenticateToken, globalSearch);

export default router;

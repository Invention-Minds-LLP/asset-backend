import express from "express";
import { getAllUsers, createUser, deleteUser, loginUser } from "./user.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllUsers);
router.post("/", createUser);
router.delete("/:id",authenticateToken, deleteUser);
router.post("/login", loginUser);

export default router;

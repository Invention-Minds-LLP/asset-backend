import express from "express";
import { getAllUsers, createUser, deleteUser, loginUser, resetPassword } from "./user.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.get("/",authenticateToken, getAllUsers);
router.post("/", createUser);
router.delete("/:id",authenticateToken, deleteUser);

router.put("/reset-password", authenticateToken, resetPassword);
router.post("/login", loginUser);

export default router;

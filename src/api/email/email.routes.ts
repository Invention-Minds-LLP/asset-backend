import express from "express";
import { sendEmail } from "./email.controller";

const router = express.Router();

router.post("/", sendEmail);

export default router;

"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// configure transporter with Hostinger SMTP details
const transporter = nodemailer_1.default.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const sendEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { to, subject, text, html } = req.body;
    if (!to || !subject || (!text && !html)) {
        res.status(400).json({ message: "to, subject, and text or html are required" });
        return;
    }
    try {
        const info = yield transporter.sendMail({
            from: `"My App" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text,
            html,
        });
        console.log("✅ Email sent:", info.response);
        res.json({ message: "Email sent successfully", info });
        return;
    }
    catch (error) {
        console.error("❌ Failed to send email:", error);
        res.status(500).json({ message: "Failed to send email", error });
        return;
    }
});
exports.sendEmail = sendEmail;

import { Request, Response } from "express";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();


// configure transporter with Hostinger SMTP details
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,         
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
}as nodemailer.TransportOptions);

export const sendEmail = async (req: Request, res: Response) => {
  const { to, subject, text, html } = req.body;

  if (!to || !subject || (!text && !html)) {
     res.status(400).json({ message: "to, subject, and text or html are required" });
     return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"My App" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });

    console.log("✅ Email sent:", info.response);

     res.json({ message: "Email sent successfully", info });
     return;
  } catch (error) {
    console.error("❌ Failed to send email:", error);
     res.status(500).json({ message: "Failed to send email", error });
     return;
  }
};

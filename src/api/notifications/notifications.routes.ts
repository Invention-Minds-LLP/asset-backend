import express from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createNotification,
  getMyNotifications,
  getAllNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getMyPreferences,
  updateMyPreferences,
  getEmailTemplates,
  upsertEmailTemplate,
  seedEmailTemplates,
  getSmtpConfig,
  upsertSmtpConfig,
  sendManualEmail,
} from "./notifications.controller";
import { addSSEClient, removeSSEClient } from "../../utilis/notificationHelper";

const router = express.Router();

// SSE stream for real-time notifications
router.get("/stream", (req, res) => {
  const employeeId = Number(req.query.employeeId);
  if (!employeeId) {
    res.status(400).json({ message: "employeeId query param required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  addSSEClient(employeeId, res);

  req.on("close", () => {
    removeSSEClient(res);
  });
});

// Current-user notifications
router.get("/my", authenticateToken, getMyNotifications);
router.get("/my/unread-count", authenticateToken, getUnreadCount);
router.patch("/my/read-all", authenticateToken, markAllAsRead);
router.patch("/:id/read", authenticateToken, markAsRead);

// Notification preferences
router.get("/preferences", authenticateToken, getMyPreferences);
router.put("/preferences", authenticateToken, updateMyPreferences);

// Admin: Email templates
router.get("/email-templates", authenticateToken, getEmailTemplates);
router.put("/email-templates", authenticateToken, upsertEmailTemplate);
router.post("/email-templates/seed", authenticateToken, seedEmailTemplates);

// Admin: SMTP config
router.get("/smtp-config", authenticateToken, getSmtpConfig);
router.put("/smtp-config", authenticateToken, upsertSmtpConfig);

// Send manual email (with CC/BCC + template)
router.post("/send-email", authenticateToken, sendManualEmail);

// Admin / system
router.get("/", authenticateToken, getAllNotifications);
router.post("/", authenticateToken, createNotification);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;

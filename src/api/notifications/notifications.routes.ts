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
  getSmtpConfig,
  upsertSmtpConfig,
} from "./notifications.controller";

const router = express.Router();

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

// Admin: SMTP config
router.get("/smtp-config", authenticateToken, getSmtpConfig);
router.put("/smtp-config", authenticateToken, upsertSmtpConfig);

// Admin / system
router.get("/", authenticateToken, getAllNotifications);
router.post("/", authenticateToken, createNotification);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;

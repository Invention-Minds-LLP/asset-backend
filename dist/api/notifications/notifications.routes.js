"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const notifications_controller_1 = require("./notifications.controller");
const notificationHelper_1 = require("../../utilis/notificationHelper");
const router = express_1.default.Router();
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
    (0, notificationHelper_1.addSSEClient)(employeeId, res);
    req.on("close", () => {
        (0, notificationHelper_1.removeSSEClient)(res);
    });
});
// Current-user notifications
router.get("/my", authMiddleware_1.authenticateToken, notifications_controller_1.getMyNotifications);
router.get("/my/unread-count", authMiddleware_1.authenticateToken, notifications_controller_1.getUnreadCount);
router.patch("/my/read-all", authMiddleware_1.authenticateToken, notifications_controller_1.markAllAsRead);
router.patch("/:id/read", authMiddleware_1.authenticateToken, notifications_controller_1.markAsRead);
// Notification preferences
router.get("/preferences", authMiddleware_1.authenticateToken, notifications_controller_1.getMyPreferences);
router.put("/preferences", authMiddleware_1.authenticateToken, notifications_controller_1.updateMyPreferences);
// Admin: Email templates
router.get("/email-templates", authMiddleware_1.authenticateToken, notifications_controller_1.getEmailTemplates);
router.put("/email-templates", authMiddleware_1.authenticateToken, notifications_controller_1.upsertEmailTemplate);
router.post("/email-templates/seed", authMiddleware_1.authenticateToken, notifications_controller_1.seedEmailTemplates);
// Admin: SMTP config
router.get("/smtp-config", authMiddleware_1.authenticateToken, notifications_controller_1.getSmtpConfig);
router.put("/smtp-config", authMiddleware_1.authenticateToken, notifications_controller_1.upsertSmtpConfig);
// Send manual email (with CC/BCC + template)
router.post("/send-email", authMiddleware_1.authenticateToken, notifications_controller_1.sendManualEmail);
// Admin / system
router.get("/", authMiddleware_1.authenticateToken, notifications_controller_1.getAllNotifications);
router.post("/", authMiddleware_1.authenticateToken, notifications_controller_1.createNotification);
router.delete("/:id", authMiddleware_1.authenticateToken, notifications_controller_1.deleteNotification);
exports.default = router;

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
exports.sendManualEmail = exports.upsertSmtpConfig = exports.getSmtpConfig = exports.seedEmailTemplates = exports.upsertEmailTemplate = exports.getEmailTemplates = exports.updateMyPreferences = exports.getMyPreferences = exports.getUnreadCount = exports.deleteNotification = exports.markAllAsRead = exports.markAsRead = exports.getAllNotifications = exports.getMyNotifications = exports.createNotification = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
// ─── Create Notification ───────────────────────────────────────────────────────
const createNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { type, title, message, priority, channel, assetId, ticketId, gatePassId, insuranceId, claimId, employeeId, recipientIds, // array of employee IDs
        dedupeKey, } = req.body;
        if (!type || !message) {
            res.status(400).json({ message: "type and message are required" });
            return;
        }
        const notification = yield prismaClient_1.default.notification.create({
            data: {
                type,
                title,
                message,
                priority,
                channel,
                assetId: assetId ? Number(assetId) : undefined,
                ticketId: ticketId ? Number(ticketId) : undefined,
                gatePassId: gatePassId ? Number(gatePassId) : undefined,
                insuranceId: insuranceId ? Number(insuranceId) : undefined,
                claimId: claimId ? Number(claimId) : undefined,
                employeeId: employeeId ? Number(employeeId) : undefined,
                createdById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId,
                dedupeKey: dedupeKey !== null && dedupeKey !== void 0 ? dedupeKey : undefined,
                recipients: (recipientIds === null || recipientIds === void 0 ? void 0 : recipientIds.length)
                    ? {
                        create: recipientIds.map((empId) => ({
                            employeeId: empId,
                        })),
                    }
                    : undefined,
            },
            include: {
                recipients: { include: { employee: { select: { name: true, employeeID: true } } } },
            },
        });
        res.status(201).json(notification);
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === "P2002") {
            res.status(409).json({ message: "Duplicate notification (dedupeKey already exists)" });
            return;
        }
        console.error("createNotification error:", error);
        res.status(500).json({ message: "Failed to create notification" });
    }
});
exports.createNotification = createNotification;
// ─── Get Notifications for Logged-in User ─────────────────────────────────────
const getMyNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const { isRead, page = "1", limit = "20" } = req.query;
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const where = { employeeId };
        if (isRead !== undefined)
            where.isRead = isRead === "true";
        const [recipients, total, unreadCount] = yield Promise.all([
            prismaClient_1.default.notificationRecipient.findMany({
                where,
                include: {
                    notification: {
                        include: {
                            asset: { select: { assetId: true, assetName: true } },
                            ticket: { select: { ticketId: true } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prismaClient_1.default.notificationRecipient.count({ where }),
            prismaClient_1.default.notificationRecipient.count({ where: { employeeId, isRead: false } }),
        ]);
        res.json({
            data: recipients,
            total,
            unreadCount,
            page: parseInt(String(page)),
            limit: take,
        });
    }
    catch (error) {
        console.error("getMyNotifications error:", error);
        res.status(500).json({ message: "Failed to fetch notifications" });
    }
});
exports.getMyNotifications = getMyNotifications;
// ─── Get All Notifications (admin) ────────────────────────────────────────────
const getAllNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { type, priority, assetId, ticketId } = req.query;
        const where = {};
        if (type)
            where.type = String(type);
        if (priority)
            where.priority = String(priority);
        if (assetId)
            where.assetId = Number(assetId);
        if (ticketId)
            where.ticketId = Number(ticketId);
        const notifications = yield prismaClient_1.default.notification.findMany({
            where,
            include: {
                asset: { select: { assetId: true, assetName: true } },
                ticket: { select: { ticketId: true } },
                createdBy: { select: { name: true } },
                recipients: { include: { employee: { select: { name: true } } } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
        res.json(notifications);
    }
    catch (error) {
        console.error("getAllNotifications error:", error);
        res.status(500).json({ message: "Failed to fetch notifications" });
    }
});
exports.getAllNotifications = getAllNotifications;
// ─── Mark Single Notification as Read ─────────────────────────────────────────
const markAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const notificationId = parseInt(req.params.id);
        const employeeId = req.user.employeeDbId;
        const recipient = yield prismaClient_1.default.notificationRecipient.findUnique({
            where: { notificationId_employeeId: { notificationId, employeeId } },
        });
        if (!recipient) {
            res.status(404).json({ message: "Notification not found for this user" });
            return;
        }
        const updated = yield prismaClient_1.default.notificationRecipient.update({
            where: { notificationId_employeeId: { notificationId, employeeId } },
            data: { isRead: true, readAt: new Date() },
        });
        res.json(updated);
    }
    catch (error) {
        console.error("markAsRead error:", error);
        res.status(500).json({ message: "Failed to mark notification as read" });
    }
});
exports.markAsRead = markAsRead;
// ─── Mark All as Read ─────────────────────────────────────────────────────────
const markAllAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        yield prismaClient_1.default.notificationRecipient.updateMany({
            where: { employeeId, isRead: false },
            data: { isRead: true, readAt: new Date() },
        });
        res.json({ message: "All notifications marked as read" });
    }
    catch (error) {
        console.error("markAllAsRead error:", error);
        res.status(500).json({ message: "Failed to mark all as read" });
    }
});
exports.markAllAsRead = markAllAsRead;
// ─── Delete Notification ───────────────────────────────────────────────────────
const deleteNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.notification.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Notification not found" });
            return;
        }
        // Delete recipients first (FK constraint)
        yield prismaClient_1.default.notificationRecipient.deleteMany({ where: { notificationId: id } });
        yield prismaClient_1.default.notification.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteNotification error:", error);
        res.status(500).json({ message: "Failed to delete notification" });
    }
});
exports.deleteNotification = deleteNotification;
// ─── Get Unread Count ─────────────────────────────────────────────────────────
const getUnreadCount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const count = yield prismaClient_1.default.notificationRecipient.count({
            where: { employeeId, isRead: false },
        });
        res.json({ unreadCount: count });
    }
    catch (error) {
        console.error("getUnreadCount error:", error);
        res.status(500).json({ message: "Failed to get unread count" });
    }
});
exports.getUnreadCount = getUnreadCount;
// ─── Get My Notification Preferences ─────────────────────────────────────────
const getMyPreferences = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        let pref = yield prismaClient_1.default.notificationPreference.findUnique({
            where: { employeeId: req.user.employeeDbId },
        });
        // Return defaults if none exist yet
        if (!pref) {
            pref = {
                id: 0,
                employeeId: req.user.employeeDbId,
                warrantyExpiry: true,
                insuranceExpiry: true,
                amcCmcExpiry: true,
                maintenanceDue: true,
                slaBreach: true,
                lowStock: true,
                gatepassOverdue: true,
                ticketUpdates: true,
                assetTransfer: true,
                channelInApp: true,
                channelEmail: false,
                channelSms: false,
                channelWhatsapp: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        }
        res.json(pref);
    }
    catch (error) {
        console.error("getMyPreferences error:", error);
        res.status(500).json({ message: "Failed to fetch preferences" });
    }
});
exports.getMyPreferences = getMyPreferences;
// ─── Update My Notification Preferences ──────────────────────────────────────
const updateMyPreferences = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const data = req.body;
        const pref = yield prismaClient_1.default.notificationPreference.upsert({
            where: { employeeId },
            update: {
                warrantyExpiry: data.warrantyExpiry,
                insuranceExpiry: data.insuranceExpiry,
                amcCmcExpiry: data.amcCmcExpiry,
                maintenanceDue: data.maintenanceDue,
                slaBreach: data.slaBreach,
                lowStock: data.lowStock,
                gatepassOverdue: data.gatepassOverdue,
                ticketUpdates: data.ticketUpdates,
                assetTransfer: data.assetTransfer,
                channelInApp: data.channelInApp,
                channelEmail: data.channelEmail,
                channelSms: data.channelSms,
                channelWhatsapp: data.channelWhatsapp,
            },
            create: {
                employeeId,
                warrantyExpiry: (_a = data.warrantyExpiry) !== null && _a !== void 0 ? _a : true,
                insuranceExpiry: (_b = data.insuranceExpiry) !== null && _b !== void 0 ? _b : true,
                amcCmcExpiry: (_c = data.amcCmcExpiry) !== null && _c !== void 0 ? _c : true,
                maintenanceDue: (_d = data.maintenanceDue) !== null && _d !== void 0 ? _d : true,
                slaBreach: (_e = data.slaBreach) !== null && _e !== void 0 ? _e : true,
                lowStock: (_f = data.lowStock) !== null && _f !== void 0 ? _f : true,
                gatepassOverdue: (_g = data.gatepassOverdue) !== null && _g !== void 0 ? _g : true,
                ticketUpdates: (_h = data.ticketUpdates) !== null && _h !== void 0 ? _h : true,
                assetTransfer: (_j = data.assetTransfer) !== null && _j !== void 0 ? _j : true,
                channelInApp: (_k = data.channelInApp) !== null && _k !== void 0 ? _k : true,
                channelEmail: (_l = data.channelEmail) !== null && _l !== void 0 ? _l : false,
                channelSms: (_m = data.channelSms) !== null && _m !== void 0 ? _m : false,
                channelWhatsapp: (_o = data.channelWhatsapp) !== null && _o !== void 0 ? _o : false,
            },
        });
        res.json(pref);
    }
    catch (error) {
        console.error("updateMyPreferences error:", error);
        res.status(500).json({ message: "Failed to update preferences" });
    }
});
exports.updateMyPreferences = updateMyPreferences;
// ─── Admin: Get/Update Email Templates ───────────────────────────────────────
const getEmailTemplates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templates = yield prismaClient_1.default.emailTemplate.findMany({ orderBy: { code: "asc" } });
        res.json(templates);
    }
    catch (error) {
        console.error("getEmailTemplates error:", error);
        res.status(500).json({ message: "Failed to fetch email templates" });
    }
});
exports.getEmailTemplates = getEmailTemplates;
const upsertEmailTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, name, subject, bodyHtml, bodyText, isActive } = req.body;
        if (!code || !name || !subject || !bodyHtml) {
            res.status(400).json({ message: "code, name, subject, and bodyHtml are required" });
            return;
        }
        const template = yield prismaClient_1.default.emailTemplate.upsert({
            where: { code: String(code) },
            update: { name, subject, bodyHtml, bodyText, isActive },
            create: { code, name, subject, bodyHtml, bodyText, isActive: isActive !== null && isActive !== void 0 ? isActive : true },
        });
        res.json(template);
    }
    catch (error) {
        console.error("upsertEmailTemplate error:", error);
        res.status(500).json({ message: "Failed to save email template" });
    }
});
exports.upsertEmailTemplate = upsertEmailTemplate;
// ─── Seed Default Email Templates ───────────────────────────────────────────
const seedEmailTemplates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templates = [
            { code: "TICKET_RAISED", name: "Ticket Raised", subject: "New Ticket: {{ticketId}} — {{issueType}}", bodyHtml: "<h3>New Ticket Raised</h3><p>Hi {{name}},</p><p>A new ticket <strong>{{ticketId}}</strong> has been raised for <strong>{{assetName}}</strong>.</p><p><strong>Issue:</strong> {{issueType}}</p><p><strong>Priority:</strong> {{priority}}</p><p><strong>Description:</strong> {{description}}</p><p>Please take necessary action.</p><p>— Smart Assets</p>" },
            { code: "TICKET_ASSIGNED", name: "Ticket Assigned", subject: "Ticket {{ticketId}} Assigned to You", bodyHtml: "<h3>Ticket Assigned</h3><p>Hi {{name}},</p><p>Ticket <strong>{{ticketId}}</strong> has been assigned to you.</p><p><strong>Asset:</strong> {{assetName}}</p><p><strong>Issue:</strong> {{issueType}}</p><p>Please review and take action.</p><p>— Smart Assets</p>" },
            { code: "TICKET_RESOLVED", name: "Ticket Resolved", subject: "Ticket {{ticketId}} Resolved", bodyHtml: "<h3>Ticket Resolved</h3><p>Hi {{name}},</p><p>Your ticket <strong>{{ticketId}}</strong> has been resolved.</p><p><strong>Resolution:</strong> {{resolution}}</p><p>If you're satisfied, please close the ticket.</p><p>— Smart Assets</p>" },
            { code: "TICKET_SLA_BREACH", name: "SLA Breach Alert", subject: "⚠️ SLA Breach: Ticket {{ticketId}}", bodyHtml: "<h3 style='color:#dc2626'>SLA Breach Alert</h3><p>Hi {{name}},</p><p>Ticket <strong>{{ticketId}}</strong> has breached its SLA.</p><p><strong>Asset:</strong> {{assetName}}</p><p><strong>Expected Resolution:</strong> {{slaHours}} hours</p><p>Immediate action required.</p><p>— Smart Assets</p>" },
            { code: "PO_APPROVAL", name: "PO Pending Approval", subject: "PO {{poNumber}} Pending Your Approval", bodyHtml: "<h3>Purchase Order Approval Required</h3><p>Hi {{name}},</p><p>Purchase Order <strong>{{poNumber}}</strong> of amount <strong>{{amount}}</strong> requires your approval.</p><p><strong>Vendor:</strong> {{vendorName}}</p><p><strong>Department:</strong> {{department}}</p><p>Please review and approve.</p><p>— Smart Assets</p>" },
            { code: "PO_APPROVED", name: "PO Approved", subject: "PO {{poNumber}} Approved", bodyHtml: "<h3>PO Approved</h3><p>Hi {{name}},</p><p>Your Purchase Order <strong>{{poNumber}}</strong> has been approved and sent to vendor.</p><p><strong>Amount:</strong> {{amount}}</p><p>— Smart Assets</p>" },
            { code: "GRA_ACCEPTED", name: "GRA Accepted", subject: "GRA {{grnNumber}} Accepted — Assets Created", bodyHtml: "<h3>Goods Receipt Accepted</h3><p>Hi {{name}},</p><p>GRA <strong>{{grnNumber}}</strong> has been accepted.</p><p>{{assetsCreated}}</p><p>Please verify the received items in the system.</p><p>— Smart Assets</p>" },
            { code: "WO_ASSIGNED", name: "Work Order Assigned", subject: "Work Order {{woNumber}} Assigned to You", bodyHtml: "<h3>Work Order Assigned</h3><p>Hi {{name}},</p><p>Work Order <strong>{{woNumber}}</strong> ({{woType}}) has been approved and assigned to you.</p><p><strong>Asset:</strong> {{assetName}}</p><p><strong>Description:</strong> {{description}}</p><p>You can now start the work.</p><p>— Smart Assets</p>" },
            { code: "WO_COMPLETED", name: "Work Order Completed", subject: "Work Order {{woNumber}} Completed", bodyHtml: "<h3>Work Order Completed</h3><p>Hi {{name}},</p><p>Work Order <strong>{{woNumber}}</strong> has been completed.</p><p><strong>Actual Cost:</strong> {{actualCost}}</p><p>Pending WCC issuance.</p><p>— Smart Assets</p>" },
            { code: "WCC_ISSUED", name: "WCC Issued", subject: "WCC {{wccNumber}} Issued for {{woNumber}}", bodyHtml: "<h3>Work Completion Certificate Issued</h3><p>Hi {{name}},</p><p>WCC <strong>{{wccNumber}}</strong> has been issued for Work Order <strong>{{woNumber}}</strong>.</p><p><strong>Total Cost:</strong> {{totalCost}}</p><p><strong>Quality Check:</strong> {{qualityStatus}}</p><p>— Smart Assets</p>" },
            { code: "WARRANTY_EXPIRY", name: "Warranty Expiring", subject: "⚠️ Warranty Expiring: {{assetName}}", bodyHtml: "<h3 style='color:#d97706'>Warranty Expiry Alert</h3><p>Hi {{name}},</p><p>The warranty for <strong>{{assetName}}</strong> ({{assetId}}) is expiring on <strong>{{expiryDate}}</strong>.</p><p><strong>Days Left:</strong> {{daysLeft}}</p><p>Please take action to renew if needed.</p><p>— Smart Assets</p>" },
            { code: "INSURANCE_EXPIRY", name: "Insurance Expiring", subject: "⚠️ Insurance Expiring: {{assetName}}", bodyHtml: "<h3 style='color:#d97706'>Insurance Expiry Alert</h3><p>Hi {{name}},</p><p>Insurance policy for <strong>{{assetName}}</strong> is expiring on <strong>{{expiryDate}}</strong>.</p><p><strong>Policy:</strong> {{policyNumber}}</p><p>Please renew the policy.</p><p>— Smart Assets</p>" },
            { code: "PM_OVERDUE", name: "PM Overdue", subject: "⚠️ Preventive Maintenance Overdue: {{assetName}}", bodyHtml: "<h3 style='color:#dc2626'>PM Overdue Alert</h3><p>Hi {{name}},</p><p>Preventive maintenance for <strong>{{assetName}}</strong> is overdue.</p><p><strong>Was Due:</strong> {{dueDate}}</p><p><strong>Days Overdue:</strong> {{daysOverdue}}</p><p>Please schedule maintenance immediately.</p><p>— Smart Assets</p>" },
            { code: "INDENT_APPROVED", name: "Indent Approved", subject: "Asset Indent {{indentNumber}} Approved", bodyHtml: "<h3>Indent Approved</h3><p>Hi {{name}},</p><p>Your asset indent <strong>{{indentNumber}}</strong> for <strong>{{assetName}}</strong> has been approved.</p><p>A purchase order will be created shortly.</p><p>— Smart Assets</p>" },
            { code: "INDENT_REJECTED", name: "Indent Rejected", subject: "Asset Indent {{indentNumber}} Rejected", bodyHtml: "<h3>Indent Rejected</h3><p>Hi {{name}},</p><p>Your asset indent <strong>{{indentNumber}}</strong> for <strong>{{assetName}}</strong> has been rejected.</p><p><strong>Reason:</strong> {{reason}}</p><p>— Smart Assets</p>" },
            { code: "DISPOSAL_APPROVED", name: "Disposal Approved", subject: "Asset Disposal Approved", bodyHtml: "<h3>Disposal Approved</h3><p>Hi {{name}},</p><p>The disposal request for asset <strong>{{assetName}}</strong> has been approved.</p><p>Please proceed with the disposal process.</p><p>— Smart Assets</p>" },
            { code: "TRANSFER_REQUEST", name: "Transfer Request", subject: "Asset Transfer Request: {{assetName}}", bodyHtml: "<h3>Transfer Request</h3><p>Hi {{name}},</p><p>A transfer request has been submitted for <strong>{{assetName}}</strong>.</p><p><strong>Type:</strong> {{transferType}}</p><p>Please review and approve.</p><p>— Smart Assets</p>" },
            { code: "GENERAL", name: "General Notification", subject: "{{title}}", bodyHtml: "<h3>{{title}}</h3><p>Hi {{name}},</p><p>{{message}}</p><p>— Smart Assets</p>" },
        ];
        const results = [];
        for (const t of templates) {
            const result = yield prismaClient_1.default.emailTemplate.upsert({
                where: { code: t.code },
                update: {},
                create: { code: t.code, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml, isActive: true },
            });
            results.push(result);
        }
        res.json({ message: `${results.length} email templates seeded`, data: results });
    }
    catch (error) {
        console.error("seedEmailTemplates error:", error);
        res.status(500).json({ message: "Failed to seed email templates" });
    }
});
exports.seedEmailTemplates = seedEmailTemplates;
// ─── Admin: Get/Update SMTP Config ───────────────────────────────────────────
const getSmtpConfig = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const config = yield prismaClient_1.default.smtpConfig.findFirst({ where: { isActive: true } });
        if (config) {
            // Mask password for security
            config.password = "********";
        }
        res.json(config || null);
    }
    catch (error) {
        console.error("getSmtpConfig error:", error);
        res.status(500).json({ message: "Failed to fetch SMTP config" });
    }
});
exports.getSmtpConfig = getSmtpConfig;
const upsertSmtpConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { host, port, secure, username, password, fromName, fromEmail } = req.body;
        if (!host || !port || !username || !fromEmail) {
            res.status(400).json({ message: "host, port, username, and fromEmail are required" });
            return;
        }
        // Deactivate all existing configs
        yield prismaClient_1.default.smtpConfig.updateMany({ data: { isActive: false } });
        const config = yield prismaClient_1.default.smtpConfig.create({
            data: {
                host,
                port: Number(port),
                secure: secure !== null && secure !== void 0 ? secure : true,
                username,
                password: password || "",
                fromName: fromName || "Smart Assets",
                fromEmail,
                isActive: true,
            },
        });
        res.json(config);
    }
    catch (error) {
        console.error("upsertSmtpConfig error:", error);
        res.status(500).json({ message: "Failed to save SMTP config" });
    }
});
exports.upsertSmtpConfig = upsertSmtpConfig;
// ─── Send Manual Email (with template + CC/BCC) ────────────────────────────
const sendManualEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { to, // string[] — primary recipients (emails or employeeIds)
        cc, // string[] — CC emails
        bcc, // string[] — BCC emails
        subject, // string (overrides template subject if provided)
        body, // string (HTML body, overrides template if provided)
        templateCode, // string — use a saved template
        templateData, // Record<string, string> — placeholder values
        employeeIds, // number[] — resolve employee emails as "to"
        ccEmployeeIds, // number[] — resolve employee emails as "cc"
        bccEmployeeIds, // number[] — resolve employee emails as "bcc"
         } = req.body;
        if (!(to === null || to === void 0 ? void 0 : to.length) && !(employeeIds === null || employeeIds === void 0 ? void 0 : employeeIds.length)) {
            res.status(400).json({ message: "At least one recipient (to or employeeIds) is required" });
            return;
        }
        if (!subject && !templateCode) {
            res.status(400).json({ message: "subject or templateCode is required" });
            return;
        }
        // Resolve employee IDs to emails
        const resolveEmails = (ids) => __awaiter(void 0, void 0, void 0, function* () {
            if (!(ids === null || ids === void 0 ? void 0 : ids.length))
                return [];
            const employees = yield prismaClient_1.default.employee.findMany({
                where: { id: { in: ids } },
                select: { email: true, name: true },
            });
            return employees.map(e => e.email).filter(Boolean);
        });
        const toEmails = [
            ...(to || []),
            ...(yield resolveEmails(employeeIds || [])),
        ];
        const ccEmails = [
            ...(cc || []),
            ...(yield resolveEmails(ccEmployeeIds || [])),
        ];
        const bccEmails = [
            ...(bcc || []),
            ...(yield resolveEmails(bccEmployeeIds || [])),
        ];
        if (toEmails.length === 0) {
            res.status(400).json({ message: "No valid recipient emails found" });
            return;
        }
        yield (0, notificationHelper_1.sendEmail)({
            to: toEmails,
            cc: ccEmails.length > 0 ? ccEmails : undefined,
            bcc: bccEmails.length > 0 ? bccEmails : undefined,
            subject: subject || "Notification",
            html: body || `<p>${subject || ''}</p>`,
            templateCode,
            templateData,
        });
        res.json({
            message: "Email sent successfully",
            sentTo: toEmails.length,
            cc: ccEmails.length,
            bcc: bccEmails.length,
        });
    }
    catch (error) {
        console.error("sendManualEmail error:", error);
        res.status(500).json({ message: "Failed to send email", error: error.message });
    }
});
exports.sendManualEmail = sendManualEmail;

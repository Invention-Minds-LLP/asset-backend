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
exports.formatCurrency = exports.getAdminIds = exports.getSecurityTeam = exports.getDepartmentHODs = exports.notify = exports.sendPushNotification = exports.sendEmail = exports.removeSSEClient = exports.addSSEClient = void 0;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const firebase_1 = require("../lib/firebase");
const formatCurrency = (n) => '₹' + n.toLocaleString('en-IN');
exports.formatCurrency = formatCurrency;
let clients = [];
const addSSEClient = (employeeId, res) => {
    clients.push({ employeeId, res });
};
exports.addSSEClient = addSSEClient;
const removeSSEClient = (res) => {
    clients = clients.filter(c => c.res !== res);
};
exports.removeSSEClient = removeSSEClient;
// ── Broadcast to connected SSE clients ──
const broadcastToEmployee = (employeeId, data) => {
    clients.forEach(client => {
        if (client.employeeId === employeeId) {
            client.res.write(`event: notification\n`);
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    });
};
// ── Replace template placeholders ──
function replacePlaceholders(text, data) {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}
// ── Send Email (supports CC/BCC) ──
const sendEmail = (options) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let { to, subject, html, cc, bcc, templateCode, templateData } = options;
        // If templateCode provided, try to load template from DB
        if (templateCode) {
            const template = yield prismaClient_1.default.emailTemplate.findUnique({ where: { code: templateCode } });
            if (template && template.isActive) {
                subject = replacePlaceholders(template.subject, templateData || {});
                html = replacePlaceholders(template.bodyHtml, templateData || {});
            }
        }
        // Try to get SMTP config from DB first
        const smtpConfig = yield prismaClient_1.default.smtpConfig.findFirst({ where: { isActive: true } });
        const transportConfig = smtpConfig
            ? { host: smtpConfig.host, port: smtpConfig.port, secure: smtpConfig.secure, auth: { user: smtpConfig.username, pass: smtpConfig.password } }
            : { host: process.env.SMTP_HOST || "smtp.hostinger.com", port: Number(process.env.SMTP_PORT) || 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } };
        const transporter = nodemailer_1.default.createTransport(transportConfig);
        const fromName = (smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.fromName) || "Smart Assets";
        const fromEmail = (smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.fromEmail) || process.env.SMTP_USER;
        const mailOptions = {
            from: `"${fromName}" <${fromEmail}>`,
            to: Array.isArray(to) ? to.join(', ') : to,
            subject,
            html,
        };
        if (cc)
            mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
        if (bcc)
            mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
        yield transporter.sendMail(mailOptions);
    }
    catch (err) {
        console.error("Email send failed (non-blocking):", err);
    }
});
exports.sendEmail = sendEmail;
// ── Firebase push (FCM) ──
// Sends a multicast push to every active device registered for `employeeId`.
// No-op when Firebase isn't configured (FIREBASE_SERVICE_ACCOUNT_PATH unset),
// so the rest of the notification flow keeps working in dev / demo envs.
// Tokens that come back as INVALID / NOT_REGISTERED are pruned automatically.
const sendPushNotification = (employeeId, title, message, data) => __awaiter(void 0, void 0, void 0, function* () {
    const app = (0, firebase_1.getFirebaseApp)();
    if (!app)
        return;
    try {
        const tokens = yield prismaClient_1.default.deviceToken.findMany({
            where: { employeeId },
            select: { token: true },
        });
        if (!tokens.length)
            return;
        const response = yield app.messaging().sendEachForMulticast({
            tokens: tokens.map(t => t.token),
            notification: { title, body: message },
            data: data !== null && data !== void 0 ? data : { route: "/notifications" },
        });
        // Cleanup tokens FCM tells us are dead. Codes that mean "remove this token":
        //   messaging/registration-token-not-registered
        //   messaging/invalid-registration-token
        response.responses.forEach((r, i) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            if (r.success)
                return;
            const code = ((_a = r.error) === null || _a === void 0 ? void 0 : _a.code) || "";
            if (code.includes("registration-token-not-registered") ||
                code.includes("invalid-registration-token") ||
                code.includes("invalid-argument")) {
                yield prismaClient_1.default.deviceToken.deleteMany({
                    where: { token: tokens[i].token },
                });
            }
        }));
    }
    catch (err) {
        // Push failure must never break the in-app / email flow.
        console.error("Push send failed (non-blocking):", err);
    }
});
exports.sendPushNotification = sendPushNotification;
// ── Map notification type → NotificationPreference category toggle ──
// Types not listed here have no per-category toggle and are always delivered.
const PREF_FIELD_BY_TYPE = {
    WARRANTY_EXPIRY: "warrantyExpiry",
    INSURANCE_EXPIRY: "insuranceExpiry",
    AMC_CMC_EXPIRY: "amcCmcExpiry",
    MAINTENANCE_DUE: "maintenanceDue",
    CALIBRATION: "maintenanceDue",
    SLA_BREACH: "slaBreach",
    LOW_STOCK: "lowStock",
    GATEPASS_OVERDUE: "gatepassOverdue",
    TICKET_UPDATE: "ticketUpdates",
    TRANSFER: "assetTransfer",
};
// ── Main notify function ──
// Call this from any controller to create notification + broadcast + optionally email.
// Honours each recipient's NotificationPreference (category + email channel) and,
// when a dedupeKey is supplied, silently skips if the same alert was already sent.
const notify = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        if (!params.recipientIds || params.recipientIds.length === 0)
            return;
        const channel = params.channel || "IN_APP";
        const uniqueIds = [...new Set(params.recipientIds)];
        // ── Apply per-employee notification preferences ──
        const prefs = yield prismaClient_1.default.notificationPreference.findMany({
            where: { employeeId: { in: uniqueIds } },
        });
        const prefByEmp = new Map(prefs.map(p => [p.employeeId, p]));
        const prefField = PREF_FIELD_BY_TYPE[params.type];
        // Category filter: drop employees who switched this category off.
        // No preference row → deliver (sensible default for alerts).
        const allowedIds = uniqueIds.filter(id => {
            if (!prefField)
                return true;
            const pref = prefByEmp.get(id);
            if (!pref)
                return true;
            return pref[prefField] !== false;
        });
        if (allowedIds.length === 0)
            return;
        // Create notification record (+ recipient rows for category-allowed employees)
        let notification;
        try {
            notification = yield prismaClient_1.default.notification.create({
                data: {
                    type: params.type,
                    title: params.title,
                    message: params.message,
                    priority: params.priority || "MEDIUM",
                    channel,
                    assetId: (_a = params.assetId) !== null && _a !== void 0 ? _a : null,
                    ticketId: (_b = params.ticketId) !== null && _b !== void 0 ? _b : null,
                    gatePassId: (_c = params.gatePassId) !== null && _c !== void 0 ? _c : null,
                    insuranceId: (_d = params.insuranceId) !== null && _d !== void 0 ? _d : null,
                    createdById: (_e = params.createdById) !== null && _e !== void 0 ? _e : null,
                    dedupeKey: (_f = params.dedupeKey) !== null && _f !== void 0 ? _f : null,
                    recipients: {
                        create: allowedIds.map(empId => ({ employeeId: empId })),
                    },
                },
            });
        }
        catch (err) {
            // P2002 = dedupeKey already used → this alert was already sent. Skip silently.
            if ((err === null || err === void 0 ? void 0 : err.code) === "P2002")
                return;
            throw err;
        }
        // Broadcast via SSE to each category-allowed recipient
        for (const empId of allowedIds) {
            broadcastToEmployee(empId, {
                id: notification.id,
                type: params.type,
                title: params.title,
                message: params.message,
                priority: params.priority || "MEDIUM",
                createdAt: notification.createdAt,
            });
        }
        // Send email if channel is EMAIL or BOTH — only to recipients who allow email
        if (channel === "EMAIL" || channel === "BOTH") {
            const employees = yield prismaClient_1.default.employee.findMany({
                where: { id: { in: allowedIds } },
                select: { id: true, email: true, name: true },
            });
            for (const emp of employees) {
                if (!emp.email)
                    continue;
                const pref = prefByEmp.get(emp.id);
                // No preference row → email allowed (matches existing alert behaviour).
                const emailAllowed = !pref || pref.channelEmail;
                if (!emailAllowed)
                    continue;
                const tplData = Object.assign({ name: emp.name || '' }, (params.templateData || {}));
                (0, exports.sendEmail)({
                    to: emp.email,
                    subject: params.emailSubject || params.title,
                    html: params.emailHtml || `<p>Hi ${emp.name},</p><p>${params.message}</p><p>— Smart Assets</p>`,
                    cc: params.cc,
                    bcc: params.bcc,
                    templateCode: params.templateCode,
                    templateData: tplData,
                });
            }
        }
        // Send Firebase push to recipients who allow push (channelPush on by default).
        // Fan-out happens in parallel; each call is fault-isolated and a no-op when
        // Firebase isn't configured, so this is safe on any environment.
        for (const empId of allowedIds) {
            const pref = prefByEmp.get(empId);
            const pushAllowed = !pref || pref.channelPush !== false;
            if (!pushAllowed)
                continue;
            void (0, exports.sendPushNotification)(empId, params.title, params.message, {
                notificationId: String(notification.id),
                type: params.type,
                route: "/notifications",
            });
        }
    }
    catch (err) {
        // Never break the main flow
        console.error("Notification failed (non-blocking):", err);
    }
});
exports.notify = notify;
// ── Helper to get HOD(s) for a department ──
const getDepartmentHODs = (departmentId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!departmentId)
        return [];
    const hods = yield prismaClient_1.default.employee.findMany({
        where: { departmentId, role: "HOD", isActive: true },
        select: { id: true },
    });
    return hods.map(h => h.id);
});
exports.getDepartmentHODs = getDepartmentHODs;
// ── Helper to get all SECURITY-role employees ──
// SECURITY isn't part of the EmployeeRole enum — it's stored on User.role (string).
// Same pattern as getAdminIds() above: walk User → Employee.
const getSecurityTeam = () => __awaiter(void 0, void 0, void 0, function* () {
    const securityUsers = yield prismaClient_1.default.user.findMany({
        where: { role: "SECURITY" },
        select: { employee: { select: { id: true } } },
    });
    return securityUsers.map(u => { var _a; return (_a = u.employee) === null || _a === void 0 ? void 0 : _a.id; }).filter(Boolean);
});
exports.getSecurityTeam = getSecurityTeam;
// ── Helper to get all ADMINs ──
const getAdminIds = () => __awaiter(void 0, void 0, void 0, function* () {
    // Admins are users with ADMIN role
    const admins = yield prismaClient_1.default.user.findMany({
        where: { role: "ADMIN" },
        select: { employee: { select: { id: true } } },
    });
    return admins.map(a => { var _a; return (_a = a.employee) === null || _a === void 0 ? void 0 : _a.id; }).filter(Boolean);
});
exports.getAdminIds = getAdminIds;

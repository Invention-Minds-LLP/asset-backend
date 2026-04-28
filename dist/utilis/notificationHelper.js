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
exports.formatCurrency = exports.getAdminIds = exports.getDepartmentHODs = exports.notify = exports.sendEmail = exports.removeSSEClient = exports.addSSEClient = void 0;
const prismaClient_1 = __importDefault(require("../prismaClient"));
const nodemailer_1 = __importDefault(require("nodemailer"));
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
// ── Main notify function ──
// Call this from any controller to create notification + broadcast + optionally email
const notify = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        if (!params.recipientIds || params.recipientIds.length === 0)
            return;
        const channel = params.channel || "IN_APP";
        // Create notification record
        const notification = yield prismaClient_1.default.notification.create({
            data: {
                type: params.type,
                title: params.title,
                message: params.message,
                priority: params.priority || "MEDIUM",
                channel,
                assetId: (_a = params.assetId) !== null && _a !== void 0 ? _a : null,
                ticketId: (_b = params.ticketId) !== null && _b !== void 0 ? _b : null,
                createdById: (_c = params.createdById) !== null && _c !== void 0 ? _c : null,
                recipients: {
                    create: params.recipientIds.map(empId => ({ employeeId: empId })),
                },
            },
        });
        // Broadcast via SSE to each recipient
        for (const empId of params.recipientIds) {
            broadcastToEmployee(empId, {
                id: notification.id,
                type: params.type,
                title: params.title,
                message: params.message,
                priority: params.priority || "MEDIUM",
                createdAt: notification.createdAt,
            });
        }
        // Send email if channel is EMAIL or BOTH
        if (channel === "EMAIL" || channel === "BOTH") {
            // Get employee emails
            const employees = yield prismaClient_1.default.employee.findMany({
                where: { id: { in: params.recipientIds } },
                select: { id: true, email: true, name: true },
            });
            for (const emp of employees) {
                if (emp.email) {
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

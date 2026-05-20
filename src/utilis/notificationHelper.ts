import prisma from "../prismaClient";
import nodemailer from "nodemailer";
import { Response } from "express";
import { getFirebaseApp } from "../lib/firebase";

const formatCurrency = (n: number) => '₹' + n.toLocaleString('en-IN');

// ── SSE Client Management ──
interface SSEClient {
  employeeId: number;
  res: Response;
}

let clients: SSEClient[] = [];

export const addSSEClient = (employeeId: number, res: Response) => {
  clients.push({ employeeId, res });
};

export const removeSSEClient = (res: Response) => {
  clients = clients.filter(c => c.res !== res);
};

// ── Broadcast to connected SSE clients ──
const broadcastToEmployee = (employeeId: number, data: any) => {
  clients.forEach(client => {
    if (client.employeeId === employeeId) {
      client.res.write(`event: notification\n`);
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  });
};

// ── Replace template placeholders ──
function replacePlaceholders(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

// ── Send Email (supports CC/BCC) ──
export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string | string[];
  bcc?: string | string[];
  templateCode?: string;
  templateData?: Record<string, string>;
}) => {
  try {
    let { to, subject, html, cc, bcc, templateCode, templateData } = options;

    // If templateCode provided, try to load template from DB
    if (templateCode) {
      const template = await prisma.emailTemplate.findUnique({ where: { code: templateCode } });
      if (template && template.isActive) {
        subject = replacePlaceholders(template.subject, templateData || {});
        html = replacePlaceholders(template.bodyHtml, templateData || {});
      }
    }

    // Try to get SMTP config from DB first
    const smtpConfig = await prisma.smtpConfig.findFirst({ where: { isActive: true } });

    const transportConfig: any = smtpConfig
      ? { host: smtpConfig.host, port: smtpConfig.port, secure: smtpConfig.secure, auth: { user: smtpConfig.username, pass: smtpConfig.password } }
      : { host: process.env.SMTP_HOST || "smtp.hostinger.com", port: Number(process.env.SMTP_PORT) || 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } };

    const transporter = nodemailer.createTransport(transportConfig);
    const fromName = smtpConfig?.fromName || "Smart Assets";
    const fromEmail = smtpConfig?.fromEmail || process.env.SMTP_USER;

    const mailOptions: any = {
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
    };
    if (cc) mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
    if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;

    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("Email send failed (non-blocking):", err);
  }
};

// ── Firebase push (FCM) ──
// Sends a multicast push to every active device registered for `employeeId`.
// No-op when Firebase isn't configured (FIREBASE_SERVICE_ACCOUNT_PATH unset),
// so the rest of the notification flow keeps working in dev / demo envs.
// Tokens that come back as INVALID / NOT_REGISTERED are pruned automatically.
export const sendPushNotification = async (
  employeeId: number,
  title: string,
  message: string,
  data?: Record<string, string>,
): Promise<void> => {
  const app = getFirebaseApp();
  if (!app) return;

  try {
    const tokens: { token: string }[] = await (prisma as any).deviceToken.findMany({
      where: { employeeId },
      select: { token: true },
    });
    if (!tokens.length) return;

    const response = await app.messaging().sendEachForMulticast({
      tokens: tokens.map(t => t.token),
      notification: { title, body: message },
      data: data ?? { route: "/notifications" },
    });

    // Cleanup tokens FCM tells us are dead. Codes that mean "remove this token":
    //   messaging/registration-token-not-registered
    //   messaging/invalid-registration-token
    response.responses.forEach(async (r, i) => {
      if (r.success) return;
      const code = (r.error as any)?.code || "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token") ||
        code.includes("invalid-argument")
      ) {
        await (prisma as any).deviceToken.deleteMany({
          where: { token: tokens[i].token },
        });
      }
    });
  } catch (err) {
    // Push failure must never break the in-app / email flow.
    console.error("Push send failed (non-blocking):", err);
  }
};

// ── Map notification type → NotificationPreference category toggle ──
// Types not listed here have no per-category toggle and are always delivered.
const PREF_FIELD_BY_TYPE: Record<string, string> = {
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
export const notify = async (params: {
  type: string;
  title: string;
  message: string;
  recipientIds: number[];
  priority?: string;
  channel?: string;       // IN_APP | EMAIL | BOTH (default IN_APP)
  assetId?: number;
  ticketId?: number;
  gatePassId?: number;
  insuranceId?: number;
  createdById?: number;
  dedupeKey?: string;     // when set, a repeat call with the same key is skipped
  emailSubject?: string;
  emailHtml?: string;
  templateCode?: string;
  templateData?: Record<string, string>;
  cc?: string[];          // CC email addresses
  bcc?: string[];         // BCC email addresses
}) => {
  try {
    if (!params.recipientIds || params.recipientIds.length === 0) return;

    const channel = params.channel || "IN_APP";
    const uniqueIds = [...new Set(params.recipientIds)];

    // ── Apply per-employee notification preferences ──
    const prefs = await prisma.notificationPreference.findMany({
      where: { employeeId: { in: uniqueIds } },
    });
    const prefByEmp = new Map(prefs.map(p => [p.employeeId, p]));

    const prefField = PREF_FIELD_BY_TYPE[params.type];

    // Category filter: drop employees who switched this category off.
    // No preference row → deliver (sensible default for alerts).
    const allowedIds = uniqueIds.filter(id => {
      if (!prefField) return true;
      const pref = prefByEmp.get(id) as any;
      if (!pref) return true;
      return pref[prefField] !== false;
    });

    if (allowedIds.length === 0) return;

    // Create notification record (+ recipient rows for category-allowed employees)
    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          type: params.type,
          title: params.title,
          message: params.message,
          priority: params.priority || "MEDIUM",
          channel,
          assetId: params.assetId ?? null,
          ticketId: params.ticketId ?? null,
          gatePassId: params.gatePassId ?? null,
          insuranceId: params.insuranceId ?? null,
          createdById: params.createdById ?? null,
          dedupeKey: params.dedupeKey ?? null,
          recipients: {
            create: allowedIds.map(empId => ({ employeeId: empId })),
          },
        },
      });
    } catch (err: any) {
      // P2002 = dedupeKey already used → this alert was already sent. Skip silently.
      if (err?.code === "P2002") return;
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
      const employees = await prisma.employee.findMany({
        where: { id: { in: allowedIds } },
        select: { id: true, email: true, name: true },
      });

      for (const emp of employees) {
        if (!emp.email) continue;
        const pref = prefByEmp.get(emp.id);
        // No preference row → email allowed (matches existing alert behaviour).
        const emailAllowed = !pref || pref.channelEmail;
        if (!emailAllowed) continue;

        const tplData = { name: emp.name || '', ...(params.templateData || {}) };
        sendEmail({
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
      const pref = prefByEmp.get(empId) as any;
      const pushAllowed = !pref || pref.channelPush !== false;
      if (!pushAllowed) continue;
      void sendPushNotification(empId, params.title, params.message, {
        notificationId: String(notification.id),
        type: params.type,
        route: "/notifications",
      });
    }
  } catch (err) {
    // Never break the main flow
    console.error("Notification failed (non-blocking):", err);
  }
};

// ── Helper to get HOD(s) for a department ──
export const getDepartmentHODs = async (departmentId: number | null | undefined): Promise<number[]> => {
  if (!departmentId) return [];
  const hods = await prisma.employee.findMany({
    where: { departmentId, role: "HOD", isActive: true },
    select: { id: true },
  });
  return hods.map(h => h.id);
};

// ── Helper to get all SECURITY-role employees ──
// SECURITY isn't part of the EmployeeRole enum — it's stored on User.role (string).
// Same pattern as getAdminIds() above: walk User → Employee.
export const getSecurityTeam = async (): Promise<number[]> => {
  const securityUsers = await prisma.user.findMany({
    where: { role: "SECURITY" },
    select: { employee: { select: { id: true } } },
  });
  return securityUsers.map(u => u.employee?.id).filter(Boolean) as number[];
};

// ── Helper to get all ADMINs ──
export const getAdminIds = async (): Promise<number[]> => {
  // Admins are users with ADMIN role
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { employee: { select: { id: true } } },
  });
  return admins.map(a => a.employee?.id).filter(Boolean) as number[];
};

export { formatCurrency };

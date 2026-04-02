import prisma from "../prismaClient";
import nodemailer from "nodemailer";
import { Response } from "express";

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

// ── Main notify function ──
// Call this from any controller to create notification + broadcast + optionally email
export const notify = async (params: {
  type: string;
  title: string;
  message: string;
  recipientIds: number[];
  priority?: string;
  channel?: string;       // IN_APP | EMAIL | BOTH (default IN_APP)
  assetId?: number;
  ticketId?: number;
  createdById?: number;
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

    // Create notification record
    const notification = await prisma.notification.create({
      data: {
        type: params.type,
        title: params.title,
        message: params.message,
        priority: params.priority || "MEDIUM",
        channel,
        assetId: params.assetId ?? null,
        ticketId: params.ticketId ?? null,
        createdById: params.createdById ?? null,
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
      const employees = await prisma.employee.findMany({
        where: { id: { in: params.recipientIds } },
        select: { id: true, email: true, name: true },
      });

      for (const emp of employees) {
        if (emp.email) {
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

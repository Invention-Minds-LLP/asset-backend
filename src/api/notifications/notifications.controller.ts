import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { sendEmail } from "../../utilis/notificationHelper";

// ─── Create Notification ───────────────────────────────────────────────────────
export const createNotification = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      type,
      title,
      message,
      priority,
      channel,
      assetId,
      ticketId,
      gatePassId,
      insuranceId,
      claimId,
      employeeId,
      recipientIds, // array of employee IDs
      dedupeKey,
    } = req.body;

    if (!type || !message) {
      res.status(400).json({ message: "type and message are required" });
      return;
    }

    const notification = await prisma.notification.create({
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
        createdById: req.user?.employeeDbId,
        dedupeKey: dedupeKey ?? undefined,
        recipients: recipientIds?.length
          ? {
              create: (recipientIds as number[]).map((empId) => ({
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
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ message: "Duplicate notification (dedupeKey already exists)" });
      return;
    }
    console.error("createNotification error:", error);
    res.status(500).json({ message: "Failed to create notification" });
  }
};

// ─── Get Notifications for Logged-in User ─────────────────────────────────────
export const getMyNotifications = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    const { isRead, page = "1", limit = "20" } = req.query;

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const where: any = { employeeId };
    if (isRead !== undefined) where.isRead = isRead === "true";

    const [recipients, total, unreadCount] = await Promise.all([
      prisma.notificationRecipient.findMany({
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
      prisma.notificationRecipient.count({ where }),
      prisma.notificationRecipient.count({ where: { employeeId, isRead: false } }),
    ]);

    res.json({
      data: recipients,
      total,
      unreadCount,
      page: parseInt(String(page)),
      limit: take,
    });
  } catch (error) {
    console.error("getMyNotifications error:", error);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

// ─── Get All Notifications (admin) ────────────────────────────────────────────
export const getAllNotifications = async (req: Request, res: Response) => {
  try {
    const { type, priority, assetId, ticketId } = req.query;

    const where: any = {};
    if (type) where.type = String(type);
    if (priority) where.priority = String(priority);
    if (assetId) where.assetId = Number(assetId);
    if (ticketId) where.ticketId = Number(ticketId);

    const notifications = await prisma.notification.findMany({
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
  } catch (error) {
    console.error("getAllNotifications error:", error);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

// ─── Mark Single Notification as Read ─────────────────────────────────────────
export const markAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const notificationId = parseInt(req.params.id);
    const employeeId = req.user.employeeDbId;

    const recipient = await prisma.notificationRecipient.findUnique({
      where: { notificationId_employeeId: { notificationId, employeeId } },
    });

    if (!recipient) {
      res.status(404).json({ message: "Notification not found for this user" });
      return;
    }

    const updated = await prisma.notificationRecipient.update({
      where: { notificationId_employeeId: { notificationId, employeeId } },
      data: { isRead: true, readAt: new Date() },
    });

    res.json(updated);
  } catch (error) {
    console.error("markAsRead error:", error);
    res.status(500).json({ message: "Failed to mark notification as read" });
  }
};

// ─── Mark All as Read ─────────────────────────────────────────────────────────
export const markAllAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;

    await prisma.notificationRecipient.updateMany({
      where: { employeeId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("markAllAsRead error:", error);
    res.status(500).json({ message: "Failed to mark all as read" });
  }
};

// ─── Delete Notification ───────────────────────────────────────────────────────
export const deleteNotification = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.notification.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    // Delete recipients first (FK constraint)
    await prisma.notificationRecipient.deleteMany({ where: { notificationId: id } });
    await prisma.notification.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error("deleteNotification error:", error);
    res.status(500).json({ message: "Failed to delete notification" });
  }
};

// ─── Get Unread Count ─────────────────────────────────────────────────────────
export const getUnreadCount = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    const count = await prisma.notificationRecipient.count({
      where: { employeeId, isRead: false },
    });

    res.json({ unreadCount: count });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    res.status(500).json({ message: "Failed to get unread count" });
  }
};

// ─── Get My Notification Preferences ─────────────────────────────────────────
export const getMyPreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }

    let pref = await prisma.notificationPreference.findUnique({
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
  } catch (error) {
    console.error("getMyPreferences error:", error);
    res.status(500).json({ message: "Failed to fetch preferences" });
  }
};

// ─── Update My Notification Preferences ──────────────────────────────────────
export const updateMyPreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }

    const employeeId = req.user.employeeDbId;
    const data = req.body;

    const pref = await prisma.notificationPreference.upsert({
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
        warrantyExpiry: data.warrantyExpiry ?? true,
        insuranceExpiry: data.insuranceExpiry ?? true,
        amcCmcExpiry: data.amcCmcExpiry ?? true,
        maintenanceDue: data.maintenanceDue ?? true,
        slaBreach: data.slaBreach ?? true,
        lowStock: data.lowStock ?? true,
        gatepassOverdue: data.gatepassOverdue ?? true,
        ticketUpdates: data.ticketUpdates ?? true,
        assetTransfer: data.assetTransfer ?? true,
        channelInApp: data.channelInApp ?? true,
        channelEmail: data.channelEmail ?? false,
        channelSms: data.channelSms ?? false,
        channelWhatsapp: data.channelWhatsapp ?? false,
      },
    });

    res.json(pref);
  } catch (error) {
    console.error("updateMyPreferences error:", error);
    res.status(500).json({ message: "Failed to update preferences" });
  }
};

// ─── Admin: Get/Update Email Templates ───────────────────────────────────────
export const getEmailTemplates = async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.emailTemplate.findMany({ orderBy: { code: "asc" } });
    res.json(templates);
  } catch (error) {
    console.error("getEmailTemplates error:", error);
    res.status(500).json({ message: "Failed to fetch email templates" });
  }
};

export const upsertEmailTemplate = async (req: Request, res: Response) => {
  try {
    const { code, name, subject, bodyHtml, bodyText, isActive } = req.body;

    if (!code || !name || !subject || !bodyHtml) {
      res.status(400).json({ message: "code, name, subject, and bodyHtml are required" });
      return;
    }

    const template = await prisma.emailTemplate.upsert({
      where: { code: String(code) },
      update: { name, subject, bodyHtml, bodyText, isActive },
      create: { code, name, subject, bodyHtml, bodyText, isActive: isActive ?? true },
    });

    res.json(template);
  } catch (error) {
    console.error("upsertEmailTemplate error:", error);
    res.status(500).json({ message: "Failed to save email template" });
  }
};

// ─── Seed Default Email Templates ───────────────────────────────────────────
export const seedEmailTemplates = async (_req: Request, res: Response) => {
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
      const result = await prisma.emailTemplate.upsert({
        where: { code: t.code },
        update: {},
        create: { code: t.code, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml, isActive: true },
      });
      results.push(result);
    }

    res.json({ message: `${results.length} email templates seeded`, data: results });
  } catch (error) {
    console.error("seedEmailTemplates error:", error);
    res.status(500).json({ message: "Failed to seed email templates" });
  }
};

// ─── Admin: Get/Update SMTP Config ───────────────────────────────────────────
export const getSmtpConfig = async (_req: Request, res: Response) => {
  try {
    const config = await prisma.smtpConfig.findFirst({ where: { isActive: true } });
    if (config) {
      // Mask password for security
      (config as any).password = "********";
    }
    res.json(config || null);
  } catch (error) {
    console.error("getSmtpConfig error:", error);
    res.status(500).json({ message: "Failed to fetch SMTP config" });
  }
};

export const upsertSmtpConfig = async (req: Request, res: Response) => {
  try {
    const { host, port, secure, username, password, fromName, fromEmail } = req.body;

    if (!host || !port || !username || !fromEmail) {
      res.status(400).json({ message: "host, port, username, and fromEmail are required" });
      return;
    }

    // Deactivate all existing configs
    await prisma.smtpConfig.updateMany({ data: { isActive: false } });

    const config = await prisma.smtpConfig.create({
      data: {
        host,
        port: Number(port),
        secure: secure ?? true,
        username,
        password: password || "",
        fromName: fromName || "Smart Assets",
        fromEmail,
        isActive: true,
      },
    });

    res.json(config);
  } catch (error) {
    console.error("upsertSmtpConfig error:", error);
    res.status(500).json({ message: "Failed to save SMTP config" });
  }
};

// ─── Send Manual Email (with template + CC/BCC) ────────────────────────────
export const sendManualEmail = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      to,              // string[] — primary recipients (emails or employeeIds)
      cc,              // string[] — CC emails
      bcc,             // string[] — BCC emails
      subject,         // string (overrides template subject if provided)
      body,            // string (HTML body, overrides template if provided)
      templateCode,    // string — use a saved template
      templateData,    // Record<string, string> — placeholder values
      employeeIds,     // number[] — resolve employee emails as "to"
      ccEmployeeIds,   // number[] — resolve employee emails as "cc"
      bccEmployeeIds,  // number[] — resolve employee emails as "bcc"
    } = req.body;

    if (!to?.length && !employeeIds?.length) {
      res.status(400).json({ message: "At least one recipient (to or employeeIds) is required" });
      return;
    }
    if (!subject && !templateCode) {
      res.status(400).json({ message: "subject or templateCode is required" });
      return;
    }

    // Resolve employee IDs to emails
    const resolveEmails = async (ids: number[]): Promise<string[]> => {
      if (!ids?.length) return [];
      const employees = await prisma.employee.findMany({
        where: { id: { in: ids } },
        select: { email: true, name: true },
      });
      return employees.map(e => e.email).filter(Boolean) as string[];
    };

    const toEmails = [
      ...(to || []),
      ...(await resolveEmails(employeeIds || [])),
    ];
    const ccEmails = [
      ...(cc || []),
      ...(await resolveEmails(ccEmployeeIds || [])),
    ];
    const bccEmails = [
      ...(bcc || []),
      ...(await resolveEmails(bccEmployeeIds || [])),
    ];

    if (toEmails.length === 0) {
      res.status(400).json({ message: "No valid recipient emails found" });
      return;
    }

    await sendEmail({
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
  } catch (error: any) {
    console.error("sendManualEmail error:", error);
    res.status(500).json({ message: "Failed to send email", error: error.message });
  }
};

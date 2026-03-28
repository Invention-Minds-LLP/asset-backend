import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

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

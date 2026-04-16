import { Request, Response } from "express";
import prisma from "../../prismaClient";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { MobileAuthRequest } from "../../middleware/mobileAuthMiddleware";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";

// Mobile Login — returns token + user profile + assigned assets summary
export const mobileLogin = async (req: Request, res: Response) => {
  try {
    const { employeeId, password, deviceId, deviceType, pushToken } = req.body;

    if (!employeeId || !password) {
      res.status(400).json({ message: "Employee ID and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { employeeID: employeeId },
      include: {
        employee: {
          include: {
            department: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      // Log failed attempt
      await prisma.loginHistory.create({
        data: { userId: user.id, success: false, ipAddress: req.ip, userAgent: req.headers["user-agent"] || "mobile" },
      });
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // Generate token
    const token = jwt.sign(
      {
        userId: user.id,
        employeeID: user.employeeID,
        employeeDbId: user.employee?.id,
        role: user.role,
        name: user.employee?.name,
        departmentId: user.employee?.departmentId,
      },
      JWT_SECRET,
      { expiresIn: "30d" } // Mobile tokens last longer
    );

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    // Log successful login
    await prisma.loginHistory.create({
      data: { userId: user.id, success: true, ipAddress: req.ip, userAgent: `mobile-${deviceType || "unknown"}` },
    });

    // Get summary counts for the user
    const employeeDbId = user.employee?.id;
    const departmentId = user.employee?.departmentId;

    const [myAssetsCount, myTicketsCount, pendingAckCount, unreadNotifs] = await Promise.all([
      employeeDbId ? prisma.asset.count({ where: { allottedToId: employeeDbId } }) : Promise.resolve(0),
      employeeDbId ? prisma.ticket.count({ where: { raisedById: employeeDbId, status: { notIn: ["CLOSED", "RESOLVED"] } } }) : Promise.resolve(0),
      employeeDbId ? prisma.assetAssignment.count({ where: { assignedToId: employeeDbId, status: "PENDING", isActive: true } }) : Promise.resolve(0),
      employeeDbId ? prisma.notificationRecipient.count({ where: { employeeId: employeeDbId, isRead: false } }) : Promise.resolve(0),
    ]);

    res.json({
      token,
      user: {
        id: user.id,
        employeeID: user.employeeID,
        employeeDbId: user.employee?.id,
        name: user.employee?.name,
        email: user.employee?.email,
        phone: user.employee?.phone,
        designation: user.employee?.designation,
        role: user.role,
        departmentId: user.employee?.departmentId,
        departmentName: user.employee?.department?.name,
      },
      summary: {
        myAssets: myAssetsCount,
        openTickets: myTicketsCount,
        pendingAcknowledgements: pendingAckCount,
        unreadNotifications: unreadNotifs,
      },
    });
  } catch (error: any) {
    console.error("mobileLogin error:", error);
    res.status(500).json({ message: "Login failed" });
  }
};

// Get mobile dashboard data for current user
export const getMobileDashboard = async (req: MobileAuthRequest, res: Response) => {
  try {
    const user = req.user as any;
    const employeeDbId = user?.employeeDbId;

    if (!employeeDbId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // My assets
    const myAssets = await prisma.asset.findMany({
      where: { allottedToId: employeeDbId },
      select: {
        id: true, assetId: true, assetName: true, status: true, assetPhoto: true,
        currentLocation: true, workingCondition: true,
        assetCategory: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { assetName: "asc" },
      take: 50,
    });

    // My recent tickets
    const myTickets = await prisma.ticket.findMany({
      where: { raisedById: employeeDbId },
      select: {
        id: true, ticketId: true, issueType: true, priority: true, status: true,
        createdAt: true,
        asset: { select: { assetId: true, assetName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Pending acknowledgements
    const pendingAcks = await prisma.assetAssignment.findMany({
      where: { assignedToId: employeeDbId, status: "PENDING", isActive: true },
      select: {
        id: true, assignedAt: true,
        asset: { select: { id: true, assetId: true, assetName: true, assetPhoto: true } },
      },
      orderBy: { assignedAt: "desc" },
    });

    // Recent notifications
    const notifications = await prisma.notificationRecipient.findMany({
      where: { employeeId: employeeDbId },
      include: {
        notification: {
          select: { id: true, type: true, title: true, message: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    res.json({
      myAssets,
      myTickets,
      pendingAcknowledgements: pendingAcks,
      notifications: notifications.map(n => ({
        id: n.notification.id,
        recipientId: n.id,
        type: n.notification.type,
        title: n.notification.title,
        message: n.notification.message,
        isRead: n.isRead,
        createdAt: n.notification.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("getMobileDashboard error:", error);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
};

// Get all assets for ticket creation (same as web — no role filter)
export const getMobileAssetList = async (req: MobileAuthRequest, res: Response) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { status: { notIn: ["DISPOSED", "SCRAPPED"] } },
      select: {
        id: true, assetId: true, assetName: true, serialNumber: true,
        currentLocation: true, status: true,
        department: { select: { name: true } },
        assetCategory: { select: { name: true } },
      },
      orderBy: { assetName: "asc" },
    });
    res.json(assets);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to load assets" });
  }
};

// Quick raise ticket from mobile
export const mobileRaiseTicket = async (req: MobileAuthRequest, res: Response) => {
  try {
    const user = req.user as any;
    if (!user?.employeeDbId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { assetId, issueType, description, priority, location, photoUrl } = req.body;

    if (!assetId || !issueType || !description || !location) {
      res.status(400).json({ message: "assetId, issueType, description, and location are required" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
      select: { id: true, assetId: true, departmentId: true },
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    // Generate ticket ID
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEnd = fyStart + 1;
    const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
    const prefix = `TKT-${fyStr}-`;

    const latestTicket = await prisma.ticket.findFirst({
      where: { ticketId: { startsWith: prefix } },
      orderBy: { id: "desc" },
    });

    let seq = 1;
    if (latestTicket) {
      const parts = latestTicket.ticketId.split("-");
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last)) seq = last + 1;
    }

    const ticketId = `${prefix}${seq.toString().padStart(5, "0")}`;

    const ticket = await prisma.ticket.create({
      data: {
        ticketId,
        assetId: asset.id,
        departmentId: asset.departmentId || 1,
        raisedById: user.employeeDbId,
        issueType,
        detailedDesc: description,
        priority: priority || "MEDIUM",
        location,
        photoOfIssue: photoUrl || null,
        status: "OPEN",
        workCategory: "BREAKDOWN",
        createdById: user.employeeDbId,
      },
      include: {
        asset: { select: { assetId: true, assetName: true } },
      },
    });

    // Update asset status
    await prisma.asset.update({
      where: { id: asset.id },
      data: { status: "UNDER_OBSERVATION" },
    });

    res.status(201).json(ticket);
  } catch (error: any) {
    console.error("mobileRaiseTicket error:", error);
    res.status(500).json({ message: "Failed to create ticket" });
  }
};

// Get user profile
export const getMobileProfile = async (req: MobileAuthRequest, res: Response) => {
  try {
    const user = req.user as any;
    const employee = await prisma.employee.findUnique({
      where: { id: user.employeeDbId },
      include: {
        department: { select: { name: true } },
      },
    });

    if (!employee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    res.json({
      ...employee,
      role: user.role,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to load profile" });
  }
};

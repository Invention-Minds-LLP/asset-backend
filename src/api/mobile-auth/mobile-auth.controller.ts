import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../../prismaClient";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { MobileAuthRequest } from "../../middleware/mobileAuthMiddleware";
import { sendEmail } from "../../utilis/notificationHelper";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";

// Password login (no OTP) — Employee ID + password. Re-added for QA / Google
// Play review. Authenticates against User.passwordHash (same password as the
// web admin) and returns the same shape as the OTP verify success.
export const mobileLogin = async (req: Request, res: Response) => {
  try {
    const { employeeId, password, deviceType } = req.body || {};
    if (!employeeId || !password) {
      res.status(400).json({ message: "Employee ID and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { employeeID: employeeId },
      include: { employee: { include: { department: { select: { id: true, name: true } } } } },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      if (user) {
        await prisma.loginHistory.create({
          data: { userId: user.id, success: false, ipAddress: req.ip, userAgent: `mobile-pw-${deviceType || "unknown"}` },
        });
      }
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // Deactivated employees cannot sign in.
    if (user.employee?.isActive === false) {
      res.status(403).json({ message: "Your account is inactive. Please contact your administrator." });
      return;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        employeeID: user.employeeID,
        employeeDbId: user.employee?.id,
        role: user.role,
        name: user.employee?.name,
        departmentId: user.employee?.departmentId,
        userType: "INTERNAL",
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await prisma.loginHistory.create({
      data: { userId: user.id, success: true, ipAddress: req.ip, userAgent: `mobile-pw-${deviceType || "unknown"}` },
    });

    const employeeDbId = user.employee?.id;
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
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Exact counts (not limited by the take:20 lists above) for summary tiles.
    const CLOSED_STATUSES: any = ["CLOSED", "RESOLVED", "TERMINATED"];
    const RESOLVED_STATUSES: any = ["RESOLVED", "CLOSED"];
    const [openTicketsCount, resolvedTicketsCount, totalAssetsCount] = await Promise.all([
      prisma.ticket.count({ where: { raisedById: employeeDbId, status: { notIn: CLOSED_STATUSES } } }),
      prisma.ticket.count({ where: { raisedById: employeeDbId, status: { in: RESOLVED_STATUSES } } }),
      prisma.asset.count({ where: { allottedToId: employeeDbId } }),
    ]);

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
      counts: {
        assets: totalAssetsCount,
        openTickets: openTicketsCount,
        resolvedTickets: resolvedTicketsCount,
      },
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

// GET /api/mobile/assets/mine
// The caller's "own" assets, role-aware:
//   SUPERVISOR → assets they supervise (supervisorId) OR are allotted (allottedToId)
//   everyone else (EXECUTIVE / regular staff) → assets allotted to them (allottedToId)
// Used by the raise-ticket picker for non-privileged roles.
export const getMyAssets = async (req: MobileAuthRequest, res: Response) => {
  try {
    const empId = req.user?.employeeDbId;
    if (!empId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const role = (req.user?.role || "").toUpperCase();
    const ownerWhere =
      role === "SUPERVISOR"
        ? { OR: [
            { supervisorId: empId },
            { supervisors: { some: { employeeId: empId, isActive: true } } },
            { allottedToId: empId },
          ] }
        : { allottedToId: empId };

    const assets = await prisma.asset.findMany({
      where: { ...ownerWhere, status: { notIn: ["DISPOSED", "SCRAPPED"] } },
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

// ── OTP login (internal employees) ────────────────────────────────────────
// Two-step replacement for the password flow. Until Batch B's cleanup removes
// the password endpoint, both auth paths coexist.

const OTP_TTL_MS = 5 * 60 * 1000;            // 5 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;    // 60 seconds
const OTP_MAX_ATTEMPTS = 5;
const OTP_BCRYPT_COST = 10;
const INTERNAL_IDENTIFIER_TYPE = "EMPLOYEE_ID";
const EXTERNAL_IDENTIFIER_TYPE = "EXTERNAL_EMAIL";
const EXTERNAL_JWT_TTL = "8h";

// POST /api/mobile/login/request-otp
// Body: { employeeId }
// Always responds 200 success — even if the employee doesn't exist or has no
// email on file — so an attacker can't enumerate valid employee IDs by probing.
// Rate-limited to one fresh OTP per 60s per identifier.
export const mobileRequestOtp = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.body || {};

    if (!employeeId || typeof employeeId !== "string") {
      res.status(400).json({ message: "Employee ID is required" });
      return;
    }

    // Rate limit check first — don't even hit the user table if the caller
    // is hammering the endpoint.
    const recent = await prisma.loginOtp.findFirst({
      where: {
        identifier: employeeId,
        identifierType: INTERNAL_IDENTIFIER_TYPE,
        createdAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      const retryAfterSec = Math.ceil(
        (recent.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now()) / 1000
      );
      res.setHeader("Retry-After", String(Math.max(retryAfterSec, 1)));
      res.status(429).json({ message: "Please wait before requesting another code." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { employeeID: employeeId },
      include: { employee: { select: { email: true, name: true, isActive: true } } },
    });

    const email = user?.employee?.email;

    // Unknown employee ID → still respond success so we don't leak which IDs
    // exist (enumeration protection).
    if (!user) {
      res.json({ success: true });
      return;
    }

    // Deactivated employee → no code is sent, but respond the same way so the
    // caller can't tell an inactive account apart from an unknown one.
    if (user.employee?.isActive === false) {
      res.json({ success: true });
      return;
    }

    // Known employee but no email on file → nowhere to send the OTP, so surface
    // a clear error instead of a silent success the user can't act on.
    if (!email) {
      res.status(400).json({
        message: "No email is registered for your account. Please contact your administrator to add one.",
      });
      return;
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, OTP_BCRYPT_COST);

    await prisma.loginOtp.create({
      data: {
        identifier: employeeId,
        identifierType: INTERNAL_IDENTIFIER_TYPE,
        otpHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    // Fire and forget — sendEmail swallows errors internally. If SMTP is
    // misconfigured the OTP row still exists; the user will never receive it,
    // but the failure is logged server-side.
    await sendEmail({
      to: email,
      subject: "Your Smart Assets login code",
      html: `<p>Hi ${user.employee?.name || "there"},</p>
             <p>Your Smart Assets login code is:</p>
             <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p>
             <p>This code expires in 5 minutes. If you didn't request it, ignore this email.</p>
             <p>— Smart Assets</p>`,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("mobileRequestOtp error:", error);
    res.status(500).json({ message: "Failed to send login code" });
  }
};

// POST /api/mobile/login/verify-otp
// Body: { employeeId, otp, deviceId?, deviceType?, pushToken? }
// On success, returns the same shape as POST /api/mobile/login.
export const mobileVerifyOtp = async (req: Request, res: Response) => {
  try {
    const { employeeId, otp, deviceType } = req.body || {};

    if (!employeeId || !otp) {
      res.status(400).json({ message: "Employee ID and code are required" });
      return;
    }

    const record = await prisma.loginOtp.findFirst({
      where: {
        identifier: employeeId,
        identifierType: INTERNAL_IDENTIFIER_TYPE,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record || record.expiresAt < new Date()) {
      res.status(401).json({ message: "Code expired. Request a new one." });
      return;
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(401).json({ message: "Too many attempts. Request a new code." });
      return;
    }

    const isMatch = await bcrypt.compare(String(otp), record.otpHash);
    if (!isMatch) {
      await prisma.loginOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      res.status(401).json({ message: "Incorrect code." });
      return;
    }

    // Consume immediately so the same code can't be replayed.
    await prisma.loginOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

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
      // OTP was valid but user record vanished between issuance and verify.
      // Treat as expired so the client requests a new code.
      res.status(401).json({ message: "Account no longer available." });
      return;
    }

    // Re-check status NOW: the employee may have been deactivated between
    // request-otp and verify-otp. A correct code must not let them in.
    if (user.employee?.isActive === false) {
      res.status(403).json({ message: "Your account is inactive. Please contact your administrator." });
      return;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        employeeID: user.employeeID,
        employeeDbId: user.employee?.id,
        role: user.role,
        name: user.employee?.name,
        departmentId: user.employee?.departmentId,
        userType: "INTERNAL",
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        success: true,
        ipAddress: req.ip,
        userAgent: `mobile-otp-${deviceType || "unknown"}`,
      },
    });

    const employeeDbId = user.employee?.id;
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
    console.error("mobileVerifyOtp error:", error);
    res.status(500).json({ message: "Login failed" });
  }
};

// ── OTP login (external auditors) ─────────────────────────────────────────
// Parallel flow to the internal one, but the identifier is an email looked up
// against the ExternalAuditor master (status=ACTIVE only). Tokens carry
// userType=EXTERNAL and a much shorter TTL than internal employees.

// POST /api/mobile/external/request-otp
// Body: { email }
// Always 200 — even if the email isn't registered or is INACTIVE — so we
// can't be used to enumerate which addresses are valid auditors.
export const externalRequestOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== "string") {
      res.status(400).json({ message: "Email is required" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limit check before any other work.
    const recent = await prisma.loginOtp.findFirst({
      where: {
        identifier: normalizedEmail,
        identifierType: EXTERNAL_IDENTIFIER_TYPE,
        createdAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      const retryAfterSec = Math.ceil(
        (recent.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now()) / 1000
      );
      res.setHeader("Retry-After", String(Math.max(retryAfterSec, 1)));
      res.status(429).json({ message: "Please wait before requesting another code." });
      return;
    }

    const auditor = await prisma.externalAuditor.findUnique({
      where: { email: normalizedEmail },
    });

    // Unknown email OR INACTIVE auditor → silent success, no email sent.
    // Prevents enumeration of which addresses are registered or active.
    if (!auditor || auditor.status !== "ACTIVE") {
      res.json({ success: true });
      return;
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, OTP_BCRYPT_COST);

    await prisma.loginOtp.create({
      data: {
        identifier: normalizedEmail,
        identifierType: EXTERNAL_IDENTIFIER_TYPE,
        otpHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await sendEmail({
      to: auditor.email,
      subject: "Your Smart Assets auditor login code",
      html: `<p>Hi ${auditor.name},</p>
             <p>Your Smart Assets login code is:</p>
             <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p>
             <p>This code expires in 5 minutes. If you didn't request it, ignore this email.</p>
             <p>— Smart Assets</p>`,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("externalRequestOtp error:", error);
    res.status(500).json({ message: "Failed to send login code" });
  }
};

// POST /api/mobile/external/verify-otp
// Body: { email, otp }
// Success → JWT with userType=EXTERNAL, externalAuditorId, email, 8h TTL.
export const externalVerifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body || {};

    if (!email || !otp) {
      res.status(400).json({ message: "Email and code are required" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const record = await prisma.loginOtp.findFirst({
      where: {
        identifier: normalizedEmail,
        identifierType: EXTERNAL_IDENTIFIER_TYPE,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record || record.expiresAt < new Date()) {
      res.status(401).json({ message: "Code expired. Request a new one." });
      return;
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(401).json({ message: "Too many attempts. Request a new code." });
      return;
    }

    const isMatch = await bcrypt.compare(String(otp), record.otpHash);
    if (!isMatch) {
      await prisma.loginOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      res.status(401).json({ message: "Incorrect code." });
      return;
    }

    // Even if the OTP was right, re-check the auditor's status NOW. If they
    // were deactivated between request-otp and verify-otp, deny entry.
    const auditor = await prisma.externalAuditor.findUnique({
      where: { email: normalizedEmail },
    });
    if (!auditor || auditor.status !== "ACTIVE") {
      res.status(401).json({ message: "Account no longer available." });
      return;
    }

    await prisma.loginOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const token = jwt.sign(
      {
        userType: "EXTERNAL",
        externalAuditorId: auditor.id,
        email: auditor.email,
      },
      JWT_SECRET,
      { expiresIn: EXTERNAL_JWT_TTL }
    );

    res.json({
      token,
      auditor: {
        id: auditor.id,
        email: auditor.email,
        name: auditor.name,
        organization: auditor.organization,
      },
    });
  } catch (error: any) {
    console.error("externalVerifyOtp error:", error);
    res.status(500).json({ message: "Login failed" });
  }
};

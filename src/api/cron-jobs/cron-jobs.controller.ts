import { Request, Response } from "express";
import prisma from "../../prismaClient";
import nodemailer from "nodemailer";

// ─── Helper: Get Active SMTP Config ──────────────────────────────────────────
async function getTransporter() {
  const config = await prisma.smtpConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    // Fallback to env vars
    return nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    } as nodemailer.TransportOptions);
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
  } as nodemailer.TransportOptions);
}

async function sendAlertEmail(to: string, subject: string, html: string) {
  try {
    const transporter = await getTransporter();
    const config = await prisma.smtpConfig.findFirst({ where: { isActive: true } });
    const from = config ? `"${config.fromName}" <${config.fromEmail}>` : `"Smart Assets" <${process.env.SMTP_USER}>`;

    await transporter.sendMail({ from, to, subject, html });
    return true;
  } catch (err) {
    console.error("sendAlertEmail failed:", err);
    return false;
  }
}

// ─── Check Warranty Expiry ───────────────────────────────────────────────────
export const checkWarrantyExpiry = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);

    const expiringWarranties = await prisma.warranty.findMany({
      where: {
        isActive: true,
        isUnderWarranty: true,
        alertSent: false,
        warrantyEnd: { gte: now, lte: thirtyDays },
      },
      include: {
        asset: { select: { assetId: true, assetName: true, departmentId: true } },
      },
    });

    let notified = 0;

    for (const w of expiringWarranties) {
      const daysLeft = Math.ceil((new Date(w.warrantyEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Create in-app notification
      const notif = await prisma.notification.create({
        data: {
          type: "WARRANTY_EXPIRY",
          title: "Warranty Expiring Soon",
          message: `Warranty for ${w.asset.assetName} (${w.asset.assetId}) expires in ${daysLeft} days.`,
          assetId: w.assetId,
          priority: daysLeft <= 7 ? "HIGH" : "MEDIUM",
          dedupeKey: `warranty-expiry-${w.id}-${w.warrantyEnd.toISOString().split("T")[0]}`,
        },
      });

      // Notify HOD
      if (w.asset.departmentId) {
        const hod = await prisma.employee.findFirst({
          where: { departmentId: w.asset.departmentId, role: "HOD" },
        });
        if (hod) {
          await prisma.notificationRecipient.create({
            data: { notificationId: notif.id, employeeId: hod.id },
          });

          // Send email if HOD has email preferences enabled
          if (hod.email) {
            const pref = await prisma.notificationPreference.findUnique({ where: { employeeId: hod.id } });
            if (!pref || pref.channelEmail) {
              await sendAlertEmail(
                hod.email,
                `Warranty Expiring: ${w.asset.assetName}`,
                `<p>The warranty for <strong>${w.asset.assetName}</strong> (${w.asset.assetId}) expires in <strong>${daysLeft} days</strong>.</p><p>Please take necessary action.</p>`
              );
            }
          }
        }
      }

      await prisma.warranty.update({ where: { id: w.id }, data: { alertSent: true } });
      notified++;
    }

    res.json({ message: `${notified} warranty expiry alerts sent`, count: notified });
  } catch (error) {
    console.error("checkWarrantyExpiry error:", error);
    res.status(500).json({ message: "Failed to check warranty expiry" });
  }
};

// ─── Check Insurance Expiry ──────────────────────────────────────────────────
export const checkInsuranceExpiry = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);

    const expiringPolicies = await prisma.assetInsurance.findMany({
      where: {
        isActive: true,
        policyStatus: "ACTIVE",
        endDate: { gte: now, lte: thirtyDays },
      },
      include: {
        asset: { select: { assetId: true, assetName: true, departmentId: true } },
      },
    });

    let notified = 0;

    for (const p of expiringPolicies) {
      const daysLeft = Math.ceil((new Date(p.endDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      await prisma.notification.create({
        data: {
          type: "INSURANCE_EXPIRY",
          title: "Insurance Policy Expiring Soon",
          message: `Insurance policy ${p.policyNumber || ""} for ${p.asset.assetName} expires in ${daysLeft} days.`,
          assetId: p.assetId,
          insuranceId: p.id,
          priority: daysLeft <= 7 ? "HIGH" : "MEDIUM",
          dedupeKey: `insurance-expiry-${p.id}-${p.endDate?.toISOString().split("T")[0]}`,
        },
      });

      notified++;
    }

    res.json({ message: `${notified} insurance expiry alerts sent`, count: notified });
  } catch (error) {
    console.error("checkInsuranceExpiry error:", error);
    res.status(500).json({ message: "Failed to check insurance expiry" });
  }
};

// ─── Check SLA Breach ────────────────────────────────────────────────────────
export const checkSLABreach = async (_req: Request, res: Response) => {
  try {
    // Find open tickets that have breached SLA
    const breachedTickets = await prisma.ticket.findMany({
      where: {
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
        slaBreached: false,
        slaExpectedValue: { not: null },
      },
      include: {
        asset: { select: { assetId: true, assetName: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    const now = new Date();
    let breachCount = 0;

    for (const ticket of breachedTickets) {
      if (!ticket.slaExpectedValue || !ticket.slaExpectedUnit) continue;

      const createdAt = new Date(ticket.createdAt);
      let slaDeadline: Date;

      const value = ticket.slaExpectedValue;
      const unit = ticket.slaExpectedUnit;

      if (unit === "HOURS") {
        slaDeadline = new Date(createdAt.getTime() + value * 60 * 60 * 1000);
      } else if (unit === "DAYS") {
        slaDeadline = new Date(createdAt.getTime() + value * 24 * 60 * 60 * 1000);
      } else {
        continue;
      }

      if (now > slaDeadline) {
        // Mark as breached
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaBreached: true },
        });

        // Create notification
        const notif = await prisma.notification.create({
          data: {
            type: "SLA_BREACH",
            title: "SLA Breached",
            message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} has breached SLA.`,
            assetId: ticket.assetId,
            ticketId: ticket.id,
            priority: "CRITICAL",
            dedupeKey: `sla-breach-${ticket.id}`,
          },
        });

        // Notify assigned technician
        if (ticket.assignedTo) {
          await prisma.notificationRecipient.create({
            data: { notificationId: notif.id, employeeId: ticket.assignedTo.id },
          });

          if (ticket.assignedTo.email) {
            await sendAlertEmail(
              ticket.assignedTo.email,
              `SLA Breached: Ticket ${ticket.ticketId}`,
              `<p>Ticket <strong>${ticket.ticketId}</strong> for <strong>${ticket.asset.assetName}</strong> has breached its SLA. Please resolve immediately.</p>`
            );
          }
        }

        breachCount++;
      }
    }

    res.json({ message: `${breachCount} SLA breaches detected`, count: breachCount });
  } catch (error) {
    console.error("checkSLABreach error:", error);
    res.status(500).json({ message: "Failed to check SLA breach" });
  }
};

// ─── Check AMC/CMC Expiry ────────────────────────────────────────────────────
export const checkContractExpiry = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);

    const expiringContracts = await prisma.serviceContract.findMany({
      where: {
        status: "ACTIVE",
        endDate: { gte: now, lte: thirtyDays },
      },
      include: {
        asset: { select: { assetId: true, assetName: true, departmentId: true } },
        vendor: { select: { name: true } },
      },
    });

    let notified = 0;

    for (const c of expiringContracts) {
      const daysLeft = Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      await prisma.notification.create({
        data: {
          type: "AMC_CMC_EXPIRY",
          title: `${c.contractType} Contract Expiring`,
          message: `${c.contractType} contract for ${c.asset.assetName} (vendor: ${c.vendor?.name || "N/A"}) expires in ${daysLeft} days.`,
          assetId: c.assetId,
          priority: daysLeft <= 7 ? "HIGH" : "MEDIUM",
          dedupeKey: `contract-expiry-${c.id}-${c.endDate.toISOString().split("T")[0]}`,
        },
      });

      notified++;
    }

    res.json({ message: `${notified} contract expiry alerts sent`, count: notified });
  } catch (error) {
    console.error("checkContractExpiry error:", error);
    res.status(500).json({ message: "Failed to check contract expiry" });
  }
};

// ─── Run All Checks (single endpoint for cron) ──────────────────────────────
export const runAllChecks = async (req: Request, res: Response) => {
  try {
    const results: any = {};

    // We'll call each check internally
    const mockRes = {
      json: (data: any) => data,
      status: () => ({ json: (data: any) => data }),
    } as any;

    // Run sequentially to avoid overwhelming the DB
    try { results.warranty = await checkWarrantyExpiryInternal(); } catch (e) { results.warranty = { error: true }; }
    try { results.insurance = await checkInsuranceExpiryInternal(); } catch (e) { results.insurance = { error: true }; }
    try { results.sla = await checkSLABreachInternal(); } catch (e) { results.sla = { error: true }; }
    try { results.contract = await checkContractExpiryInternal(); } catch (e) { results.contract = { error: true }; }

    res.json({ message: "All checks completed", results });
  } catch (error) {
    console.error("runAllChecks error:", error);
    res.status(500).json({ message: "Failed to run checks" });
  }
};

// Internal versions that return data instead of sending response
async function checkWarrantyExpiryInternal() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(now.getDate() + 30);

  const count = await prisma.warranty.count({
    where: { isActive: true, isUnderWarranty: true, alertSent: false, warrantyEnd: { gte: now, lte: thirtyDays } },
  });

  return { type: "warranty", expiringCount: count };
}

async function checkInsuranceExpiryInternal() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(now.getDate() + 30);

  const count = await prisma.assetInsurance.count({
    where: { isActive: true, policyStatus: "ACTIVE", endDate: { gte: now, lte: thirtyDays } },
  });

  return { type: "insurance", expiringCount: count };
}

async function checkSLABreachInternal() {
  const count = await prisma.ticket.count({
    where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] }, slaBreached: true },
  });

  return { type: "sla", breachedCount: count };
}

async function checkContractExpiryInternal() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(now.getDate() + 30);

  const count = await prisma.serviceContract.count({
    where: { status: "ACTIVE", endDate: { gte: now, lte: thirtyDays } },
  });

  return { type: "contract", expiringCount: count };
}

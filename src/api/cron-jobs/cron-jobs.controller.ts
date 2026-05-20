import { Request, Response } from "express";
import prisma from "../../prismaClient";
import nodemailer from "nodemailer";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

// ─── Date helpers ────────────────────────────────────────────────────────────
const dayStr = (d: Date) => d.toISOString().split("T")[0];
const daysBetween = (from: Date, to: Date) =>
  Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

// Resolve the people who should receive an asset-scoped alert: the department's
// HOD(s), falling back to Admins so an alert is never created with no recipients.
async function hodOrAdmin(departmentId: number | null | undefined): Promise<number[]> {
  const hods = await getDepartmentHODs(departmentId);
  if (hods.length) return hods;
  return getAdminIds();
}

// ─── Helper: Get Active SMTP Config (used by the gate-pass email path) ───────
async function getTransporter() {
  const config = await prisma.smtpConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    return nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    } as nodemailer.TransportOptions);
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
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

// ═════════════════════════════════════════════════════════════════════════════
//  WARRANTY EXPIRY — tiered 60 / 30 / 7-day reminders
// ═════════════════════════════════════════════════════════════════════════════
async function checkWarrantyExpiryInternal() {
  const now = new Date();
  const horizon = new Date();
  horizon.setDate(now.getDate() + 60); // widest reminder window

  const warranties = await prisma.warranty.findMany({
    where: {
      isActive: true,
      isUnderWarranty: true,
      warrantyEnd: { gte: now, lte: horizon },
    },
    include: {
      asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
    },
  });

  let alerted = 0;

  for (const w of warranties) {
    const daysLeft = daysBetween(now, new Date(w.warrantyEnd));
    // Pick the milestone band this warranty currently falls in.
    const milestone = daysLeft <= 7 ? "7d" : daysLeft <= 30 ? "30d" : "60d";
    const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";

    const recipients = await hodOrAdmin(w.asset.departmentId);
    if (!recipients.length) continue;

    await notify({
      type: "WARRANTY_EXPIRY",
      title: "Warranty Expiring Soon",
      message: `Warranty for ${w.asset.assetName} (${w.asset.assetId}) expires in ${daysLeft} day(s).`,
      recipientIds: recipients,
      priority,
      channel: "BOTH",
      assetId: w.asset.id,
      // One alert per warranty per milestone band → each of 60/30/7 fires once.
      dedupeKey: `warranty-expiry-${w.id}-${milestone}`,
    });
    alerted++;
  }

  return { type: "warranty", expiringCount: warranties.length, alerted };
}

export const checkWarrantyExpiry = async (_req: Request, res: Response) => {
  try {
    const result = await checkWarrantyExpiryInternal();
    res.json({ message: `${result.alerted} warranty expiry alert(s) processed`, ...result });
  } catch (error) {
    console.error("checkWarrantyExpiry error:", error);
    res.status(500).json({ message: "Failed to check warranty expiry" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  INSURANCE EXPIRY
// ═════════════════════════════════════════════════════════════════════════════
async function checkInsuranceExpiryInternal() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(now.getDate() + 30);

  const policies = await prisma.assetInsurance.findMany({
    where: {
      isActive: true,
      policyStatus: "ACTIVE",
      endDate: { gte: now, lte: thirtyDays },
    },
    include: {
      asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
    },
  });

  let alerted = 0;

  for (const p of policies) {
    if (!p.endDate) continue;
    const daysLeft = daysBetween(now, new Date(p.endDate));
    const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";

    const hods = await getDepartmentHODs(p.asset.departmentId);
    const admins = await getAdminIds();
    const recipients = [...new Set([...hods, ...admins])];
    if (!recipients.length) continue;

    await notify({
      type: "INSURANCE_EXPIRY",
      title: "Insurance Policy Expiring Soon",
      message: `Insurance policy ${p.policyNumber || ""} for ${p.asset.assetName} expires in ${daysLeft} day(s).`,
      recipientIds: recipients,
      priority,
      channel: "BOTH",
      assetId: p.asset.id,
      insuranceId: p.id,
      dedupeKey: `insurance-expiry-${p.id}-${dayStr(new Date(p.endDate))}`,
    });
    alerted++;
  }

  return { type: "insurance", expiringCount: policies.length, alerted };
}

export const checkInsuranceExpiry = async (_req: Request, res: Response) => {
  try {
    const result = await checkInsuranceExpiryInternal();
    res.json({ message: `${result.alerted} insurance expiry alert(s) processed`, ...result });
  } catch (error) {
    console.error("checkInsuranceExpiry error:", error);
    res.status(500).json({ message: "Failed to check insurance expiry" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  AMC / CMC CONTRACT EXPIRY
// ═════════════════════════════════════════════════════════════════════════════
async function checkContractExpiryInternal() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(now.getDate() + 30);

  const contracts = await prisma.serviceContract.findMany({
    where: {
      status: "ACTIVE",
      endDate: { gte: now, lte: thirtyDays },
    },
    include: {
      asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
      vendor: { select: { name: true } },
    },
  });

  let alerted = 0;

  for (const c of contracts) {
    const daysLeft = daysBetween(now, new Date(c.endDate));
    const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";

    const hods = await getDepartmentHODs(c.asset.departmentId);
    const admins = await getAdminIds();
    const recipients = [...new Set([...hods, ...admins])];
    if (!recipients.length) continue;

    await notify({
      type: "AMC_CMC_EXPIRY",
      title: `${c.contractType} Contract Expiring`,
      message: `${c.contractType} contract for ${c.asset.assetName} (vendor: ${c.vendor?.name || "N/A"}) expires in ${daysLeft} day(s).`,
      recipientIds: recipients,
      priority,
      channel: "BOTH",
      assetId: c.asset.id,
      dedupeKey: `contract-expiry-${c.id}-${dayStr(new Date(c.endDate))}`,
    });
    alerted++;
  }

  return { type: "contract", expiringCount: contracts.length, alerted };
}

export const checkContractExpiry = async (_req: Request, res: Response) => {
  try {
    const result = await checkContractExpiryInternal();
    res.json({ message: `${result.alerted} contract expiry alert(s) processed`, ...result });
  } catch (error) {
    console.error("checkContractExpiry error:", error);
    res.status(500).json({ message: "Failed to check contract expiry" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  TICKET SLA — pre-breach warning + breach
// ═════════════════════════════════════════════════════════════════════════════
async function checkSLAInternal() {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
      slaExpectedValue: { not: null },
    },
    include: {
      asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
      assignedTo: { select: { id: true } },
    },
  });

  const now = new Date();
  let warned = 0;
  let breached = 0;

  for (const ticket of tickets) {
    if (!ticket.slaExpectedValue || !ticket.slaExpectedUnit) continue;

    const createdAt = new Date(ticket.createdAt);
    const value = ticket.slaExpectedValue;
    const unit = ticket.slaExpectedUnit;

    let totalMs: number;
    if (unit === "HOURS") totalMs = value * 60 * 60 * 1000;
    else if (unit === "DAYS") totalMs = value * 24 * 60 * 60 * 1000;
    else continue;

    const slaDeadline = new Date(createdAt.getTime() + totalMs);
    const remainingMs = slaDeadline.getTime() - now.getTime();

    // Recipients: assigned technician + the asset department's HOD(s).
    const recipients = new Set<number>();
    if (ticket.assignedTo) recipients.add(ticket.assignedTo.id);
    (await getDepartmentHODs(ticket.asset.departmentId)).forEach(id => recipients.add(id));
    if (recipients.size === 0) (await getAdminIds()).forEach(id => recipients.add(id));
    if (recipients.size === 0) continue;

    if (remainingMs <= 0 && !ticket.slaBreached) {
      // ── Breach ──
      await prisma.ticket.update({ where: { id: ticket.id }, data: { slaBreached: true } });
      await notify({
        type: "SLA_BREACH",
        title: "SLA Breached",
        message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} has breached its SLA.`,
        recipientIds: [...recipients],
        priority: "CRITICAL",
        channel: "BOTH",
        assetId: ticket.asset.id,
        ticketId: ticket.id,
        dedupeKey: `sla-breach-${ticket.id}`,
      });
      breached++;
    } else if (remainingMs > 0 && remainingMs <= totalMs * 0.2) {
      // ── Pre-breach warning: ≤ 20% of the SLA window left ──
      const hoursLeft = Math.max(1, Math.round(remainingMs / (1000 * 60 * 60)));
      await notify({
        type: "SLA_BREACH",
        title: "SLA Deadline Approaching",
        message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} will breach SLA in about ${hoursLeft} hour(s).`,
        recipientIds: [...recipients],
        priority: "HIGH",
        channel: "BOTH",
        assetId: ticket.asset.id,
        ticketId: ticket.id,
        dedupeKey: `sla-warning-${ticket.id}`,
      });
      warned++;
    }
  }

  return { type: "sla", warned, breached };
}

export const checkSLABreach = async (_req: Request, res: Response) => {
  try {
    const result = await checkSLAInternal();
    res.json({ message: `${result.breached} SLA breach, ${result.warned} SLA warning alert(s)`, ...result });
  } catch (error) {
    console.error("checkSLABreach error:", error);
    res.status(500).json({ message: "Failed to check SLA" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  MAINTENANCE SLA BREACH — PM checklist runs overdue beyond grace
// ═════════════════════════════════════════════════════════════════════════════
async function checkMaintenanceSLABreachInternal() {
  const now = new Date();

  const overdueRuns = await prisma.preventiveChecklistRun.findMany({
    where: { status: { in: ["DUE"] } },
    include: {
      template: { select: { slaOverdueDays: true, name: true } as any },
      asset: { select: { id: true, assetName: true, assetId: true, departmentId: true } },
    },
  });

  let breachCount = 0;

  for (const run of overdueRuns) {
    const template = run.template as any;
    const overdueDays = template?.slaOverdueDays ?? 3;
    const deadline = new Date(run.scheduledDue);
    deadline.setDate(deadline.getDate() + overdueDays);

    if (now > deadline) {
      await prisma.preventiveChecklistRun.update({
        where: { id: run.id },
        data: { status: "OVERDUE" as any },
      });

      const recipients = await hodOrAdmin(run.asset.departmentId);
      if (recipients.length) {
        await notify({
          type: "SLA_BREACH",
          title: "Preventive Maintenance Overdue",
          message: `PM schedule "${template?.name}" for asset ${run.asset.assetName} is overdue by more than ${overdueDays} day(s).`,
          recipientIds: recipients,
          priority: "HIGH",
          channel: "BOTH",
          assetId: run.asset.id,
          dedupeKey: `pm-sla-breach-${run.id}`,
        });
      }
      breachCount++;
    }
  }

  return { type: "maintenanceSla", overdueCount: breachCount };
}

export const checkMaintenanceSLABreach = async (_req: Request, res: Response) => {
  try {
    const result = await checkMaintenanceSLABreachInternal();
    res.json({ message: `${result.overdueCount} maintenance SLA breach alert(s)`, ...result });
  } catch (error) {
    console.error("checkMaintenanceSLABreach error:", error);
    res.status(500).json({ message: "Failed to check maintenance SLA breach" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  CALIBRATION DUE
// ═════════════════════════════════════════════════════════════════════════════
async function checkCalibrationDueInternal() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(now.getDate() + 30);

  const schedules = await prisma.calibrationSchedule.findMany({
    where: {
      isActive: true,
      nextDueAt: { gte: now, lte: thirtyDays },
    },
    include: {
      asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
    },
  });

  let alerted = 0;

  for (const s of schedules) {
    const daysLeft = daysBetween(now, new Date(s.nextDueAt));
    const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";

    const recipients = await hodOrAdmin(s.asset.departmentId);
    if (!recipients.length) continue;

    await notify({
      type: "CALIBRATION",
      title: "Calibration Due Soon",
      message: `Calibration for ${s.asset.assetName} (${s.asset.assetId}) is due in ${daysLeft} day(s).`,
      recipientIds: recipients,
      priority,
      channel: "BOTH",
      assetId: s.asset.id,
      dedupeKey: `calibration-due-${s.id}-${dayStr(new Date(s.nextDueAt))}`,
    });
    alerted++;
  }

  return { type: "calibrationDue", dueCount: schedules.length, alerted };
}

export const checkCalibrationDue = async (_req: Request, res: Response) => {
  try {
    const result = await checkCalibrationDueInternal();
    res.json({ message: `${result.alerted} calibration due alert(s) processed`, ...result });
  } catch (error) {
    console.error("checkCalibrationDue error:", error);
    res.status(500).json({ message: "Failed to check calibration due" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  PREVENTIVE MAINTENANCE DUE SOON
// ═════════════════════════════════════════════════════════════════════════════
async function checkMaintenanceDueInternal() {
  const now = new Date();
  const sevenDays = new Date();
  sevenDays.setDate(now.getDate() + 7);

  const runs = await prisma.preventiveChecklistRun.findMany({
    where: {
      status: "DUE",
      scheduledDue: { gte: now, lte: sevenDays },
    },
    include: {
      template: { select: { name: true } as any },
      asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
    },
  });

  let alerted = 0;

  for (const run of runs) {
    const daysLeft = daysBetween(now, new Date(run.scheduledDue));
    const priority = daysLeft <= 2 ? "HIGH" : "MEDIUM";
    const template = run.template as any;

    const recipients = await hodOrAdmin(run.asset.departmentId);
    if (!recipients.length) continue;

    await notify({
      type: "MAINTENANCE_DUE",
      title: "Preventive Maintenance Due Soon",
      message: `PM "${template?.name || "schedule"}" for ${run.asset.assetName} (${run.asset.assetId}) is due in ${daysLeft} day(s).`,
      recipientIds: recipients,
      priority,
      channel: "BOTH",
      assetId: run.asset.id,
      dedupeKey: `maintenance-due-${run.id}-${dayStr(new Date(run.scheduledDue))}`,
    });
    alerted++;
  }

  return { type: "maintenanceDue", dueCount: runs.length, alerted };
}

export const checkMaintenanceDue = async (_req: Request, res: Response) => {
  try {
    const result = await checkMaintenanceDueInternal();
    res.json({ message: `${result.alerted} maintenance due alert(s) processed`, ...result });
  } catch (error) {
    console.error("checkMaintenanceDue error:", error);
    res.status(500).json({ message: "Failed to check maintenance due" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  LOW STOCK / REORDER
// ═════════════════════════════════════════════════════════════════════════════
async function checkLowStockInternal() {
  const today = dayStr(new Date());

  // Prisma can't compare two columns directly → fetch candidates and filter in code.
  const positions = await prisma.storeStockPosition.findMany({
    where: { reorderLevel: { not: null } },
    include: { store: { select: { name: true } } },
  });

  const lowStock = positions.filter(
    p => p.reorderLevel && p.currentQty.lessThanOrEqualTo(p.reorderLevel)
  );

  if (lowStock.length === 0) return { type: "lowStock", lowCount: 0, alerted: 0 };

  const admins = await getAdminIds();
  if (!admins.length) return { type: "lowStock", lowCount: lowStock.length, alerted: 0 };

  let alerted = 0;

  for (const p of lowStock) {
    // Resolve a readable item name.
    let itemName = "stock item";
    if (p.itemType === "SPARE_PART" && p.sparePartId) {
      const sp = await prisma.sparePart.findUnique({
        where: { id: p.sparePartId },
        select: { name: true, partNumber: true },
      });
      if (sp) itemName = `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}`;
    } else if (p.itemType === "CONSUMABLE" && p.consumableId) {
      const c = await prisma.consumable.findUnique({
        where: { id: p.consumableId },
        select: { name: true },
      });
      if (c) itemName = c.name;
    }

    const qty = p.currentQty.toString();
    const reorder = p.reorderLevel!.toString();
    const priority = p.currentQty.lessThanOrEqualTo(0) ? "HIGH" : "MEDIUM";

    await notify({
      type: "LOW_STOCK",
      title: "Low Stock Alert",
      message: `${itemName} at store "${p.store?.name || "Store"}" is low — quantity ${qty} (reorder level ${reorder}).`,
      recipientIds: admins,
      priority,
      channel: "BOTH",
      // Per-item, per-day → re-alerts once daily until restocked.
      dedupeKey: `low-stock-${p.id}-${today}`,
    });
    alerted++;
  }

  return { type: "lowStock", lowCount: lowStock.length, alerted };
}

export const checkLowStock = async (_req: Request, res: Response) => {
  try {
    const result = await checkLowStockInternal();
    res.json({ message: `${result.alerted} low stock alert(s) processed`, ...result });
  } catch (error) {
    console.error("checkLowStock error:", error);
    res.status(500).json({ message: "Failed to check low stock" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  ASSET ACTIVATION — IN_STORE → ACTIVE on depreciation start date
// ═════════════════════════════════════════════════════════════════════════════
async function checkAssetActivationInternal() {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const candidates = await prisma.assetDepreciation.findMany({
    where: {
      isActive: true,
      depreciationStart: { lte: today },
      asset: { status: "IN_STORE" },
    },
    select: {
      assetId: true,
      depreciationStart: true,
      asset: { select: { id: true, assetId: true, assetName: true } },
    },
  });

  if (!candidates.length) {
    return { type: "assetActivation", activated: 0, assets: [] };
  }

  const assetDbIds = candidates.map(c => c.assetId);

  await prisma.asset.updateMany({
    where: { id: { in: assetDbIds }, status: "IN_STORE" },
    data: { status: "ACTIVE" },
  });

  const activatedAssets = candidates.map(c => ({
    id: c.asset.id,
    assetId: c.asset.assetId,
    assetName: c.asset.assetName,
    depreciationStart: c.depreciationStart,
  }));

  console.log(`[Asset Activation] ${activatedAssets.length} asset(s) moved to ACTIVE:`,
    activatedAssets.map(a => a.assetId).join(", "));

  return { type: "assetActivation", activated: activatedAssets.length, assets: activatedAssets };
}

export const checkAssetActivation = async (_req: Request, res: Response) => {
  try {
    const result = await checkAssetActivationInternal();
    res.json({ message: `${result.activated} asset(s) activated`, ...result });
  } catch (error) {
    console.error("checkAssetActivation error:", error);
    res.status(500).json({ message: "Failed to run asset activation check" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  GATE PASS OVERDUE
// ═════════════════════════════════════════════════════════════════════════════
async function runGatePassOverdueCheck() {
  const now = new Date();
  const today = dayStr(now); // per-day dedupe

  const overdue = await prisma.gatePass.findMany({
    where: {
      type: "RETURNABLE",
      status: "ISSUED",
      expectedReturnDate: { lt: now },
    },
    include: {
      requestedBy: { select: { id: true, name: true, departmentId: true, email: true } },
      items: { include: { asset: { select: { assetId: true, assetName: true } } } },
    },
  });

  const securityUsers = await prisma.user.findMany({
    where: { role: "SECURITY" },
    select: { employee: { select: { id: true, email: true } } },
  });
  const securityIds = securityUsers.map(u => u.employee?.id).filter(Boolean) as number[];

  let alerted = 0;

  for (const gp of overdue) {
    const daysOverdue = daysBetween(new Date(gp.expectedReturnDate!), now);
    const priority = daysOverdue > 7 ? "HIGH" : "MEDIUM";

    const recipients = new Set<number>();
    if (gp.requestedById) recipients.add(gp.requestedById);
    if (gp.requestedBy?.departmentId) {
      const hods = await prisma.employee.findMany({
        where: { departmentId: gp.requestedBy.departmentId, role: "HOD", isActive: true },
        select: { id: true },
      });
      hods.forEach(h => recipients.add(h.id));
    }
    securityIds.forEach(id => recipients.add(id));
    if (recipients.size === 0) continue;

    const itemSummary = gp.items.length
      ? `${gp.items[0].asset?.assetName || "asset"}${gp.items.length > 1 ? ` +${gp.items.length - 1} more` : ""}`
      : "asset(s)";

    try {
      const notif = await prisma.notification.create({
        data: {
          type: "GATEPASS_OVERDUE",
          title: `Gate Pass Overdue · ${daysOverdue} day${daysOverdue > 1 ? "s" : ""}`,
          message: `${gp.gatePassNo} (${itemSummary}) was due on ${new Date(gp.expectedReturnDate!).toLocaleDateString("en-IN")} — issued to ${gp.issuedTo}.`,
          priority,
          gatePassId: gp.id,
          dedupeKey: `gatepass-overdue-${gp.id}-${today}`,
          recipients: { create: Array.from(recipients).map(id => ({ employeeId: id })) },
        },
      });
      if (priority === "HIGH") {
        const secEmails = securityUsers.map(u => u.employee?.email).filter(Boolean) as string[];
        for (const email of secEmails) {
          await sendAlertEmail(
            email,
            `Gate Pass Overdue: ${gp.gatePassNo}`,
            `<p>Gate pass <strong>${gp.gatePassNo}</strong> is <strong>${daysOverdue} days overdue</strong>.</p>
             <p>Issued to: ${gp.issuedTo}<br>Expected return: ${new Date(gp.expectedReturnDate!).toLocaleDateString("en-IN")}<br>Items: ${itemSummary}</p>`
          );
        }
      }
      void notif;
      alerted++;
    } catch (err: any) {
      // Unique-violation on dedupeKey just means we already alerted today — skip silently
      if (err?.code !== "P2002") console.error("checkGatePassOverdue insert failed:", err);
    }
  }

  return { type: "gate-pass-overdue", overdueCount: overdue.length, alerted };
}

export const checkGatePassOverdue = async (_req: Request, res: Response) => {
  try {
    const result = await runGatePassOverdueCheck();
    res.json({ message: `${result.alerted} overdue gate pass alert(s) sent`, ...result });
  } catch (error) {
    console.error("checkGatePassOverdue error:", error);
    res.status(500).json({ message: "Failed to check overdue gate passes" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  RUN ALL — single entry point for the scheduler / cron
// ═════════════════════════════════════════════════════════════════════════════
export async function runAllChecksInternal() {
  const results: Record<string, any> = {};
  const checks: [string, () => Promise<any>][] = [
    ["warranty", checkWarrantyExpiryInternal],
    ["insurance", checkInsuranceExpiryInternal],
    ["contract", checkContractExpiryInternal],
    ["sla", checkSLAInternal],
    ["maintenanceSla", checkMaintenanceSLABreachInternal],
    ["calibrationDue", checkCalibrationDueInternal],
    ["maintenanceDue", checkMaintenanceDueInternal],
    ["lowStock", checkLowStockInternal],
    ["assetActivation", checkAssetActivationInternal],
    ["gatePassOverdue", runGatePassOverdueCheck],
  ];

  for (const [key, fn] of checks) {
    try {
      results[key] = await fn();
    } catch (e) {
      console.error(`[cron] check "${key}" failed:`, e);
      results[key] = { error: true };
    }
  }
  return results;
}

export const runAllChecks = async (_req: Request, res: Response) => {
  try {
    const results = await runAllChecksInternal();
    res.json({ message: "All checks completed", results });
  } catch (error) {
    console.error("runAllChecks error:", error);
    res.status(500).json({ message: "Failed to run checks" });
  }
};

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { Client } from "basic-ftp";

/**
 * ✅ Keep secrets in env
 * .env:
 * FTP_HOST=...
 * FTP_USER=...
 * FTP_PASSWORD=...
 * FTP_SECURE=false
 * PUBLIC_TICKET_IMAGE_BASE=https://smartassets.inventionminds.com/ticket_images
 */

const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
};


const PUBLIC_TICKET_IMAGE_BASE =
  process.env.PUBLIC_TICKET_IMAGE_BASE ||
  "https://smartassets.inventionminds.com/ticket_images";

function mustUser(req: any) {
  if (!req.user?.employeeDbId) throw new Error("Unauthorized");
  return req.user;
}

function toMs(value: number | null | undefined, unit: string | null | undefined): number {
  if (value == null) return 0;

  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;

  const u = (unit || "").toUpperCase();

  switch (u) {
    case "MINUTE":
    case "MINUTES":
      return n * 60_000;

    case "HOUR":
    case "HOURS":
      return n * 3_600_000;

    case "DAY":
    case "DAYS":
      return n * 86_400_000;

    case "MONTH":
    case "MONTHS":
      return n * 30 * 86_400_000;

    case "YEAR":
    case "YEARS":
      return n * 365 * 86_400_000;

    default:
      return 0;
  }
}

function buildStatusTat(
  historyAsc: Array<{ status: string; changedAt: Date }>,
  endAt: Date
) {
  const byStatus: Record<string, number> = {};

  for (let i = 0; i < historyAsc.length; i++) {
    const cur = historyAsc[i];
    const next = historyAsc[i + 1];
    const stop = next?.changedAt ?? endAt;

    const dur = Math.max(0, stop.getTime() - cur.changedAt.getTime());
    byStatus[cur.status] = (byStatus[cur.status] || 0) + dur;
  }

  return byStatus;
}
export const getTicketMetrics = async (req: Request, res: Response) => {
  try {
    const ticketId = Number(req.params.id);
    if (!ticketId) {
      res.status(400).json({ message: "Invalid ticket id" });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        statusHistory: { orderBy: { changedAt: "asc" }, select: { status: true, changedAt: true }, },
        // optional: vendor work orders (if you add relation)
        // vendorWorkOrders: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!ticket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    // Choose "end time" for calculations:
    const endAt =
      ticket.closedAt ??
      ticket.slaResolvedAt ??
      new Date(); // still running

    const totalTatMs = Math.max(0, endAt.getTime() - ticket.createdAt.getTime());

    // SLA
    const slaMs = toMs(ticket.slaExpectedValue, ticket.slaExpectedUnit);

    // Resolved TAT comparison
    const resolvedAt = ticket.slaResolvedAt ?? null;
    const resolvedTatMs =
      resolvedAt ? Math.max(0, resolvedAt.getTime() - ticket.createdAt.getTime()) : null;

    const breached =
      resolvedTatMs != null && slaMs > 0 ? resolvedTatMs > slaMs : null;

    // Status-wise TAT
    const byStatus = buildStatusTat(ticket.statusHistory, endAt);

    // Active time excluding ON_HOLD
    const onHoldMs = byStatus["ON_HOLD"] || 0;
    const activeTatMs = Math.max(0, totalTatMs - onHoldMs);

    // Vendor time (if exists)
    // We keep vendor time separate from ticket SLA (recommended).
    let vendorTatMs: number | null = null;
    const vwo = (ticket as any)?.vendorWorkOrders?.[0]; // latest
    if (vwo?.createdAt) {
      const vEnd = vwo.completedAt ?? endAt;
      vendorTatMs = Math.max(0, new Date(vEnd).getTime() - new Date(vwo.createdAt).getTime());
    }

    res.json({
      ticketId: ticket.id,
      ticketCode: ticket.ticketId,
      status: ticket.status,
      createdAt: ticket.createdAt,
      endAt,

      sla: {
        value: ticket.slaExpectedValue ?? null,
        unit: ticket.slaExpectedUnit ?? null,
        ms: slaMs || null,
      },

      resolved: {
        resolvedAt,
        ms: resolvedTatMs,
        breached,
      },

      tat: {
        totalMs: totalTatMs,
        activeMs: activeTatMs,
      },

      byStatus, // ms per status
      vendor: {
        latestWorkOrderId: vwo?.id ?? null,
        status: vwo?.status ?? null,
        ms: vendorTatMs,
      },
    });
  } catch (e: any) {
    console.error("getTicketMetrics error:", e);
    res.status(500).json({ message: "Failed to compute metrics", error: e.message });
  }
};

async function detectServiceType(tx: any, assetId: number) {
  const now = new Date();

  const warranty = await tx.warranty.findUnique({ where: { assetId } });
  if (warranty?.isUnderWarranty && warranty.warrantyEnd >= now) return "WARRANTY";

  const contract = await tx.serviceContract.findFirst({
    where: {
      assetId,
      status: "ACTIVE",
      startDate: { lte: now },
      endDate: { gte: now },
    },
  });

  if (contract) return contract.contractType; // AMC | CMC
  return "PAID";
}

async function requireAssetOrTicketDeptHod(user: any, ticketId: number) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { asset: true },
  });
  if (!ticket) throw new Error("Ticket not found");

  const deptIds = [
    ticket.departmentId,
    ticket.asset?.departmentId,
  ].filter(Boolean) as number[];

  if (deptIds.length === 0) throw new Error("No department found");

  const hod = await prisma.employee.findFirst({
    where: { id: user.employeeDbId, role: "HOD", departmentId: { in: deptIds } },
  });

  if (!hod) throw new Error("Only related HOD allowed");
  return ticket;
}

async function requireTicketDeptHod(user: any, ticketDbId: number) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketDbId },
    include: { department: true },
  });
  if (!ticket) throw new Error("Ticket not found");

  const hod = await prisma.employee.findFirst({
    where: { departmentId: ticket.departmentId, role: "HOD" },
  });

  if (!hod || hod.id !== user.employeeDbId) {
    throw new Error("Only current ticket department HOD allowed");
  }

  return ticket;
}

async function getAssetDeptHod(assetId: number) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset?.departmentId) return { asset, hod: null, supervisor: null };

  const hod = await prisma.employee.findFirst({
    where: { departmentId: asset.departmentId, role: "HOD" },
  });

  const supervisor = await prisma.employee.findFirst({
    where: { departmentId: asset.departmentId, role: "SUPERVISOR" },
  });

  return { asset, hod, supervisor };
}

async function requireAssetDeptHod(user: any, ticketId: number) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { asset: true },
  });
  if (!ticket) throw new Error("Ticket not found");
  if (!ticket.asset?.departmentId) throw new Error("Asset department missing");

  const hod = await prisma.employee.findFirst({
    where: { departmentId: ticket.asset.departmentId, role: "HOD" },
  });

  console.log(hod, user.employeeDbId)

  if (!hod || hod.id !== user.employeeDbId)
    throw new Error("Only asset department HOD allowed");

  return ticket;
}

/**
 * ✅ Status history helper (matches new schema)
 * TicketStatusHistory requires `changedBy` (string)
 * and you may optionally store changedById (FK) and note.
 */
async function createStatusHistory(tx: any, args: {
  ticketDbId: number;
  status: any;
  changedBy: string;
  changedById?: number | null;
  note?: string | null;
}) {
  return tx.ticketStatusHistory.create({
    data: {
      ticketId: args.ticketDbId,
      status: args.status,
      changedBy: args.changedBy,
      changedById: args.changedById ?? null,
      note: args.note ?? null,
    },
  });
}



export const getAllTickets = async (req: any, res: Response) => {
  try {
    if (!req.user?.employeeDbId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { role, employeeDbId } = req.user;
    const { exportCsv, search, status, priority } = req.query;

    // Build role-based where
    let where: any = {};
    if (role === "HOD") {
      const me = await prisma.employee.findUnique({
        where: { id: employeeDbId },
        select: { departmentId: true },
      });
      if (!me?.departmentId) { res.json(exportCsv ? [] : []); return; }
      where.departmentId = me.departmentId;
    } else if (role !== "ADMIN") {
      where.OR = [{ assignedToId: employeeDbId }, { raisedById: employeeDbId }];
    }

    // Additional filters
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (search) {
      const searchFilter = [
        { ticketId: { contains: String(search) } },
        { detailedDesc: { contains: String(search) } },
        { issueType: { contains: String(search) } },
      ];
      if (where.OR) {
        // Combine role filter with search
        where = { AND: [{ OR: where.OR }, { OR: searchFilter }] };
      } else {
        where.OR = searchFilter;
      }
    }

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        asset: { select: { assetId: true, assetName: true } },
        department: { select: { name: true } },
        assignedTo: { select: { name: true, employeeID: true } },
        raisedBy: { select: { name: true, employeeID: true } },
      },
      orderBy: { id: "desc" },
    });

    if (exportCsv === "true") {
      const csvRows = tickets.map((t: any) => ({
        TicketID: t.ticketId,
        AssetID: t.asset?.assetId || "",
        AssetName: t.asset?.assetName || "",
        Department: t.department?.name || "",
        IssueType: t.issueType,
        Priority: t.priority,
        Status: t.status,
        RaisedBy: t.raisedBy?.name || "",
        AssignedTo: t.assignedTo?.name || "",
        ServiceType: t.serviceType || "",
        TotalCost: t.totalCost ? Number(t.totalCost) : "",
        SLABreached: t.slaBreached ? "Yes" : "No",
        RootCause: t.rootCause || "",
        Resolution: t.resolutionSummary || "",
        CreatedAt: t.createdAt ? new Date(t.createdAt).toISOString().split("T")[0] : "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) =>
        Object.values(r).map((v) => {
          const str = String(v ?? "").replace(/"/g, '""');
          return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
        }).join(",")
      ).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=tickets.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json(tickets);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch tickets", error: e.message });
  }
};

export const getTicketById = async (req: Request, res: Response) => {
  const ticketId = req.params.ticketId;

  const ticket = await prisma.ticket.findUnique({
    where: { ticketId },
    include: {
      asset: true,
      department: true,
      assignedTo: true,
      raisedBy: true,
      statusHistory: {
        orderBy: { changedAt: "desc" },
        include: {
          changedByEmployee: true, // ✅ updated schema relation name
        },
      },
      sparePartUsages: {
        include: { sparePart: true, usedBy: true },
        orderBy: { usedAt: "desc" },
      },
      ticketAssignmentHistories: {
        orderBy: { createdAt: "desc" },
        include: { fromEmployee: true, toEmployee: true, performedBy: true },
      },
    },
  });

  if (!ticket) {
    res.status(404).json({ message: "Ticket not found" });
    return;
  }
  res.json(ticket);
};

export const createTicket = async (req: Request, res: Response) => {
  try {
    const user = mustUser(req);

    const assetId = Number(req.body.assetId);
    if (!assetId) {
      res.status(400).json({ message: "assetId required" });;
      return
    }

    const { asset, hod, supervisor } = await getAssetDeptHod(assetId);
    if (!asset) {
      res.status(400).json({ message: "Invalid assetId" });
      return;
    }
    if (!asset.departmentId) {
      res.status(400).json({ message: "Asset department not assigned" });
      return;
    }

    const departmentId = asset.departmentId;

    if (departmentId == null) {
      res.status(400).json({ message: "Asset department not assigned" });
      return;
    }

    // 1️⃣ FY
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEndYear = fyStartYear + 1;
    const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;

    // 2️⃣ latest FY ticket
    const latestTicket = await prisma.ticket.findFirst({
      where: { ticketId: { startsWith: `TKT-${fyString}` } },
      orderBy: { id: "desc" },
    });

    let nextNumber = 1;
    if (latestTicket) {
      const parts = latestTicket.ticketId.split("-");
      const lastSeq = parseInt(parts[3], 10);
      if (!isNaN(lastSeq)) nextNumber = lastSeq + 1;
    }

    const newTicketId = `TKT-${fyString}-${nextNumber.toString().padStart(3, "0")}`;

    // const created = await prisma.$transaction(async (tx) => {
    //   const ticket = await tx.ticket.create({
    //     data: {
    //       ticketId: newTicketId,

    //       raisedBy: user.employeeDbId
    //         ? { connect: { id: user.employeeDbId } }
    //         : undefined,

    //       department: { connect: { id: departmentId } },
    //       asset: { connect: { id: assetId } },

    //       issueType: req.body.issueType,
    //       detailedDesc: req.body.detailedDesc,
    //       priority: req.body.priority,
    //       photoOfIssue: req.body.photoOfIssue ?? null,

    //       // ✅ location must be string (not null)
    //       location: req.body.location ?? asset.currentLocation ?? "UNKNOWN",

    //       status: "OPEN",

    //       // ✅ relation style instead of assignedToId/assignedById
    //       assignedTo: supervisor?.id
    //         ? { connect: { id: supervisor.id } }
    //         : undefined,

    //       assignedBy: supervisor?.id
    //         ? { connect: { id: hod?.id ?? user.employeeDbId } }
    //         : undefined,

    //       lastAssignedAt: supervisor?.id ? new Date() : null,
    //       assignmentNote: supervisor?.id
    //         ? "Auto-assigned to department supervisor"
    //         : null,
    //     },
    //   });

    //   await createStatusHistory(tx, {
    //     ticketDbId: ticket.id,
    //     status: ticket.status,
    //     changedBy: user.employeeID ?? user.name ?? "system",
    //     changedById: user.employeeDbId ?? null,
    //     note: "Ticket created",
    //   });

    //   if (supervisor?.id) {
    //     await tx.ticketAssignmentHistory.create({
    //       data: {
    //         ticketId: ticket.id,
    //         fromEmployeeId: null,
    //         toEmployeeId: supervisor.id,
    //         action: "ASSIGNED",
    //         comment: "Auto-assigned to supervisor on ticket creation",
    //         performedById: hod?.id ?? user.employeeDbId,
    //       },
    //     });
    //   }



    //   return ticket;
    // });
    // 1) create ticket
    const created = await prisma.ticket.create({
      data: {
        ticketId: newTicketId,
        raisedBy: user.employeeDbId ? { connect: { id: user.employeeDbId } } : undefined,
        department: { connect: { id: departmentId } },
        asset: { connect: { id: assetId } },
        issueType: req.body.issueType,
        detailedDesc: req.body.detailedDesc,
        priority: req.body.priority,
        photoOfIssue: req.body.photoOfIssue ?? null,
        location: req.body.location ?? asset.currentLocation ?? "UNKNOWN",
        status: "OPEN",
        assignedTo: supervisor?.id ? { connect: { id: supervisor.id } } : undefined,
        assignedBy: supervisor?.id ? { connect: { id: hod?.id ?? user.employeeDbId } } : undefined,
        lastAssignedAt: supervisor?.id ? new Date() : null,
        assignmentNote: supervisor?.id ? "Auto-assigned to department supervisor" : null,
        slaExpectedValue: asset.slaResolutionValue ?? null,
        slaExpectedUnit: asset.slaResolutionUnit ?? null,
      },
    });

    // 2) status history
    await prisma.ticketStatusHistory.create({
      data: {
        ticketId: created.id,
        status: created.status,
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId ?? null,
        note: "Ticket created",
      },
    });

    // 3) assignment history
    if (supervisor?.id) {
      await prisma.ticketAssignmentHistory.create({
        data: {
          ticketId: created.id,
          fromEmployeeId: null,
          toEmployeeId: supervisor.id,
          action: "ASSIGNED",
          comment: "Auto-assigned to supervisor on ticket creation",
          performedById: hod?.id ?? user.employeeDbId,
        },
      });
    }

    // Notify HOD + Supervisor
    const notif = await prisma.notification.create({
      data: {
        ticketId: created.id,
        assetId: asset.id,
        type: "OTHER",
        title: `New Ticket ${newTicketId}`,
        message: `Ticket raised for asset ${asset.assetId} - ${asset.assetName}`,
        priority: created.priority,
        dedupeKey: `TICKET_NEW_${created.id}_${new Date()}`,
        createdById: user.employeeDbId,
      },
    });

    const recipients = [hod?.id, supervisor?.id].filter(Boolean) as number[];
    await prisma.notificationRecipient.createMany({
      data: recipients.map(empId => ({ notificationId: notif.id, employeeId: empId })),
      skipDuplicates: true,
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating ticket:", error);
    res.status(500).json({ message: "Failed to create ticket" });
  }
};

export const updateTicketBasic = async (req: any, res: Response) => {
  try {
    mustUser(req);
    const id = Number(req.params.id);

    const allowed: any = {};
    if (req.body.detailedDesc != null) allowed.detailedDesc = req.body.detailedDesc;
    if (req.body.location != null) allowed.location = req.body.location;
    if (req.body.photoOfIssue != null) allowed.photoOfIssue = req.body.photoOfIssue;

    const updated = await prisma.ticket.update({ where: { id }, data: allowed });
    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to update ticket" });
  }
};

export const updateTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const id = Number(req.params.id);

    const existingTicket = await prisma.ticket.findUnique({ where: { id } });
    if (!existingTicket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    // ✅ disallow client to spoof createdBy/updatedBy; accept only safe fields
    const { status, ...rest } = req.body;

    const updatedTicket = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? { status } : {}),
          updatedById: user.employeeDbId,
        },
      });

      // If status changed, create status history
      if (status && status !== existingTicket.status) {
        await createStatusHistory(tx, {
          ticketDbId: updated.id,
          status,
          changedBy: user.employeeID ?? user.name ?? "system",
          changedById: user.employeeDbId ?? null,
          note: req.body.note ?? null,
        });
      }

      return updated;
    });

    res.json(updatedTicket);
  } catch (error) {
    console.error("Error updating ticket:", error);
    res.status(500).json({ message: "Failed to update ticket" });
  }
};

export const assignTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const toEmployeeId = Number(req.body.toEmployeeId);
    const comment = String(req.body.comment || "").trim();

    if (!toEmployeeId) {
      res.status(400).json({ message: "toEmployeeId required" });
      return;
    }
    if (!comment) {
      res.status(400).json({ message: "comment required" });
      return;
    }

    const ticket = await requireAssetDeptHod(user, ticketId);

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          assignedTo: { connect: { id: toEmployeeId } },
          assignedBy: { connect: { id: user.employeeDbId } },
          lastAssignedAt: new Date(),
          assignmentNote: comment,
          status: "ASSIGNED",
        },
      });

      await tx.ticketAssignmentHistory.create({
        data: {
          ticketId,
          fromEmployeeId: ticket.assignedToId ?? null,
          toEmployeeId,
          action: "ASSIGNED",
          comment,
          performedById: user.employeeDbId,
        },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "ASSIGNED",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId ?? null,
        note: comment,
      });

      return upd;
    });

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to assign" });
  }
};


export const reassignTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const toEmployeeId = Number(req.body.toEmployeeId);
    const comment = String(req.body.comment || "").trim();

    if (!toEmployeeId) {
      res.status(400).json({ message: "toEmployeeId required" });
      return;
    }
    if (!comment) {
      res.status(400).json({ message: "comment required" });
      return;
    }

    const ticket = await requireAssetOrTicketDeptHod(user, ticketId);

    if ((ticket.reassignCount ?? 0) >= 2) {
      res.status(400).json({ message: "Reassign limit reached (max 2)" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          reassignCount: { increment: 1 },
          assignedTo: { connect: { id: toEmployeeId } },
          assignedBy: { connect: { id: user.employeeDbId } },
          lastAssignedAt: new Date(),
          assignmentNote: comment,
          status: "ASSIGNED",
        },
      });

      await tx.ticketAssignmentHistory.create({
        data: {
          ticketId,
          fromEmployeeId: ticket.assignedToId ?? null,
          toEmployeeId,
          action: "REASSIGNED",
          comment,
          performedById: user.employeeDbId,
        },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "ASSIGNED",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId ?? null,
        note: comment,
      });

      return upd;
    });

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to reassign" });
  }
};

export const terminateTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const note = String(req.body.note || "").trim();
    if (!note) {
      res.status(400).json({ message: "termination note required" });
      return;
    }

    await requireAssetDeptHod(user, ticketId);

    const upd = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: "TERMINATED",
          terminatedAt: new Date(),
          terminatedById: user.employeeDbId,
          terminationNote: note,
        },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "TERMINATED",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId ?? null,
        note,
      });

      return u;
    });

    res.json(upd);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to terminate" });
  }
};

export const closeTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const remarks = String(req.body.remarks || "").trim();

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    if (ticket.raisedById !== user.employeeDbId) {
      res.status(403).json({ message: "Only raised person can close this ticket" });
      return;
    }

    if (ticket.status !== "RESOLVED" && ticket.status !== "TERMINATED") {
      res.status(400).json({
        message: "Ticket can be closed only after RESOLVED/TERMINATED",
      });
      return;
    }

    const upd = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: user.employeeDbId,
          closeRemarks: remarks || null,
        },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "CLOSED",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId ?? null,
        note: remarks || null,
      });

      return u;
    });

    res.json(upd);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to close" });
  }
};

export const getAssignmentHistory = async (req: Request, res: Response) => {
  const ticketId = Number(req.params.id);
  const rows = await prisma.ticketAssignmentHistory.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    include: { fromEmployee: true, toEmployee: true, performedBy: true },
  });
  res.json(rows);
};

export const deleteTicket = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await prisma.ticket.delete({ where: { id } });
  res.status(204).send();
};

/** ===========================
 *  Upload Ticket Image (FTP)
 *  ===========================
 */
const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) fs.mkdirSync(TEMP_FOLDER, { recursive: true });

async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
  const client = new Client();
  client.ftp.verbose = false;

  try {
    await client.access(FTP_CONFIG);
    const remoteDir = path.dirname(remoteFilePath);
    await client.ensureDir(remoteDir);
    await client.uploadFrom(localFilePath, remoteFilePath);
    await client.close();

    const fileName = path.basename(remoteFilePath);
    return `${PUBLIC_TICKET_IMAGE_BASE}/${fileName}`;
  } catch (error) {
    console.error("FTP upload error:", error);
    throw new Error("FTP upload failed");
  }
}

export const uploadTicketImage = async (req: any, res: Response) => {
  try {
    mustUser(req); // ✅ protect upload too
    const ticketId = req.params.ticketId;

    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: false,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const fileArr: any = (files as any).file;
      if (!fileArr || fileArr.length === 0) {
        res.status(400).json({ error: "No image file uploaded." });
        return;
      }

      const file = fileArr[0];
      const tempFilePath = file.filepath;
      const originalFileName = file.originalFilename || `ticket-${Date.now()}.jpg`;

      if (!fs.existsSync(tempFilePath)) {
        res.status(500).json({ error: "Temporary image file not found." });
        return;
      }

      const remoteFilePath = `/public_html/smartassets/ticket_images/${originalFileName}`;

      try {
        const fileUrl = await uploadToFTP(tempFilePath, remoteFilePath);

        await prisma.ticket.update({
          where: { ticketId },
          data: { photoOfIssue: fileUrl },
        });

        fs.unlinkSync(tempFilePath);
        res.json({ url: fileUrl });
        return;
      } catch (uploadErr) {
        console.error("Ticket image upload failed:", uploadErr);
        res.status(500).json({ error: "Ticket image upload failed." });
        return;
      }
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: (error as Error).message });
    return;
  }
};

export const requestTicketTransfer = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);

    const { transferType, toDepartmentId, vendorId, comment } = req.body;

    if (!comment) {
      res.status(400).json({ message: "comment is required" });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    const existingPending = await prisma.ticketTransferHistory.findFirst({
      where: { ticketId, status: "REQUESTED" },
      orderBy: { createdAt: "desc" },
    });
    if (existingPending) {
      res.status(400).json({ message: "A transfer request is already pending for this ticket" });
      return;
    }

    if (transferType !== "INTERNAL_DEPARTMENT" && !vendorId) {
      res.status(400).json({ message: "vendorId required for external transfer" });
      return;
    }

    //  Get TARGET HOD
    let targetHod: any = null;
    if (transferType === "INTERNAL_DEPARTMENT" && toDepartmentId) {
      targetHod = await prisma.employee.findFirst({
        where: { departmentId: toDepartmentId, role: "HOD" },
      });
    }

    // const result = await prisma.$transaction(async (tx) => {
    //   const transfer = await tx.ticketTransferHistory.create({
    //     data: {
    //       ticketId,
    //       transferType,
    //       fromDepartmentId: ticket.departmentId,
    //       toDepartmentId: transferType === "INTERNAL_DEPARTMENT" ? toDepartmentId : null,
    //       vendorId: transferType !== "INTERNAL_DEPARTMENT" ? vendorId : null,
    //       comment,
    //       requestedById: user.employeeDbId,
    //     },
    //   });

    //   // 🔔 Notify target HOD
    //   if (targetHod?.id) {
    //     await createNotificationWithRecipients(tx, {
    //       title: "Ticket Transfer Request",
    //       message: `Ticket ${ticket.ticketId} transfer requested`,
    //       ticketId: ticket.id,
    //       createdById: user.employeeDbId,
    //       recipients: [targetHod.id],
    //     });
    //   }

    //   return transfer;
    // });
    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.ticketTransferHistory.create({
        data: {
          ticketId,
          transferType,
          fromDepartmentId: ticket.departmentId,
          toDepartmentId: transferType === "INTERNAL_DEPARTMENT" ? toDepartmentId : null,
          vendorId: transferType !== "INTERNAL_DEPARTMENT" ? vendorId : null,
          comment,
          requestedById: user.employeeDbId,
          status: transferType === "INTERNAL_DEPARTMENT" ? "REQUESTED" : "APPROVED", // ✅ auto approve external
          approvedById: transferType === "INTERNAL_DEPARTMENT" ? null : user.employeeDbId, // ✅
        },
      });

      // ✅ If EXTERNAL, update ticket immediately
      if (transferType !== "INTERNAL_DEPARTMENT") {
        const serviceType = await detectServiceType(tx, ticket.assetId);

        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: "ON_HOLD",
            serviceType, // WARRANTY | AMC | CMC | PAID
            assignmentNote: `Sent to external service (${serviceType})`,
          },
        });

        await createStatusHistory(tx, {
          ticketDbId: ticketId,
          status: "ON_HOLD",
          changedBy: user.employeeID ?? user.name ?? "system",
          changedById: user.employeeDbId,
          note: `External transfer approved (${serviceType}). ${comment}`,
        });
      }

      // 🔔 Notify target HOD ONLY for internal
      if (transferType === "INTERNAL_DEPARTMENT" && targetHod?.id) {
        await createNotificationWithRecipients(tx, {
          title: "Ticket Transfer Request",
          message: `Ticket ${ticket.ticketId} transfer requested`,
          ticketId: ticket.id,
          createdById: user.employeeDbId,
          recipients: [targetHod.id],
        });
      }

      return transfer;
    });

    res.json({ message: "Transfer requested", result });
  } catch (err) {
    res.status(500).json({ message: "Failed to request transfer" });
  }
};
// export const approveTicketTransfer = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const transferId = Number(req.params.transferId);

//     const transfer = await prisma.ticketTransferHistory.findUnique({
//       where: { id: transferId },
//     });

//     if (!transfer) {
//       res.status(404).json({ message: "Transfer not found" });
//       return;
//     }

//     if (!transfer.toDepartmentId) {
//       res.status(400).json({ message: "Transfer missing toDepartmentId" });
//       return;
//     }

//     // ✅ Get target HOD (only target HOD can approve)
//     const targetHod = await prisma.employee.findFirst({
//       where: { departmentId: transfer.toDepartmentId, role: "HOD" },
//     });

//     if (!targetHod || targetHod.id !== user.employeeDbId) {
//       res.status(403).json({ message: "Only target HOD can approve" });
//       return;
//     }

//     // ✅ Ensure transfer is still REQUESTED
//     if (transfer.status !== "REQUESTED") {
//       res.status(400).json({ message: `Transfer already ${transfer.status}` });
//       return;
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       // 1) approve transfer row
//       const updatedTransfer = await tx.ticketTransferHistory.update({
//         where: { id: transferId },
//         data: {
//           status: "APPROVED",
//           approvedById: user.employeeDbId,
//         },
//       });

//       // 2) find ticket (for old assignedTo / ids)
//       const oldTicket = await tx.ticket.findUnique({
//         where: { id: transfer.ticketId },
//       });

//       if (!oldTicket) throw new Error("Ticket not found");

//       // 3) find target supervisor (auto assign)
//       const targetSupervisor = await tx.employee.findFirst({
//         where: { departmentId: transfer.toDepartmentId!, role: "SUPERVISOR" },
//       });

//       // 4) update ticket department + assign to target supervisor
//       const ticket = await tx.ticket.update({
//         where: { id: transfer.ticketId },
//         data: {
//           departmentId: transfer.toDepartmentId!,
//           isTransferred: true,
//           transferCount: { increment: 1 },

//           // ✅ move assignment to target dept supervisor
//           assignedToId: targetSupervisor?.id ?? null,
//           assignedById: user.employeeDbId,
//           lastAssignedAt: targetSupervisor?.id ? new Date() : null,
//           assignmentNote: "Auto assigned to target supervisor after transfer",

//           // ✅ status after transfer
//           status: "ASSIGNED",

//           // optional: reset reassign count after transfer
//           reassignCount: 0,
//         },
//       });

//       // 5) assignment history (if supervisor exists)
//       if (targetSupervisor?.id) {
//         await tx.ticketAssignmentHistory.create({
//           data: {
//             ticketId: ticket.id,
//             fromEmployeeId: oldTicket.assignedToId ?? null,
//             toEmployeeId: targetSupervisor.id,
//             action: "ASSIGNED",
//             comment: "Auto assigned after department transfer approval",
//             performedById: user.employeeDbId,
//           },
//         });
//       }

//       // 6) status history
//       await createStatusHistory(tx, {
//         ticketDbId: ticket.id,
//         status: "ASSIGNED",
//         changedBy: user.employeeID ?? user.name ?? "system",
//         changedById: user.employeeDbId ?? null,
//         note: "Ticket transferred and assigned to target department",
//       });

//       // 7) notify requester + source HOD (+ target supervisor optional)
//       const sourceHod = transfer.fromDepartmentId
//         ? await tx.employee.findFirst({
//           where: { departmentId: transfer.fromDepartmentId, role: "HOD" },
//         })
//         : null;

//       const recipients = [
//         transfer.requestedById,
//         sourceHod?.id,
//         targetSupervisor?.id, // optional notify new supervisor
//       ].filter(Boolean) as number[];

//       await createNotificationWithRecipients(tx, {
//         title: "Transfer Approved",
//         message: `Ticket ${ticket.ticketId} transfer approved and moved to new department`,
//         ticketId: ticket.id,
//         createdById: user.employeeDbId,
//         recipients,
//       });

//       return { updatedTransfer, ticket, targetSupervisor };
//     });

//     res.json({ message: "Transfer approved", result });
//   } catch (err: any) {
//     console.error("approveTicketTransfer error:", err);
//     res.status(500).json({ message: err.message || "Failed to approve transfer" });
//   }
// };
export const approveTicketTransfer = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const transferId = Number(req.params.transferId);

    const transfer = await prisma.ticketTransferHistory.findUnique({
      where: { id: transferId },
    });
    if (!transfer) {
      res.status(404).json({ message: "Transfer not found" });
      return
    }
    if (!transfer.toDepartmentId) {
      res.status(400).json({ message: "Transfer missing toDepartmentId" });
      return
    }

    // Only target HOD can approve
    const targetHod = await prisma.employee.findFirst({
      where: { departmentId: transfer.toDepartmentId, role: "HOD" },
    });
    if (!targetHod || targetHod.id !== user.employeeDbId) {
      res.status(403).json({ message: "Only target HOD can approve" });
      return;
    }

    // 1) Approve transfer (guard: only if REQUESTED)
    const updatedTransfer = await prisma.ticketTransferHistory.updateMany({
      where: { id: transferId, status: "REQUESTED" },
      data: { status: "APPROVED", approvedById: user.employeeDbId },
    });

    if (updatedTransfer.count === 0) {
      res.status(400).json({ message: "Transfer already processed (not REQUESTED)" });
      return;
    }

    // 2) Read ticket (for old assignedTo)
    const oldTicket = await prisma.ticket.findUnique({ where: { id: transfer.ticketId } });
    if (!oldTicket) {
      res.status(404).json({ message: "Ticket not found" });
      return
    }

    // 3) Target supervisor
    const targetSupervisor = await prisma.employee.findFirst({
      where: { departmentId: transfer.toDepartmentId, role: "SUPERVISOR" },
    });

    // 4) Update ticket
    const ticket = await prisma.ticket.update({
      where: { id: transfer.ticketId },
      data: {
        departmentId: transfer.toDepartmentId,
        isTransferred: true,
        transferCount: { increment: 1 },

        assignedToId: targetSupervisor?.id ?? null,
        assignedById: user.employeeDbId,
        lastAssignedAt: targetSupervisor?.id ? new Date() : null,
        assignmentNote: "Auto assigned to target supervisor after transfer",

        status: "ASSIGNED",
        reassignCount: 0,
      },
    });

    // 5) Assignment history (optional)
    if (targetSupervisor?.id) {
      await prisma.ticketAssignmentHistory.create({
        data: {
          ticketId: ticket.id,
          fromEmployeeId: oldTicket.assignedToId ?? null,
          toEmployeeId: targetSupervisor.id,
          action: "ASSIGNED",
          comment: "Auto assigned after department transfer approval",
          performedById: user.employeeDbId,
        },
      });
    }

    // 6) Status history
    await createStatusHistory(prisma, {
      ticketDbId: ticket.id,
      status: "ASSIGNED",
      changedBy: user.employeeID ?? user.name ?? "system",
      changedById: user.employeeDbId ?? null,
      note: "Ticket transferred and assigned to target department",
    });

    // 7) Notify requester + source HOD + target supervisor
    const sourceHod = transfer.fromDepartmentId
      ? await prisma.employee.findFirst({
        where: { departmentId: transfer.fromDepartmentId, role: "HOD" },
      })
      : null;

    const recipients = [
      transfer.requestedById,
      sourceHod?.id,
      targetSupervisor?.id,
    ].filter(Boolean) as number[];

    await createNotificationWithRecipients(prisma, {
      title: "Transfer Approved",
      message: `Ticket ${ticket.ticketId} transfer approved and moved to new department`,
      ticketId: ticket.id,
      createdById: user.employeeDbId,
      recipients,
    });

    res.json({ message: "Transfer approved", ticket });
    return;
  } catch (err: any) {
    console.error("approveTicketTransfer error:", err);
    res.status(500).json({ message: err.message || "Failed to approve transfer" });
    return;
  }
};
// export const rejectTicketTransfer = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const transferId = Number(req.params.transferId);
//     const { reason } = req.body;

//     const transfer = await prisma.ticketTransferHistory.findUnique({
//       where: { id: transferId },
//     });

//     if (!transfer) {
//       res.status(404).json({ message: "Transfer not found" });
//       return;
//     }

//     //  Only target HOD can reject
//     const targetHod = await prisma.employee.findFirst({
//       where: {
//         departmentId: transfer.toDepartmentId!,
//         role: "HOD",
//       },
//     });

//     if (!targetHod || targetHod.id !== user.employeeDbId) {
//       res.status(403).json({ message: "Only target HOD can reject" });
//       return;
//     }

//     await prisma.$transaction(async (tx) => {
//       await tx.ticketTransferHistory.update({
//         where: { id: transferId },
//         data: {
//           status: "REJECTED",
//           approvedById: user.employeeDbId,
//           rejectionReason: reason,
//         },
//       });

//       // 🔔 Notify requester
//       await createNotificationWithRecipients(tx, {
//         title: "Transfer Rejected",
//         message: `Transfer rejected: ${reason || ""}`,
//         ticketId: transfer.ticketId,
//         createdById: user.employeeDbId,
//         recipients: [transfer.requestedById!],
//       });
//     });

//     res.json({ message: "Transfer rejected" });
//   } catch (err) {
//     res.status(500).json({ message: "Failed to reject transfer" });
//   }
// };
export const rejectTicketTransfer = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const transferId = Number(req.params.transferId);
    const { reason } = req.body;

    const transfer = await prisma.ticketTransferHistory.findUnique({
      where: { id: transferId },
    });
    if (!transfer) {
      res.status(404).json({ message: "Transfer not found" });
      return
    }

    const targetHod = await prisma.employee.findFirst({
      where: { departmentId: transfer.toDepartmentId!, role: "HOD" },
    });
    if (!targetHod || targetHod.id !== user.employeeDbId) {
      res.status(403).json({ message: "Only target HOD can reject" });
      return;
    }

    // guard: only reject if REQUESTED
    const updated = await prisma.ticketTransferHistory.updateMany({
      where: { id: transferId, status: "REQUESTED" },
      data: {
        status: "REJECTED",
        approvedById: user.employeeDbId,
        rejectionReason: reason ?? null,
      },
    });

    if (updated.count === 0) {
      res.status(400).json({ message: "Transfer already processed (not REQUESTED)" });
      return;
    }

    await createNotificationWithRecipients(prisma, {
      title: "Transfer Rejected",
      message: `Transfer rejected${reason ? `: ${reason}` : ""}`,
      ticketId: transfer.ticketId,
      createdById: user.employeeDbId,
      recipients: transfer.requestedById ? [transfer.requestedById] : [],
    });

    res.json({ message: "Transfer rejected" });
    return;
  } catch (err: any) {
    console.error("rejectTicketTransfer error:", err);
    res.status(500).json({ message: err.message || "Failed to reject transfer" });
    return;
  }
};
export const completeTicketTransfer = async (req: any, res: Response) => {
  try {
    const transferId = Number(req.params.transferId);

    await prisma.ticketTransferHistory.update({
      where: { id: transferId },
      data: { status: "COMPLETED" },
    });

    res.json({ message: "Transfer completed" });
  } catch (err) {
    res.status(500).json({ message: "Failed to complete transfer" });
  }
};

export const getTransferHistory = async (req: Request, res: Response) => {
  const ticketId = Number(req.params.id);

  const history = await prisma.ticketTransferHistory.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    include: {
      fromDepartment: true,
      toDepartment: true,
      vendor: true,
      requestedBy: true,
      approvedBy: true,
    },
  });

  res.json(history);
};

async function createNotificationWithRecipients(tx: any, data: {
  title: string;
  message: string;
  ticketId?: number;
  assetId?: number;
  createdById?: number;
  recipients: number[];
}) {
  const notif = await tx.notification.create({
    data: {
      title: data.title,
      message: data.message,
      ticketId: data.ticketId,
      assetId: data.assetId,
      type: "OTHER",
      createdById: data.createdById,
    },
  });

  for (const empId of data.recipients) {
    await tx.notificationRecipient.create({
      data: {
        notificationId: notif.id,
        employeeId: empId,
      },
    });
  }
}

// GET /api/tickets/my-assigned
export const getMyAssignedTickets = async (req: any, res: Response) => {
  try {
    if (!req.user?.employeeDbId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;

    const tickets = await prisma.ticket.findMany({
      where: { assignedToId: employeeId },
      include: { asset: true, department: true, assignedTo: true, raisedBy: true },
      orderBy: { updatedAt: "desc" },
    });

    res.json(tickets);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch assigned tickets", error: e.message });
  }
};

// GET /api/tickets/my-raised
export const getMyRaisedTickets = async (req: any, res: Response) => {
  try {
    if (!req.user?.employeeDbId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;

    const tickets = await prisma.ticket.findMany({
      where: { raisedById: employeeId },
      include: { asset: true, department: true, assignedTo: true, raisedBy: true },
      orderBy: { updatedAt: "desc" },
    });

    res.json(tickets);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch raised tickets", error: e.message });
  }
};

async function requireAssignedTo(user: any, ticketId: number) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.assignedToId !== user.employeeDbId) {
    throw new Error("Only assigned person can perform this action");
  }
  return ticket;
}

async function requireRaisedBy(user: any, ticketId: number) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.raisedById !== user.employeeDbId) {
    throw new Error("Only raised person can perform this action");
  }
  return ticket;
}

function ensureStatus(ticket: any, allowed: string[]) {
  if (!allowed.includes(ticket.status)) {
    throw new Error(`Invalid status transition from ${ticket.status}`);
  }
}

export const startWork = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);

    const ticket = await requireAssignedTo(user, ticketId);
    ensureStatus(ticket, ["ASSIGNED", "ON_HOLD"]);

    const upd = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: ticketId },
        data: { status: "IN_PROGRESS" },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "IN_PROGRESS",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId,
        note: "Work started",
      });

      return u;
    });

    res.json(upd);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to start work" });
  }
};

export const holdTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const note = String(req.body.note || "").trim();

    const ticket = await requireAssignedTo(user, ticketId);
    ensureStatus(ticket, ["ASSIGNED", "IN_PROGRESS"]);

    const upd = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: ticketId },
        data: { status: "ON_HOLD" },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "ON_HOLD",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId,
        note: note || "On hold",
      });

      return u;
    });

    res.json(upd);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to hold ticket" });
  }
};

// export const resolveTicket = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const ticketId = Number(req.params.id);
//     const note = String(req.body.note || "").trim();

//     const ticket = await requireAssignedTo(user, ticketId);
//     ensureStatus(ticket, ["IN_PROGRESS", "ON_HOLD", "ASSIGNED"]);

//     const upd = await prisma.$transaction(async (tx) => {
//       const u = await tx.ticket.update({
//         where: { id: ticketId },
//         data: {
//           status: "RESOLVED",
//           slaResolvedAt: new Date(),
//         },
//       });

//       await createStatusHistory(tx, {
//         ticketDbId: ticketId,
//         status: "RESOLVED",
//         changedBy: user.employeeID ?? user.name ?? "system",
//         changedById: user.employeeDbId,
//         note: note || "Resolved",
//       });

//       return u;
//     });

//     res.json(upd);
//   } catch (e: any) {
//     res.status(403).json({ message: e.message || "Failed to resolve" });
//   }
// };

// GET /api/tickets/transfers/pending
export const resolveTicket = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const note = String(req.body.note || "").trim();

    const ticket = await requireAssetOrTicketDeptHod(user, ticketId);
    ensureStatus(ticket, ["WORK_COMPLETED"]);

    const metricsTicket = await prisma.ticket.findUnique({
      where: { id: ticketId }
    });

    if (!metricsTicket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    const now = new Date();
    const slaMs = toMs(metricsTicket.slaExpectedValue, metricsTicket.slaExpectedUnit);
    const resolvedTatMs = Math.max(0, now.getTime() - metricsTicket.createdAt.getTime());
    const breached = slaMs > 0 ? resolvedTatMs > slaMs : null;

    const upd = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: "RESOLVED",
          slaResolvedAt: now,
          slaBreached: breached,
          closureRemarks: note || null,
          approvedBy: user.name || user.employeeID || "HOD",
        },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "RESOLVED",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId,
        note: note || "Resolved by HOD after review",
      });

      return u;
    });

    res.json(upd);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to resolve" });
  }
};
export const getPendingTransferApprovals = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);

    const me = await prisma.employee.findUnique({
      where: { id: user.employeeDbId },
      select: { departmentId: true, role: true },
    });

    if (!me?.departmentId || me.role !== "HOD") {
      res.json([]);
      return;
    }

    const rows = await prisma.ticketTransferHistory.findMany({
      where: { status: "REQUESTED", toDepartmentId: me.departmentId },
      orderBy: { createdAt: "desc" },
      include: {
        ticket: { include: { asset: true, department: true, raisedBy: true, assignedTo: true } },
        fromDepartment: true,
        toDepartment: true,
        requestedBy: true,
      },
    });

    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch pending transfers", error: e.message });
  }
};

export const completeTicketWork = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const ticketId = Number(req.params.id);
    const note = String(req.body.note || "").trim();

    if (!note) {
      res.status(400).json({ message: "Completion note required" });
      return;
    }

    const ticket = await requireAssignedTo(user, ticketId);
    ensureStatus(ticket, ["IN_PROGRESS", "ON_HOLD"]);

    const upd = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: "WORK_COMPLETED",
          closureRemarks: note,
        },
      });

      await createStatusHistory(tx, {
        ticketDbId: ticketId,
        status: "WORK_COMPLETED",
        changedBy: user.employeeID ?? user.name ?? "system",
        changedById: user.employeeDbId,
        note,
      });

      return u;
    });

    res.json(upd);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to mark work completed" });
  }
};
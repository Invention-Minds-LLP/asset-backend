import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── Escalation Matrix (Rules) ─────────────────────────────────────────────────

export const createEscalationRule = async (req: Request, res: Response) => {
  try {
    const {
      departmentId,
      assetCategoryId,
      priority,
      level,
      escalateAfterValue,
      escalateAfterUnit,
      notifyRole,
      notifyEmployeeId,
      slaType,         // INTERNAL | VENDOR | null (both)
      applicableTo,    // TICKET | MAINTENANCE | null (both)
      vendorContactName,
      vendorContactEmail,
      vendorContactPhone,
    } = req.body;

    if (!priority || !level || !escalateAfterValue || !escalateAfterUnit) {
      res.status(400).json({ message: "priority, level, escalateAfterValue, escalateAfterUnit are required" });
      return;
    }

    const rule = await prisma.escalationMatrix.create({
      data: {
        departmentId: departmentId ? Number(departmentId) : undefined,
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
        priority,
        level: Number(level),
        escalateAfterValue: Number(escalateAfterValue),
        escalateAfterUnit,
        notifyRole,
        notifyEmployeeId: notifyEmployeeId ? Number(notifyEmployeeId) : undefined,
        slaType: slaType ?? null,
        applicableTo: applicableTo ?? null,
        vendorContactName: vendorContactName ?? null,
        vendorContactEmail: vendorContactEmail ?? null,
        vendorContactPhone: vendorContactPhone ?? null,
      } as any,
      include: {
        department: { select: { name: true } },
        assetCategory: { select: { name: true } },
        notifyEmployee: { select: { name: true, employeeID: true } },
      },
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error("createEscalationRule error:", error);
    res.status(500).json({ message: "Failed to create escalation rule" });
  }
};

export const getAllEscalationRules = async (req: Request, res: Response) => {
  try {
    const { departmentId, assetCategoryId, priority, slaType, applicableTo } = req.query;
    const where: any = {};
    if (departmentId) where.departmentId = Number(departmentId);
    if (assetCategoryId) where.assetCategoryId = Number(assetCategoryId);
    if (priority) where.priority = String(priority);
    if (slaType) where.slaType = String(slaType);
    if (applicableTo) where.applicableTo = String(applicableTo);

    const rules = await prisma.escalationMatrix.findMany({
      where,
      include: {
        department: { select: { name: true } },
        assetCategory: { select: { name: true } },
        notifyEmployee: { select: { name: true, employeeID: true } },
      },
      orderBy: [{ priority: "asc" }, { level: "asc" }],
    });

    res.json(rules);
  } catch (error) {
    console.error("getAllEscalationRules error:", error);
    res.status(500).json({ message: "Failed to fetch escalation rules" });
  }
};

export const getEscalationRuleById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const rule = await prisma.escalationMatrix.findUnique({
      where: { id },
      include: {
        department: { select: { name: true } },
        assetCategory: { select: { name: true } },
        notifyEmployee: { select: { name: true, employeeID: true } },
      },
    });
    if (!rule) {
      res.status(404).json({ message: "Rule not found" });
      return;
    }
    res.json(rule);
  } catch (error) {
    console.error("getEscalationRuleById error:", error);
    res.status(500).json({ message: "Failed to fetch escalation rule" });
  }
};

export const updateEscalationRule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.escalationMatrix.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Rule not found" });
      return;
    }
    const updated = await prisma.escalationMatrix.update({ where: { id }, data: req.body });
    res.json(updated);
  } catch (error) {
    console.error("updateEscalationRule error:", error);
    res.status(500).json({ message: "Failed to update escalation rule" });
  }
};

export const deleteEscalationRule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.escalationMatrix.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Rule not found" });
      return;
    }
    await prisma.escalationMatrix.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteEscalationRule error:", error);
    res.status(500).json({ message: "Failed to delete escalation rule" });
  }
};

export const bulkUpsertEscalationMatrix = async (req: Request, res: Response) => {
  try {
    const { departmentId, assetCategoryId, priority, rules } = req.body;

    if (!rules?.length || !priority) {
      res.status(400).json({ message: "priority and rules array are required" });
      return;
    }

    // Delete existing rules for this scope + priority
    await prisma.escalationMatrix.deleteMany({
      where: {
        departmentId: departmentId ? Number(departmentId) : undefined,
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
        priority,
      },
    });

    const created = await prisma.$transaction(
      rules.map((r: any) =>
        prisma.escalationMatrix.create({
          data: {
            departmentId: departmentId ? Number(departmentId) : undefined,
            assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
            priority,
            level: Number(r.level),
            escalateAfterValue: Number(r.escalateAfterValue),
            escalateAfterUnit: r.escalateAfterUnit,
            notifyRole: r.notifyRole,
            notifyEmployeeId: r.notifyEmployeeId ? Number(r.notifyEmployeeId) : undefined,
            slaType: r.slaType ?? null,
            applicableTo: r.applicableTo ?? null,
            vendorContactName: r.vendorContactName ?? null,
            vendorContactEmail: r.vendorContactEmail ?? null,
            vendorContactPhone: r.vendorContactPhone ?? null,
          } as any,
        })
      )
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("bulkUpsertEscalationMatrix error:", error);
    res.status(500).json({ message: "Failed to save escalation matrix" });
  }
};

// ─── Ticket Escalations ────────────────────────────────────────────────────────

export const getTicketEscalations = async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const escalations = await prisma.ticketEscalation.findMany({
      where: { ticketId },
      include: {
        notifiedEmployee: { select: { name: true, employeeID: true } },
      },
      orderBy: { escalatedAt: "asc" },
    });
    res.json(escalations);
  } catch (error) {
    console.error("getTicketEscalations error:", error);
    res.status(500).json({ message: "Failed to fetch ticket escalations" });
  }
};

export const triggerTicketEscalation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const { level, notifiedEmployeeId, message } = req.body;

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    const escalation = await prisma.ticketEscalation.create({
      data: {
        ticketId,
        level: Number(level) || 1,
        notifiedEmployeeId: notifiedEmployeeId ? Number(notifiedEmployeeId) : undefined,
        message,
      },
      include: {
        notifiedEmployee: { select: { name: true, employeeID: true } },
      },
    });

    res.status(201).json(escalation);
  } catch (error) {
    console.error("triggerTicketEscalation error:", error);
    res.status(500).json({ message: "Failed to trigger escalation" });
  }
};

export const checkAndEscalateTickets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    const openTickets = await prisma.ticket.findMany({
      where: {
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
      },
      include: {
        department: true,
        asset: { include: { assetCategory: true } },
      },
    });

    const escalated: number[] = [];

    for (const ticket of openTickets) {
      const t = ticket as any;
      const createdAt = new Date(ticket.createdAt);

      function calcDeadline(value: number | null, unit: string | null): Date | null {
        if (!value || !unit) return null;
        const d = new Date(createdAt);
        if (unit === "HOURS") d.setHours(d.getHours() + value);
        else if (unit === "DAYS") d.setDate(d.getDate() + value);
        else if (unit === "MINUTES") d.setMinutes(d.getMinutes() + value);
        return d;
      }

      const internalDeadline = calcDeadline(t.internalSlaValue, t.internalSlaUnit);
      const vendorDeadline   = calcDeadline(t.vendorSlaValue,   t.vendorSlaUnit);
      const governingDeadline = calcDeadline(ticket.slaExpectedValue, ticket.slaExpectedUnit);

      const updateData: any = {};
      let breachOccurred = false;

      // Check internal SLA
      if (internalDeadline && now > internalDeadline && !ticket.slaBreached) {
        updateData.slaBreached = true;
        breachOccurred = true;
      }

      // Check vendor SLA separately
      if (vendorDeadline && now > vendorDeadline && !t.vendorSlaBreached) {
        updateData.vendorSlaBreached = true;
        breachOccurred = true;

        // Vendor-specific escalation rules
        const vendorRules = await prisma.escalationMatrix.findMany({
          where: {
            priority: ticket.priority,
            slaType: "VENDOR",
            applicableTo: { in: ["TICKET", null as any] },
            OR: [
              { departmentId: ticket.departmentId },
              { assetCategoryId: ticket.asset?.assetCategoryId ?? undefined },
              { departmentId: null, assetCategoryId: null },
            ],
          } as any,
          orderBy: { level: "asc" },
        });

        for (const rule of vendorRules) {
          await prisma.ticketEscalation.create({
            data: {
              ticketId: ticket.id,
              level: rule.level,
              notifiedEmployeeId: rule.notifyEmployeeId ?? undefined,
              message: `[VENDOR SLA BREACH] Ticket ${ticket.ticketId}: vendor resolution SLA exceeded. Contact: ${(rule as any).vendorContactName ?? "vendor"}`,
            },
          });
        }

        // Notification for vendor SLA breach
        await (prisma.notification as any).upsert?.({
          where: { dedupeKey: `vendor-sla-breach-${ticket.id}` },
          create: {
            type: "SLA_BREACH",
            title: "Vendor SLA Breached",
            message: `Ticket ${ticket.ticketId} exceeded vendor contractual SLA.`,
            priority: "HIGH",
            ticketId: ticket.id,
            dedupeKey: `vendor-sla-breach-${ticket.id}`,
          },
          update: {},
        }).catch(() => null);
      }

      // Check governing (internal) SLA breach for escalation
      if (governingDeadline && now > governingDeadline && !ticket.slaBreached) {
        updateData.slaBreached = true;
        breachOccurred = true;

        const internalRules = await prisma.escalationMatrix.findMany({
          where: {
            priority: ticket.priority,
            slaType: { in: ["INTERNAL", null as any] },
            applicableTo: { in: ["TICKET", null as any] },
            OR: [
              { departmentId: ticket.departmentId },
              { assetCategoryId: ticket.asset?.assetCategoryId ?? undefined },
              { departmentId: null, assetCategoryId: null },
            ],
          } as any,
          orderBy: { level: "asc" },
        });

        for (const rule of internalRules) {
          await prisma.ticketEscalation.create({
            data: {
              ticketId: ticket.id,
              level: rule.level,
              notifiedEmployeeId: rule.notifyEmployeeId ?? undefined,
              message: `[INTERNAL SLA BREACH] Ticket ${ticket.ticketId}: internal resolution SLA exceeded`,
            },
          });
        }

        // Notification
        await (prisma.notification.upsert as any)({
          where: { dedupeKey: `sla-breach-${ticket.id}` },
          create: {
            type: "SLA_BREACH",
            title: "SLA Breached",
            message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} has breached internal SLA.`,
            priority: "HIGH",
            ticketId: ticket.id,
            dedupeKey: `sla-breach-${ticket.id}`,
          },
          update: {},
        });
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
      }

      if (breachOccurred) escalated.push(ticket.id);
    }

    res.json({ escalated: escalated.length, ticketIds: escalated });
  } catch (error) {
    console.error("checkAndEscalateTickets error:", error);
    res.status(500).json({ message: "Failed to check escalations" });
  }
};

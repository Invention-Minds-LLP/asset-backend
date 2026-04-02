import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { Prisma } from "@prisma/client";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

/** =========================
 * Helpers
 * ========================= */

function mustUser(req: any) {
    if (!req.user?.employeeDbId) throw new Error("Unauthorized");
    return req.user;
}

async function createNotification(tx: any, data: {
    title: string;
    message: string;
    assetId?: number;
    ticketId?: number;
    recipients: number[];
    createdById?: number;
}) {
    const notif = await tx.notification.create({
        data: {
            title: data.title,
            message: data.message,
            assetId: data.assetId,
            ticketId: data.ticketId,
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

function calculateNextDue(schedule: any) {
    const next = new Date(schedule.nextDueAt);

    if (schedule.frequencyUnit === "DAYS") {
        next.setDate(next.getDate() + schedule.frequencyValue);
    } else if (schedule.frequencyUnit === "MONTHS") {
        next.setMonth(next.getMonth() + schedule.frequencyValue);
    } else if (schedule.frequencyUnit === "YEARS") {
        next.setFullYear(next.getFullYear() + schedule.frequencyValue);
    }

    return next;
}

/** =========================
 * 1. Create Schedule
 * ========================= */
export const createSchedule = async (req: any, res: Response) => {
    try {
        const user = mustUser(req);

        const {
            assetId,
            frequencyValue,
            frequencyUnit,
            startDate,
            nextDueAt,
            reminderDays,
            reason,
            description,
        } = req.body;

        if (!assetId || !frequencyValue || !frequencyUnit) {
             res.status(400).json({ message: "assetId, frequencyValue, and frequencyUnit are required" });
             return;
        }

        // Calculate nextDueAt: if startDate given, first due = startDate + frequency
        // If nextDueAt given explicitly, use that instead
        let computedNextDueAt: Date;
        if (nextDueAt) {
            computedNextDueAt = new Date(nextDueAt);
        } else if (startDate) {
            const start = new Date(startDate);
            computedNextDueAt = new Date(start);
            if (frequencyUnit === "DAYS") computedNextDueAt.setDate(start.getDate() + Number(frequencyValue));
            else if (frequencyUnit === "MONTHS") computedNextDueAt.setMonth(start.getMonth() + Number(frequencyValue));
            else if (frequencyUnit === "YEARS") computedNextDueAt.setFullYear(start.getFullYear() + Number(frequencyValue));
            else computedNextDueAt.setDate(start.getDate() + Number(frequencyValue));
        } else {
            // Default: first due date = today + frequency
            computedNextDueAt = new Date();
            if (frequencyUnit === "DAYS") computedNextDueAt.setDate(computedNextDueAt.getDate() + Number(frequencyValue));
            else if (frequencyUnit === "MONTHS") computedNextDueAt.setMonth(computedNextDueAt.getMonth() + Number(frequencyValue));
            else if (frequencyUnit === "YEARS") computedNextDueAt.setFullYear(computedNextDueAt.getFullYear() + Number(frequencyValue));
        }

        const schedule = await prisma.maintenanceSchedule.create({
            data: {
                assetId: Number(assetId),
                frequencyValue: Number(frequencyValue),
                frequencyUnit,
                startDate: startDate ? new Date(startDate) : new Date(),
                nextDueAt: computedNextDueAt,
                reminderDays: reminderDays ? Number(reminderDays) : 7,
                reason: reason || null,
                description: description || null,
                createdBy: user.employeeID,
                createdById: user.employeeDbId,
            },
        });

        logAction({ entityType: "MAINTENANCE_SCHEDULE", entityId: schedule.id, action: "CREATE", description: `PM schedule created for asset #${assetId} (every ${frequencyValue} ${frequencyUnit})`, performedById: user.employeeDbId });

        res.status(201).json(schedule);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

/** =========================
 * 2. Get All Schedules
 * ========================= */
export const getAllSchedules = async (_req: Request, res: Response) => {
    const user = (_req as any).user;

    // Department scoping: non-admin sees only their department's assets
    let scopedAssetIds: number[] | undefined;
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      scopedAssetIds = deptAssets.map(a => a.id);
    }

    const where: any = {};
    if (scopedAssetIds) {
      where.assetId = { in: scopedAssetIds };
    }

    const data = await prisma.maintenanceSchedule.findMany({
        where,
        include: { asset: true },
        orderBy: { nextDueAt: "asc" },
    });
    res.json(data);
};

/** =========================
 * 3. Get Due Schedules
 * ========================= */
export const getDueSchedules = async (_req: Request, res: Response) => {
    const now = new Date();

    const schedules = await prisma.maintenanceSchedule.findMany({
        where: {
            nextDueAt: { lte: now },
            isActive: true,
        },
        include: { asset: true },
    });

    res.json(schedules);
};

/** =========================
 * 4. Execute Maintenance
 * ========================= */
export const executeMaintenance = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);

    const {
      assetId,
      scheduleId,
      notes,
      spareParts = [],
      consumables = [],
      serviceCost = 0,
      partsCost = 0,
    } = req.body;

    if (!assetId) {
       res.status(400).json({ message: "assetId required" });
       return
    }

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
       res.status(404).json({ message: "Asset not found" });
       return;
    }

    // 🔹 Detect AMC / CMC
    const contract = await prisma.serviceContract.findFirst({
      where: {
        assetId,
        status: "ACTIVE",
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
      },
    });

    const serviceType = contract ? contract.contractType : "PAID";

    const result = await prisma.$transaction(async (tx) => {

      // ✅ get schedule once
      const schedule = scheduleId
        ? await tx.maintenanceSchedule.findUnique({ where: { id: scheduleId } })
        : null;

      // 1️⃣ Create maintenance history
      const history = await tx.maintenanceHistory.create({
        data: {
          asset: {
            connect: { id: assetId },
          },
          scheduledDue: schedule?.nextDueAt ?? new Date(),
          actualDoneAt: new Date(),
          wasLate: schedule ? new Date() > schedule.nextDueAt : false,
          performedBy: user.employeeID,
          notes,
          serviceType,
          serviceCost: new Prisma.Decimal(serviceCost),
          partsCost: new Prisma.Decimal(partsCost),
          totalCost: new Prisma.Decimal(Number(serviceCost) + Number(partsCost)),
          createdById: user.employeeDbId,
        },
      });

      // 2️⃣ Spare Parts
      for (const sp of spareParts) {
        await tx.sparePartUsage.create({
          data: {
            sparePartId: sp.id,
            assetId,
            quantity: sp.qty,
            usedById: user.employeeDbId,
            reason: "Preventive Maintenance",
          },
        });

        await tx.sparePart.update({
          where: { id: sp.id },
          data: {
            stockQuantity: { decrement: sp.qty },
          },
        });

        await tx.inventoryTransaction.create({
          data: {
            type: "OUT",
            sparePartId: sp.id,
            quantity: sp.qty,
            referenceType: "MAINTENANCE",
            referenceId: history.id, // ✅ FIXED
            performedById: user.employeeDbId,
          },
        });
      }

      // 3️⃣ Consumables
      for (const c of consumables) {
        await tx.inventoryTransaction.create({
          data: {
            type: "OUT",
            consumableId: c.id,
            quantity: c.qty,
            referenceType: "MAINTENANCE",
            referenceId: history.id, // ✅ FIXED
            performedById: user.employeeDbId,
          },
        });
      }

      // 4️⃣ Update next schedule
      if (schedule) {
        const nextDue = calculateNextDue(schedule);

        await tx.maintenanceSchedule.update({
          where: { id: schedule.id },
          data: { nextDueAt: nextDue },
        });
      }

      // 5️⃣ Notify HOD
      if (asset.departmentId) {
        const hod = await tx.employee.findFirst({
          where: {
            departmentId: asset.departmentId,
            role: "HOD",
          },
        });

        if (hod) {
          const notif = await tx.notification.create({
            data: {
              type: "OTHER", // ✅ REQUIRED FIX
              title: "Maintenance Completed",
              message: `Asset ${asset.assetName} maintenance completed`,
              assetId: asset.id,
              createdById: user.employeeDbId,
            },
          });

          await tx.notificationRecipient.create({
            data: {
              notificationId: notif.id,
              employeeId: hod.id,
            },
          });
        }
      }

      return history; // ✅ FIXED
    });

    logAction({ entityType: "MAINTENANCE_SCHEDULE", entityId: result.id, action: "UPDATE", description: `Maintenance executed for asset #${assetId}${scheduleId ? `, schedule #${scheduleId}` : ""}`, performedById: user.employeeDbId });

    // Notify HOD about maintenance completion via SSE + helper
    if (asset.departmentId) {
      const hodIds = await getDepartmentHODs(asset.departmentId);
      notify({ type: "PM_DUE", title: "Maintenance Completed", message: `Preventive maintenance completed for asset ${asset.assetName}`, recipientIds: hodIds, assetId: asset.id, createdById: user.employeeDbId });
    }

    res.json(result);
  } catch (e: any) {
    console.error("executeMaintenance error:", e);
    res.status(500).json({ message: e.message });
  }
};

/** =========================
 * 5. Get History by Asset
 * ========================= */
export const getHistoryByAsset = async (req: Request, res: Response) => {
    const assetId = Number(req.params.assetId);

    const history = await prisma.maintenanceHistory.findMany({
        where: { assetId },
        orderBy: { actualDoneAt: "desc" },
    });

    res.json(history);
};

/** =========================
 * 6. Get AMC/CMC Contract
 * ========================= */
export const getServiceContract = async (req: Request, res: Response) => {
    const assetId = Number(req.params.assetId);

    const contract = await prisma.serviceContract.findFirst({
        where: {
            assetId,
            status: "ACTIVE",
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
        },
    });

    res.json(contract);
};

/** =========================
 * 7. Trigger Notifications (cron-ready)
 * ========================= */
/** =========================
 * Calendar View (month-based)
 * ========================= */
export const getCalendarView = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { month, year } = req.query;
        const m = Number(month) || new Date().getMonth() + 1;
        const y = Number(year) || new Date().getFullYear();

        // Department scoping: non-admin sees only their department's assets
        let scopedAssetIds: number[] | undefined;
        if (user?.role !== "ADMIN" && user?.departmentId) {
          const deptAssets = await prisma.asset.findMany({
            where: { departmentId: Number(user.departmentId) },
            select: { id: true },
          });
          scopedAssetIds = deptAssets.map(a => a.id);
        }

        const startDate = new Date(y, m - 1, 1);
        const endDate = new Date(y, m, 0, 23, 59, 59);

        const schedules = await prisma.maintenanceSchedule.findMany({
            where: {
                nextDueAt: { gte: startDate, lte: endDate },
                isActive: true,
                ...(scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {}),
            },
            include: {
                asset: {
                    select: {
                        id: true,
                        assetId: true,
                        assetName: true,
                        departmentId: true,
                        department: { select: { name: true } },
                        currentLocation: true,
                    },
                },
            },
            orderBy: { nextDueAt: "asc" },
        });

        const now = new Date();

        const events = schedules.map((s) => {
            const dueDate = new Date(s.nextDueAt);
            let status: string;
            if (dueDate < now) {
                status = "OVERDUE";
            } else {
                const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                status = daysUntil <= (s.reminderDays || 7) ? "UPCOMING" : "SCHEDULED";
            }

            return {
                id: s.id,
                assetId: s.asset.id,
                assetCode: s.asset.assetId,
                assetName: s.asset.assetName,
                department: (s.asset as any).department?.name || "",
                location: s.asset.currentLocation || "",
                dueDate: s.nextDueAt,
                frequencyValue: s.frequencyValue,
                frequencyUnit: s.frequencyUnit,
                status,
                reason: s.reason,
            };
        });

        const overdue = events.filter((e) => e.status === "OVERDUE").length;
        const upcoming = events.filter((e) => e.status === "UPCOMING").length;
        const scheduled = events.filter((e) => e.status === "SCHEDULED").length;

        res.json({ month: m, year: y, overdue, upcoming, scheduled, total: events.length, events });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

/** =========================
 * Reschedule a PM
 * ========================= */
export const rescheduleMaintenance = async (req: any, res: Response) => {
    try {
        const user = mustUser(req);
        const id = Number(req.params.id);
        const { newDueDate, reason } = req.body;

        if (!newDueDate) {
            res.status(400).json({ message: "newDueDate is required" });
            return;
        }

        const schedule = await prisma.maintenanceSchedule.findUnique({ where: { id } });
        if (!schedule) {
            res.status(404).json({ message: "Schedule not found" });
            return;
        }

        const updated = await prisma.maintenanceSchedule.update({
            where: { id },
            data: {
                nextDueAt: new Date(newDueDate),
                reason: reason || schedule.reason,
            },
        });

        logAction({ entityType: "MAINTENANCE_SCHEDULE", entityId: id, action: "UPDATE", description: `PM schedule #${id} rescheduled to ${newDueDate}`, performedById: user.employeeDbId });

        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

/** =========================
 * Update schedule (toggle active, change frequency)
 * ========================= */
export const updateSchedule = async (req: any, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { frequencyValue, frequencyUnit, nextDueAt, reminderDays, reason, isActive } = req.body;

        const data: any = {};
        if (frequencyValue !== undefined) data.frequencyValue = frequencyValue;
        if (frequencyUnit !== undefined) data.frequencyUnit = frequencyUnit;
        if (nextDueAt !== undefined) data.nextDueAt = new Date(nextDueAt);
        if (reminderDays !== undefined) data.reminderDays = reminderDays;
        if (reason !== undefined) data.reason = reason;
        if (isActive !== undefined) data.isActive = isActive;

        const updated = await prisma.maintenanceSchedule.update({
            where: { id },
            data,
        });

        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

/** =========================
 * PM History with pagination & CSV export
 * ========================= */
export const getAllMaintenanceHistory = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { assetId, serviceType, page = "1", limit = "25", search, exportCsv } = req.query;

        // Department scoping: non-admin sees only their department's assets
        let scopedAssetIds: number[] | undefined;
        if (user?.role !== "ADMIN" && user?.departmentId) {
          const deptAssets = await prisma.asset.findMany({
            where: { departmentId: Number(user.departmentId) },
            select: { id: true },
          });
          scopedAssetIds = deptAssets.map(a => a.id);
        }

        const where: any = {};
        if (scopedAssetIds) {
          where.assetId = { in: scopedAssetIds };
        }
        if (assetId) where.assetId = Number(assetId);
        if (serviceType) where.serviceType = String(serviceType);
        if (search) {
            where.OR = [
                { performedBy: { contains: String(search) } },
                { notes: { contains: String(search) } },
                { asset: { assetName: { contains: String(search) } } },
            ];
        }

        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));

        const [total, history] = await Promise.all([
            prisma.maintenanceHistory.count({ where }),
            prisma.maintenanceHistory.findMany({
                where,
                include: {
                    asset: { select: { assetId: true, assetName: true } },
                },
                orderBy: { actualDoneAt: "desc" },
                ...(exportCsv !== "true" ? { skip, take } : {}),
            }),
        ]);

        if (exportCsv === "true") {
            const csvRows = history.map((h: any) => ({
                AssetId: h.asset?.assetId || "",
                AssetName: h.asset?.assetName || "",
                ScheduledDue: h.scheduledDue ? new Date(h.scheduledDue).toISOString().split("T")[0] : "",
                ActualDone: h.actualDoneAt ? new Date(h.actualDoneAt).toISOString().split("T")[0] : "",
                WasLate: h.wasLate ? "Yes" : "No",
                PerformedBy: h.performedBy || "",
                ServiceType: h.serviceType || "",
                ServiceCost: h.serviceCost ? Number(h.serviceCost) : "",
                PartsCost: h.partsCost ? Number(h.partsCost) : "",
                TotalCost: h.totalCost ? Number(h.totalCost) : "",
                Notes: h.notes || "",
            }));

            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=maintenance-history.csv");
            res.send(headers + "\n" + rows);
            return;
        }

        res.json({ data: history, total, page: parseInt(String(page)), limit: take });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

export const triggerPMNotifications = async (req: any, res: Response) => {
    const now = new Date();

    const schedules = await prisma.maintenanceSchedule.findMany({
        where: {
            nextDueAt: { lte: now },
            isActive: true,
        },
        include: { asset: true },
    });

    for (const s of schedules) {
        const hod = await prisma.employee.findFirst({
            where: {
                departmentId: s.asset.departmentId!,
                role: "HOD",
            },
        });

        if (hod) {
            const notif = await prisma.notification.create({
                data: {
                    type: "OTHER",
                    title: "Maintenance Due",
                    message: `Asset ${s.asset.assetName} is due`,
                    assetId: s.asset.id,
                },
            });

            await prisma.notificationRecipient.create({
                data: {
                    notificationId: notif.id,
                    employeeId: hod.id,
                },
            });
        }
    }

    res.json({ message: "PM notifications triggered" });
};
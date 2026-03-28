import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── Calibration Schedules ─────────────────────────────────────────────────────

export const createCalibrationSchedule = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      assetId,
      frequencyValue,
      frequencyUnit,
      nextDueAt,
      standardProcedure,
      vendorId,
      reminderDays,
      notes,
    } = req.body;

    if (!assetId || !frequencyValue || !frequencyUnit || !nextDueAt) {
      res.status(400).json({ message: "assetId, frequencyValue, frequencyUnit, nextDueAt are required" });
      return;
    }

    const schedule = await prisma.calibrationSchedule.create({
      data: {
        assetId: Number(assetId),
        frequencyValue: Number(frequencyValue),
        frequencyUnit,
        nextDueAt: new Date(nextDueAt),
        standardProcedure,
        vendorId: vendorId ? Number(vendorId) : undefined,
        reminderDays: reminderDays ? Number(reminderDays) : 7,
        notes,
      },
      include: {
        asset: { select: { assetId: true, assetName: true } },
        vendor: { select: { name: true } },
      },
    });

    res.status(201).json(schedule);
  } catch (error) {
    console.error("createCalibrationSchedule error:", error);
    res.status(500).json({ message: "Failed to create calibration schedule" });
  }
};

export const getAllCalibrationSchedules = async (req: Request, res: Response) => {
  try {
    const { assetId, isActive } = req.query;
    const where: any = {};
    if (assetId) where.assetId = Number(assetId);
    if (isActive !== undefined) where.isActive = isActive === "true";

    const schedules = await prisma.calibrationSchedule.findMany({
      where,
      include: {
        asset: { select: { assetId: true, assetName: true, assetType: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { nextDueAt: "asc" },
    });

    res.json(schedules);
  } catch (error) {
    console.error("getAllCalibrationSchedules error:", error);
    res.status(500).json({ message: "Failed to fetch calibration schedules" });
  }
};

export const getCalibrationSchedulesByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const schedules = await prisma.calibrationSchedule.findMany({
      where: { assetId },
      include: {
        vendor: { select: { name: true } },
        histories: { orderBy: { calibratedAt: "desc" }, take: 3 },
      },
      orderBy: { nextDueAt: "asc" },
    });
    res.json(schedules);
  } catch (error) {
    console.error("getCalibrationSchedulesByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch schedules" });
  }
};

export const updateCalibrationSchedule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationSchedule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }

    const { nextDueAt, frequencyValue, frequencyUnit, isActive, vendorId, reminderDays, notes, standardProcedure } = req.body;

    const updated = await prisma.calibrationSchedule.update({
      where: { id },
      data: {
        nextDueAt: nextDueAt ? new Date(nextDueAt) : undefined,
        frequencyValue: frequencyValue ? Number(frequencyValue) : undefined,
        frequencyUnit,
        isActive,
        vendorId: vendorId ? Number(vendorId) : undefined,
        reminderDays: reminderDays ? Number(reminderDays) : undefined,
        notes,
        standardProcedure,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("updateCalibrationSchedule error:", error);
    res.status(500).json({ message: "Failed to update calibration schedule" });
  }
};

export const deleteCalibrationSchedule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationSchedule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await prisma.calibrationSchedule.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteCalibrationSchedule error:", error);
    res.status(500).json({ message: "Failed to delete schedule" });
  }
};

export const getDueCalibrations = async (req: Request, res: Response) => {
  try {
    const daysAhead = parseInt((req.query.days as string) || "7");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const due = await prisma.calibrationSchedule.findMany({
      where: { nextDueAt: { lte: cutoff }, isActive: true },
      include: {
        asset: { select: { assetId: true, assetName: true, assetType: true, departmentId: true } },
        vendor: { select: { name: true, contact: true } },
      },
      orderBy: { nextDueAt: "asc" },
    });

    res.json(due);
  } catch (error) {
    console.error("getDueCalibrations error:", error);
    res.status(500).json({ message: "Failed to fetch due calibrations" });
  }
};

// ─── Calibration History ───────────────────────────────────────────────────────

export const logCalibrationHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      assetId,
      scheduleId,
      calibratedAt,
      dueAt,
      calibratedByType,
      calibratedByName,
      vendorId,
      result,
      certificateNo,
      certificateUrl,
      remarks,
    } = req.body;

    if (!assetId) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }

    const history = await prisma.calibrationHistory.create({
      data: {
        assetId: Number(assetId),
        scheduleId: scheduleId ? Number(scheduleId) : undefined,
        calibratedAt: calibratedAt ? new Date(calibratedAt) : new Date(),
        dueAt: dueAt ? new Date(dueAt) : undefined,
        calibratedByType,
        calibratedByName,
        vendorId: vendorId ? Number(vendorId) : undefined,
        result: result ?? "NA",
        certificateNo,
        certificateUrl,
        remarks,
        createdById: req.user?.employeeDbId,
      },
      include: {
        asset: { select: { assetId: true, assetName: true } },
        vendor: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });

    // Advance next due date on linked schedule
    if (scheduleId) {
      const schedule = await prisma.calibrationSchedule.findUnique({ where: { id: Number(scheduleId) } });
      if (schedule) {
        const base = calibratedAt ? new Date(calibratedAt) : new Date();
        let nextDue = new Date(base);
        if (schedule.frequencyUnit === "DAYS") nextDue.setDate(nextDue.getDate() + schedule.frequencyValue);
        else if (schedule.frequencyUnit === "MONTHS") nextDue.setMonth(nextDue.getMonth() + schedule.frequencyValue);
        else if (schedule.frequencyUnit === "YEARS") nextDue.setFullYear(nextDue.getFullYear() + schedule.frequencyValue);

        await prisma.calibrationSchedule.update({
          where: { id: Number(scheduleId) },
          data: { nextDueAt: nextDue, lastCalibratedAt: base },
        });
      }
    }

    res.status(201).json(history);
  } catch (error) {
    console.error("logCalibrationHistory error:", error);
    res.status(500).json({ message: "Failed to log calibration history" });
  }
};

export const getCalibrationHistoryByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const history = await prisma.calibrationHistory.findMany({
      where: { assetId },
      include: {
        vendor: { select: { name: true } },
        createdBy: { select: { name: true, employeeID: true } },
      },
      orderBy: { calibratedAt: "desc" },
    });
    res.json(history);
  } catch (error) {
    console.error("getCalibrationHistoryByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch calibration history" });
  }
};

// ─── Calibration Checklist Templates ──────────────────────────────────────────

export const createCalibrationTemplate = async (req: Request, res: Response) => {
  try {
    const { name, description, assetCategoryId, assetId, isActive } = req.body;

    if (!name) {
      res.status(400).json({ message: "name is required" });
      return;
    }

    const template = await prisma.calibrationChecklistTemplate.create({
      data: {
        name,
        description,
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
        assetId: assetId ? Number(assetId) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
      },
    });

    res.status(201).json(template);
  } catch (error) {
    console.error("createCalibrationTemplate error:", error);
    res.status(500).json({ message: "Failed to create calibration template" });
  }
};

export const getAllCalibrationTemplates = async (req: Request, res: Response) => {
  try {
    const { assetCategoryId, assetId } = req.query;
    const where: any = {};
    if (assetCategoryId) where.assetCategoryId = Number(assetCategoryId);
    if (assetId) where.assetId = Number(assetId);

    const templates = await prisma.calibrationChecklistTemplate.findMany({
      where,
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
        items: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(templates);
  } catch (error) {
    console.error("getAllCalibrationTemplates error:", error);
    res.status(500).json({ message: "Failed to fetch calibration templates" });
  }
};

export const addCalibrationTemplateItems = async (req: Request, res: Response) => {
  try {
    const templateId = parseInt(req.params.templateId);
    const { items } = req.body as {
      items: { title: string; description?: string; expectedValue?: string; unit?: string; sortOrder?: number; isRequired?: boolean }[];
    };

    if (!items?.length) {
      res.status(400).json({ message: "items array is required" });
      return;
    }

    const template = await prisma.calibrationChecklistTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    const created = await prisma.$transaction(
      items.map((item, idx) =>
        prisma.calibrationChecklistItem.create({
          data: {
            templateId,
            title: item.title,
            description: item.description,
            expectedValue: item.expectedValue,
            unit: item.unit,
            sortOrder: item.sortOrder ?? idx,
            isRequired: item.isRequired !== undefined ? item.isRequired : true,
          },
        })
      )
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("addCalibrationTemplateItems error:", error);
    res.status(500).json({ message: "Failed to add items" });
  }
};

export const updateCalibrationTemplate = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationChecklistTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    const updated = await prisma.calibrationChecklistTemplate.update({
      where: { id },
      data: req.body,
    });

    res.json(updated);
  } catch (error) {
    console.error("updateCalibrationTemplate error:", error);
    res.status(500).json({ message: "Failed to update template" });
  }
};

export const deleteCalibrationTemplate = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationChecklistTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    await prisma.calibrationChecklistItem.deleteMany({ where: { templateId: id } });
    await prisma.calibrationChecklistTemplate.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteCalibrationTemplate error:", error);
    res.status(500).json({ message: "Failed to delete template" });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// "Electricity (BESCOM) Meter Log" — a simple per-meter reading log ported from
// the physical register format. Self-contained; no cross-model relations.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllElectricityLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month } = req.query;
    const where: any = {};
    if (month) where.month = String(month);
    const rows = await prisma.electricityMeterLog.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllElectricityLogs error:", err);
    res.status(500).json({ message: "Failed to fetch electricity meter log", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getElectricityLogById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.electricityMeterLog.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Entry not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch entry", error: err.message });
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
export const createElectricityLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month, floor, meterName, startDate, startTime, openingReading, endDate, endTime, closingReading, totalUnits, remarks } = req.body;
    if (!month) {
      res.status(400).json({ message: "month is required" });
      return;
    }

    const opening = openingReading != null && openingReading !== '' ? Number(openingReading) : null;
    const closing = closingReading != null && closingReading !== '' ? Number(closingReading) : null;
    let total = totalUnits != null && totalUnits !== '' ? Number(totalUnits) : null;
    if (total == null && opening != null && closing != null) {
      total = closing - opening;
    }

    const row = await prisma.electricityMeterLog.create({
      data: {
        month,
        floor: floor ?? null,
        meterName: meterName ?? null,
        startDate: startDate ? new Date(startDate) : null,
        startTime: startTime ?? null,
        openingReading: opening,
        endDate: endDate ? new Date(endDate) : null,
        endTime: endTime ?? null,
        closingReading: closing,
        totalUnits: total,
        remarks: remarks ?? null,
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createElectricityLog error:", err);
    res.status(500).json({ message: "Failed to create entry", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateElectricityLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.electricityMeterLog.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }

    const { month, floor, meterName, startDate, startTime, openingReading, endDate, endTime, closingReading, totalUnits, remarks } = req.body;

    const opening = openingReading != null && openingReading !== '' ? Number(openingReading) : undefined;
    const closing = closingReading != null && closingReading !== '' ? Number(closingReading) : undefined;
    let total = totalUnits != null && totalUnits !== '' ? Number(totalUnits) : undefined;
    if (total === undefined && opening != null && closing != null) {
      total = closing - opening;
    }

    const row = await prisma.electricityMeterLog.update({
      where: { id },
      data: {
        month: month ?? undefined,
        floor: floor ?? undefined,
        meterName: meterName ?? undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        startTime: startTime ?? undefined,
        openingReading: opening,
        endDate: endDate ? new Date(endDate) : undefined,
        endTime: endTime ?? undefined,
        closingReading: closing,
        totalUnits: total,
        remarks: remarks ?? undefined,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateElectricityLog error:", err);
    res.status(500).json({ message: "Failed to update entry", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteElectricityLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.electricityMeterLog.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    await prisma.electricityMeterLog.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteElectricityLog error:", err);
    res.status(500).json({ message: "Failed to delete entry", error: err.message });
  }
};

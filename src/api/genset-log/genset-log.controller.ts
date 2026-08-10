import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// "Genset & Diesel Log" — daily generator run + diesel stock log ported from the
// physical register format. Self-contained; no cross-model relations.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllGensetLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const where: any = {};
    if (from || to) {
      where.logDate = {};
      if (from) where.logDate.gte = new Date(String(from));
      if (to) where.logDate.lte = new Date(String(to));
    }
    const rows = await prisma.gensetLog.findMany({ where, orderBy: { logDate: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllGensetLogs error:", err);
    res.status(500).json({ message: "Failed to fetch genset logs", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getGensetLogById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.gensetLog.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Log not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch log", error: err.message });
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
export const createGensetLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      logDate, genSetOnTime, genSetOffTime, openingMeterReading, closingMeterReading,
      totalHoursRun, dieselOpeningStock, dieselPurchasedBillNo, litersPurchased,
      dieselClosingStock, consumptionLiters, authorisedBy, remarks,
    } = req.body;
    if (!logDate) {
      res.status(400).json({ message: "logDate is required" });
      return;
    }
    const row = await prisma.gensetLog.create({
      data: {
        logDate: new Date(logDate),
        genSetOnTime: genSetOnTime ?? null,
        genSetOffTime: genSetOffTime ?? null,
        openingMeterReading: openingMeterReading != null && openingMeterReading !== '' ? Number(openingMeterReading) : null,
        closingMeterReading: closingMeterReading != null && closingMeterReading !== '' ? Number(closingMeterReading) : null,
        totalHoursRun: totalHoursRun != null && totalHoursRun !== '' ? Number(totalHoursRun) : null,
        dieselOpeningStock: dieselOpeningStock != null && dieselOpeningStock !== '' ? Number(dieselOpeningStock) : null,
        dieselPurchasedBillNo: dieselPurchasedBillNo ?? null,
        litersPurchased: litersPurchased != null && litersPurchased !== '' ? Number(litersPurchased) : null,
        dieselClosingStock: dieselClosingStock != null && dieselClosingStock !== '' ? Number(dieselClosingStock) : null,
        consumptionLiters: consumptionLiters != null && consumptionLiters !== '' ? Number(consumptionLiters) : null,
        authorisedBy: authorisedBy ?? null,
        remarks: remarks ?? null,
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createGensetLog error:", err);
    res.status(500).json({ message: "Failed to create log", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateGensetLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.gensetLog.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Log not found" }); return; }

    const {
      logDate, genSetOnTime, genSetOffTime, openingMeterReading, closingMeterReading,
      totalHoursRun, dieselOpeningStock, dieselPurchasedBillNo, litersPurchased,
      dieselClosingStock, consumptionLiters, authorisedBy, remarks,
    } = req.body;
    const row = await prisma.gensetLog.update({
      where: { id },
      data: {
        logDate: logDate ? new Date(logDate) : undefined,
        genSetOnTime: genSetOnTime ?? undefined,
        genSetOffTime: genSetOffTime ?? undefined,
        openingMeterReading: openingMeterReading != null && openingMeterReading !== '' ? Number(openingMeterReading) : undefined,
        closingMeterReading: closingMeterReading != null && closingMeterReading !== '' ? Number(closingMeterReading) : undefined,
        totalHoursRun: totalHoursRun != null && totalHoursRun !== '' ? Number(totalHoursRun) : undefined,
        dieselOpeningStock: dieselOpeningStock != null && dieselOpeningStock !== '' ? Number(dieselOpeningStock) : undefined,
        dieselPurchasedBillNo: dieselPurchasedBillNo ?? undefined,
        litersPurchased: litersPurchased != null && litersPurchased !== '' ? Number(litersPurchased) : undefined,
        dieselClosingStock: dieselClosingStock != null && dieselClosingStock !== '' ? Number(dieselClosingStock) : undefined,
        consumptionLiters: consumptionLiters != null && consumptionLiters !== '' ? Number(consumptionLiters) : undefined,
        authorisedBy: authorisedBy ?? undefined,
        remarks: remarks ?? undefined,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateGensetLog error:", err);
    res.status(500).json({ message: "Failed to update log", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteGensetLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.gensetLog.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Log not found" }); return; }
    await prisma.gensetLog.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteGensetLog error:", err);
    res.status(500).json({ message: "Failed to delete log", error: err.message });
  }
};

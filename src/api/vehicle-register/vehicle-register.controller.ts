import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Admin/Security "Vehicle Register" — a simple movement log ported from the
// physical register format. Self-contained; no cross-model relations.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllVehicleEntries = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const where: any = {};
    if (from || to) {
      where.entryDate = {};
      if (from) where.entryDate.gte = new Date(String(from));
      if (to) where.entryDate.lte = new Date(String(to));
    }
    const rows = await prisma.vehicleRegister.findMany({ where, orderBy: { entryDate: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllVehicleEntries error:", err);
    res.status(500).json({ message: "Failed to fetch vehicle register", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getVehicleEntryById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.vehicleRegister.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Entry not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch entry", error: err.message });
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
export const createVehicleEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entryDate, employeeName, contactNo, vehicleType, vehicleRegnNo, inTime, outTime, purpose, remarks } = req.body;
    if (!entryDate || !vehicleRegnNo) {
      res.status(400).json({ message: "entryDate and vehicleRegnNo are required" });
      return;
    }
    const row = await prisma.vehicleRegister.create({
      data: {
        entryDate: new Date(entryDate),
        employeeName: employeeName ?? null,
        contactNo: contactNo ?? null,
        vehicleType: vehicleType ?? null,
        vehicleRegnNo,
        inTime: inTime ?? null,
        outTime: outTime ?? null,
        purpose: purpose ?? null,
        remarks: remarks ?? null,
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createVehicleEntry error:", err);
    res.status(500).json({ message: "Failed to create entry", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateVehicleEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.vehicleRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }

    const { entryDate, employeeName, contactNo, vehicleType, vehicleRegnNo, inTime, outTime, purpose, remarks } = req.body;
    const row = await prisma.vehicleRegister.update({
      where: { id },
      data: {
        entryDate: entryDate ? new Date(entryDate) : undefined,
        employeeName: employeeName ?? undefined,
        contactNo: contactNo ?? undefined,
        vehicleType: vehicleType ?? undefined,
        vehicleRegnNo: vehicleRegnNo ?? undefined,
        inTime: inTime ?? undefined,
        outTime: outTime ?? undefined,
        purpose: purpose ?? undefined,
        remarks: remarks ?? undefined,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateVehicleEntry error:", err);
    res.status(500).json({ message: "Failed to update entry", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteVehicleEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.vehicleRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    await prisma.vehicleRegister.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteVehicleEntry error:", err);
    res.status(500).json({ message: "Failed to delete entry", error: err.message });
  }
};

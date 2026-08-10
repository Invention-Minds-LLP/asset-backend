import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// "Rental Asset Register" — inward/outward movement log for rented assets.
// Self-contained; no cross-model relations.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllRentalEntries = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to, direction } = req.query;
    const where: any = {};
    if (from || to) {
      where.entryDate = {};
      if (from) where.entryDate.gte = new Date(String(from));
      if (to) where.entryDate.lte = new Date(String(to));
    }
    if (direction) where.direction = String(direction);
    const rows = await prisma.rentalAssetRegister.findMany({ where, orderBy: { entryDate: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllRentalEntries error:", err);
    res.status(500).json({ message: "Failed to fetch rental asset register", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getRentalEntryById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.rentalAssetRegister.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Entry not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch entry", error: err.message });
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
export const createRentalEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { direction, entryDate, vendorName, description, brand, serialOrTagNo, gatePassOrDcNo, quantity, returnableType, returnDate, handledBy, remarks } = req.body;
    if (!direction || !entryDate) {
      res.status(400).json({ message: "direction and entryDate are required" });
      return;
    }
    const row = await prisma.rentalAssetRegister.create({
      data: {
        direction,
        entryDate: new Date(entryDate),
        vendorName: vendorName ?? null,
        description: description ?? null,
        brand: brand ?? null,
        serialOrTagNo: serialOrTagNo ?? null,
        gatePassOrDcNo: gatePassOrDcNo ?? null,
        quantity: quantity ? Number(quantity) : 1,
        returnableType: returnableType ?? null,
        returnDate: returnDate ? new Date(returnDate) : null,
        handledBy: handledBy ?? null,
        remarks: remarks ?? null,
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createRentalEntry error:", err);
    res.status(500).json({ message: "Failed to create entry", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateRentalEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.rentalAssetRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }

    const { direction, entryDate, vendorName, description, brand, serialOrTagNo, gatePassOrDcNo, quantity, returnableType, returnDate, handledBy, remarks } = req.body;
    const row = await prisma.rentalAssetRegister.update({
      where: { id },
      data: {
        direction: direction ?? undefined,
        entryDate: entryDate ? new Date(entryDate) : undefined,
        vendorName: vendorName ?? undefined,
        description: description ?? undefined,
        brand: brand ?? undefined,
        serialOrTagNo: serialOrTagNo ?? undefined,
        gatePassOrDcNo: gatePassOrDcNo ?? undefined,
        quantity: quantity !== undefined ? Number(quantity) : undefined,
        returnableType: returnableType ?? undefined,
        returnDate: returnDate !== undefined ? (returnDate ? new Date(returnDate) : null) : undefined,
        handledBy: handledBy ?? undefined,
        remarks: remarks ?? undefined,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateRentalEntry error:", err);
    res.status(500).json({ message: "Failed to update entry", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteRentalEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.rentalAssetRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    await prisma.rentalAssetRegister.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteRentalEntry error:", err);
    res.status(500).json({ message: "Failed to delete entry", error: err.message });
  }
};

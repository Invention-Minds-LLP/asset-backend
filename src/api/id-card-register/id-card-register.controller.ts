import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Admin/Security "Temp ID Card Register" — a simple issuance log ported from the
// physical register format. Self-contained; no cross-model relations.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllIdCardEntries = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const where: any = {};
    if (from || to) {
      where.entryDate = {};
      if (from) where.entryDate.gte = new Date(String(from));
      if (to) where.entryDate.lte = new Date(String(to));
    }
    const rows = await prisma.idCardRegister.findMany({ where, orderBy: { entryDate: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllIdCardEntries error:", err);
    res.status(500).json({ message: "Failed to fetch ID card register", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getIdCardEntryById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.idCardRegister.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Entry not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch entry", error: err.message });
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
export const createIdCardEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entryDate, employeeName, contactNo, tempIdNo, inTime, outTime, issuedBy, remarks } = req.body;
    if (!entryDate || !employeeName) {
      res.status(400).json({ message: "entryDate and employeeName are required" });
      return;
    }
    const row = await prisma.idCardRegister.create({
      data: {
        entryDate: new Date(entryDate),
        employeeName,
        contactNo: contactNo ?? null,
        tempIdNo: tempIdNo ?? null,
        inTime: inTime ?? null,
        outTime: outTime ?? null,
        issuedBy: issuedBy ?? null,
        remarks: remarks ?? null,
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createIdCardEntry error:", err);
    res.status(500).json({ message: "Failed to create entry", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateIdCardEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.idCardRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }

    const { entryDate, employeeName, contactNo, tempIdNo, inTime, outTime, issuedBy, remarks } = req.body;
    const row = await prisma.idCardRegister.update({
      where: { id },
      data: {
        entryDate: entryDate ? new Date(entryDate) : undefined,
        employeeName: employeeName ?? undefined,
        contactNo: contactNo ?? undefined,
        tempIdNo: tempIdNo ?? undefined,
        inTime: inTime ?? undefined,
        outTime: outTime ?? undefined,
        issuedBy: issuedBy ?? undefined,
        remarks: remarks ?? undefined,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateIdCardEntry error:", err);
    res.status(500).json({ message: "Failed to update entry", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteIdCardEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.idCardRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    await prisma.idCardRegister.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteIdCardEntry error:", err);
    res.status(500).json({ message: "Failed to delete entry", error: err.message });
  }
};

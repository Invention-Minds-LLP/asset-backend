import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Admin/Security "Key Register" — a simple key issue/return log ported from the
// physical register format. Self-contained; no cross-model relations.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllKeyEntries = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const where: any = {};
    if (from || to) {
      where.entryDate = {};
      if (from) where.entryDate.gte = new Date(String(from));
      if (to) where.entryDate.lte = new Date(String(to));
    }
    const rows = await prisma.keyRegister.findMany({ where, orderBy: { entryDate: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllKeyEntries error:", err);
    res.status(500).json({ message: "Failed to fetch key register", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getKeyEntryById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.keyRegister.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Entry not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch entry", error: err.message });
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
export const createKeyEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entryDate, keyIssuedTo, cabinNameOrNo, purpose, keyReceivedTime, keyReturnTime, receiverSign, remarks } = req.body;
    if (!entryDate || !keyIssuedTo) {
      res.status(400).json({ message: "entryDate and keyIssuedTo are required" });
      return;
    }
    const row = await prisma.keyRegister.create({
      data: {
        entryDate: new Date(entryDate),
        keyIssuedTo,
        cabinNameOrNo: cabinNameOrNo ?? null,
        purpose: purpose ?? null,
        keyReceivedTime: keyReceivedTime ?? null,
        keyReturnTime: keyReturnTime ?? null,
        receiverSign: receiverSign ?? null,
        remarks: remarks ?? null,
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createKeyEntry error:", err);
    res.status(500).json({ message: "Failed to create entry", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateKeyEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.keyRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }

    const { entryDate, keyIssuedTo, cabinNameOrNo, purpose, keyReceivedTime, keyReturnTime, receiverSign, remarks } = req.body;
    const row = await prisma.keyRegister.update({
      where: { id },
      data: {
        entryDate: entryDate ? new Date(entryDate) : undefined,
        keyIssuedTo: keyIssuedTo ?? undefined,
        cabinNameOrNo: cabinNameOrNo ?? undefined,
        purpose: purpose ?? undefined,
        keyReceivedTime: keyReceivedTime ?? undefined,
        keyReturnTime: keyReturnTime ?? undefined,
        receiverSign: receiverSign ?? undefined,
        remarks: remarks ?? undefined,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateKeyEntry error:", err);
    res.status(500).json({ message: "Failed to update entry", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteKeyEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.keyRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    await prisma.keyRegister.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteKeyEntry error:", err);
    res.status(500).json({ message: "Failed to delete entry", error: err.message });
  }
};

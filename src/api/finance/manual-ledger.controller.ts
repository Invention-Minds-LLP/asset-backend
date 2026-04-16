import { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

const prisma = new PrismaClient();

async function nextEntryNo(): Promise<string> {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const prefix = `MLE-${fy}-`;
  const last = await prisma.manualLedgerEntry.findFirst({ where: { entryNo: { startsWith: prefix } }, orderBy: { entryNo: "desc" } });
  const seq = last ? parseInt(last.entryNo.split("-").pop() || "0") + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// GET /api/finance/manual-ledger
export async function listManualLedger(req: AuthenticatedRequest, res: Response) {
  const { from, to } = req.query as any;
  const where: any = {};
  if (from || to) where.entryDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  try {
    const entries = await prisma.manualLedgerEntry.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { entryDate: "desc" },
    });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: "Failed to load manual ledger" });
  }
}

// POST /api/finance/manual-ledger
export async function createManualLedger(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE") {
    res.status(403).json({ error: "FINANCE role required" }); return;
  }
  const { entryDate, narration, amount, entryType, referenceNo, attachmentUrl } = req.body;
  if (!entryDate || !narration || !amount || !entryType) {
    res.status(400).json({ error: "entryDate, narration, amount, entryType are required" }); return;
  }
  try {
    const entryNo = await nextEntryNo();
    const entry = await prisma.manualLedgerEntry.create({
      data: { entryNo, entryDate: new Date(entryDate), narration, amount, entryType, referenceNo: referenceNo || null, attachmentUrl: attachmentUrl || null, createdById: req.user.employeeDbId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create entry" });
  }
}

// DELETE /api/finance/manual-ledger/:id
export async function deleteManualLedger(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE") {
    res.status(403).json({ error: "FINANCE role required" }); return;
  }
  try {
    await prisma.manualLedgerEntry.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete entry" });
  }
}

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Admin/Security "Material Inward Register" — the gatehouse log for material /
// assets arriving on campus, especially deliveries against a Purchase Order or
// Work Order. Captures who came, why (PO/WO reference), what they brought, and
// the internal receiver. Self-contained; PO/WO links are stored as scalar ids.

const creatorId = (req: AuthenticatedRequest): number | null => {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
};

// Auto gate-inward / visit number, e.g. MIN-20260808-0001
async function generateInwardNo(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.materialInwardRegister.count({
    where: { inwardNo: { startsWith: `MIN-${dateStr}` } },
  });
  return `MIN-${dateStr}-${String(count + 1).padStart(4, "0")}`;
}

const VALID_STATUS = ["AT_GATE", "RECEIVED", "HANDED_OVER"];

// ── GET / ─────────────────────────────────────────────────────────────────────
export const getAllInwardEntries = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to, returnableType, status, referenceType } = req.query;
    const where: any = {};
    if (returnableType) where.returnableType = String(returnableType);
    if (status) where.status = String(status);
    if (referenceType) where.referenceType = String(referenceType);
    if (from || to) {
      where.entryDate = {};
      if (from) where.entryDate.gte = new Date(String(from));
      if (to) where.entryDate.lte = new Date(String(to));
    }
    const rows = await prisma.materialInwardRegister.findMany({ where, orderBy: { entryDate: "desc" } });
    res.json(rows);
  } catch (err: any) {
    console.error("getAllInwardEntries error:", err);
    res.status(500).json({ message: "Failed to fetch material inward register", error: err.message });
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
export const getInwardEntryById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) { res.status(404).json({ message: "Entry not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch entry", error: err.message });
  }
};

// Fields the client sends (excludes system-managed inwardNo / status / createdById)
function pickBody(b: any) {
  return {
    entryDate: b.entryDate,
    timeIn: b.timeIn ?? null,
    referenceType: b.referenceType ?? null,
    referenceNo: b.referenceNo ?? null,
    purchaseOrderId: b.purchaseOrderId ? Number(b.purchaseOrderId) : null,
    workOrderId: b.workOrderId ? Number(b.workOrderId) : null,
    vendorName: b.vendorName ?? null,
    deliveryPersonName: b.deliveryPersonName ?? null,
    deliveryPersonContact: b.deliveryPersonContact ?? null,
    govtIdType: b.govtIdType ?? null,
    govtIdNumber: b.govtIdNumber ?? null,
    vehicleNo: b.vehicleNo ?? null,
    vehicleType: b.vehicleType ?? null,
    dcOrInvoiceNo: b.dcOrInvoiceNo ?? null,
    ewayBillNo: b.ewayBillNo ?? null,
    returnableType: b.returnableType ?? null,
    description: b.description,
    brand: b.brand ?? null,
    serialOrTagNo: b.serialOrTagNo ?? null,
    quantity: b.quantity ? Number(b.quantity) : 1,
    packageCount: b.packageCount != null && b.packageCount !== "" ? Number(b.packageCount) : null,
    conditionOnArrival: b.conditionOnArrival ?? null,
    whomToMeet: b.whomToMeet ?? null,
    department: b.department ?? null,
    receivedBy: b.receivedBy ?? null,
    gatePassNo: b.gatePassNo ?? null,
    returnDate: b.returnDate ? new Date(b.returnDate) : null,
    securityGuardName: b.securityGuardName ?? null,
    senderAddress: b.senderAddress ?? null,
    timeOut: b.timeOut ?? null,
    remarks: b.remarks ?? null,
  };
}

// ── POST / ────────────────────────────────────────────────────────────────────
export const createInwardEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entryDate, description } = req.body;
    if (!entryDate || !description) {
      res.status(400).json({ message: "entryDate and description are required" });
      return;
    }
    const data = pickBody(req.body);
    const inwardNo = await generateInwardNo();
    const row = await prisma.materialInwardRegister.create({
      data: {
        ...data,
        entryDate: new Date(entryDate),
        inwardNo,
        status: "AT_GATE",
        createdById: creatorId(req),
      },
    });
    res.status(201).json(row);
  } catch (err: any) {
    console.error("createInwardEntry error:", err);
    res.status(500).json({ message: "Failed to create entry", error: err.message });
  }
};

// ── PUT /:id ──────────────────────────────────────────────────────────────────
export const updateInwardEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.materialInwardRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    if (!req.body.description) { res.status(400).json({ message: "description is required" }); return; }

    const data = pickBody(req.body);
    const row = await prisma.materialInwardRegister.update({
      where: { id },
      data: {
        ...data,
        entryDate: req.body.entryDate ? new Date(req.body.entryDate) : existing.entryDate,
      },
    });
    res.json(row);
  } catch (err: any) {
    console.error("updateInwardEntry error:", err);
    res.status(500).json({ message: "Failed to update entry", error: err.message });
  }
};

// ── PATCH /:id/status — AT_GATE → RECEIVED → HANDED_OVER ───────────────────────
export const updateInwardStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!status || !VALID_STATUS.includes(status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUS.join(", ")}` });
      return;
    }
    const existing = await prisma.materialInwardRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }

    const row = await prisma.materialInwardRegister.update({ where: { id }, data: { status } });
    res.json(row);
  } catch (err: any) {
    console.error("updateInwardStatus error:", err);
    res.status(500).json({ message: "Failed to update status", error: err.message });
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
export const deleteInwardEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.materialInwardRegister.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Entry not found" }); return; }
    await prisma.materialInwardRegister.delete({ where: { id } });
    res.status(204).send();
  } catch (err: any) {
    console.error("deleteInwardEntry error:", err);
    res.status(500).json({ message: "Failed to delete entry", error: err.message });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getAdminIds } from "../../utilis/notificationHelper";

// ── Auto-ref number generator ─────────────────────────────────────────────────
async function generateEWasteRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.eWasteRecord.count();
  return `EW-${year}-${String(count + 1).padStart(5, "0")}`;
}

// ── Shared include ────────────────────────────────────────────────────────────
const fullInclude = {
  asset: { select: { id: true, assetId: true, assetName: true, assetCategory: { select: { name: true } }, department: { select: { name: true } } } },
  assetDisposal: { select: { id: true, disposalType: true, estimatedScrapValue: true, actualSaleValue: true, completedAt: true } },
  hodSignedBy:         { select: { id: true, name: true, role: true } },
  operationsSignedBy:  { select: { id: true, name: true, role: true } },
  securitySignedBy:    { select: { id: true, name: true, role: true } },
  createdBy:           { select: { id: true, name: true } },
};

// ── GET /e-waste ──────────────────────────────────────────────────────────────
export const getAllEWaste = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, page = "1", limit = "20" } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status) where.status = String(status);

    // Scope non-admin to their department
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS", "SECURITY"].includes(user?.role) && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      where.assetId = { in: deptAssets.map((a) => a.id) };
    }

    const [records, total] = await Promise.all([
      prisma.eWasteRecord.findMany({ where, skip, take: limitNum, orderBy: { createdAt: "desc" }, include: fullInclude }),
      prisma.eWasteRecord.count({ where }),
    ]);

    res.json({ data: records, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err: any) {
    console.error("getAllEWaste error:", err);
    res.status(500).json({ message: "Failed to fetch e-waste records", error: err.message });
  }
};

// ── GET /e-waste/:id ──────────────────────────────────────────────────────────
export const getEWasteById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const record = await prisma.eWasteRecord.findUnique({
      where: { id: Number(req.params.id) },
      include: fullInclude,
    });
    if (!record) { res.status(404).json({ message: "E-Waste record not found" }); return; }
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch record", error: err.message });
  }
};

// ── Internal: called from disposal controller when SCRAP is COMPLETED ─────────
export async function autoCreateEWasteRecord(disposalId: number, assetId: number, createdById?: number | null) {
  try {
    const existing = await prisma.eWasteRecord.findUnique({ where: { assetDisposalId: disposalId } });
    if (existing) return existing;
    const ref = await generateEWasteRef();
    const record = await prisma.eWasteRecord.create({
      data: {
        eWasteRefNo: ref,
        assetDisposalId: disposalId,
        assetId,
        status: "PENDING_HOD",
        createdById: createdById ?? null,
      },
    });
    // Notify admins
    const adminIds = await getAdminIds();
    await notify({
      type: "EWASTE",
      title: "E-Waste Record Created",
      message: `E-Waste record ${ref} created for asset #${assetId}. HOD signature required.`,
      recipientIds: adminIds,
      assetId,
    });
    return record;
  } catch (err) {
    console.error("autoCreateEWasteRecord error:", err);
  }
}

// ── PUT /e-waste/:id/hod-sign ─────────────────────────────────────────────────
export const hodSign = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { signature, remarks, assetCondition, dataWiped, dataWipeMethod, dataWipeCertUrl, recyclerName, recyclerAuthNo, recyclerContact, handoverDate } = req.body;

    if (!signature) { res.status(400).json({ message: "Signature is required" }); return; }

    const record = await prisma.eWasteRecord.findUnique({ where: { id } });
    if (!record) { res.status(404).json({ message: "Record not found" }); return; }
    if (record.status !== "PENDING_HOD") { res.status(400).json({ message: `Cannot sign at HOD stage — current status is ${record.status}` }); return; }

    const updated = await prisma.eWasteRecord.update({
      where: { id },
      data: {
        status: "PENDING_OPERATIONS",
        hodSignedById: user.employeeDbId,
        hodSignedAt: new Date(),
        hodSignature: signature,
        hodRemarks: remarks || null,
        assetCondition: assetCondition || null,
        dataWiped: dataWiped === true || dataWiped === "true",
        dataWipeMethod: dataWipeMethod || null,
        dataWipeCertUrl: dataWipeCertUrl || null,
        recyclerName: recyclerName || null,
        recyclerAuthNo: recyclerAuthNo || null,
        recyclerContact: recyclerContact || null,
        handoverDate: handoverDate ? new Date(handoverDate) : null,
      },
      include: fullInclude,
    });

    res.json({ data: updated, message: "HOD signature recorded. Forwarded to Operations." });
  } catch (err: any) {
    console.error("hodSign error:", err);
    res.status(500).json({ message: "Failed to record HOD signature", error: err.message });
  }
};

// ── PUT /e-waste/:id/operations-sign ─────────────────────────────────────────
export const operationsSign = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { signature, remarks } = req.body;

    if (!signature) { res.status(400).json({ message: "Signature is required" }); return; }

    const record = await prisma.eWasteRecord.findUnique({ where: { id } });
    if (!record) { res.status(404).json({ message: "Record not found" }); return; }
    if (record.status !== "PENDING_OPERATIONS") { res.status(400).json({ message: `Cannot sign at Operations stage — current status is ${record.status}` }); return; }

    const updated = await prisma.eWasteRecord.update({
      where: { id },
      data: {
        status: "PENDING_SECURITY",
        operationsSignedById: user.employeeDbId,
        operationsSignedAt: new Date(),
        operationsSignature: signature,
        operationsRemarks: remarks || null,
      },
      include: fullInclude,
    });

    res.json({ data: updated, message: "Operations signature recorded. Forwarded to Security." });
  } catch (err: any) {
    console.error("operationsSign error:", err);
    res.status(500).json({ message: "Failed to record Operations signature", error: err.message });
  }
};

// ── PUT /e-waste/:id/security-sign ───────────────────────────────────────────
export const securitySign = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { signature, remarks, gatePassNo } = req.body;

    if (!signature) { res.status(400).json({ message: "Signature is required" }); return; }

    const record = await prisma.eWasteRecord.findUnique({ where: { id } });
    if (!record) { res.status(404).json({ message: "Record not found" }); return; }
    if (record.status !== "PENDING_SECURITY") { res.status(400).json({ message: `Cannot sign at Security stage — current status is ${record.status}` }); return; }

    const updated = await prisma.eWasteRecord.update({
      where: { id },
      data: {
        status: "CLOSED",
        securitySignedById: user.employeeDbId,
        securitySignedAt: new Date(),
        securitySignature: signature,
        securityRemarks: remarks || null,
        gatePassNo: gatePassNo || null,
        closedAt: new Date(),
      },
      include: fullInclude,
    });

    // Notify all admins of closure
    const adminIds = await getAdminIds();
    await notify({
      type: "EWASTE",
      title: "E-Waste Record Closed",
      message: `E-Waste record ${record.eWasteRefNo} has been fully signed and closed.`,
      recipientIds: adminIds,
      assetId: record.assetId,
    });

    res.json({ data: updated, message: "E-Waste record closed. All three stages signed." });
  } catch (err: any) {
    console.error("securitySign error:", err);
    res.status(500).json({ message: "Failed to record Security signature", error: err.message });
  }
};

// ── POST /e-waste/:id/upload-cert ────────────────────────────────────────────
export const uploadRecyclerCert = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) { res.status(400).json({ message: "No file uploaded" }); return; }

    const fileUrl = `/uploads/e-waste/${req.file.filename}`;

    const updated = await prisma.eWasteRecord.update({
      where: { id },
      data: { eWasteCertUrl: fileUrl },
      include: fullInclude,
    });

    res.json({ data: updated, message: "Recycler certificate uploaded", fileUrl });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to upload certificate", error: err.message });
  }
};

// ── PUT /e-waste/:id/update-details ──────────────────────────────────────────
// Admin can update recycler details / upload certificate before signing
export const updateEWasteDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { recyclerName, recyclerAuthNo, recyclerContact, handoverDate, eWasteCertUrl, assetDescription } = req.body;

    const updated = await prisma.eWasteRecord.update({
      where: { id },
      data: {
        recyclerName:    recyclerName    ?? undefined,
        recyclerAuthNo:  recyclerAuthNo  ?? undefined,
        recyclerContact: recyclerContact ?? undefined,
        handoverDate:    handoverDate ? new Date(handoverDate) : undefined,
        eWasteCertUrl:   eWasteCertUrl   ?? undefined,
        assetDescription: assetDescription ?? undefined,
      },
      include: fullInclude,
    });

    res.json({ data: updated, message: "Details updated" });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to update details", error: err.message });
  }
};

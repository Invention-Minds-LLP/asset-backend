import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import multer from "multer";
import fs from "fs";
import path from "path";

// ── File upload ────────────────────────────────────────────────────────────────
const uploadDir = path.join(process.cwd(), "uploads", "service-invoices");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

export const uploadStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});
export const upload = multer({ storage: uploadStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Shared include ─────────────────────────────────────────────────────────────
const fullInclude = {
  asset:               { select: { id: true, assetId: true, assetName: true } },
  vendor:              { select: { id: true, name: true } },
  ticket:              { select: { id: true, ticketId: true, description: true } },
  maintenanceSchedule: { select: { id: true, scheduleName: true } },
  calibrationSchedule: { select: { id: true, equipmentName: true } },
  serviceContract:     { select: { id: true, contractNumber: true, contractType: true } },
  createdBy:           { select: { id: true, name: true } },
  approvedBy:          { select: { id: true, name: true } },
};

// ── GET /service-invoices ─────────────────────────────────────────────────────
export const getAll = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, vendorId, assetId, page = "1", limit = "25" } = req.query;
    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));

    const where: any = {};
    if (status)   where.status   = String(status);
    if (vendorId) where.vendorId = Number(vendorId);
    if (assetId)  where.assetId  = Number(assetId);

    const [total, records] = await Promise.all([
      prisma.serviceInvoice.count({ where }),
      prisma.serviceInvoice.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { invoiceDate: "desc" },
        include: fullInclude,
      }),
    ]);

    res.json({ data: records, pagination: { total, page: pageNum, limit: limitNum } });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch service invoices", error: err.message });
  }
};

// ── GET /service-invoices/:id ─────────────────────────────────────────────────
export const getById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const record = await prisma.serviceInvoice.findUnique({
      where: { id: Number(req.params.id) },
      include: fullInclude,
    });
    if (!record) { res.status(404).json({ message: "Invoice not found" }); return; }
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch invoice", error: err.message });
  }
};

// ── POST /service-invoices ────────────────────────────────────────────────────
export const create = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      invoiceNo, invoiceDate, dueDate,
      ticketId, maintenanceScheduleId, calibrationScheduleId, serviceContractId,
      assetId, vendorId,
      invoiceAmount, gstPct, tdsAmount,
      serviceDescription, remarks,
    } = req.body;

    if (!invoiceNo || !invoiceDate || !invoiceAmount) {
      res.status(400).json({ message: "invoiceNo, invoiceDate and invoiceAmount are required" }); return;
    }

    const amt  = Number(invoiceAmount);
    const gst  = Number(gstPct ?? 18);
    const tds  = Number(tdsAmount ?? 0);
    const gstAmt = Math.round(amt * gst / 100 * 100) / 100;
    const netAmt = Math.round((amt + gstAmt) * 100) / 100;
    const payable = Math.round((netAmt - tds) * 100) / 100;

    const record = await prisma.serviceInvoice.create({
      data: {
        invoiceNo, invoiceDate: new Date(invoiceDate),
        dueDate: dueDate ? new Date(dueDate) : null,
        ticketId:             ticketId             ? Number(ticketId)             : null,
        maintenanceScheduleId: maintenanceScheduleId ? Number(maintenanceScheduleId) : null,
        calibrationScheduleId: calibrationScheduleId ? Number(calibrationScheduleId) : null,
        serviceContractId:    serviceContractId    ? Number(serviceContractId)    : null,
        assetId:  assetId  ? Number(assetId)  : null,
        vendorId: vendorId ? Number(vendorId) : null,
        invoiceAmount: amt, gstPct: gst, gstAmount: gstAmt,
        netAmount: netAmt, tdsAmount: tds, payableAmount: payable,
        serviceDescription: serviceDescription || null,
        remarks: remarks || null,
        status: "PENDING_APPROVAL",
        createdById: user?.employeeDbId ?? null,
      },
      include: fullInclude,
    });

    res.status(201).json({ data: record, message: "Service invoice created" });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to create invoice", error: err.message });
  }
};

// ── PUT /service-invoices/:id/approve ─────────────────────────────────────────
export const approve = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const record = await prisma.serviceInvoice.findUnique({ where: { id } });
    if (!record) { res.status(404).json({ message: "Invoice not found" }); return; }
    if (record.status !== "PENDING_APPROVAL") {
      res.status(400).json({ message: `Cannot approve — current status is ${record.status}` }); return;
    }
    const updated = await prisma.serviceInvoice.update({
      where: { id },
      data: { status: "APPROVED", approvedById: user?.employeeDbId ?? null },
      include: fullInclude,
    });
    res.json({ data: updated, message: "Invoice approved" });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to approve", error: err.message });
  }
};

// ── PUT /service-invoices/:id/reject ──────────────────────────────────────────
export const reject = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { remarks } = req.body;
    const record = await prisma.serviceInvoice.findUnique({ where: { id } });
    if (!record) { res.status(404).json({ message: "Invoice not found" }); return; }
    if (record.status !== "PENDING_APPROVAL") {
      res.status(400).json({ message: `Cannot reject — status is ${record.status}` }); return;
    }
    const updated = await prisma.serviceInvoice.update({
      where: { id },
      data: { status: "REJECTED", remarks: remarks || record.remarks },
      include: fullInclude,
    });
    res.json({ data: updated, message: "Invoice rejected" });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to reject", error: err.message });
  }
};

// ── PUT /service-invoices/:id/mark-paid ───────────────────────────────────────
export const markPaid = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { paymentMode, paymentRef } = req.body;
    const record = await prisma.serviceInvoice.findUnique({ where: { id } });
    if (!record) { res.status(404).json({ message: "Invoice not found" }); return; }
    if (record.status !== "APPROVED") {
      res.status(400).json({ message: "Invoice must be APPROVED before marking as paid" }); return;
    }
    const updated = await prisma.serviceInvoice.update({
      where: { id },
      data: { status: "PAID", paidAt: new Date(), paymentMode: paymentMode || null, paymentRef: paymentRef || null },
      include: fullInclude,
    });
    res.json({ data: updated, message: "Invoice marked as paid" });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to mark paid", error: err.message });
  }
};

// ── POST /service-invoices/:id/upload ─────────────────────────────────────────
export const uploadDoc = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) { res.status(400).json({ message: "No file uploaded" }); return; }
    const fileUrl = `/uploads/service-invoices/${req.file.filename}`;
    const updated = await prisma.serviceInvoice.update({
      where: { id }, data: { fileUrl }, include: fullInclude,
    });
    res.json({ data: updated, message: "Document uploaded", fileUrl });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to upload", error: err.message });
  }
};

// ── GET /service-invoices/stats ────────────────────────────────────────────────
export const getStats = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [pending, approved, paid, rejected, totalPayable] = await Promise.all([
      prisma.serviceInvoice.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.serviceInvoice.count({ where: { status: "APPROVED" } }),
      prisma.serviceInvoice.count({ where: { status: "PAID" } }),
      prisma.serviceInvoice.count({ where: { status: "REJECTED" } }),
      prisma.serviceInvoice.aggregate({ where: { status: { in: ["APPROVED", "PENDING_APPROVAL"] } }, _sum: { payableAmount: true } }),
    ]);
    res.json({
      pending, approved, paid, rejected,
      totalPayable: Number(totalPayable._sum.payableAmount ?? 0),
    });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch stats", error: err.message });
  }
};

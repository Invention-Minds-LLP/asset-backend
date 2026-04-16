import { Response } from "express";
import prisma from "../../../prismaClient";
import { AuthenticatedRequest } from "../../../middleware/authMiddleware";
import { logAction } from "../../audit-trail/audit-trail.controller";

async function generatePMTNumber(): Promise<string> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const fyStart = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEnd = fyStart + 1;
  const fy = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
  const latest = await prisma.paymentVoucher.findFirst({
    where: { voucherNo: { startsWith: `PMT-${fy}` } },
    orderBy: { id: "desc" },
  });
  let seq = 1;
  if (latest) {
    const parts = latest.voucherNo.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `PMT-${fy}-${seq.toString().padStart(3, "0")}`;
}

// GET /
export const getAllPaymentVouchers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, vendorId, purchaseVoucherId, page, limit: lim } = req.query;
    const where: any = {};
    if (status) where.status = String(status);
    if (vendorId) where.vendorId = Number(vendorId);
    if (purchaseVoucherId) where.purchaseVoucherId = Number(purchaseVoucherId);

    const pageNum = page ? parseInt(String(page)) : 1;
    const take = lim ? parseInt(String(lim)) : 20;
    const skip = (pageNum - 1) * take;

    const [total, vouchers] = await Promise.all([
      prisma.paymentVoucher.count({ where }),
      prisma.paymentVoucher.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          purchaseVoucher: { select: { id: true, voucherNo: true, amount: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { id: "desc" },
        skip,
        take,
      }),
    ]);
    res.json({ data: vouchers, total, page: pageNum, limit: take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch payment vouchers" });
  }
};

// GET /:id
export const getPaymentVoucherById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const voucher = await prisma.paymentVoucher.findUnique({
      where: { id },
      include: {
        vendor: true,
        purchaseVoucher: { select: { id: true, voucherNo: true, amount: true, invoiceNo: true } },
        createdBy: { select: { id: true, name: true, employeeID: true } },
        approvedBy: { select: { id: true, name: true, employeeID: true } },
        journalEntries: { select: { id: true, entryNo: true, entryDate: true, totalAmount: true } },
      },
    });
    if (!voucher) { res.status(404).json({ message: "Payment voucher not found" }); return; }
    res.json(voucher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch payment voucher" });
  }
};

// POST /
export const createPaymentVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { voucherDate, amount, paymentMode, bankReference, bankName, narration, purchaseVoucherId, vendorId } = req.body;
    if (!voucherDate || !amount || !paymentMode) {
      res.status(400).json({ message: "voucherDate, amount and paymentMode are required" }); return;
    }

    const voucherNo = await generatePMTNumber();
    const voucher = await prisma.paymentVoucher.create({
      data: {
        voucherNo,
        voucherDate: new Date(voucherDate),
        amount: parseFloat(amount),
        paymentMode,
        bankReference: bankReference ?? null,
        bankName: bankName ?? null,
        narration: narration ?? null,
        purchaseVoucherId: purchaseVoucherId ? Number(purchaseVoucherId) : null,
        vendorId: vendorId ? Number(vendorId) : null,
        createdById: user?.employeeDbId ?? null,
        status: "DRAFT",
      } as any,
    });

    logAction({ entityType: "PAYMENT_VOUCHER", entityId: voucher.id, action: "CREATE", description: `Payment voucher ${voucherNo} created`, performedById: user?.employeeDbId });
    res.status(201).json(voucher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create payment voucher" });
  }
};

// PUT /:id
export const updatePaymentVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const existing = await prisma.paymentVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (existing.status === "POSTED") { res.status(400).json({ message: "Cannot edit a posted voucher" }); return; }

    const { voucherDate, amount, paymentMode, bankReference, bankName, narration } = req.body;
    const updated = await prisma.paymentVoucher.update({
      where: { id },
      data: {
        voucherDate: voucherDate ? new Date(voucherDate) : undefined,
        amount: amount ? parseFloat(amount) : undefined,
        paymentMode: paymentMode ?? undefined,
        bankReference: bankReference ?? undefined,
        bankName: bankName ?? undefined,
        narration: narration ?? undefined,
      },
    });
    logAction({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "UPDATE", description: `Payment voucher ${updated.voucherNo} updated`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update payment voucher" });
  }
};

// PATCH /:id/approve
export const approvePaymentVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const { remarks } = req.body;
    const existing = await prisma.paymentVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (!["DRAFT", "PENDING_APPROVAL"].includes(existing.status)) {
      res.status(400).json({ message: "Voucher is not approvable" }); return;
    }
    const updated = await prisma.paymentVoucher.update({
      where: { id },
      data: { status: "APPROVED", approvedById: user?.employeeDbId ?? null, approvedAt: new Date(), approvalRemarks: remarks ?? null },
    });
    logAction({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "APPROVE", description: `Payment voucher ${updated.voucherNo} approved`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to approve payment voucher" });
  }
};

// PATCH /:id/post
export const postPaymentVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const existing = await prisma.paymentVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (existing.status !== "APPROVED") {
      res.status(400).json({ message: "Only approved vouchers can be posted" }); return;
    }
    const updated = await prisma.paymentVoucher.update({ where: { id }, data: { status: "POSTED" } });
    logAction({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "POST", description: `Payment voucher ${updated.voucherNo} posted`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to post payment voucher" });
  }
};

// PATCH /:id/cancel
export const cancelPaymentVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const existing = await prisma.paymentVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (existing.status === "POSTED") {
      res.status(400).json({ message: "Cannot cancel a posted voucher" }); return;
    }
    const updated = await prisma.paymentVoucher.update({ where: { id }, data: { status: "CANCELLED" } });
    logAction({ entityType: "PAYMENT_VOUCHER", entityId: id, action: "CANCEL", description: `Payment voucher ${updated.voucherNo} cancelled`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to cancel payment voucher" });
  }
};

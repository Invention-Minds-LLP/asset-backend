import { Response } from "express";
import prisma from "../../../prismaClient";
import { AuthenticatedRequest } from "../../../middleware/authMiddleware";
import { logAction } from "../../audit-trail/audit-trail.controller";

// ── Number generator ─────────────────────────────────────────────────────────
async function generatePVNumber(): Promise<string> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const fyStart = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEnd = fyStart + 1;
  const fy = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
  const latest = await prisma.purchaseVoucher.findFirst({
    where: { voucherNo: { startsWith: `PV-${fy}` } },
    orderBy: { id: "desc" },
  });
  let seq = 1;
  if (latest) {
    const parts = latest.voucherNo.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `PV-${fy}-${seq.toString().padStart(3, "0")}`;
}

// GET /
export const getAllPurchaseVouchers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, vendorId, page, limit: lim } = req.query;
    const where: any = {};
    if (status) where.status = String(status);
    if (vendorId) where.vendorId = Number(vendorId);

    const pageNum = page ? parseInt(String(page)) : 1;
    const take = lim ? parseInt(String(lim)) : 20;
    const skip = (pageNum - 1) * take;

    const [total, vouchers] = await Promise.all([
      prisma.purchaseVoucher.count({ where }),
      prisma.purchaseVoucher.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          asset: { select: { id: true, assetId: true, assetName: true } },
          goodsReceipt: { select: { id: true, grnNumber: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          _count: { select: { paymentVouchers: true } },
        },
        orderBy: { id: "desc" },
        skip,
        take,
      }),
    ]);
    res.json({ data: vouchers, total, page: pageNum, limit: take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch purchase vouchers" });
  }
};

// GET /:id
export const getPurchaseVoucherById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const voucher = await prisma.purchaseVoucher.findUnique({
      where: { id },
      include: {
        vendor: true,
        asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true } },
        goodsReceipt: { select: { id: true, grnNumber: true, grnDate: true } },
        createdBy: { select: { id: true, name: true, employeeID: true } },
        approvedBy: { select: { id: true, name: true, employeeID: true } },
        paymentVouchers: { select: { id: true, voucherNo: true, amount: true, status: true, voucherDate: true } },
        journalEntries: { select: { id: true, entryNo: true, entryDate: true, totalAmount: true } },
      },
    });
    if (!voucher) { res.status(404).json({ message: "Purchase voucher not found" }); return; }
    res.json(voucher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch purchase voucher" });
  }
};

// POST /
export const createPurchaseVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { voucherDate, amount, narration, assetId, goodsReceiptId, vendorId, invoiceNo, invoiceDate, invoiceAmount, attachmentUrl } = req.body;

    if (!voucherDate || !amount) {
      res.status(400).json({ message: "voucherDate and amount are required" }); return;
    }

    const voucherNo = await generatePVNumber();

    const voucher = await prisma.purchaseVoucher.create({
      data: {
        voucherNo,
        voucherDate: new Date(voucherDate),
        amount: parseFloat(amount),
        narration: narration ?? null,
        assetId: assetId ? Number(assetId) : null,
        goodsReceiptId: goodsReceiptId ? Number(goodsReceiptId) : null,
        vendorId: vendorId ? Number(vendorId) : null,
        invoiceNo: invoiceNo ?? null,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
        invoiceAmount: invoiceAmount ? parseFloat(invoiceAmount) : null,
        attachmentUrl: attachmentUrl ?? null,
        createdById: user?.employeeDbId ?? null,
        status: "DRAFT",
      } as any,
    });

    // If linked to an asset, update the asset's purchaseVoucherNo/Date/Id
    if (assetId) {
      await prisma.asset.update({
        where: { id: Number(assetId) },
        data: {
          purchaseVoucherNo: voucherNo,
          purchaseVoucherDate: new Date(voucherDate),
          purchaseVoucherId: voucher.id,
        } as any,
      });
    }

    logAction({ entityType: "PURCHASE_VOUCHER", entityId: voucher.id, action: "CREATE", description: `Purchase voucher ${voucherNo} created`, performedById: user?.employeeDbId });
    res.status(201).json(voucher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create purchase voucher" });
  }
};

// PUT /:id
export const updatePurchaseVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const existing = await prisma.purchaseVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Purchase voucher not found" }); return; }
    if (existing.status === "POSTED") { res.status(400).json({ message: "Cannot edit a posted voucher" }); return; }

    const { voucherDate, amount, narration, vendorId, invoiceNo, invoiceDate, invoiceAmount, attachmentUrl } = req.body;
    const updated = await prisma.purchaseVoucher.update({
      where: { id },
      data: {
        voucherDate: voucherDate ? new Date(voucherDate) : undefined,
        amount: amount ? parseFloat(amount) : undefined,
        narration: narration ?? undefined,
        vendorId: vendorId ? Number(vendorId) : undefined,
        invoiceNo: invoiceNo ?? undefined,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        invoiceAmount: invoiceAmount ? parseFloat(invoiceAmount) : undefined,
        attachmentUrl: attachmentUrl ?? undefined,
      },
    });
    logAction({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "UPDATE", description: `Purchase voucher ${updated.voucherNo} updated`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update purchase voucher" });
  }
};

// PATCH /:id/approve
export const approvePurchaseVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const { remarks } = req.body;
    const existing = await prisma.purchaseVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (!["DRAFT", "PENDING_APPROVAL"].includes(existing.status)) {
      res.status(400).json({ message: "Voucher is not in an approvable state" }); return;
    }
    const updated = await prisma.purchaseVoucher.update({
      where: { id },
      data: { status: "APPROVED", approvedById: user?.employeeDbId ?? null, approvedAt: new Date(), approvalRemarks: remarks ?? null },
    });
    logAction({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "APPROVE", description: `Purchase voucher ${updated.voucherNo} approved`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to approve purchase voucher" });
  }
};

// PATCH /:id/post
export const postPurchaseVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const existing = await prisma.purchaseVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (existing.status !== "APPROVED") {
      res.status(400).json({ message: "Only approved vouchers can be posted" }); return;
    }
    const updated = await prisma.purchaseVoucher.update({ where: { id }, data: { status: "POSTED" } });
    logAction({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "POST", description: `Purchase voucher ${updated.voucherNo} posted to ledger`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to post purchase voucher" });
  }
};

// PATCH /:id/cancel
export const cancelPurchaseVoucher = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const existing = await prisma.purchaseVoucher.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: "Not found" }); return; }
    if (existing.status === "POSTED") {
      res.status(400).json({ message: "Cannot cancel a posted voucher" }); return;
    }
    const updated = await prisma.purchaseVoucher.update({ where: { id }, data: { status: "CANCELLED" } });
    logAction({ entityType: "PURCHASE_VOUCHER", entityId: id, action: "CANCEL", description: `Purchase voucher ${updated.voucherNo} cancelled`, performedById: user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to cancel purchase voucher" });
  }
};

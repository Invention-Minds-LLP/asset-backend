import { Request, Response } from "express";
import prisma from "../../../prismaClient";

// GET /api/accounts/summary  — dashboard KPIs
export const getAccountsSummary = async (_req: Request, res: Response) => {
  try {
    const [
      totalPV,
      postedPV,
      pendingPV,
      draftPV,
      totalPMT,
      postedPMT,
      pendingPMT,
      totalJE,
      totalCOA,
    ] = await Promise.all([
      prisma.purchaseVoucher.count(),
      prisma.purchaseVoucher.count({ where: { status: "POSTED" } }),
      prisma.purchaseVoucher.count({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } } }),
      prisma.purchaseVoucher.count({ where: { status: "DRAFT" } }),
      prisma.paymentVoucher.count(),
      prisma.paymentVoucher.count({ where: { status: "POSTED" } }),
      prisma.paymentVoucher.count({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } } }),
      prisma.journalEntry.count(),
      prisma.chartOfAccount.count({ where: { isActive: true } }),
    ]);

    const pvAmounts = await prisma.purchaseVoucher.aggregate({
      _sum: { amount: true },
      where: { status: "POSTED" },
    });
    const pmtAmounts = await prisma.paymentVoucher.aggregate({
      _sum: { amount: true },
      where: { status: "POSTED" },
    });

    // Recent purchase vouchers (last 10)
    const recentPV = await prisma.purchaseVoucher.findMany({
      orderBy: { id: "desc" },
      take: 10,
      select: { id: true, voucherNo: true, voucherDate: true, amount: true, status: true, vendor: { select: { name: true } } },
    });

    // Recent payments
    const recentPMT = await prisma.paymentVoucher.findMany({
      orderBy: { id: "desc" },
      take: 10,
      select: { id: true, voucherNo: true, voucherDate: true, amount: true, paymentMode: true, status: true, vendor: { select: { name: true } } },
    });

    res.json({
      purchaseVouchers: { total: totalPV, posted: postedPV, pending: pendingPV, draft: draftPV, postedAmount: pvAmounts._sum.amount ?? 0 },
      paymentVouchers: { total: totalPMT, posted: postedPMT, pending: pendingPMT, postedAmount: pmtAmounts._sum.amount ?? 0 },
      journalEntries: { total: totalJE },
      chartOfAccounts: { total: totalCOA },
      recentPurchaseVouchers: recentPV,
      recentPaymentVouchers: recentPMT,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch accounts summary" });
  }
};

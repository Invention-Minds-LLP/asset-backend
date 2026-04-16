import { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

const prisma = new PrismaClient();

// GET /api/finance/trial-balance?from=&to=
export async function getTrialBalance(req: AuthenticatedRequest, res: Response) {
  const { from, to } = req.query as any;
  try {
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const lines = await prisma.financeVoucherLine.findMany({
      where: {
        voucher: {
          status: "POSTED",
          ...(Object.keys(dateFilter).length ? { voucherDate: dateFilter } : {}),
        },
      },
      include: { account: true },
    });

    const accountMap: Record<number, { code: string; name: string; type: string; debit: number; credit: number }> = {};
    for (const line of lines) {
      const id = line.accountId;
      if (!accountMap[id]) {
        accountMap[id] = { code: line.account.code, name: line.account.name, type: line.account.type, debit: 0, credit: 0 };
      }
      accountMap[id].debit += Number(line.debit);
      accountMap[id].credit += Number(line.credit);
    }

    const rows = Object.values(accountMap).sort((a, b) => a.code.localeCompare(b.code));
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

    res.json({ rows, totalDebit, totalCredit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate trial balance" });
  }
}

// GET /api/finance/asset-cost-ledger/:assetId
export async function getAssetCostLedger(req: AuthenticatedRequest, res: Response) {
  const assetId = Number(req.params.assetId);
  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, assetId: true, assetName: true, purchaseCost: true } });
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    const vouchers = await prisma.financeVoucher.findMany({
      where: { sourceId: assetId, status: "POSTED" },
      include: { lines: { include: { account: true } } },
      orderBy: { voucherDate: "asc" },
    });

    res.json({ asset, vouchers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load asset cost ledger" });
  }
}

// GET /api/finance/department-cost-summary?fiscalYear=
export async function getDepartmentCostSummary(req: AuthenticatedRequest, res: Response) {
  const now = new Date();
  const fy = parseInt((req.query.fiscalYear as string) || String(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1));
  const fyStart = new Date(`${fy}-04-01`);
  const fyEnd = new Date(`${fy + 1}-03-31`);
  try {
    const lines = await prisma.financeVoucherLine.findMany({
      where: {
        costCentreId: { not: null },
        voucher: { status: "POSTED", voucherDate: { gte: fyStart, lte: fyEnd } },
      },
      include: { costCentre: true, voucher: { select: { sourceType: true, voucherDate: true } } },
    });

    const deptMap: Record<number, { deptName: string; totalDebit: number; totalCredit: number; bySource: Record<string, number> }> = {};
    for (const line of lines) {
      const id = line.costCentreId!;
      if (!deptMap[id]) deptMap[id] = { deptName: line.costCentre?.name || "", totalDebit: 0, totalCredit: 0, bySource: {} };
      deptMap[id].totalDebit += Number(line.debit);
      deptMap[id].totalCredit += Number(line.credit);
      const src = line.voucher.sourceType;
      deptMap[id].bySource[src] = (deptMap[id].bySource[src] || 0) + Number(line.debit);
    }

    res.json(Object.values(deptMap).sort((a, b) => b.totalDebit - a.totalDebit));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load department cost summary" });
  }
}

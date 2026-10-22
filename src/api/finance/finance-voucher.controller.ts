import { Response } from "express";
import { PrismaClient, FinanceVoucherStatus } from "@prisma/client";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { fyLockMessage, getLockedYears, isLocked } from "../../utilis/fyLock";

const prisma = new PrismaClient();

/**
 * Financial-year lock. Anything that puts an entry into the ledger, or changes
 * one that's there, is refused for a date in a finalized year (or one awaiting
 * CFO finalization). Clearing out a voucher that was never posted is allowed —
 * it isn't in the books. Answers with both `error` (this module's convention)
 * and `message`.
 */
async function refuseIfLocked(res: Response, dates: { label: string; date: any }[]): Promise<boolean> {
  const msg = await fyLockMessage(dates);
  if (msg) {
    res.status(409).json({ error: msg, message: msg, code: "FY_LOCKED" });
    return true;
  }
  return false;
}

const voucherInclude = {
  lines: { include: { account: true, costCentre: true } },
  department: true,
  batchRun: true,
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
};

// ─── Sequence generator ────────────────────────────────────────────────
async function nextVoucherNo(): Promise<string> {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const prefix = `FV-FY${fy}-`;
  const last = await prisma.financeVoucher.findFirst({
    where: { voucherNo: { startsWith: prefix } },
    orderBy: { voucherNo: "desc" },
  });
  const seq = last ? parseInt(last.voucherNo.split("-").pop() || "0") + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// GET /api/finance/vouchers
export async function listVouchers(req: AuthenticatedRequest, res: Response) {
  const { status, sourceType, from, to, page = "1", limit = "20" } = req.query as any;
  const where: any = {};
  if (status) where.status = status;
  if (sourceType) where.sourceType = sourceType;
  if (from || to) where.voucherDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  const skip = (parseInt(page) - 1) * parseInt(limit);
  try {
    const [data, total] = await Promise.all([
      prisma.financeVoucher.findMany({ where, include: voucherInclude, orderBy: { voucherDate: "desc" }, skip, take: parseInt(limit) }),
      prisma.financeVoucher.count({ where }),
    ]);
    res.json({ data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load vouchers" });
  }
}

// GET /api/finance/vouchers/:id
export async function getVoucher(req: AuthenticatedRequest, res: Response) {
  try {
    const v = await prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) }, include: voucherInclude });
    if (!v) { res.status(404).json({ error: "Voucher not found" }); return; }
    res.json(v);
  } catch (err) {
    res.status(500).json({ error: "Failed to load voucher" });
  }
}

// POST /api/finance/vouchers  (manual entry)
export async function createVoucher(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE" && req.user.role !== "CFO") {
    res.status(403).json({ error: "FINANCE or CFO role required" }); return;
  }
  const { voucherDate, narration, sourceType = "MANUAL", departmentId, lines } = req.body;
  if (!lines || !Array.isArray(lines) || lines.length < 2) {
    res.status(400).json({ error: "Minimum 2 lines required" }); return;
  }
  const totalDebit = lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    res.status(400).json({ error: "Debit and Credit must balance" }); return;
  }
  try {
    if (await refuseIfLocked(res, [{ label: "voucher date", date: voucherDate }])) return;
    const voucherNo = await nextVoucherNo();
    const config = await prisma.financeConfig.findFirst();
    const status: FinanceVoucherStatus = config?.requireApproval ? "DRAFT" : "POSTED";
    const voucher = await prisma.financeVoucher.create({
      data: {
        voucherNo,
        voucherDate: new Date(voucherDate),
        narration,
        sourceType,
        totalDebit,
        totalCredit,
        status,
        departmentId: departmentId || null,
        createdById: req.user.employeeDbId,
        lines: {
          create: lines.map((l: any) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            narration: l.narration || null,
            costCentreId: l.costCentreId || null,
          })),
        },
      },
      include: voucherInclude,
    });
    res.status(201).json(voucher);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create voucher" });
  }
}

// POST /api/finance/vouchers/:id/approve
export async function approveVoucher(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE" && req.user.role !== "CFO") {
    res.status(403).json({ error: "FINANCE or CFO role required" }); return;
  }
  try {
    const v = await prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) } });
    if (!v) { res.status(404).json({ error: "Voucher not found" }); return; }
    if (v.status !== "DRAFT" && v.status !== "PENDING_APPROVAL") {
      res.status(400).json({ error: `Cannot approve voucher in ${v.status} status` }); return;
    }
    // Approving posts it to the ledger.
    if (await refuseIfLocked(res, [{ label: "voucher date", date: v.voucherDate }])) return;
    const updated = await prisma.financeVoucher.update({
      where: { id: v.id },
      data: { status: "POSTED", approvedById: req.user.employeeDbId, approvedAt: new Date() },
      include: voucherInclude,
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve voucher" });
  }
}

// POST /api/finance/vouchers/:id/reject
export async function rejectVoucher(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE" && req.user.role !== "CFO") {
    res.status(403).json({ error: "FINANCE or CFO role required" }); return;
  }
  const { reason } = req.body;
  try {
    const v = await prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) } });
    if (!v) { res.status(404).json({ error: "Voucher not found" }); return; }
    // Rejecting an unposted voucher is cleanup; rejecting a POSTED one takes it
    // out of the books, which a closed year can't allow.
    if (v.status === "POSTED" && await refuseIfLocked(res, [{ label: "voucher date", date: v.voucherDate }])) return;
    const updated = await prisma.financeVoucher.update({
      where: { id: v.id },
      data: { status: "REJECTED", rejectionReason: reason || null, approvedById: req.user.employeeDbId, approvedAt: new Date() },
      include: voucherInclude,
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject voucher" });
  }
}

// POST /api/finance/vouchers/:id/void
export async function voidVoucher(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE" && req.user.role !== "CFO") {
    res.status(403).json({ error: "FINANCE or CFO role required" }); return;
  }
  try {
    const v = await prisma.financeVoucher.findUnique({ where: { id: Number(req.params.id) } });
    if (!v) { res.status(404).json({ error: "Voucher not found" }); return; }
    if (v.status === "VOID") { res.status(400).json({ error: "Already voided" }); return; }
    // Voiding a POSTED voucher reverses a ledger entry — not in a closed year.
    if (v.status === "POSTED" && await refuseIfLocked(res, [{ label: "voucher date", date: v.voucherDate }])) return;
    const updated = await prisma.financeVoucher.update({
      where: { id: v.id },
      data: { status: "VOID" },
      include: voucherInclude,
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to void voucher" });
  }
}

// ─── Auto-Voucher helper (called internally from other controllers) ─────────
/** What createAutoVoucher actually did — a caller must not report "posted" otherwise. */
export type AutoVoucherResult =
  | { created: true; status: FinanceVoucherStatus; voucherNo: string }
  | { created: false; reason: "AUTO_VOUCHER_OFF" | "LOCKED_YEAR" | "UNBALANCED" };

export async function createAutoVoucher(params: {
  sourceType: string;
  sourceId: number;
  voucherDate: Date;
  narration: string;
  departmentId?: number;
  batchRunId?: number;
  createdById?: number;
  lines: { accountId: number; debit: number; credit: number; narration?: string; costCentreId?: number }[];
}): Promise<AutoVoucherResult> {
  const config = await prisma.financeConfig.findFirst();
  if (!config?.autoVoucher) return { created: false, reason: "AUTO_VOUCHER_OFF" };

  // Defence in depth: callers already refuse locked years before getting here
  // (depreciation approval, reclassification), but an automatic entry must
  // never land in a closed year whatever calls it.
  if (isLocked(await getLockedYears(), params.voucherDate)) {
    console.warn(`Auto-voucher (${params.sourceType} #${params.sourceId}) not created: its date falls in a locked financial year.`);
    return { created: false, reason: "LOCKED_YEAR" };
  }

  const totalDebit = params.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = params.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    console.warn(`Auto-voucher (${params.sourceType} #${params.sourceId}) not created: debits ${totalDebit} ≠ credits ${totalCredit}.`);
    return { created: false, reason: "UNBALANCED" };
  }

  const voucherNo = await nextVoucherNo();
  const status: FinanceVoucherStatus = config.requireApproval ? "DRAFT" : "POSTED";

  await prisma.financeVoucher.create({
    data: {
      voucherNo,
      voucherDate: params.voucherDate,
      narration: params.narration,
      sourceType: params.sourceType as any,
      sourceId: params.sourceId,
      totalDebit,
      totalCredit,
      status,
      departmentId: params.departmentId || null,
      batchRunId: params.batchRunId || null,
      createdById: params.createdById || null,
      lines: { create: params.lines },
    },
  });
  return { created: true, status, voucherNo };
}

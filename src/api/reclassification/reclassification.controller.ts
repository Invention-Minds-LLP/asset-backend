/**
 * Asset reclassification — correct an asset's category (and depreciation
 * settings) from 1 April of the current financial year, without touching any
 * past year.
 *
 *   FINANCE / CFO  POST /            raise a request (one or many assets)
 *   CFO            POST /:id/approve applied; GL reclass voucher posted
 *   CFO            POST /:id/reject
 *   requester      POST /:id/cancel  while still pending
 *   FINANCE / CFO  POST /:id/post-gl re-try the GL entry of an approved request
 *   FINANCE / CFO / ADMIN            everything else is read-only, for them only
 *
 * Why past years stay put: an asset acquired before this year can only be
 * reclassified once the previous year is FINALIZED. Its past figures then live
 * in the year-end snapshot (served by the FA Schedule), and this year opens from
 * that frozen closing value (resolveOpeningWdv → FINALIZED_YEAR) at the new rate.
 */
import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getCfoIds, getFinanceApproverIds } from "../../utilis/notificationHelper";
import { getFYContext, resolveOpeningWdv, LIVE_LOG_STATUSES } from "../../utilis/depreciationEngine";
import { getLockedYears, fyLabelOf, acquisitionDateOf } from "../../utilis/fyLock";
import { createAutoVoucher } from "../finance/finance-voucher.controller";
import { logAction } from "../audit-trail/audit-trail.controller";

const actorId = (req: AuthenticatedRequest) => (req.user as any)?.employeeDbId ?? null;
const roleOf = (req: AuthenticatedRequest) => String((req.user as any)?.role ?? "");
const MAX_ASSETS = 2000;

/** Requests carry asset costs and the CFO's decisions — not for every logged-in user. */
const READ_ROLES = ["FINANCE", "CFO", "ADMIN"];
function refuseUnlessReader(req: AuthenticatedRequest, res: Response): boolean {
  if (READ_ROLES.includes(roleOf(req))) return false;
  res.status(403).json({ message: "Only Finance, the CFO or an admin can view reclassifications." });
  return true;
}

/** A request carries new depreciation settings that must land on each asset. */
const hasNewSettings = (r: { newMethod: any; newRate: any; newLifeYears: any }) =>
  r.newMethod != null || r.newRate != null || r.newLifeYears != null;

type LineDraft = {
  assetId: number;
  assetCode: string;
  assetName: string;
  fromCategoryId: number | null;
  fromCategoryName: string;
  oldMethod: string | null;
  oldRate: number | null;
  oldLifeYears: number | null;
  grossBlock: number;
  accDepAtEffective: number;
  openingWdvAtEffective: number;
  openingSource: string;
};
type LineError = { assetId: number; assetCode?: string; assetName?: string; message: string };

/**
 * Checks each asset and, for the eligible ones, works out its position on the
 * effective date. Shared by preview, create and approve (which re-checks, since
 * things can change between request and approval).
 */
async function evaluate(
  assetIds: number[],
  toCategoryId: number,
  opts: { ignoreRequestId?: number; newSettings?: boolean } = {},
) {
  const ctx = getFYContext(new Date());
  const fiscalYear = ctx.fyStart.getFullYear();
  const locked = await getLockedYears();
  const prevFinalized = locked.get(fiscalYear - 1) === "FINALIZED";

  const toCategory = await prisma.assetCategory.findUnique({ where: { id: toCategoryId } });

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    include: {
      assetCategory: { select: { id: true, name: true } },
      depreciation: true,
    },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));

  // Assets already in another pending request.
  const pending = await prisma.assetReclassLine.findMany({
    where: {
      assetId: { in: assetIds },
      request: { status: "PENDING_CFO", ...(opts.ignoreRequestId ? { NOT: { id: opts.ignoreRequestId } } : {}) },
    },
    select: { assetId: true, request: { select: { requestNo: true } } },
  });
  const pendingBy = new Map(pending.map((p) => [p.assetId, p.request.requestNo]));

  // Assets whose depreciation for this year is already drafted or booked —
  // the new settings apply from 1 April, so they must come before that run.
  const currentLogs = await prisma.depreciationLog.findMany({
    where: {
      assetId: { in: assetIds },
      status: { in: [...LIVE_LOG_STATUSES] },
      periodEnd: { gte: ctx.fyStart, lte: ctx.fyEnd },
    },
    select: { assetId: true },
  });
  const hasCurrentLog = new Set(currentLogs.map((l) => l.assetId));

  const lines: LineDraft[] = [];
  const errors: LineError[] = [];

  for (const id of assetIds) {
    const a = byId.get(id);
    if (!a) { errors.push({ assetId: id, message: "Asset not found." }); continue; }
    const tag = { assetId: a.id, assetCode: a.assetId, assetName: a.assetName };

    if (!toCategory) { errors.push({ ...tag, message: "Target category not found." }); continue; }
    if (a.parentAssetId != null) {
      errors.push({ ...tag, message: "This is a sub-asset — its cost sits in the parent. Reclassify the parent asset instead." });
      continue;
    }
    if (a.assetCategoryId === toCategoryId) {
      errors.push({ ...tag, message: `Already in "${toCategory.name}".` });
      continue;
    }
    const pendingNo = pendingBy.get(a.id);
    if (pendingNo) {
      errors.push({ ...tag, message: `Already in pending request ${pendingNo}.` });
      continue;
    }
    if (hasCurrentLog.has(a.id)) {
      errors.push({ ...tag, message: `Depreciation for ${ctx.fyLabel} is already drafted or booked for this asset. Reclassification applies from 1 April, so it has to happen before this year's depreciation run.` });
      continue;
    }
    const acq = acquisitionDateOf(a);
    if (acq && acq < ctx.fyStart && !prevFinalized) {
      errors.push({
        ...tag,
        message: `${fyLabelOf(fiscalYear - 1)} must be finalized first. Reclassification changes ${fyLabelOf(fiscalYear)} onward only — with an earlier year still open, that year would be restated too.`,
      });
      continue;
    }
    // New method/rate/life have nowhere to go without a depreciation setup —
    // applying the category alone would leave the asset on its old settings.
    if (opts.newSettings && !a.depreciation) {
      errors.push({ ...tag, message: "It has no depreciation setup, so the new method/rate/life can't be applied. Set up its depreciation first, or untick 'apply new depreciation settings'." });
      continue;
    }

    const cost = Number(a.purchaseCost ?? a.estimatedValue ?? 0);
    const opening = await resolveOpeningWdv({
      id: a.id,
      assetId: a.assetId,
      purchaseCost: cost,
      estimatedValue: Number(a.estimatedValue ?? 0),
      purchaseDate: a.purchaseDate,
      installedAt: null,
      isLegacyAsset: (a as any).isLegacyAsset ?? false,
      migrationMode: (a as any).migrationMode ?? null,
      migrationDate: (a as any).migrationDate ?? null,
      originalPurchaseDate: (a as any).originalPurchaseDate ?? null,
      originalCost: (a as any).originalCost ?? null,
      accDepAtMigration: (a as any).accDepAtMigration ?? null,
      openingWdvAtMigration: (a as any).openingWdvAtMigration ?? null,
    } as any, cost, ctx);

    lines.push({
      assetId: a.id,
      assetCode: a.assetId,
      assetName: a.assetName,
      fromCategoryId: a.assetCategoryId ?? null,
      fromCategoryName: a.assetCategory?.name ?? "Uncategorized",
      oldMethod: a.depreciation?.depreciationMethod ?? null,
      oldRate: a.depreciation?.depreciationRate != null ? Number(a.depreciation.depreciationRate) : null,
      oldLifeYears: a.depreciation?.expectedLifeYears ?? null,
      grossBlock: +cost.toFixed(2),
      accDepAtEffective: +Number(opening.accDepBefore).toFixed(2),
      openingWdvAtEffective: +Number(opening.openingWdv).toFixed(2),
      openingSource: opening.source,
    });
  }

  return { ctx, fiscalYear, toCategory, lines, errors };
}

/**
 * Why an asset can't be picked right now, or null. A cheaper subset of
 * evaluate() for the picker, so a user sees it before the preview — chiefly
 * monthly-depreciation assets, which are run early in the year.
 */
async function blockedReasons(assets: { id: number; purchaseDate: Date | null; donationDate: Date | null }[]) {
  const ids = assets.map((a) => a.id);
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const ctx = getFYContext(new Date());
  const fiscalYear = ctx.fyStart.getFullYear();
  const prevFinalized = (await getLockedYears()).get(fiscalYear - 1) === "FINALIZED";

  const [logs, pending] = await Promise.all([
    prisma.depreciationLog.findMany({
      where: { assetId: { in: ids }, status: { in: [...LIVE_LOG_STATUSES] }, periodEnd: { gte: ctx.fyStart, lte: ctx.fyEnd } },
      select: { assetId: true },
    }),
    prisma.assetReclassLine.findMany({
      where: { assetId: { in: ids }, request: { status: "PENDING_CFO" } },
      select: { assetId: true, request: { select: { requestNo: true } } },
    }),
  ]);
  const hasLog = new Set(logs.map((l) => l.assetId));
  const pendingBy = new Map(pending.map((p) => [p.assetId, p.request.requestNo]));

  for (const a of assets) {
    const acq = acquisitionDateOf(a);
    if (hasLog.has(a.id)) out.set(a.id, `Depreciation for ${ctx.fyLabel} is already drafted or booked — reclassification applies from 1 April, so it's too late this year.`);
    else if (pendingBy.has(a.id)) out.set(a.id, `Already in pending request ${pendingBy.get(a.id)}.`);
    else if (acq && acq < ctx.fyStart && !prevFinalized) out.set(a.id, `${fyLabelOf(fiscalYear - 1)} must be finalized first.`);
  }
  return out;
}

/** RCL-FY2026-27-0001 — a running series per financial year (like indents and gate passes). */
async function nextRequestNo(fiscalYear: number): Promise<string> {
  const prefix = `RCL-${fyLabelOf(fiscalYear)}`;
  const latest = await prisma.assetReclassRequest.findFirst({
    where: { requestNo: { startsWith: prefix } },
    orderBy: { id: "desc" },
    select: { requestNo: true },
  });
  let seq = 1;
  if (latest) {
    const last = parseInt(latest.requestNo.split("-").pop() ?? "", 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

function parseIds(raw: any): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((n: any) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Depreciation settings to apply; null field = keep each asset's own. */
function parseSettings(body: any): { ok: true; newMethod: string | null; newRate: number | null; newLifeYears: number | null } | { ok: false; message: string } {
  if (!body?.applyDepreciation) return { ok: true, newMethod: null, newRate: null, newLifeYears: null };
  const method = body.newMethod ? String(body.newMethod).toUpperCase() : null;
  if (method && !["SL", "DB"].includes(method)) return { ok: false, message: "Method must be SL or DB." };
  const rate = body.newRate != null && body.newRate !== "" ? Number(body.newRate) : null;
  if (rate != null && (isNaN(rate) || rate < 0 || rate > 100)) return { ok: false, message: "Rate must be between 0 and 100." };
  const life = body.newLifeYears != null && body.newLifeYears !== "" ? Number(body.newLifeYears) : null;
  if (life != null && (!Number.isInteger(life) || life <= 0)) return { ok: false, message: "Useful life must be a whole number of years." };
  if (method == null && rate == null && life == null) return { ok: false, message: "Give the new method, rate or life — or untick 'apply new depreciation settings'." };
  return { ok: true, newMethod: method, newRate: rate, newLifeYears: life };
}

const REQUEST_INCLUDE = {
  toCategory: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true, employeeID: true } },
  approvedBy: { select: { id: true, name: true, employeeID: true } },
  rejectedBy: { select: { id: true, name: true, employeeID: true } },
} as const;

// ─── GET / — requests, newest first ─────────────────────────────────────────
export const listRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (refuseUnlessReader(req, res)) return;
    const where: any = {};
    if (req.query.status) where.status = String(req.query.status);
    const rows = await prisma.assetReclassRequest.findMany({
      where,
      include: REQUEST_INCLUDE,
      orderBy: { id: "desc" },
      take: 500,
    });
    res.json(rows);
  } catch (err) {
    console.error("reclassification listRequests error:", err);
    res.status(500).json({ message: "Failed to load reclassification requests" });
  }
};

// ─── GET /:id — one request with its lines ──────────────────────────────────
export const getRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (refuseUnlessReader(req, res)) return;
    const id = Number(req.params.id);
    const r = await prisma.assetReclassRequest.findUnique({
      where: { id },
      include: {
        ...REQUEST_INCLUDE,
        lines: { include: { asset: { select: { id: true, assetId: true, assetName: true } } }, orderBy: { id: "asc" } },
      },
    });
    if (!r) { res.status(404).json({ message: "Request not found" }); return; }
    res.json(r);
  } catch (err) {
    console.error("reclassification getRequest error:", err);
    res.status(500).json({ message: "Failed to load the request" });
  }
};

// ─── GET /candidates — assets in a category, for picking ────────────────────
export const listCandidates = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (refuseUnlessReader(req, res)) return;
    const where: any = { parentAssetId: null };
    if (req.query.categoryId) where.assetCategoryId = Number(req.query.categoryId);
    if (req.query.assetId) where.id = Number(req.query.assetId);
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [{ assetId: { contains: s } }, { assetName: { contains: s } }, { serialNumber: { contains: s } }];
    }
    const rows = await prisma.asset.findMany({
      where,
      select: {
        id: true, assetId: true, assetName: true, serialNumber: true,
        purchaseCost: true, estimatedValue: true, purchaseDate: true, donationDate: true,
        assetCategory: { select: { id: true, name: true } },
        department: { select: { name: true } },
        depreciation: { select: { depreciationMethod: true, depreciationRate: true, expectedLifeYears: true } },
      },
      orderBy: [{ assetName: "asc" }],
      take: 1000,
    });
    const blocked = await blockedReasons(rows);
    res.json(rows.map((a) => ({
      id: a.id,
      assetCode: a.assetId,
      assetName: a.assetName,
      serialNumber: a.serialNumber,
      category: a.assetCategory,
      department: a.department?.name ?? null,
      cost: Number(a.purchaseCost ?? a.estimatedValue ?? 0),
      acquisitionDate: a.purchaseDate ?? a.donationDate ?? null,
      method: a.depreciation?.depreciationMethod ?? null,
      rate: a.depreciation?.depreciationRate != null ? Number(a.depreciation.depreciationRate) : null,
      lifeYears: a.depreciation?.expectedLifeYears ?? null,
      blockedReason: blocked.get(a.id) ?? null,
    })));
  } catch (err) {
    console.error("reclassification listCandidates error:", err);
    res.status(500).json({ message: "Failed to load assets" });
  }
};

// ─── POST /preview — eligibility + position on the effective date ───────────
export const previewRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (refuseUnlessReader(req, res)) return;
    const assetIds = parseIds(req.body?.assetIds);
    const toCategoryId = Number(req.body?.toCategoryId);
    if (!assetIds.length || !toCategoryId) { res.status(400).json({ message: "Select at least one asset and the new category." }); return; }
    if (assetIds.length > MAX_ASSETS) { res.status(400).json({ message: `At most ${MAX_ASSETS} assets per request.` }); return; }

    // Settings are optional here (the user may preview before filling them);
    // when given, check them the same way submit will.
    const settings = parseSettings(req.body);
    const ev = await evaluate(assetIds, toCategoryId, { newSettings: settings.ok && hasNewSettings(settings) });
    res.json({
      fiscalYear: ev.fiscalYear,
      fyLabel: fyLabelOf(ev.fiscalYear),
      effectiveFrom: ev.ctx.fyStart,
      toCategory: ev.toCategory ? {
        id: ev.toCategory.id, name: ev.toCategory.name,
        defaultMethod: ev.toCategory.defaultDepreciationMethod,
        defaultRate: ev.toCategory.defaultDepreciationRate != null ? Number(ev.toCategory.defaultDepreciationRate) : null,
        defaultLifeYears: ev.toCategory.defaultLifeYears,
      } : null,
      lines: ev.lines,
      errors: ev.errors,
      totals: {
        assets: ev.lines.length,
        grossBlock: +ev.lines.reduce((s, l) => s + l.grossBlock, 0).toFixed(2),
        accDep: +ev.lines.reduce((s, l) => s + l.accDepAtEffective, 0).toFixed(2),
        openingWdv: +ev.lines.reduce((s, l) => s + l.openingWdvAtEffective, 0).toFixed(2),
      },
    });
  } catch (err) {
    console.error("reclassification previewRequest error:", err);
    res.status(500).json({ message: "Failed to preview the reclassification" });
  }
};

// ─── POST / — raise a request (FINANCE or CFO) ──────────────────────────────
export const createRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const role = roleOf(req);
    if (role !== "FINANCE" && role !== "CFO") {
      res.status(403).json({ message: "Only Finance or the CFO can raise a reclassification." });
      return;
    }
    const me = actorId(req);
    if (!me) { res.status(401).json({ message: "Unauthorized" }); return; }

    const assetIds = parseIds(req.body?.assetIds);
    const toCategoryId = Number(req.body?.toCategoryId);
    const reason = String(req.body?.reason ?? "").trim();
    if (!assetIds.length || !toCategoryId) { res.status(400).json({ message: "Select at least one asset and the new category." }); return; }
    if (assetIds.length > MAX_ASSETS) { res.status(400).json({ message: `At most ${MAX_ASSETS} assets per request.` }); return; }
    if (!reason) { res.status(400).json({ message: "A reason is required — it is what the CFO and the auditor will read." }); return; }

    const settings = parseSettings(req.body);
    if (!settings.ok) { res.status(400).json({ message: settings.message }); return; }

    const ev = await evaluate(assetIds, toCategoryId, { newSettings: hasNewSettings(settings) });
    // All or nothing: a partial request would quietly drop assets the user
    // thought were included. The preview shows exactly which ones fail and why.
    if (ev.errors.length) {
      res.status(400).json({
        message: `${ev.errors.length} of ${assetIds.length} asset(s) can't be reclassified. Remove them or fix the issue, then submit again.`,
        errors: ev.errors,
      });
      return;
    }

    // Two requests raised at the same moment can draw the same number; the
    // unique index refuses the second, which then takes the next one.
    let requestNo = "";
    let created: any = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      requestNo = await nextRequestNo(ev.fiscalYear);
      try {
        created = await createRequestRow(requestNo, ev, toCategoryId, settings, reason, me);
      } catch (e: any) {
        if (e?.code !== "P2002" || attempt === 2) throw e;
      }
    }

    getCfoIds().then((ids) => notify({
      type: "OTHER",
      title: "Asset Reclassification — CFO Approval Required",
      message: `${requestNo}: ${ev.lines.length} asset(s) to move to "${ev.toCategory?.name}" from ${fyLabelOf(ev.fiscalYear)}. Reason: ${reason}`,
      recipientIds: ids.filter((id) => id !== me),
      priority: "HIGH",
      createdById: me,
    })).catch(() => {});

    res.status(201).json({ message: `${requestNo} sent to the CFO for approval.`, request: created });
  } catch (err) {
    console.error("reclassification createRequest error:", err);
    res.status(500).json({ message: "Failed to raise the reclassification" });
  }
};

function createRequestRow(
  requestNo: string,
  ev: Awaited<ReturnType<typeof evaluate>>,
  toCategoryId: number,
  settings: { newMethod: string | null; newRate: number | null; newLifeYears: number | null },
  reason: string,
  me: number,
) {
  return prisma.assetReclassRequest.create({
    data: {
      requestNo,
      status: "PENDING_CFO",
      fiscalYear: ev.fiscalYear,
      effectiveFrom: ev.ctx.fyStart,
      toCategoryId,
      newMethod: settings.newMethod,
      newRate: settings.newRate != null ? String(settings.newRate) : null,
      newLifeYears: settings.newLifeYears,
      reason,
      requestedById: me,
      totalAssets: ev.lines.length,
      totalGross: String(ev.lines.reduce((s, l) => s + l.grossBlock, 0).toFixed(2)),
      totalAccDep: String(ev.lines.reduce((s, l) => s + l.accDepAtEffective, 0).toFixed(2)),
      lines: {
        create: ev.lines.map((l) => ({
          assetId: l.assetId,
          fromCategoryId: l.fromCategoryId,
          fromCategoryName: l.fromCategoryName,
          oldMethod: l.oldMethod,
          oldRate: l.oldRate != null ? String(l.oldRate) : null,
          oldLifeYears: l.oldLifeYears,
          grossBlock: String(l.grossBlock),
          accDepAtEffective: String(l.accDepAtEffective),
          openingWdvAtEffective: String(l.openingWdvAtEffective),
          openingSource: l.openingSource,
        })),
      },
    },
    include: REQUEST_INCLUDE,
  });
}

// ─── POST /:id/approve — CFO, not the requester. Applies it. ────────────────
export const approveRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (roleOf(req) !== "CFO") { res.status(403).json({ message: "Only the CFO can approve a reclassification." }); return; }
    const me = actorId(req);
    const id = Number(req.params.id);

    const r = await prisma.assetReclassRequest.findUnique({
      where: { id },
      include: { lines: true, toCategory: true },
    });
    if (!r) { res.status(404).json({ message: "Request not found" }); return; }
    if (r.status !== "PENDING_CFO") { res.status(400).json({ message: `${r.requestNo} is ${r.status.toLowerCase().replace("_", " ")}, not awaiting approval.` }); return; }
    if (me != null && r.requestedById === me) {
      res.status(403).json({ message: "You raised this reclassification, so you can't also approve it." });
      return;
    }

    // It must still be valid now, and still describe the assets as they are:
    // a year may have rolled over, or an asset may have been changed since.
    const current = getFYContext(new Date()).fyStart.getFullYear();
    if (current !== r.fiscalYear) {
      res.status(409).json({ message: `${r.requestNo} was raised for ${fyLabelOf(r.fiscalYear)}, and the financial year has since changed. Reject it and raise a fresh one.` });
      return;
    }
    const ev = await evaluate(r.lines.map((l) => l.assetId), r.toCategoryId, { ignoreRequestId: r.id, newSettings: hasNewSettings(r) });
    const errors = [...ev.errors];
    const evById = new Map(ev.lines.map((l) => [l.assetId, l]));
    for (const l of r.lines) {
      const now = evById.get(l.assetId);
      if (now && now.fromCategoryId !== l.fromCategoryId) {
        errors.push({ assetId: l.assetId, assetCode: now.assetCode, message: `Its category changed since the request (now "${now.fromCategoryName}").` });
      }
    }
    if (errors.length) {
      res.status(409).json({ message: `${errors.length} asset(s) in ${r.requestNo} can no longer be reclassified as requested. Reject it and raise a fresh one.`, errors });
      return;
    }

    // The lines hold the figures as they were when the request was raised. What
    // moves (and what the GL entry posts) is the position now — a current-year
    // asset's cost may have been corrected meanwhile — so the lines are brought
    // up to date in the same transaction that applies the change.
    let refreshed = 0;
    for (const l of r.lines) {
      const now = evById.get(l.assetId)!;
      if (Number(l.grossBlock) !== now.grossBlock || Number(l.accDepAtEffective) !== now.accDepAtEffective ||
          Number(l.openingWdvAtEffective) !== now.openingWdvAtEffective || l.openingSource !== now.openingSource) refreshed++;
    }

    const applied = await prisma.$transaction(async (tx) => {
      // Flip the status first and only if still pending: two approvals racing
      // would otherwise both apply and both post a GL entry.
      const flipped = await tx.assetReclassRequest.updateMany({
        where: { id: r.id, status: "PENDING_CFO" },
        data: {
          status: "APPROVED",
          approvedById: me,
          approvedAt: new Date(),
          approvalNotes: String(req.body?.notes ?? "").trim() || null,
          totalGross: String(ev.lines.reduce((s, l) => s + l.grossBlock, 0).toFixed(2)),
          totalAccDep: String(ev.lines.reduce((s, l) => s + l.accDepAtEffective, 0).toFixed(2)),
        },
      });
      if (flipped.count === 0) return false;

      for (const l of r.lines) {
        const now = evById.get(l.assetId)!;
        await tx.assetReclassLine.update({
          where: { id: l.id },
          data: {
            grossBlock: String(now.grossBlock),
            accDepAtEffective: String(now.accDepAtEffective),
            openingWdvAtEffective: String(now.openingWdvAtEffective),
            openingSource: now.openingSource,
          },
        });
        await tx.asset.update({ where: { id: l.assetId }, data: { assetCategoryId: r.toCategoryId } });
        if (hasNewSettings(r)) {
          // evaluate() refused any asset without a depreciation row.
          await tx.assetDepreciation.update({
            where: { assetId: l.assetId },
            data: {
              ...(r.newMethod != null ? { depreciationMethod: r.newMethod } : {}),
              ...(r.newRate != null ? { depreciationRate: r.newRate } : {}),
              ...(r.newLifeYears != null ? { expectedLifeYears: r.newLifeYears } : {}),
              updatedById: me,
            },
          });
        }
      }
      return true;
    }, { timeout: 120_000, maxWait: 10_000 });
    if (!applied) {
      res.status(409).json({ message: `${r.requestNo} was decided by someone else a moment ago. Refresh the list.` });
      return;
    }

    const fresh = await prisma.assetReclassRequest.findUnique({ where: { id: r.id }, include: { lines: true, toCategory: true } });
    const gl = await postReclassVoucher(fresh!, me);
    await prisma.assetReclassRequest.update({ where: { id: r.id }, data: { glStatus: gl.status, glNote: gl.note } });

    for (const l of r.lines) {
      logAction({
        entityType: "ASSET",
        entityId: l.assetId,
        action: "RECLASSIFIED",
        description: `${r.requestNo}: category "${l.fromCategoryName}" → "${r.toCategory.name}" from ${fyLabelOf(r.fiscalYear)}`,
        oldValue: JSON.stringify({ category: l.fromCategoryName, method: l.oldMethod, rate: l.oldRate, life: l.oldLifeYears }),
        newValue: JSON.stringify({ category: r.toCategory.name, method: r.newMethod, rate: r.newRate, life: r.newLifeYears }),
        performedById: me ?? undefined,
      }).catch(() => {});
    }

    const recipients = new Set<number>(await getFinanceApproverIds());
    recipients.add(r.requestedById);
    recipients.delete(me as number);
    notify({
      type: "OTHER",
      title: "Asset Reclassification Approved",
      message: `${r.requestNo} approved: ${r.lines.length} asset(s) now in "${r.toCategory.name}" from ${fyLabelOf(r.fiscalYear)}. ${gl.note ?? ""}`.trim(),
      recipientIds: [...recipients],
      createdById: me ?? undefined,
    }).catch(() => {});

    const refreshNote = refreshed
      ? `${refreshed} asset(s)' figures had changed since the request and were updated to the current position.`
      : "";
    res.json({ message: `${r.requestNo} approved and applied. ${refreshNote} ${gl.note ?? ""}`.replace(/\s+/g, " ").trim(), glStatus: gl.status, refreshed });
  } catch (err) {
    console.error("reclassification approveRequest error:", err);
    res.status(500).json({ message: "Failed to approve the reclassification" });
  }
};

/**
 * GL reclass entry, dated the effective date: move each asset's gross block and
 * accumulated depreciation from the old category's accounts to the new one's.
 *   DR new Fixed Asset   / CR old Fixed Asset    (gross block)
 *   DR old Acc. Dep.     / CR new Acc. Dep.      (accumulated depreciation)
 * Pairs whose two accounts are the same net to nothing and are left out.
 */
async function postReclassVoucher(r: any, me: number | null): Promise<{ status: string; note: string | null }> {
  try {
    // Never twice: a live voucher for this request already exists (a re-try
    // after a lost response, say). Voided/rejected ones can be replaced.
    const existing = await prisma.financeVoucher.findFirst({
      where: { sourceType: "ASSET_RECLASSIFICATION", sourceId: r.id, status: { in: ["DRAFT", "PENDING_APPROVAL", "POSTED"] } },
      select: { voucherNo: true, status: true },
    });
    if (existing) return voucherOutcome(existing.status, existing.voucherNo, new Set());

    const config = await prisma.financeConfig.findFirst();
    if (!config?.autoVoucher) {
      return { status: "AUTO_VOUCHER_OFF", note: "Automatic vouchers are turned off in Finance Config — pass the reclass entry manually." };
    }

    const catIds = [...new Set<number>([r.toCategoryId, ...r.lines.map((l: any) => l.fromCategoryId).filter(Boolean)])];
    const mappings = await prisma.assetGLMapping.findMany({ where: { assetCategoryId: { in: catIds } } });
    const map = new Map(mappings.map((m) => [m.assetCategoryId, m]));
    const to = map.get(r.toCategoryId);

    const lines: { accountId: number; debit: number; credit: number; narration?: string }[] = [];
    const unmapped = new Set<string>();
    let movable = 0;

    for (const l of r.lines) {
      const gross = Number(l.grossBlock), acc = Number(l.accDepAtEffective);
      if (!(gross > 0) && !(acc > 0)) continue;
      movable++;
      const from = l.fromCategoryId ? map.get(l.fromCategoryId) : null;
      if (!from?.fixedAssetAccountId || !to?.fixedAssetAccountId || !from?.accDepAccountId || !to?.accDepAccountId) {
        unmapped.add(l.fromCategoryName);
        continue;
      }
      if (gross > 0 && from.fixedAssetAccountId !== to.fixedAssetAccountId) {
        lines.push({ accountId: to.fixedAssetAccountId, debit: gross, credit: 0, narration: `Reclass in — ${l.fromCategoryName}` });
        lines.push({ accountId: from.fixedAssetAccountId, debit: 0, credit: gross, narration: `Reclass out — ${r.toCategory.name}` });
      }
      if (acc > 0 && from.accDepAccountId !== to.accDepAccountId) {
        lines.push({ accountId: from.accDepAccountId, debit: acc, credit: 0, narration: `Acc. dep. reclass out — ${r.toCategory.name}` });
        lines.push({ accountId: to.accDepAccountId, debit: 0, credit: acc, narration: `Acc. dep. reclass in — ${l.fromCategoryName}` });
      }
    }
    if (!to?.fixedAssetAccountId || !to?.accDepAccountId) unmapped.add(r.toCategory.name);

    if (movable === 0) return { status: "NOTHING_TO_MOVE", note: null };
    if (lines.length < 2) {
      return {
        status: "NO_GL_MAPPING",
        note: `No GL entry posted — set up Fixed Asset and Acc. Dep. accounts in the GL mapping for: ${[...unmapped].join(", ")}.`,
      };
    }
    const result = await createAutoVoucher({
      sourceType: "ASSET_RECLASSIFICATION",
      sourceId: r.id,
      voucherDate: r.effectiveFrom,
      narration: `Asset reclassification ${r.requestNo} — ${r.lines.length} asset(s) to ${r.toCategory.name}`,
      createdById: me ?? undefined,
      lines,
    });
    if (!result.created) {
      const why = {
        AUTO_VOUCHER_OFF: "Automatic vouchers are turned off in Finance Config — pass the reclass entry manually.",
        LOCKED_YEAR: `No GL entry created — ${fyLabelOf(r.fiscalYear)} is locked, so a voucher dated ${new Date(r.effectiveFrom).toDateString()} can't be posted.`,
        UNBALANCED: "No GL entry created — its debits and credits did not agree. Check the GL mapping and try again.",
      }[result.reason];
      return { status: result.reason === "AUTO_VOUCHER_OFF" ? "AUTO_VOUCHER_OFF" : "NOT_CREATED", note: why };
    }
    return voucherOutcome(result.status, result.voucherNo, unmapped);
  } catch (e) {
    console.warn("Reclass voucher skipped:", e);
    return { status: "NOT_CREATED", note: "The GL reclass entry could not be created — check the GL mapping and try again." };
  }
}

/** POSTED only when the ledger really has it; a voucher awaiting approval is DRAFTED. */
function voucherOutcome(status: string, voucherNo: string, unmapped: Set<string>): { status: string; note: string } {
  const except = unmapped.size ? `, except for categories without a GL mapping: ${[...unmapped].join(", ")}` : "";
  if (status === "POSTED") return { status: "POSTED", note: `GL reclass entry ${voucherNo} posted${except}.` };
  return { status: "DRAFTED", note: `GL reclass entry ${voucherNo} created as a draft — it reaches the ledger once Finance approves it${except}.` };
}

/** Approved, but its GL entry never made it — these can be re-tried. */
const GL_RETRYABLE = [null, "NO_GL_MAPPING", "AUTO_VOUCHER_OFF", "NOT_CREATED"];

// ─── POST /:id/post-gl — re-try the GL entry (FINANCE or CFO) ───────────────
export const retryGlEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const role = roleOf(req);
    if (role !== "FINANCE" && role !== "CFO") { res.status(403).json({ message: "Only Finance or the CFO can post the GL entry." }); return; }
    const me = actorId(req);
    const id = Number(req.params.id);

    const r = await prisma.assetReclassRequest.findUnique({ where: { id }, include: { lines: true, toCategory: true } });
    if (!r) { res.status(404).json({ message: "Request not found" }); return; }
    if (r.status !== "APPROVED") { res.status(400).json({ message: `${r.requestNo} is not approved.` }); return; }
    if (!GL_RETRYABLE.includes(r.glStatus)) {
      res.status(400).json({ message: `${r.requestNo}'s GL entry is already ${r.glStatus === "NOTHING_TO_MOVE" ? "not needed" : "created"}.` });
      return;
    }

    // Uses the figures stored at approval — the position that was applied.
    const gl = await postReclassVoucher(r, me);
    await prisma.assetReclassRequest.update({ where: { id }, data: { glStatus: gl.status, glNote: gl.note } });
    logAction({
      entityType: "ASSET_RECLASSIFICATION",
      entityId: r.id,
      action: "GL_RETRY",
      description: `${r.requestNo}: GL entry re-tried — ${gl.status}`,
      performedById: me ?? undefined,
    }).catch(() => {});
    res.json({ message: gl.note ?? `${r.requestNo}: ${gl.status}`, glStatus: gl.status });
  } catch (err) {
    console.error("reclassification retryGlEntry error:", err);
    res.status(500).json({ message: "Failed to post the GL entry" });
  }
};

// ─── POST /:id/reject — CFO ──────────────────────────────────────────────────
export const rejectRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (roleOf(req) !== "CFO") { res.status(403).json({ message: "Only the CFO can reject a reclassification." }); return; }
    const me = actorId(req);
    const id = Number(req.params.id);
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) { res.status(400).json({ message: "A rejection reason is required." }); return; }

    const r = await prisma.assetReclassRequest.findUnique({ where: { id } });
    if (!r) { res.status(404).json({ message: "Request not found" }); return; }
    if (r.status !== "PENDING_CFO") { res.status(400).json({ message: `${r.requestNo} is not awaiting approval.` }); return; }

    await prisma.assetReclassRequest.update({
      where: { id },
      data: { status: "REJECTED", rejectedById: me, rejectedAt: new Date(), rejectionReason: reason },
    });
    notify({
      type: "OTHER",
      title: "Asset Reclassification Rejected",
      message: `${r.requestNo} was rejected by the CFO. Reason: ${reason}`,
      recipientIds: [r.requestedById].filter((x) => x !== me),
      createdById: me ?? undefined,
    }).catch(() => {});
    res.json({ message: `${r.requestNo} rejected.` });
  } catch (err) {
    console.error("reclassification rejectRequest error:", err);
    res.status(500).json({ message: "Failed to reject the reclassification" });
  }
};

// ─── POST /:id/cancel — the requester (or an admin), while pending ──────────
export const cancelRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = actorId(req);
    const id = Number(req.params.id);
    const r = await prisma.assetReclassRequest.findUnique({ where: { id } });
    if (!r) { res.status(404).json({ message: "Request not found" }); return; }
    if (r.status !== "PENDING_CFO") { res.status(400).json({ message: `${r.requestNo} is not pending.` }); return; }
    if (r.requestedById !== me && roleOf(req) !== "ADMIN") {
      res.status(403).json({ message: "Only the person who raised it can cancel it. The CFO rejects instead." });
      return;
    }
    await prisma.assetReclassRequest.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    res.json({ message: `${r.requestNo} cancelled.` });
  } catch (err) {
    console.error("reclassification cancelRequest error:", err);
    res.status(500).json({ message: "Failed to cancel the reclassification" });
  }
};

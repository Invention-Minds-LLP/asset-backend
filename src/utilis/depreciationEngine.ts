/**
 * ────────────────────────────────────────────────────────────────────────────
 *  Depreciation Engine — Indian IT Act compliant
 *  - Half-year rule: assets purchased Apr-Sep get 100% rate; Oct-Mar get 50%
 *    in the year of acquisition only. From Y2 onwards, full rate on opening WDV.
 *  - Split logic: opening WDV (full rate) + additions in FY (full or half rate)
 *  - Legacy assets: engine NEVER computes for periods before migrationDate.
 * ────────────────────────────────────────────────────────────────────────────
 */
import prisma from "../prismaClient";

export interface FYContext {
  fyStart: Date;          // 1-Apr of the FY
  fyEnd: Date;            // 31-Mar of next year
  fyLabel: string;        // "FY2024-25"
}

export interface AssetForDep {
  id: number;
  assetId: string;
  purchaseCost: number | null;
  estimatedValue: number | null;
  purchaseDate: Date | null;
  installedAt: Date | null;
  isLegacyAsset?: boolean | null;
  migrationMode?: string | null;
  migrationDate?: Date | null;
  originalPurchaseDate?: Date | null;
  originalCost?: number | null;
  accDepAtMigration?: number | null;
  openingWdvAtMigration?: number | null;
}

export interface DepreciationConfig {
  method: string;            // SL | DB
  rate: number;              // percent, e.g. 15
  lifeYears: number;
  salvage: number;
  depreciationStart: Date;
  frequency: string;         // YEARLY | MONTHLY (only YEARLY supports half-year rule)
  roundOff: boolean;
  decimalPlaces: number;
}

export interface FYDepreciationResult {
  fyLabel: string;
  periodStart: Date;
  periodEnd: Date;
  openingWdv: number;
  openingWdvSource: "FINALIZED_YEAR" | "PRIOR_LOG" | "PURCHASE_COST" | "MIGRATION";
  additionsAmount: number;          // gross addition recognized in this FY (per asset = its cost in Y1)
  isFirstFY: boolean;               // is this the asset's very first FY of dep?
  halfYearApplied: boolean;
  effectiveRate: number;            // % rate after half-year adjust
  depOnOpening: number;             // dep on the carried-forward WDV at FULL rate
  depOnAdditions: number;           // dep on additions at full or half rate
  depreciationAmount: number;       // total = opening + additions
  closingWdv: number;
  accDepBefore: number;
  accDepAfter: number;
  // Diagnostics
  preMigrationSkipped: boolean;
}

/* ── Log status ──────────────────────────────────────────────────────────── */

/**
 * The one definition of "booked depreciation". A DepreciationLog row is either
 * a DRAFT (in an unapproved batch run), APPROVED (booked), or REJECTED.
 *
 * Every read that means "what depreciation has been charged" — reports,
 * exports, the audit preview, and the opening-WDV lookup below — must spread
 * this into its `where`. Reading without it counts drafts and rejected runs as
 * if they were in the books, which is how past-year figures used to move
 * without anyone approving anything.
 */
export const BOOKED_LOG_WHERE = { status: "APPROVED" } as const;

/** Rows that still hold a claim on an (asset, FY): pending or booked. */
export const LIVE_LOG_STATUSES = ["DRAFT", "APPROVED"] as const;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function isSecondHalfOfIndianFY(date: Date): boolean {
  const m = date.getMonth(); // 0=Jan
  return m >= 9 || m <= 2;   // Oct, Nov, Dec, Jan, Feb, Mar
}

/** Return the Indian FY context (Apr 1 – Mar 31) that contains the given date. */
export function getFYContext(date: Date): FYContext {
  const m = date.getMonth();
  const y = date.getFullYear();
  const fyStartYear = m >= 3 ? y : y - 1;   // Apr (3) onwards = current year
  const fyStart = new Date(fyStartYear, 3, 1);                  // Apr 1
  const fyEnd   = new Date(fyStartYear + 1, 2, 31, 23, 59, 59); // Mar 31 next year
  const fyLabel = `FY${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
  return { fyStart, fyEnd, fyLabel };
}

/** Round a number per asset's round-off settings. */
export function applyRoundOff(value: number, roundOff: boolean, decimalPlaces: number): number {
  if (!roundOff) return Number(value.toFixed(2));
  return Number(value.toFixed(decimalPlaces));
}

/** Effective residual value (defaults to 5% of cost if not explicitly stored). */
export function effectiveResidualValue(cost: number, storedSalvage: number | null | undefined): number {
  if (storedSalvage != null && Number(storedSalvage) > 0) return Number(storedSalvage);
  return Number((cost * 0.05).toFixed(2));
}

/* ── Opening WDV resolver ────────────────────────────────────────────────── */

/**
 * Resolve the opening WDV for the given FY.
 *  Priority:
 *   0. FINALIZED_YEAR — the previous year is finalized: its frozen closing net
 *                       block for this asset. Takes priority over logs because
 *                       the closed books may carry an estimated figure (no
 *                       booked log that year), and an open year must build on
 *                       what was actually closed, not on older history.
 *   1. PRIOR_LOG     — bookValueAfter from the most recent log whose periodEnd ≤ fyStart
 *   2. MIGRATION     — openingWdvAtMigration (if asset is legacy and we're in/after migration FY)
 *   3. PURCHASE_COST — fallback for the asset's first FY of dep
 */
export async function resolveOpeningWdv(
  asset: AssetForDep,
  cost: number,
  fy: FYContext
): Promise<{ openingWdv: number; source: "FINALIZED_YEAR" | "PRIOR_LOG" | "PURCHASE_COST" | "MIGRATION"; accDepBefore: number }> {
  // 0. Previous year finalized → its frozen closing is this year's opening.
  const prevFiscalYear = fy.fyStart.getFullYear() - 1;
  const frozen = await prisma.fyAssetSnapshot.findFirst({
    where: {
      assetId: asset.id,
      fiscalYear: prevFiscalYear,
      lineType: "ASSET",
      financialYearClose: { status: "FINALIZED" },
    },
    select: { openingGross: true, additions: true, deletions: true, closingAccDep: true },
  });
  if (frozen) {
    const closingGross = Number(frozen.openingGross) + Number(frozen.additions) - Number(frozen.deletions);
    const accDep = Number(frozen.closingAccDep);
    // A line with no closing gross was disposed in the closed year — nothing
    // carries forward, so fall through to the normal rules.
    if (closingGross > 0) {
      return {
        openingWdv: Math.max(0, Number((closingGross - accDep).toFixed(2))),
        source: "FINALIZED_YEAR",
        accDepBefore: Math.max(0, Number(accDep.toFixed(2))),
      };
    }
  }

  // 1. Try prior log — find the most recent BOOKED log whose periodEnd is
  //    on/before this FY's start. A draft or rejected row is not a closing
  //    balance; using one would open this year on figures nobody approved.
  const priorLog = await prisma.depreciationLog.findFirst({
    where: { assetId: asset.id, periodEnd: { lte: fy.fyStart }, ...BOOKED_LOG_WHERE },
    orderBy: { periodEnd: "desc" },
    select: { bookValueAfter: true, periodEnd: true },
  });

  if (priorLog) {
    // Sum of all dep amounts so far = cost − bookValueAfter
    const accDepBefore = Number(cost) - Number(priorLog.bookValueAfter);
    return {
      openingWdv: Number(priorLog.bookValueAfter),
      source: "PRIOR_LOG",
      accDepBefore: Math.max(0, accDepBefore),
    };
  }

  // 2. Legacy migration path
  if (asset.isLegacyAsset && asset.migrationDate && asset.openingWdvAtMigration != null) {
    const migrationFY = getFYContext(new Date(asset.migrationDate));
    if (fy.fyStart.getTime() === migrationFY.fyStart.getTime()) {
      return {
        openingWdv: Number(asset.openingWdvAtMigration),
        source: "MIGRATION",
        accDepBefore: Number(asset.accDepAtMigration ?? 0),
      };
    }
  }

  // 3. Fallback — first FY ever for this asset
  return { openingWdv: cost, source: "PURCHASE_COST", accDepBefore: 0 };
}

/* ── Core split-method calculation ───────────────────────────────────────── */

/**
 * Compute one FY's depreciation for one asset using split-method:
 *  - Opening WDV  → full rate
 *  - Additions    → full rate if Apr-Sep, half rate if Oct-Mar (in year of acquisition)
 *
 * For our model (one Asset = one purchase), the "addition" only happens in the
 * asset's first FY. Subsequent years run at full rate on the carried-forward WDV.
 */
export async function calculateAssetFYDepreciation(
  asset: AssetForDep,
  cfg: DepreciationConfig,
  fy: FYContext
): Promise<FYDepreciationResult> {
  const cost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);

  // ── Legacy guard: skip periods before migrationDate ─────────────────────
  if (asset.isLegacyAsset && asset.migrationDate) {
    const migration = new Date(asset.migrationDate);
    if (fy.fyEnd < migration) {
      return emptyResult(fy, 0, 0, true);
    }
  }

  // ── Resolve opening WDV ──────────────────────────────────────────────────
  const { openingWdv, source, accDepBefore } = await resolveOpeningWdv(asset, cost, fy);

  // ── Determine if THIS FY is the asset's first FY of depreciation ────────
  const acquisitionDate = new Date(
    asset.originalPurchaseDate ?? asset.purchaseDate ?? cfg.depreciationStart
  );
  const acquisitionFY = getFYContext(acquisitionDate);
  const isFirstFY = (
    fy.fyStart.getTime() === acquisitionFY.fyStart.getTime() &&
    source === "PURCHASE_COST"
  );

  // For legacy CARRY_AS_NEW mode → treat migrationDate as the addition date
  let additionsAmount = 0;
  let halfYearApplied = false;
  if (isFirstFY) {
    additionsAmount = cost;
    halfYearApplied = isSecondHalfOfIndianFY(acquisitionDate);
  }

  // ── Compute depreciation ─────────────────────────────────────────────────
  const fullRate = cfg.rate / 100;
  let depOnOpening = 0;
  let depOnAdditions = 0;

  if (cfg.method === "SL") {
    // SL: simple annual = (cost − salvage) / lifeYears, evenly distributed
    const annual = (cost - cfg.salvage) / Math.max(1, cfg.lifeYears);
    if (isFirstFY) {
      depOnAdditions = halfYearApplied ? annual / 2 : annual;
    } else {
      depOnOpening = annual;
    }
  } else if (cfg.method === "DB") {
    // DB split: opening WDV at full rate, additions at full/half
    if (!isFirstFY) {
      depOnOpening = openingWdv * fullRate;
    } else {
      const effRate = halfYearApplied ? fullRate / 2 : fullRate;
      depOnAdditions = additionsAmount * effRate;
    }
  }

  // ── Cap at salvage floor ─────────────────────────────────────────────────
  const grossWdv = openingWdv + (isFirstFY && source !== "PURCHASE_COST" ? additionsAmount : 0);
  const totalDep = depOnOpening + depOnAdditions;
  const maxAllowed = Math.max(0, grossWdv - cfg.salvage);
  let capped = Math.min(totalDep, maxAllowed);
  capped = applyRoundOff(capped, cfg.roundOff, cfg.decimalPlaces);

  // Re-distribute the cap proportionally
  if (totalDep > 0 && capped < totalDep) {
    const ratio = capped / totalDep;
    depOnOpening = Number((depOnOpening * ratio).toFixed(2));
    depOnAdditions = Number((depOnAdditions * ratio).toFixed(2));
  } else {
    depOnOpening = applyRoundOff(depOnOpening, cfg.roundOff, cfg.decimalPlaces);
    depOnAdditions = applyRoundOff(depOnAdditions, cfg.roundOff, cfg.decimalPlaces);
  }

  const depreciationAmount = Number((depOnOpening + depOnAdditions).toFixed(2));
  const closingWdv = applyRoundOff(grossWdv - depreciationAmount, cfg.roundOff, cfg.decimalPlaces);
  const effectiveRate = isFirstFY ? (halfYearApplied ? cfg.rate / 2 : cfg.rate) : cfg.rate;

  return {
    fyLabel: fy.fyLabel,
    periodStart: fy.fyStart,
    periodEnd: fy.fyEnd,
    openingWdv,
    openingWdvSource: source,
    additionsAmount,
    isFirstFY,
    halfYearApplied,
    effectiveRate,
    depOnOpening,
    depOnAdditions,
    depreciationAmount,
    closingWdv,
    accDepBefore,
    accDepAfter: Number((accDepBefore + depreciationAmount).toFixed(2)),
    preMigrationSkipped: false,
  };
}

function emptyResult(fy: FYContext, openingWdv: number, accDep: number, skipped: boolean): FYDepreciationResult {
  return {
    fyLabel: fy.fyLabel,
    periodStart: fy.fyStart,
    periodEnd: fy.fyEnd,
    openingWdv,
    openingWdvSource: "MIGRATION",
    additionsAmount: 0,
    isFirstFY: false,
    halfYearApplied: false,
    effectiveRate: 0,
    depOnOpening: 0,
    depOnAdditions: 0,
    depreciationAmount: 0,
    closingWdv: openingWdv,
    accDepBefore: accDep,
    accDepAfter: accDep,
    preMigrationSkipped: skipped,
  };
}

/* ── Persistence helper ──────────────────────────────────────────────────── */

/**
 * Writes a log row AND commits it to the asset's running totals in one step,
 * so it is booked immediately — status APPROVED. Draft batch rows are written
 * by the batch-run code directly and never pass through here.
 */
export async function persistDepreciationResult(params: {
  assetId: number;
  depRecordId: number;
  result: FYDepreciationResult;
  doneById: number | null;
  reason: string;
  batchRunId?: number | null;
}) {
  const { assetId, depRecordId, result, doneById, reason, batchRunId } = params;
  return prisma.$transaction(async (tx) => {
    // Snapshot the category this period is charged under (see schema comment).
    const cat = await tx.asset.findUnique({ where: { id: assetId }, select: { assetCategoryId: true } });

    const log = await tx.depreciationLog.create({
      data: {
        assetId,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        depreciationAmount: result.depreciationAmount.toFixed(2),
        bookValueAfter: result.closingWdv.toFixed(2),
        fyLabel: result.fyLabel,
        openingWdv: result.openingWdv.toFixed(2),
        depOnOpening: result.depOnOpening.toFixed(2),
        depOnAdditions: result.depOnAdditions.toFixed(2),
        additionsAmount: result.additionsAmount.toFixed(2),
        effectiveRate: result.effectiveRate.toFixed(4),
        halfYearApplied: result.halfYearApplied,
        isFirstFY: result.isFirstFY,
        openingWdvSource: result.openingWdvSource,
        doneById: doneById ?? null,
        reason,
        batchRunId: batchRunId ?? null,
        status: "APPROVED",
        assetCategoryId: cat?.assetCategoryId ?? null,
      } as any,
    });

    const updated = await tx.assetDepreciation.update({
      where: { id: depRecordId },
      data: {
        accumulatedDepreciation: result.accDepAfter.toFixed(2),
        currentBookValue: result.closingWdv.toFixed(2),
        lastCalculatedAt: result.periodEnd,
        updatedById: doneById ?? null,
      } as any,
    });

    return { log, updated };
  });
}

/* ── Backfill historical logs ─────────────────────────────────────────── */

/**
 * Generate one DepreciationLog entry per completed FY between the asset's
 * effective start date and today. Used at import / manual creation time to
 * ensure historical FA Schedule reports show the correct per-FY values.
 *
 * Effective start date priority:
 *   1. asset.financialYearAdded (pool-individualized assets)
 *   2. asset.migrationDate (legacy migration assets)
 *   3. cfg.depreciationStart (regular assets)
 *
 * Skips if logs already exist for the asset (prevents duplicate generation).
 */
export async function backfillHistoricalDepreciation(
  assetId: number,
  depRecordId: number,
  asset: AssetForDep & { financialYearAdded?: string | null; assetPoolId?: number | null },
  cfg: DepreciationConfig,
  doneById: number | null = null,
): Promise<{ created: number; skipped: number; latestFy: string | null }> {
  // Skip if any logs already exist. Rejected rows don't count — they were never
  // booked, so an asset with only rejected history still needs its backfill.
  const existingLogCount = await prisma.depreciationLog.count({
    where: { assetId, status: { not: "REJECTED" } },
  });
  if (existingLogCount > 0) {
    return { created: 0, skipped: existingLogCount, latestFy: null };
  }

  // Determine the effective start FY
  let startDate: Date | null = null;

  // Priority 1: pool-individualized → start from financialYearAdded FY end (handover point)
  if (asset.assetPoolId && asset.financialYearAdded) {
    // Parse FY string like "FY2024-25" → start year = 2024
    const m = asset.financialYearAdded.match(/FY(\d{4})/);
    if (m) {
      const fyStartYear = Number(m[1]);
      // Use first day of next FY (handover happened at end of pool's FY)
      startDate = new Date(fyStartYear + 1, 3, 1); // Apr 1 of next year
    }
  }

  // Priority 2: legacy migration → start from migrationDate FY
  if (!startDate && asset.isLegacyAsset && asset.migrationDate) {
    const migDate = new Date(asset.migrationDate);
    const migFY = getFYContext(migDate);
    startDate = new Date(migFY.fyEnd.getTime() + 86400000); // day after migration FY end
  }

  // Priority 3: regular asset → start from depreciationStart
  if (!startDate) {
    startDate = new Date(cfg.depreciationStart);
  }

  if (!startDate || isNaN(startDate.getTime())) {
    return { created: 0, skipped: 0, latestFy: null };
  }

  const today = new Date();
  let fy = getFYContext(startDate);
  let created = 0;
  let latestFy: string | null = null;

  // Locked years (finalized, or awaiting CFO) are never written into. A
  // finalized year's figures live in its frozen snapshot, and the next open
  // year opens from that (resolveOpeningWdv), so skipping keeps the chain
  // intact. Queried here rather than via utilis/fyLock, which imports this file.
  const lockedYears = new Set(
    (await prisma.financialYearClose.findMany({
      where: { status: { in: ["PENDING_CFO", "FINALIZED"] } },
      select: { fiscalYear: true },
    })).map((r) => r.fiscalYear)
  );

  // Loop through each completed FY up to (but not including) the current FY
  while (fy.fyEnd < today) {
    if (lockedYears.has(fy.fyStart.getFullYear())) {
      fy = getFYContext(new Date(fy.fyEnd.getTime() + 86400000));
      continue;
    }
    const result = await calculateAssetFYDepreciation(asset, cfg, fy);

    if (!result.preMigrationSkipped && result.depreciationAmount >= 0) {
      await persistDepreciationResult({
        assetId,
        depRecordId,
        result,
        doneById,
        reason: "BACKFILL",
      });
      created++;
      latestFy = result.fyLabel;
    }

    // Advance to next FY
    fy = getFYContext(new Date(fy.fyEnd.getTime() + 86400000));
  }

  return { created, skipped: 0, latestFy };
}

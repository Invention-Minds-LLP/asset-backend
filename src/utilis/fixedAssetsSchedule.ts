/**
 * Fixed Assets Schedule — the single computation behind:
 *   • the live FA Schedule report (reports.controller getFixedAssetsSchedule)
 *   • the per-asset snapshot frozen when a financial year is finalized
 *   • the finalized-year FA Schedule, rebuilt from that snapshot
 *
 * Split in two so a finalized year goes through exactly the same arithmetic as
 * a live one:
 *   buildScheduleLines()      — per-asset and per-pool figures for one FY
 *   aggregateScheduleLines()  — category rows + grand total from those lines
 *
 * The line builder is the body of the original getFixedAssetsSchedule, moved
 * here unchanged in its arithmetic (and in the ORDER of additions, which is
 * what makes the float totals reproduce exactly). Don't "tidy" the maths here
 * without re-diffing the report output — a finalized year's figures are only
 * as trustworthy as this function's stability.
 */
import prisma from "../prismaClient";
import { BOOKED_LOG_WHERE } from "./depreciationEngine";

// ─── Indian IT Act 180-day convention helpers ─────────────────────────────────
// Assets purchased Oct–Mar (second half of Indian FY Apr–Mar) get 50% rate in year 1.
export function _faIsSecondHalfFY(date: Date): boolean {
  const m = date.getMonth(); // 0=Jan … 11=Dec
  return m >= 9 || m <= 2;  // Oct(9), Nov(10), Dec(11), Jan(0), Feb(1), Mar(2)
}

// Replay WDV per Indian FY (Apr 1 – Mar 31) from depStart and return the WDV at targetDate.
// Year of acquisition: half-rate if depStart falls in Oct–Mar (second half), else full rate.
// All subsequent FYs: full rate. Stops once a completed FY would extend past targetDate.
export function _wdvAtDate(cost: number, salvage: number, rate: number, depStart: Date, targetDate: Date): number {
  let wdv = cost;
  // Acquisition FY start = Apr 1 of (depStart year if month >= Apr, else previous year)
  const acqMonth = depStart.getMonth();
  const acqFYStartYear = acqMonth >= 3 ? depStart.getFullYear() : depStart.getFullYear() - 1;
  let fyStartYear = acqFYStartYear;
  let isFirstFY = true;

  while (wdv > salvage) {
    // Each iteration represents one Indian FY: Apr 1 fyStartYear → Mar 31 (fyStartYear+1)
    const fyEnd = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999); // Mar 31 end-of-day
    if (fyEnd > targetDate) break; // targetDate falls inside this FY → don't apply its dep yet

    const effectiveRate = (isFirstFY && _faIsSecondHalfFY(depStart)) ? rate / 200 : rate / 100;
    const dep = Math.min(wdv * effectiveRate, Math.max(0, wdv - salvage));
    wdv = Math.max(salvage, wdv - dep);

    isFirstFY = false;
    fyStartYear += 1;
  }

  return wdv;
}

/** FY boundaries exactly as the FA Schedule report has always computed them. */
export function scheduleFyBounds(fiscalYear: number) {
  return {
    fyStart: new Date(`${fiscalYear}-04-01T00:00:00.000`),
    fyEnd: new Date(`${fiscalYear + 1}-03-31T23:59:59.999`),
    fyLabel: `FY${fiscalYear}-${String(fiscalYear + 1).slice(2)}`,
  };
}

export type ScheduleLine = {
  lineType: "ASSET" | "POOL";
  assetId: number | null;
  assetCode: string | null;
  assetName: string;
  serialNumber: string | null;
  modeOfProcurement: string | null;
  acquisitionDate: Date | null;
  disposalDate: Date | null;
  poolCode: string | null;
  assetCategoryId: number | null;
  categoryName: string;
  departmentId: number | null;
  branchId: number | null;
  rate: number;
  countsInRate: boolean;
  depSource: "LOG" | "COMPUTED" | "NONE" | "POOL";
  openingGross: number;
  additions: number;
  additions1H: number;
  additions2H: number;
  deletions: number;
  deletions1H: number;
  deletions2H: number;
  depOnOpening: number;
  depOnAdditions: number;
  closingAccDep: number;
  poolClosingGross: number | null;
  poolOpeningNetBlock: number | null;
  poolClosingNetBlock: number | null;
};

/**
 * Per-asset and per-pool figures for one FY. `branchId` narrows ASSET lines
 * only — undigitized pool balances were never branch-scoped in the report, and
 * still aren't.
 */
export async function buildScheduleLines(fiscalYear: number, opts: { branchId?: number } = {}): Promise<ScheduleLine[]> {
  const { fyStart, fyEnd, fyLabel } = scheduleFyBounds(fiscalYear);

  // Fetch all assets that could appear in this FY schedule
  const assets = await prisma.asset.findMany({
    where: {
      // Top-level assets only. A sub-asset's cost is already contained in its
      // parent's purchaseCost (e.g. "HP 280 G9 MT desktop ... with 21.5\"
      // monitor" carries a separate "Monitor" child), so counting both would
      // double-count gross block. Sub-assets also never carry a depreciation
      // rate, so they would inflate gross while contributing zero depreciation.
      parentAssetId: null,
      // Include purchased AND donated assets. Donations carry their date in
      // donationDate (and value in estimatedValue), so match on either date.
      OR: [
        { purchaseDate: { lte: fyEnd } },
        { donationDate: { lte: fyEnd } },
      ],
      ...(opts.branchId ? { currentBranchId: opts.branchId } : {}),
    },
    select: {
      id: true,
      assetId: true,
      serialNumber: true,
      assetName: true,
      assetNature: true,
      purchaseCost: true,
      purchaseDate: true,
      donationDate: true,
      estimatedValue: true,
      disposalDate: true,
      status: true,
      assetPoolId: true,
      financialYearAdded: true,
      modeOfProcurement: true,
      departmentId: true,
      currentBranchId: true,
      assetCategory: { select: { id: true, name: true } },
      depreciation: {
        select: {
          depreciationRate: true,
          depreciationMethod: true,
          depreciationStart: true,
          salvageValue: true,
          accumulatedDepreciation: true,
          currentBookValue: true,
        },
      },
    },
    orderBy: [{ assetCategory: { name: "asc" } }, { purchaseDate: "asc" }],
  });

  // ── Pre-fetch all BOOKED depreciation logs covering the selected FY ─────────
  // Source-of-truth: if a log exists for an asset's FY, use it.
  // Otherwise fall back to on-the-fly calculation via _wdvAtDate().
  const fyLogs = await prisma.depreciationLog.findMany({
    where: {
      assetId: { in: assets.map(a => a.id) },
      periodStart: { gte: fyStart, lte: fyEnd },
      ...BOOKED_LOG_WHERE,
    },
    select: {
      assetId: true,
      depreciationAmount: true,
      bookValueAfter: true,
      openingWdv: true,
      depOnOpening: true,
      depOnAdditions: true,
    },
  });
  const logByAssetId = new Map<number, typeof fyLogs[0]>();
  for (const l of fyLogs) logByAssetId.set(l.assetId, l);

  const isSecondHalf = (d: Date) => { const m = d.getMonth(); return m >= 9 || m <= 2; };

  const lines: ScheduleLine[] = [];

  for (const asset of assets) {
    // Cost basis & acquisition date fall back to the donation equivalents,
    // so donated assets are capitalised at their estimated (fair) value.
    const cost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
    const acqDate = asset.purchaseDate ?? asset.donationDate;
    const purchaseDate = acqDate ? new Date(acqDate) : null;
    const disposalDate = asset.disposalDate ? new Date(asset.disposalDate) : null;

    // ── Skip pool-individualized assets for years before their handover ─────
    // Pool-individualized assets only "exist" as standalone records from
    // financialYearAdded onward. For prior years, the pool schedule is the
    // source of truth — so don't double-count.
    if (asset.assetPoolId && asset.financialYearAdded) {
      const m = String(asset.financialYearAdded).match(/FY(\d{4})/);
      if (m) {
        const handoverFyStart = Number(m[1]);
        if (fiscalYear < handoverFyStart) continue;
      }
    }

    const isDisposedBeforeFY = disposalDate && disposalDate < fyStart;
    const isDisposedInFY = disposalDate && disposalDate >= fyStart && disposalDate <= fyEnd;
    const isAcquiredBeforeFY = purchaseDate && purchaseDate < fyStart;
    const isAcquiredInFY = purchaseDate && purchaseDate >= fyStart && purchaseDate <= fyEnd;

    let aOpeningGross = 0, aAdditions = 0, aDeletions = 0;
    let aAdditions1H = 0, aAdditions2H = 0, aDeletions1H = 0, aDeletions2H = 0;
    let aDepOnOpening = 0, aDepOnAdditions = 0, aClosingAccDep = 0;
    let aAssetRate = 0;
    let countsInRate = false;
    let depSource: ScheduleLine["depSource"] = "NONE";

    // Opening Gross Block: acquired before FY start, not disposed before FY start
    if (isAcquiredBeforeFY && !isDisposedBeforeFY) {
      aOpeningGross = cost;
    }

    // Additions: acquired during FY — split by half
    if (isAcquiredInFY && purchaseDate) {
      aAdditions = cost;
      if (isSecondHalf(purchaseDate)) { aAdditions2H = cost; }
      else { aAdditions1H = cost; }
    }

    // Deletions: disposed during FY — split by half
    if (isDisposedInFY && disposalDate) {
      aDeletions = cost;
      if (isSecondHalf(disposalDate)) { aDeletions2H = cost; }
      else { aDeletions1H = cost; }
    }

    const dep = asset.depreciation;
    if (dep) {
      const assetRate    = Number(dep.depreciationRate || 0);
      aAssetRate         = assetRate;
      const method       = dep.depreciationMethod;
      const depStart     = dep.depreciationStart ? new Date(dep.depreciationStart) : purchaseDate;
      const salvageVal   = Number(dep.salvageValue ?? 0);

      if (assetRate > 0) countsInRate = true;

      // ── Source-of-truth: prefer a booked DepreciationLog for this FY ──
      const fyLog = logByAssetId.get(asset.id);

      if (fyLog) {
        depSource = "LOG";
        const logDep = Number(fyLog.depreciationAmount);
        const logBookAfter = Number(fyLog.bookValueAfter);
        const logDepOnOpen = Number(fyLog.depOnOpening ?? 0);
        const logDepOnAdd = Number(fyLog.depOnAdditions ?? 0);

        aClosingAccDep = Math.max(0, cost - logBookAfter);
        aDepOnOpening  = logDepOnOpen;
        aDepOnAdditions = logDepOnAdd;

        // If split components are missing (older logs), fall back to total
        if (logDepOnOpen === 0 && logDepOnAdd === 0) {
          if (isAcquiredInFY) aDepOnAdditions += logDep;
          else aDepOnOpening += logDep;
        }
      } else {
        depSource = "COMPUTED";
        // ── No log → calculate on-the-fly (estimated) ──────────────────────
        if (isAcquiredBeforeFY && !isDisposedBeforeFY && assetRate > 0 && depStart) {
          if (method === "DB") {
            const openingWDV = _wdvAtDate(cost, salvageVal, assetRate, depStart, fyStart);
            const closingWDV = _wdvAtDate(cost, salvageVal, assetRate, depStart, fyEnd);
            aClosingAccDep = Math.max(0, cost - closingWDV);
            aDepOnOpening  = Math.min(openingWDV * assetRate / 100, Math.max(0, openingWDV - salvageVal));
          } else {
            const yearsElapsed = Math.max(0, (fyEnd.getTime() - depStart.getTime()) / (365.25 * 86400000));
            const annualSL = (cost - salvageVal) * assetRate / 100;
            aClosingAccDep = Math.min((cost - salvageVal), annualSL * yearsElapsed);
            aDepOnOpening  = Math.min(annualSL, Math.max(0, cost - salvageVal));
          }
        } else if (isAcquiredInFY && assetRate > 0 && purchaseDate) {
          // First-FY addition: half-year rule for DB
          if (method === "DB") {
            const halfYear = _faIsSecondHalfFY(purchaseDate);
            const d = cost * (halfYear ? assetRate / 200 : assetRate / 100);
            aDepOnAdditions = d;
            aClosingAccDep  = d;
          } else {
            const d = Math.min((cost - salvageVal) * assetRate / 100, Math.max(0, cost - salvageVal));
            aDepOnAdditions = d;
            aClosingAccDep  = d;
          }
        }
      }
    }

    lines.push({
      lineType: "ASSET",
      assetId: asset.id,
      assetCode: asset.assetId ?? null,
      assetName: asset.assetName,
      serialNumber: asset.serialNumber ?? null,
      modeOfProcurement: (asset as any).modeOfProcurement ?? null,
      acquisitionDate: purchaseDate,
      disposalDate,
      poolCode: null,
      assetCategoryId: asset.assetCategory?.id ?? null,
      categoryName: asset.assetCategory?.name || "Uncategorized",
      departmentId: (asset as any).departmentId ?? null,
      branchId: (asset as any).currentBranchId ?? null,
      rate: aAssetRate,
      countsInRate,
      depSource,
      openingGross: aOpeningGross,
      additions: aAdditions,
      additions1H: aAdditions1H,
      additions2H: aAdditions2H,
      deletions: aDeletions,
      deletions1H: aDeletions1H,
      deletions2H: aDeletions2H,
      depOnOpening: aDepOnOpening,
      depOnAdditions: aDepOnAdditions,
      closingAccDep: aClosingAccDep,
      poolClosingGross: null,
      poolOpeningNetBlock: null,
      poolClosingNetBlock: null,
    });
  }

  // ── Pool depreciation schedules for this FY ────────────────────────────────
  // The FA schedule stored per pool is the auditor-certified source of truth for
  // undigitized (not-yet-individualized) asset balances.
  const poolSchedules = await prisma.assetPoolDepreciationSchedule.findMany({
    where: { financialYear: fyLabel },
    include: {
      pool: {
        select: {
          id: true,
          poolCode: true,
          categoryId: true,
          category: { select: { name: true } },
          assets: {
            select: { id: true, purchaseCost: true, depreciation: { select: { accumulatedDepreciation: true } } },
          },
        },
      },
    },
  });

  // For each pool schedule, subtract what's already individualized so we don't double-count.
  for (const sched of poolSchedules) {
    const pool = sched.pool;
    const catName = pool.category?.name || "Uncategorized";

    // Sum costs of individual assets already extracted from this pool
    const extractedGross    = pool.assets.reduce((s: number, a: any) => s + Number(a.purchaseCost ?? 0), 0);
    const extractedAccDep   = pool.assets.reduce((s: number, a: any) => s + Number(a.depreciation?.accumulatedDepreciation ?? 0), 0);

    // Proportion of pool that is still undigitized
    const poolClosingGross  = Number(sched.closingGrossBlock);
    const remainingGross    = Math.max(0, poolClosingGross - extractedGross);
    const remainingRatio    = poolClosingGross > 0 ? remainingGross / poolClosingGross : 0;

    // Apply same ratio to all dep figures
    const remainingCloseDep    = +(Number(sched.closingAccumulatedDep) * remainingRatio - extractedAccDep).toFixed(2);
    const remainingOpenDep     = +(Number(sched.openingAccumulatedDep) * remainingRatio).toFixed(2);
    const remainingOpenGross   = +(Number(sched.openingGrossBlock) * remainingRatio).toFixed(2);
    const remainingAdditions   = +(Number(sched.additions) * remainingRatio).toFixed(2);
    const remainingAdditions1H = +(Number((sched as any).additionsFirstHalf ?? 0) * remainingRatio).toFixed(2);
    const remainingAdditions2H = +(Number((sched as any).additionsSecondHalf ?? 0) * remainingRatio).toFixed(2);
    const remainingDeletions   = +(Number(sched.deletions) * remainingRatio).toFixed(2);
    const remainingDeletions1H = +(Number((sched as any).deletionsFirstHalf ?? 0) * remainingRatio).toFixed(2);
    const remainingDeletions2H = +(Number((sched as any).deletionsSecondHalf ?? 0) * remainingRatio).toFixed(2);
    const remainingDepOnOpen   = +(Number((sched as any).depOnOpeningBlock ?? 0) * remainingRatio).toFixed(2);
    const remainingDepOnAddn   = +(Number((sched as any).depOnAdditions ?? 0) * remainingRatio).toFixed(2);
    const remainingOpenNet     = +(remainingOpenGross - remainingOpenDep).toFixed(2);
    const remainingCloseNet    = +(remainingGross - Math.max(0, remainingCloseDep)).toFixed(2);

    // Only add a pool remainder line if there's actually undigitized balance left
    if (remainingGross > 0) {
      lines.push({
        lineType: "POOL",
        assetId: null,
        assetCode: `POOL:${pool.poolCode ?? ""}`,
        assetName: `Asset Pool — ${pool.poolCode ?? ""} (undigitized balance)`,
        serialNumber: null,
        modeOfProcurement: null,
        acquisitionDate: null,
        disposalDate: null,
        poolCode: pool.poolCode ?? "",
        assetCategoryId: pool.categoryId ?? null,
        categoryName: catName,
        departmentId: null,
        branchId: null,
        rate: Number(sched.depreciationRate),
        countsInRate: true,
        depSource: "POOL",
        openingGross: remainingOpenGross,
        additions: remainingAdditions,
        additions1H: remainingAdditions1H,
        additions2H: remainingAdditions2H,
        deletions: remainingDeletions,
        deletions1H: remainingDeletions1H,
        deletions2H: remainingDeletions2H,
        depOnOpening: remainingDepOnOpen,
        depOnAdditions: remainingDepOnAddn,
        closingAccDep: Math.max(0, remainingCloseDep),
        poolClosingGross: +remainingGross.toFixed(2),
        poolOpeningNetBlock: remainingOpenNet,
        poolClosingNetBlock: remainingCloseNet,
      });
    }
  }

  return lines;
}

/**
 * Category rows + grand total from schedule lines, with the report's exact
 * category-level rules (additions without a half-year split default to 1H,
 * opening dep derived as closing − period and floored at 0, average rate over
 * lines that count toward it). Asset lines are consumed before pool lines
 * within each category, as the report always did.
 */
export function aggregateScheduleLines(lines: ScheduleLine[], opts: { collectAssetRows?: boolean } = {}) {
  // Category order = first appearance; asset lines precede pool lines, which
  // reproduces the report's order (asset categories, then pool-only ones).
  const order: string[] = [];
  const assetLinesByCat = new Map<string, ScheduleLine[]>();
  const poolLinesByCat = new Map<string, ScheduleLine[]>();
  for (const l of lines) {
    if (!assetLinesByCat.has(l.categoryName) && !poolLinesByCat.has(l.categoryName)) order.push(l.categoryName);
    const bucket = l.lineType === "POOL" ? poolLinesByCat : assetLinesByCat;
    if (!bucket.has(l.categoryName)) bucket.set(l.categoryName, []);
    bucket.get(l.categoryName)!.push(l);
  }

  const collectAssetRows = !!opts.collectAssetRows;
  const assetRowsByCategory = new Map<string, any[]>();

  const rows: any[] = [];
  let gOpenGross = 0, gAdditions = 0, gAdditions1H = 0, gAdditions2H = 0;
  let gDeletions = 0, gDeletions1H = 0, gDeletions2H = 0, gCloseGross = 0;
  let gOpenDep = 0, gDepOnOpening = 0, gDepOnAdditions = 0, gPeriodDep = 0, gCloseDep = 0;
  let gNetCurrent = 0, gNetPrevious = 0;

  for (const catName of order) {
    let openingGross = 0, additions = 0, additions1H = 0, additions2H = 0;
    let deletions = 0, deletions1H = 0, deletions2H = 0;
    let closingAccDep = 0;
    let depOnOpening = 0, depOnAdditions = 0;
    let totalRate = 0, rateCount = 0;

    if (collectAssetRows) assetRowsByCategory.set(catName, []);

    for (const a of assetLinesByCat.get(catName) ?? []) {
      openingGross += a.openingGross;
      additions    += a.additions;
      deletions    += a.deletions;
      additions1H  += a.additions1H;
      additions2H  += a.additions2H;
      deletions1H  += a.deletions1H;
      deletions2H  += a.deletions2H;
      if (a.countsInRate) { totalRate += a.rate; rateCount++; }
      closingAccDep  += a.closingAccDep;
      depOnOpening   += a.depOnOpening;
      depOnAdditions += a.depOnAdditions;

      // Per-asset row for the combined Excel writer / category drill-down.
      // Skip rows that are zero on every front (e.g. disposed-before-FY).
      if (collectAssetRows) {
        const aPeriodDep    = +(a.depOnOpening + a.depOnAdditions).toFixed(2);
        const aClosingGross = +(a.openingGross + a.additions - a.deletions).toFixed(2);
        const aOpeningDep   = +Math.max(0, a.closingAccDep - aPeriodDep).toFixed(2);
        const aNetCurrent   = +(aClosingGross - a.closingAccDep).toFixed(2);
        const aNetPrevious  = +(a.openingGross - aOpeningDep).toFixed(2);
        const aClosingDep   = +a.closingAccDep.toFixed(2);
        const isVisible =
          a.openingGross !== 0 || a.additions !== 0 || a.deletions !== 0 || aClosingDep !== 0;
        if (isVisible) {
          assetRowsByCategory.get(catName)!.push({
            assetIdCode:  a.assetCode ?? "",
            assetName:    a.assetName,
            serialNumber: a.serialNumber ?? "",
            modeOfProcurement: a.modeOfProcurement,
            acquisitionDate: a.acquisitionDate,
            openingGross: +a.openingGross.toFixed(2),
            additions:    +a.additions.toFixed(2),
            additions1H:  +a.additions1H.toFixed(2),
            additions2H:  +a.additions2H.toFixed(2),
            deletions:    +a.deletions.toFixed(2),
            deletions1H:  +a.deletions1H.toFixed(2),
            deletions2H:  +a.deletions2H.toFixed(2),
            closingGross: aClosingGross,
            rate:         a.rate,
            openingDep:   aOpeningDep,
            depOnOpening: +a.depOnOpening.toFixed(2),
            depOnAdditions: +a.depOnAdditions.toFixed(2),
            periodDep:    aPeriodDep,
            closingDep:   aClosingDep,
            netCurrent:   aNetCurrent,
            netPrevious:  aNetPrevious,
          });
        }
      }
    }

    const poolRemainders = poolLinesByCat.get(catName) ?? [];
    for (const pr of poolRemainders) {
      openingGross  += pr.openingGross;
      additions     += pr.additions;
      additions1H   += pr.additions1H;
      additions2H   += pr.additions2H;
      deletions     += pr.deletions;
      deletions1H   += pr.deletions1H;
      deletions2H   += pr.deletions2H;
      closingAccDep += pr.closingAccDep;
      depOnOpening  += pr.depOnOpening;
      depOnAdditions += pr.depOnAdditions;
      totalRate     += pr.rate;
      rateCount     += 1;

      // Combined export: surface pool-remainder balance as its own row so the
      // asset subtotal still reconciles to the category total.
      if (collectAssetRows) {
        const prPeriodDep = +(pr.depOnOpening + pr.depOnAdditions).toFixed(2);
        assetRowsByCategory.get(catName)!.push({
          assetIdCode: pr.assetCode ?? `POOL:${pr.poolCode}`,
          assetName: pr.assetName,
          serialNumber: "",
          openingGross: +pr.openingGross.toFixed(2),
          additions:    +pr.additions.toFixed(2),
          additions1H:  +pr.additions1H.toFixed(2),
          additions2H:  +pr.additions2H.toFixed(2),
          deletions:    +pr.deletions.toFixed(2),
          deletions1H:  +pr.deletions1H.toFixed(2),
          deletions2H:  +pr.deletions2H.toFixed(2),
          closingGross: +(pr.poolClosingGross ?? 0).toFixed(2),
          rate:         pr.rate,
          openingDep:   +Math.max(0, pr.closingAccDep - prPeriodDep).toFixed(2),
          depOnOpening: +pr.depOnOpening.toFixed(2),
          depOnAdditions: +pr.depOnAdditions.toFixed(2),
          periodDep:    prPeriodDep,
          closingDep:   +pr.closingAccDep.toFixed(2),
          netCurrent:   +(pr.poolClosingNetBlock ?? 0).toFixed(2),
          netPrevious:  +(pr.poolOpeningNetBlock ?? 0).toFixed(2),
          isPoolRow:    true,
        });
      }
    }

    // If additions exist but half-year split is incomplete (old pool data or assets without purchaseDate),
    // assign the unclassified portion so totals always match
    const addnClassified = additions1H + additions2H;
    if (additions > 0 && addnClassified < additions) {
      const unclassified = +(additions - addnClassified).toFixed(2);
      additions1H += unclassified; // default unclassified to 1H (full rate — conservative)
    }
    const delClassified = deletions1H + deletions2H;
    if (deletions > 0 && delClassified < deletions) {
      deletions1H += +(deletions - delClassified).toFixed(2);
    }

    const closingGross = openingGross + additions - deletions;
    const avgRate = rateCount > 0 ? +(totalRate / rateCount).toFixed(2) : 0;

    const periodDep = +(depOnOpening + depOnAdditions).toFixed(2);
    let openingDep = +(closingAccDep - periodDep).toFixed(2);
    if (openingDep < 0) openingDep = 0;

    const netCurrent  = +(closingGross - closingAccDep).toFixed(2);
    const netPrevious = +(openingGross - openingDep).toFixed(2);

    rows.push({
      category: catName,
      openingGross: +openingGross.toFixed(2),
      additions: +additions.toFixed(2),
      additions1H: +additions1H.toFixed(2),
      additions2H: +additions2H.toFixed(2),
      deletions: +deletions.toFixed(2),
      deletions1H: +deletions1H.toFixed(2),
      deletions2H: +deletions2H.toFixed(2),
      closingGross: +closingGross.toFixed(2),
      rate: avgRate,
      openingDep: +openingDep.toFixed(2),
      depOnOpening: +depOnOpening.toFixed(2),
      depOnAdditions: +depOnAdditions.toFixed(2),
      periodDep: +periodDep.toFixed(2),
      closingDep: +closingAccDep.toFixed(2),
      netCurrent: +netCurrent.toFixed(2),
      netPrevious: +netPrevious.toFixed(2),
      hasPoolBalance: poolRemainders.length > 0,
      poolCodes: poolRemainders.map(p => p.poolCode),
    });

    gOpenGross += openingGross; gAdditions += additions; gAdditions1H += additions1H; gAdditions2H += additions2H;
    gDeletions += deletions; gDeletions1H += deletions1H; gDeletions2H += deletions2H;
    gCloseGross += closingGross; gOpenDep += openingDep;
    gDepOnOpening += depOnOpening; gDepOnAdditions += depOnAdditions;
    gPeriodDep += periodDep; gCloseDep += closingAccDep;
    gNetCurrent += netCurrent; gNetPrevious += netPrevious;
  }

  const grandTotal = {
    openingGross: +gOpenGross.toFixed(2),
    additions: +gAdditions.toFixed(2), additions1H: +gAdditions1H.toFixed(2), additions2H: +gAdditions2H.toFixed(2),
    deletions: +gDeletions.toFixed(2), deletions1H: +gDeletions1H.toFixed(2), deletions2H: +gDeletions2H.toFixed(2),
    closingGross: +gCloseGross.toFixed(2),
    openingDep: +gOpenDep.toFixed(2),
    depOnOpening: +gDepOnOpening.toFixed(2), depOnAdditions: +gDepOnAdditions.toFixed(2),
    periodDep: +gPeriodDep.toFixed(2), closingDep: +gCloseDep.toFixed(2),
    netCurrent: +gNetCurrent.toFixed(2), netPrevious: +gNetPrevious.toFixed(2),
  };

  return { rows, grandTotal, assetRowsByCategory };
}

/* ── Snapshot ⇄ lines ──────────────────────────────────────────────────── */

const n = (v: any) => (v == null ? 0 : Number(v));
const nOrNull = (v: any) => (v == null ? null : Number(v));

/** Frozen FyAssetSnapshot rows back into schedule lines (same field meaning). */
export function linesFromSnapshot(snaps: any[]): ScheduleLine[] {
  return snaps.map((s) => ({
    lineType: s.lineType === "POOL" ? "POOL" : "ASSET",
    assetId: s.assetId ?? null,
    assetCode: s.assetCode ?? null,
    assetName: s.assetName,
    serialNumber: s.serialNumber ?? null,
    modeOfProcurement: s.modeOfProcurement ?? null,
    acquisitionDate: s.acquisitionDate ?? null,
    disposalDate: s.disposalDate ?? null,
    poolCode: s.poolCode ?? null,
    assetCategoryId: s.assetCategoryId ?? null,
    categoryName: s.categoryName,
    departmentId: s.departmentId ?? null,
    branchId: s.branchId ?? null,
    rate: n(s.rate),
    countsInRate: !!s.countsInRate,
    depSource: s.depSource,
    openingGross: n(s.openingGross),
    additions: n(s.additions),
    additions1H: n(s.additions1H),
    additions2H: n(s.additions2H),
    deletions: n(s.deletions),
    deletions1H: n(s.deletions1H),
    deletions2H: n(s.deletions2H),
    depOnOpening: n(s.depOnOpening),
    depOnAdditions: n(s.depOnAdditions),
    closingAccDep: n(s.closingAccDep),
    poolClosingGross: nOrNull(s.poolClosingGross),
    poolOpeningNetBlock: nOrNull(s.poolOpeningNetBlock),
    poolClosingNetBlock: nOrNull(s.poolClosingNetBlock),
  }));
}

/** Schedule lines → FyAssetSnapshot create payloads (6 dp, as the column holds). */
export function snapshotRowsFromLines(lines: ScheduleLine[], financialYearCloseId: number, fiscalYear: number) {
  const d6 = (v: number) => Number(v || 0).toFixed(6);
  const d6OrNull = (v: number | null) => (v == null ? null : Number(v).toFixed(6));
  return lines.map((l) => ({
    financialYearCloseId,
    fiscalYear,
    lineType: l.lineType,
    assetId: l.assetId,
    assetCode: l.assetCode,
    assetName: l.assetName,
    serialNumber: l.serialNumber,
    modeOfProcurement: l.modeOfProcurement,
    acquisitionDate: l.acquisitionDate,
    disposalDate: l.disposalDate,
    poolCode: l.poolCode,
    assetCategoryId: l.assetCategoryId,
    categoryName: l.categoryName,
    departmentId: l.departmentId,
    branchId: l.branchId,
    rate: Number(l.rate || 0).toFixed(2),
    countsInRate: l.countsInRate,
    depSource: l.depSource,
    openingGross: d6(l.openingGross),
    additions: d6(l.additions),
    additions1H: d6(l.additions1H),
    additions2H: d6(l.additions2H),
    deletions: d6(l.deletions),
    deletions1H: d6(l.deletions1H),
    deletions2H: d6(l.deletions2H),
    depOnOpening: d6(l.depOnOpening),
    depOnAdditions: d6(l.depOnAdditions),
    closingAccDep: d6(l.closingAccDep),
    poolClosingGross: d6OrNull(l.poolClosingGross),
    poolOpeningNetBlock: d6OrNull(l.poolOpeningNetBlock),
    poolClosingNetBlock: d6OrNull(l.poolClosingNetBlock),
  }));
}

/**
 * Lines for a finalized year, from its snapshot. `branchId` narrows ASSET
 * lines only, matching buildScheduleLines. Returns null if the year is not
 * finalized — callers then compute live.
 */
export async function finalizedScheduleLines(fiscalYear: number, opts: { branchId?: number } = {}) {
  const close = await prisma.financialYearClose.findUnique({
    where: { fiscalYear },
    select: { id: true, status: true, approvedAt: true, fyLabel: true },
  });
  if (!close || close.status !== "FINALIZED") return null;

  const snaps = await prisma.fyAssetSnapshot.findMany({
    where: { financialYearCloseId: close.id },
    orderBy: { id: "asc" }, // insertion order = the live builder's order
  });
  let lines = linesFromSnapshot(snaps);
  if (opts.branchId) lines = lines.filter((l) => l.lineType === "POOL" || l.branchId === opts.branchId);
  return { lines, finalizedAt: close.approvedAt };
}

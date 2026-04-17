/**
 * Depreciation Cron Jobs
 * ----------------------
 * - Year-End:    Apr 1 — generate draft batch run for the just-closed FY
 * - Quarterly:   Jul 1, Oct 1, Jan 1 — non-binding preview of running depreciation
 * - Pre-Audit:   Mar 25 — capture System NB / AccDep snapshot per category for auditor
 */
import { Request, Response } from "express";
import prisma from "../../prismaClient";
import {
  calculateAssetFYDepreciation,
  getFYContext,
  effectiveResidualValue,
  type AssetForDep,
  type DepreciationConfig,
} from "../../utilis/depreciationEngine";

// ── POST /cron-jobs/year-end-depreciation ─────────────────────────────────
export const runYearEndDepreciation = async (_req: Request, res: Response) => {
  try {
    const result = await yearEndDepreciationCore({ preview: false });
    res.json({ message: "Year-end depreciation draft generated", ...result });
  } catch (err: any) {
    console.error("[Year-end Dep] error:", err);
    res.status(500).json({ message: "Year-end depreciation failed", error: err.message });
  }
};

// ── POST /cron-jobs/quarterly-preview ─────────────────────────────────────
export const runQuarterlyPreview = async (_req: Request, res: Response) => {
  try {
    const result = await yearEndDepreciationCore({ preview: true });
    res.json({ message: "Quarterly preview generated", ...result });
  } catch (err: any) {
    console.error("[Quarterly Preview] error:", err);
    res.status(500).json({ message: "Quarterly preview failed", error: err.message });
  }
};

// ── POST /cron-jobs/pre-audit-snapshot ────────────────────────────────────
export const runPreAuditSnapshot = async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    const fyEnd = today.getMonth() >= 3
      ? new Date(today.getFullYear() + 1, 2, 31)
      : new Date(today.getFullYear(), 2, 31);

    const categories = await prisma.assetCategory.findMany();
    let count = 0;
    let flagged = 0;

    for (const cat of categories) {
      const assets = await prisma.asset.findMany({
        where: { assetCategoryId: cat.id },
        include: { depreciation: true },
      });
      const sysGross = assets.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
      const sysAccDep = assets.reduce((s, a) => s + Number(a.depreciation?.accumulatedDepreciation ?? 0), 0);
      const sysNet = sysGross - sysAccDep;
      const audited = assets.reduce((s, a: any) => s + Number(a.auditedBookValueAtMigration ?? 0), 0);
      const variance = audited > 0 ? sysNet - audited : 0;
      const isFlagged = Math.abs(variance) > 1;

      await prisma.reconciliationSnapshot.create({
        data: {
          asOfDate: fyEnd, scope: "CATEGORY", scopeId: cat.id, scopeLabel: cat.name,
          systemGrossBlock: sysGross.toFixed(2),
          systemAccDep:     sysAccDep.toFixed(2),
          systemNetBlock:   sysNet.toFixed(2),
          auditNetBlock:    audited > 0 ? audited.toFixed(2) : null,
          varianceVsAudit:  variance.toFixed(2),
          varianceFlagged:  isFlagged,
        } as any,
      });
      count++;
      if (isFlagged) flagged++;
    }

    console.log("[Pre-Audit Snapshot] " + count + " category snapshots, " + flagged + " flagged");
    res.json({
      message: "Pre-audit reconciliation snapshot generated",
      asOfDate: fyEnd, total: count, flagged,
    });
  } catch (err: any) {
    console.error("[Pre-Audit Snapshot] error:", err);
    res.status(500).json({ message: "Pre-audit snapshot failed", error: err.message });
  }
};

/* ── Core year-end / preview helper ──────────────────────────────────── */
async function yearEndDepreciationCore(opts: { preview: boolean }) {
  const today = new Date();
  // Target = the FY that has already ended and is most recent
  const targetFYEnd = getFYContext(new Date(today.getTime() - 86400000));

  const depreciations = await (prisma as any).assetDepreciation.findMany({
    where: { isActive: true },
    include: {
      asset: {
        select: {
          id: true, assetId: true, assetName: true, purchaseCost: true,
          estimatedValue: true, purchaseDate: true,
          isLegacyAsset: true, migrationMode: true, migrationDate: true,
          originalPurchaseDate: true, originalCost: true,
          accDepAtMigration: true, openingWdvAtMigration: true,
        },
      },
    },
  });

  const eligible: any[] = [];
  for (const dep of depreciations) {
    const cost = Number(dep.asset.purchaseCost ?? dep.asset.estimatedValue ?? 0);
    const salvage = effectiveResidualValue(cost, Number(dep.salvageValue ?? 0));

    if (dep.lastCalculatedAt && new Date(dep.lastCalculatedAt) >= targetFYEnd.fyEnd) continue;

    const a: AssetForDep = {
      id: dep.asset.id, assetId: dep.asset.assetId,
      purchaseCost: cost, estimatedValue: Number(dep.asset.estimatedValue ?? 0),
      purchaseDate: dep.asset.purchaseDate, installedAt: null,
      isLegacyAsset: dep.asset.isLegacyAsset,
      migrationMode: dep.asset.migrationMode,
      migrationDate: dep.asset.migrationDate,
      originalPurchaseDate: dep.asset.originalPurchaseDate,
      originalCost: dep.asset.originalCost,
      accDepAtMigration: dep.asset.accDepAtMigration,
      openingWdvAtMigration: dep.asset.openingWdvAtMigration,
    };
    const cfg: DepreciationConfig = {
      method: dep.depreciationMethod, rate: Number(dep.depreciationRate ?? 0),
      lifeYears: dep.expectedLifeYears, salvage,
      depreciationStart: new Date(dep.depreciationStart),
      frequency: dep.depreciationFrequency || "YEARLY",
      roundOff: dep.roundOff ?? false, decimalPlaces: dep.decimalPlaces ?? 2,
    };

    const result = await calculateAssetFYDepreciation(a, cfg, targetFYEnd);
    if (result.preMigrationSkipped || result.depreciationAmount <= 0) continue;
    eligible.push({ dep, result });
  }

  if (!eligible.length) {
    return {
      fyLabel: targetFYEnd.fyLabel, totalAssets: 0,
      totalDepreciation: 0, status: "NO_OP",
    };
  }

  const totalDep = eligible.reduce((s, e) => s + e.result.depreciationAmount, 0);

  if (opts.preview) {
    return {
      fyLabel: targetFYEnd.fyLabel,
      totalAssets: eligible.length,
      totalDepreciation: Number(totalDep.toFixed(2)),
      status: "PREVIEW",
      note: "Preview only — no records persisted",
    };
  }

  // Find a system user (first SUPERADMIN or first employee) for the run
  const sysUser = await prisma.employee.findFirst({ orderBy: { id: "asc" } });
  const runById = sysUser?.id ?? 1;

  const runNumber = "BDR-CRON-" + targetFYEnd.fyLabel + "-" + Date.now();

  const run = await (prisma as any).batchDepreciationRun.create({
    data: {
      runNumber, status: "DRAFT",
      fiscalYear: targetFYEnd.fyStart.getFullYear(),
      periodLabel: "Year-End " + targetFYEnd.fyLabel,
      totalAssets: eligible.length,
      totalDepreciation: totalDep.toFixed(2),
      runById,
    },
  });

  for (const e of eligible) {
    await prisma.depreciationLog.create({
      data: {
        assetId: e.dep.asset.id,
        periodStart: e.result.periodStart,
        periodEnd: e.result.periodEnd,
        depreciationAmount: e.result.depreciationAmount.toFixed(2),
        bookValueAfter: e.result.closingWdv.toFixed(2),
        fyLabel: e.result.fyLabel,
        openingWdv: e.result.openingWdv.toFixed(2),
        depOnOpening: e.result.depOnOpening.toFixed(2),
        depOnAdditions: e.result.depOnAdditions.toFixed(2),
        additionsAmount: e.result.additionsAmount.toFixed(2),
        effectiveRate: e.result.effectiveRate.toFixed(4),
        halfYearApplied: e.result.halfYearApplied,
        isFirstFY: e.result.isFirstFY,
        openingWdvSource: e.result.openingWdvSource,
        reason: "CRON_YEAR_END_DRAFT",
        batchRunId: run.id,
      } as any,
    });
  }

  console.log("[Year-End Dep] Draft " + runNumber + ": " + eligible.length + " assets, total " + totalDep.toFixed(2));

  return {
    runNumber, runId: run.id,
    fyLabel: targetFYEnd.fyLabel,
    totalAssets: eligible.length,
    totalDepreciation: Number(totalDep.toFixed(2)),
    status: "DRAFT",
    note: "Pending CFO approval to commit values",
  };
}

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// GET /cost-analysis/:id
export const getAssetCostAnalysis = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const assetDbId = Number(req.params.id);
    if (isNaN(assetDbId)) {
      res.status(400).json({ message: "Invalid asset id" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: assetDbId },
      include: {
        depreciation: true,
        assetCategory: { select: { name: true } },
      },
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    // ── Sub-assets (children) — collect their IDs for cost rollup ───────────
    const subAssets = await prisma.asset.findMany({
      where: { parentAssetId: assetDbId },
      select: { id: true, assetId: true, assetName: true, purchaseCost: true, status: true },
    });
    const subAssetIds = subAssets.map((s) => s.id);
    // Sum of sub-asset purchase costs (components bought new)
    const subAssetPurchaseCost = subAssets.reduce(
      (sum, s) => sum + Number(s.purchaseCost ?? 0), 0
    );
    // Replacement costs from SubAssetReplacement table
    const replacements = await (prisma as any).subAssetReplacement.findMany({
      where: { parentAssetId: assetDbId },
      select: { cost: true },
    });
    const subAssetReplacementCost = replacements.reduce(
      (sum: number, r: any) => sum + Number(r.cost ?? 0), 0
    );

    // All asset IDs to aggregate costs (parent + all sub-assets)
    const allAssetIds = [assetDbId, ...subAssetIds];

    // ── Repair / corrective tickets (parent + sub-assets) ────────────────────
    const repairTickets = await prisma.ticket.findMany({
      where: {
        assetId: { in: allAssetIds },
        status: { in: ["RESOLVED", "CLOSED"] as any },
        workCategory: { in: ["BREAKDOWN", "CORRECTIVE"] },
      },
      select: {
        id: true, totalCost: true, serviceCost: true, partsCost: true,
        serviceType: true, createdAt: true, assetId: true,
      },
    });

    const repairCount = repairTickets.length;
    let repairLabourCost = 0;
    let repairPartsCost = 0;
    for (const t of repairTickets) {
      repairLabourCost += Number(t.serviceCost ?? 0);
      repairPartsCost  += Number(t.partsCost  ?? 0);
    }
    const repairCost = repairLabourCost + repairPartsCost;

    // ── PM / maintenance history (parent + sub-assets) ───────────────────────
    const pmHistory = await prisma.maintenanceHistory.findMany({
      where: { assetId: { in: allAssetIds } },
      select: {
        id: true, totalCost: true, serviceCost: true, partsCost: true,
        serviceType: true, actualDoneAt: true,
      },
    });

    const pmCount = pmHistory.length;

    // Group PM cost by contract type
    let pmAmcCmcCost  = 0;
    let pmPaidCost    = 0;
    let pmInternalCost = 0;
    for (const h of pmHistory) {
      const cost = Number(h.totalCost ?? (Number(h.serviceCost ?? 0) + Number(h.partsCost ?? 0)));
      const type = (h.serviceType ?? "").toUpperCase();
      if (type === "AMC" || type === "CMC") pmAmcCmcCost  += cost;
      else if (type === "PAID")             pmPaidCost    += cost;
      else                                  pmInternalCost += cost;
    }
    const pmCost = pmAmcCmcCost + pmPaidCost + pmInternalCost;

    const totalMaintenanceCost = repairCost + pmCost + subAssetPurchaseCost + subAssetReplacementCost;

    // ── Depreciation / book value ────────────────────────────────────────────
    const dep = (asset as any).depreciation;
    const originalCost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);

    // Book value: use stored currentBookValue, else fall back to original cost
    const bookValueSource = dep?.currentBookValue != null ? "depreciation_record" : "original_cost";
    const currentBookValue = dep?.currentBookValue != null
      ? Number(dep.currentBookValue)
      : originalCost;

    const accumulatedDepreciation = dep?.accumulatedDepreciation != null
      ? Number(dep.accumulatedDepreciation)
      : (originalCost - currentBookValue);

    const depreciationMethod: string = dep?.depreciationMethod ?? "N/A";
    const depreciationRate   = dep?.depreciationRate != null ? Number(dep.depreciationRate) : null;
    const expectedLifeYears: number = dep?.expectedLifeYears ?? 0;
    const depreciationStart  = dep?.depreciationStart ?? asset.purchaseDate ?? asset.installedAt ?? null;

    // ── Age ──────────────────────────────────────────────────────────────────
    // Priority: purchaseDate > installedAt > depreciationStart
    const ageBasisDate = asset.purchaseDate ?? asset.installedAt ?? dep?.depreciationStart ?? null;
    let ageYears = 0;
    if (ageBasisDate) {
      ageYears = (Date.now() - new Date(ageBasisDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    }

    const remainingLifeYears = Math.max(0, expectedLifeYears - ageYears);

    // ── Historical (legacy) opening balance ──────────────────────────────────
    const historicalMaintenanceCost = Number((asset as any).historicalMaintenanceCost ?? 0);
    const historicalSparePartsCost  = Number((asset as any).historicalSparePartsCost ?? 0);
    const historicalOtherCost       = Number((asset as any).historicalOtherCost ?? 0);
    const totalHistoricalCost = historicalMaintenanceCost + historicalSparePartsCost + historicalOtherCost;
    // Lifetime TCO includes pre-system spend
    const lifetimeTotalMaintenanceCost = totalMaintenanceCost + totalHistoricalCost;

    // ── Avg cost per year ────────────────────────────────────────────────────
    // totalMaintenanceCost ÷ ageYears (since first recorded use)
    const costPerYear = ageYears > 0 ? totalMaintenanceCost / ageYears : 0;

    // ── Replacement cost estimate ────────────────────────────────────────────
    // Base = originalCost, escalated at 10% per year (medical equipment inflation proxy)
    const inflationRate = 0.10;
    const roundedAge    = Math.round(ageYears);
    const replacementCostEstimate = originalCost > 0
      ? Math.round(originalCost * Math.pow(1 + inflationRate, roundedAge))
      : null;

    // ── Revenue (from daily usage logs — actual + estimated) ─────────────────
    const revenueAgg = await (prisma as any).assetDailyUsageLog.aggregate({
      where: { assetId: assetDbId },
      _sum: { revenueGenerated: true, estimatedRevenue: true },
    });
    const actualRevenue    = Number(revenueAgg._sum.revenueGenerated ?? 0);
    const estimatedRevenue = Number(revenueAgg._sum.estimatedRevenue ?? 0);
    // Use actual if available, fall back to estimated
    const totalRevenue = actualRevenue > 0 ? actualRevenue : estimatedRevenue;
    const roi = totalRevenue > 0 && originalCost > 0
      ? ((totalRevenue - totalMaintenanceCost) / originalCost) * 100
      : null;

    // ── Recommendation ───────────────────────────────────────────────────────
    let recommendation: "REPLACE" | "REPAIR" | "MONITOR" = "MONITOR";
    const reasons: string[] = [];

    const maintenanceToPurchaseRatio = originalCost > 0 ? lifetimeTotalMaintenanceCost / originalCost : 0;
    const bookValueToPurchaseRatio   = originalCost > 0 ? currentBookValue / originalCost : 1;

    if (expectedLifeYears > 0 && ageYears >= expectedLifeYears) {
      recommendation = "REPLACE";
      reasons.push("Asset has exceeded its expected useful life.");
    }
    if (maintenanceToPurchaseRatio >= 0.75) {
      recommendation = "REPLACE";
      reasons.push(`Total maintenance cost is ≥75% of original cost.`);
    } else if (maintenanceToPurchaseRatio >= 0.5) {
      if (recommendation !== "REPLACE") recommendation = "REPAIR";
      reasons.push("Total maintenance cost is ≥50% of original cost — consider replacement soon.");
    }
    if (bookValueToPurchaseRatio <= 0.1 && originalCost > 0) {
      if (recommendation !== "REPLACE") recommendation = "REPLACE";
      reasons.push("Current book value is ≤10% of original cost (fully depreciated).");
    }
    if (repairCount >= 5) {
      if (recommendation === "MONITOR") recommendation = "REPAIR";
      reasons.push(`High breakdown frequency: ${repairCount} corrective repairs recorded.`);
    }
    if (reasons.length === 0) {
      reasons.push("Asset is within acceptable maintenance cost range and useful life.");
    }

    res.json({
      asset: {
        id: asset.id,
        assetId: asset.assetId,
        assetName: asset.assetName,
        category: (asset as any).assetCategory?.name,
        purchaseDate: asset.purchaseDate,
        installedAt: asset.installedAt,
        originalCost,
        ageYears:           Math.round(ageYears * 10) / 10,
        expectedLifeYears,
        remainingLifeYears: Math.round(remainingLifeYears * 10) / 10,
        currentBookValue,
        accumulatedDepreciation,
        depreciationMethod,
        depreciationRate,
        depreciationStart,
      },
      // Calculation breakdowns (shown in info tooltips on frontend)
      calc: {
        bookValue: {
          formula: "Original Cost − Accumulated Depreciation",
          originalCost,
          accumulatedDepreciation,
          result: currentBookValue,
          source: bookValueSource, // "depreciation_record" | "original_cost"
          method: depreciationMethod,
          rate: depreciationRate,
        },
        age: {
          formula: "Today − Purchase/Install Date (in years)",
          basisDate: ageBasisDate,
          basisField: asset.purchaseDate ? "purchaseDate" : asset.installedAt ? "installedAt" : "depreciationStart",
          result: Math.round(ageYears * 10) / 10,
        },
        maintenanceCost: {
          formula: "PM Cost (AMC/CMC + Paid + Internal) + Repair Cost (Labour + Parts) + Sub-Asset Costs",
          pmBreakdown: { amcCmc: pmAmcCmcCost, paid: pmPaidCost, internal: pmInternalCost, total: pmCost },
          repairBreakdown: { labour: repairLabourCost, parts: repairPartsCost, total: repairCost },
          subAssetBreakdown: {
            componentPurchaseCost: subAssetPurchaseCost,
            replacementCost: subAssetReplacementCost,
            total: subAssetPurchaseCost + subAssetReplacementCost,
            count: subAssets.length,
          },
          total: totalMaintenanceCost,
        },
        avgCostPerYear: {
          formula: "Total Maintenance Cost ÷ Asset Age (years)",
          totalMaintenanceCost,
          ageYears: Math.round(ageYears * 10) / 10,
          result: Math.round(costPerYear),
        },
        replacementCost: {
          formula: `Original Cost × (1 + ${inflationRate * 100}%)^Age`,
          originalCost,
          inflationRate,
          ageYearsRounded: roundedAge,
          result: replacementCostEstimate,
        },
        revenue: {
          formula: "Sum of actual revenue from daily usage logs (falls back to estimated if actual is zero)",
          totalRevenue,
          roi: roi != null ? Math.round(roi * 10) / 10 : null,
          roiFormula: "(Total Revenue − Total Maintenance Cost) ÷ Original Cost × 100",
        },
      },
      subAssets: subAssets.map((s) => ({
        id: s.id,
        assetId: s.assetId,
        assetName: s.assetName,
        purchaseCost: Number(s.purchaseCost ?? 0),
        status: s.status,
      })),
      legacy: (asset as any).isLegacyAsset ? {
        isLegacyAsset: true,
        dataAvailableSince: (asset as any).dataAvailableSince,
        historicalCostAsOf: (asset as any).historicalCostAsOf,
        historicalMaintenanceCost,
        historicalSparePartsCost,
        historicalOtherCost,
        totalHistoricalCost,
        historicalCostNote: (asset as any).historicalCostNote,
      } : null,
      summary: {
        repairCount,
        repairCost,
        repairLabourCost,
        repairPartsCost,
        pmCount,
        pmCost,
        pmAmcCmcCost,
        pmPaidCost,
        pmInternalCost,
        subAssetPurchaseCost,
        subAssetReplacementCost,
        totalMaintenanceCost,
        totalHistoricalCost,
        lifetimeTotalMaintenanceCost,
        costPerYear:                Math.round(costPerYear),
        maintenanceToPurchaseRatio: Math.round(maintenanceToPurchaseRatio * 100),
        replacementCostEstimate,
        totalRevenue,
        roi,
      },
      recommendation,
      reasons,
    });
  } catch (error: any) {
    console.error("Error in cost analysis:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /cost-analysis/alerts
export const getDepreciationAlerts = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const assets = await prisma.asset.findMany({
      where: {
        status: { notIn: ["DISPOSED", "SCRAPPED"] as any },
        depreciation: { isNot: null },
      },
      include: {
        depreciation: true,
        assetCategory: { select: { name: true } },
      },
    });

    const alerts: any[] = [];

    for (const asset of assets) {
      const dep = (asset as any).depreciation;
      if (!dep) continue;

      const originalCost      = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
      const currentBookValue  = dep.currentBookValue != null ? Number(dep.currentBookValue) : null;
      const expectedLifeYears: number = dep.expectedLifeYears ?? 0;

      const startDate = asset.purchaseDate ?? asset.installedAt ?? dep.depreciationStart;
      const ageYears  = startDate
        ? (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
        : 0;

      const alertTypes: string[] = [];
      if (expectedLifeYears > 0 && ageYears > expectedLifeYears)                            alertTypes.push("PAST_LIFE");
      if (expectedLifeYears > 0 && ageYears >= expectedLifeYears - 1 && ageYears < expectedLifeYears) alertTypes.push("NEARING_END_OF_LIFE");
      if (currentBookValue != null && originalCost > 0 && currentBookValue / originalCost <= 0.2)     alertTypes.push("LOW_BOOK_VALUE");

      if (alertTypes.length > 0) {
        alerts.push({
          assetDbId: asset.id,
          assetId:   asset.assetId,
          assetName: asset.assetName,
          category:  (asset as any).assetCategory?.name,
          originalCost,
          currentBookValue,
          ageYears:           Math.round(ageYears * 10) / 10,
          expectedLifeYears,
          alertTypes,
        });
      }
    }

    const priority = (a: any) =>
      a.alertTypes.includes("PAST_LIFE") ? 0 :
      a.alertTypes.includes("NEARING_END_OF_LIFE") ? 1 : 2;
    alerts.sort((a, b) => priority(a) - priority(b));

    res.json({ data: alerts, total: alerts.length });
  } catch (error: any) {
    console.error("Error fetching depreciation alerts:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /cost-analysis/:id/revenue — list revenue entries
export const getRevenueEntries = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const assetDbId = Number(req.params.id);
    const entries = await (prisma as any).assetRevenueEntry.findMany({
      where: { assetId: assetDbId },
      orderBy: { entryDate: "desc" },
    });
    const total = entries.reduce((s: number, e: any) => s + Number(e.totalRevenue), 0);
    res.json({ data: entries, total });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// POST /cost-analysis/:id/revenue — add a revenue entry
export const addRevenueEntry = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const assetDbId = Number(req.params.id);
    const { entryDate, revenueType, description, quantity = 1, unitRate, referenceNo } = req.body;

    if (!entryDate || !revenueType || unitRate == null) {
      res.status(400).json({ message: "entryDate, revenueType, and unitRate are required" });
      return;
    }

    const qty   = Number(quantity) || 1;
    const rate  = Number(unitRate);
    const total = qty * rate;

    const entry = await (prisma as any).assetRevenueEntry.create({
      data: {
        assetId:      assetDbId,
        entryDate:    new Date(entryDate),
        revenueType,
        description:  description || null,
        quantity:     qty,
        unitRate:     rate,
        totalRevenue: total,
        referenceNo:  referenceNo || null,
        recordedById: req.user?.id ?? null,
      },
    });

    res.status(201).json({ data: entry, message: "Revenue entry added" });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ─── Cost Allocation CRUD ────────────────────────────────────────────────────

// GET /cost-analysis/:id/allocations
export const getAllocations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetDbId = Number(req.params.id);
    const entries = await prisma.assetCostAllocation.findMany({
      where: { assetId: assetDbId },
      orderBy: { entryDate: 'desc' },
    });
    const total = entries.reduce((s, e) => s + Number(e.amount), 0);
    res.json({ data: entries, total: Number(total.toFixed(2)) });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// POST /cost-analysis/:id/allocations
export const addAllocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetDbId = Number(req.params.id);
    const { costType, amount, period, description, referenceType, referenceId, entryDate } = req.body;

    if (!costType || amount == null) {
      res.status(400).json({ message: 'costType and amount are required' });
      return;
    }

    const validTypes = ['LABOR', 'UTILITY_POWER', 'SPACE_FACILITY', 'OUTSOURCED_SERVICE', 'CONSUMABLE', 'OTHER'];
    if (!validTypes.includes(costType)) {
      res.status(400).json({ message: `costType must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const entry = await prisma.assetCostAllocation.create({
      data: {
        assetId:       assetDbId,
        costType,
        amount:        Number(amount),
        period:        period || null,
        description:   description || null,
        referenceType: referenceType || null,
        referenceId:   referenceId ? Number(referenceId) : null,
        entryDate:     entryDate ? new Date(entryDate) : new Date(),
        createdById:   req.user?.id ?? null,
      },
    });

    res.status(201).json({ data: entry, message: 'Cost allocation added' });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// PUT /cost-analysis/allocations/:entryId
export const updateAllocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entryId = Number(req.params.entryId);
    const { costType, amount, period, description, referenceType, referenceId, entryDate } = req.body;

    const updated = await prisma.assetCostAllocation.update({
      where: { id: entryId },
      data: {
        costType:      costType      ?? undefined,
        amount:        amount != null ? Number(amount) : undefined,
        period:        period        ?? undefined,
        description:   description   ?? undefined,
        referenceType: referenceType ?? undefined,
        referenceId:   referenceId != null ? Number(referenceId) : undefined,
        entryDate:     entryDate ? new Date(entryDate) : undefined,
      },
    });

    res.json({ data: updated, message: 'Cost allocation updated' });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// DELETE /cost-analysis/allocations/:entryId
export const deleteAllocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entryId = Number(req.params.entryId);
    await prisma.assetCostAllocation.delete({ where: { id: entryId } });
    res.json({ message: 'Cost allocation deleted' });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// DELETE /cost-analysis/revenue/:entryId
export const deleteRevenueEntry = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const entryId = Number(req.params.entryId);
    await (prisma as any).assetRevenueEntry.delete({ where: { id: entryId } });
    res.json({ message: "Revenue entry deleted" });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

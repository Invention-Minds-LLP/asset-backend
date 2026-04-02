import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ═══════════════════════════════════════════════════════════════════════════════
// DECISION ENGINE — Smart Maintain-vs-Replace evaluator
//
// Computes 5 independent signals per asset (each scored 0–100), applies
// configurable weights, and produces a composite score that maps to one of
// four decisions:
//   CONTINUE_MAINTENANCE | MONITOR | REVIEW_FOR_REPLACEMENT | REPLACE_IMMEDIATELY
// ═══════════════════════════════════════════════════════════════════════════════

interface SignalScores {
  maintenanceRatio: number;
  ageFactor: number;
  breakdownFreq: number;
  downtimeImpact: number;
  costTrend: number;
}

interface EngineConfig {
  weightMaintenanceRatio: number;
  weightAgeFactor: number;
  weightBreakdownFreq: number;
  weightDowntimeImpact: number;
  weightCostTrend: number;
  thresholdMonitor: number;
  thresholdReview: number;
  thresholdReplace: number;
  maintenanceRatioCeiling: number;
  breakdownHighPerYear: number;
  downtimeHighHours: number;
  costTrendHighPct: number;
}

const DEFAULT_CONFIG: EngineConfig = {
  weightMaintenanceRatio: 30,
  weightAgeFactor: 20,
  weightBreakdownFreq: 20,
  weightDowntimeImpact: 15,
  weightCostTrend: 15,
  thresholdMonitor: 36,
  thresholdReview: 56,
  thresholdReplace: 76,
  maintenanceRatioCeiling: 1.5,
  breakdownHighPerYear: 6,
  downtimeHighHours: 720,
  costTrendHighPct: 50,
};

// Clamp a value between 0 and 100
function clamp(val: number): number {
  return Math.min(100, Math.max(0, val));
}

function mapDecision(
  score: number,
  config: EngineConfig
): string {
  if (score >= config.thresholdReplace) return "REPLACE_IMMEDIATELY";
  if (score >= config.thresholdReview) return "REVIEW_FOR_REPLACEMENT";
  if (score >= config.thresholdMonitor) return "MONITOR";
  return "CONTINUE_MAINTENANCE";
}

// ═══════════════════════════════════════════════════════════════════════════════
// CapEx TRIGGER CONDITIONS — compound rules that fire independently of score
// A CapEx review is triggered if ANY condition is TRUE.
// ═══════════════════════════════════════════════════════════════════════════════
interface CapExTrigger {
  id: string;
  label: string;
  fired: boolean;
  detail: string;
}

function evaluateCapExTriggers(
  maintRatio: number,
  config: EngineConfig,
  breakdownCount12m: number,
  downtimeHours12m: number,
  ageYears: number,
  expectedLifeYears: number,
  slaLimitHours: number | null,
): { triggered: boolean; triggers: CapExTrigger[] } {
  // Threshold_X = maintenanceRatioCeiling (the ratio where score hits 100)
  const thresholdX = config.maintenanceRatioCeiling;

  const triggers: CapExTrigger[] = [];

  // Condition 1: Maintenance Ratio ≥ Threshold_X
  const c1 = maintRatio >= thresholdX;
  triggers.push({
    id: "MAINT_RATIO_EXCEEDED",
    label: "Maintenance Ratio ≥ Threshold",
    fired: c1,
    detail: `Maintenance Ratio: ${round1(maintRatio)} ${c1 ? "≥" : "<"} Threshold: ${thresholdX}`,
  });

  // Condition 2: Maintenance Ratio ≥ (Threshold_X - 10%) AND Breakdowns ≥ 3
  const c2Ratio = maintRatio >= thresholdX * 0.9;
  const c2Breakdown = breakdownCount12m >= 3;
  const c2 = c2Ratio && c2Breakdown;
  triggers.push({
    id: "MAINT_PLUS_BREAKDOWNS",
    label: "High Ratio + Frequent Breakdowns",
    fired: c2,
    detail: `Ratio: ${round1(maintRatio)} ${c2Ratio ? "≥" : "<"} ${round1(thresholdX * 0.9)} (90% of threshold) AND Breakdowns: ${breakdownCount12m} ${c2Breakdown ? "≥" : "<"} 3`,
  });

  // Condition 3: Maintenance Ratio ≥ (Threshold_X - 5%) AND Downtime > SLA limit
  const slaLimit = slaLimitHours ?? config.downtimeHighHours * 0.5; // fallback: 50% of high threshold
  const c3Ratio = maintRatio >= thresholdX * 0.95;
  const c3Downtime = downtimeHours12m > slaLimit;
  const c3 = c3Ratio && c3Downtime;
  triggers.push({
    id: "MAINT_PLUS_DOWNTIME",
    label: "High Ratio + Excessive Downtime",
    fired: c3,
    detail: `Ratio: ${round1(maintRatio)} ${c3Ratio ? "≥" : "<"} ${round1(thresholdX * 0.95)} (95% of threshold) AND Downtime: ${round1(downtimeHours12m)}h ${c3Downtime ? ">" : "≤"} SLA limit: ${round1(slaLimit)}h`,
  });

  // Condition 4: Asset Age ≥ 70% of Useful Life AND Maintenance Ratio ≥ (Threshold_X - 10%)
  const lifeUsed = expectedLifeYears > 0 ? ageYears / expectedLifeYears : 0;
  const c4Age = lifeUsed >= 0.7;
  const c4Ratio = maintRatio >= thresholdX * 0.9;
  const c4 = c4Age && c4Ratio;
  triggers.push({
    id: "AGING_PLUS_MAINT",
    label: "Aging Asset + Rising Maintenance",
    fired: c4,
    detail: `Life used: ${round1(lifeUsed * 100)}% ${c4Age ? "≥" : "<"} 70% AND Ratio: ${round1(maintRatio)} ${c4Ratio ? "≥" : "<"} ${round1(thresholdX * 0.9)}`,
  });

  return {
    triggered: triggers.some((t) => t.fired),
    triggers,
  };
}

function buildReasons(
  signals: SignalScores,
  data: {
    maintenanceCost: number;
    bookValue: number;
    ageYears: number;
    expectedLifeYears: number;
    breakdownCount12m: number;
    downtimeHours12m: number;
    costTrendPct: number | null;
    replacementEstimate: number | null;
  }
): string[] {
  const reasons: string[] = [];

  if (signals.maintenanceRatio >= 70) {
    reasons.push(
      `Maintenance cost (₹${fmt(data.maintenanceCost)}) has reached ${Math.round((data.maintenanceCost / Math.max(data.bookValue, 1)) * 100)}% of current book value (₹${fmt(data.bookValue)}) — it will cost more to maintain than the asset is worth.`
    );
  } else if (signals.maintenanceRatio >= 40) {
    reasons.push(
      `Maintenance cost is approaching ${Math.round((data.maintenanceCost / Math.max(data.bookValue, 1)) * 100)}% of book value — monitor closely.`
    );
  }

  if (signals.ageFactor >= 80) {
    reasons.push(
      `Asset has exceeded its expected useful life (${round1(data.ageYears)} yrs used of ${data.expectedLifeYears} yr expected).`
    );
  } else if (signals.ageFactor >= 50) {
    const remaining = Math.max(0, data.expectedLifeYears - data.ageYears);
    reasons.push(
      `Asset is ${round1(data.ageYears)} years old with only ~${round1(remaining)} years of useful life remaining.`
    );
  }

  if (signals.breakdownFreq >= 70) {
    reasons.push(
      `High breakdown frequency: ${data.breakdownCount12m} corrective repairs in the last 12 months — reliability is degrading.`
    );
  } else if (signals.breakdownFreq >= 40) {
    reasons.push(
      `Moderate breakdown activity: ${data.breakdownCount12m} repairs in the last 12 months.`
    );
  }

  if (signals.downtimeImpact >= 70) {
    reasons.push(
      `Significant downtime: ${round1(data.downtimeHours12m)} hours lost in the last 12 months — operational impact is high.`
    );
  } else if (signals.downtimeImpact >= 40) {
    reasons.push(
      `${round1(data.downtimeHours12m)} hours of downtime recorded in the last 12 months.`
    );
  }

  if (data.costTrendPct != null && signals.costTrend >= 60) {
    reasons.push(
      `Maintenance costs are accelerating — ${round1(data.costTrendPct)}% increase year-over-year.`
    );
  }

  if (data.replacementEstimate != null && data.maintenanceCost > data.replacementEstimate * 0.5) {
    reasons.push(
      `Total maintenance cost has reached ${Math.round((data.maintenanceCost / data.replacementEstimate) * 100)}% of the estimated replacement cost (₹${fmt(data.replacementEstimate)}).`
    );
  }

  if (reasons.length === 0) {
    reasons.push("Asset is healthy — within acceptable maintenance cost and useful life parameters.");
  }

  return reasons;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Helper: load config (per-category or global default) ─────────────────────
async function loadConfig(categoryId: number | null): Promise<EngineConfig> {
  let config: any = null;

  if (categoryId) {
    config = await prisma.decisionEngineConfig.findUnique({
      where: { categoryId },
    });
  }

  // Fall back to global default (categoryId = null)
  if (!config) {
    config = await prisma.decisionEngineConfig.findFirst({
      where: { categoryId: null },
    });
  }

  if (!config) return { ...DEFAULT_CONFIG };

  return {
    weightMaintenanceRatio: config.weightMaintenanceRatio,
    weightAgeFactor: config.weightAgeFactor,
    weightBreakdownFreq: config.weightBreakdownFreq,
    weightDowntimeImpact: config.weightDowntimeImpact,
    weightCostTrend: config.weightCostTrend,
    thresholdMonitor: config.thresholdMonitor,
    thresholdReview: config.thresholdReview,
    thresholdReplace: config.thresholdReplace,
    maintenanceRatioCeiling: config.maintenanceRatioCeiling,
    breakdownHighPerYear: config.breakdownHighPerYear,
    downtimeHighHours: config.downtimeHighHours,
    costTrendHighPct: config.costTrendHighPct,
  };
}

// ─── Helper: compute signals for a single asset ──────────────────────────────
async function evaluateAsset(assetDbId: number, config: EngineConfig) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetDbId },
    include: {
      depreciation: true,
      assetCategory: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  });

  if (!asset) return null;

  const now = Date.now();
  const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
  const msPerHour = 1000 * 60 * 60;
  const oneYearAgo = new Date(now - msPerYear);

  // ── Age ────────────────────────────────────────────────────────────────────
  const dep = (asset as any).depreciation;
  const ageBasisDate = asset.purchaseDate ?? asset.installedAt ?? dep?.depreciationStart ?? null;
  const ageYears = ageBasisDate ? (now - new Date(ageBasisDate).getTime()) / msPerYear : 0;
  const expectedLifeYears: number = dep?.expectedLifeYears ?? (asset as any).expectedLifetime ?? 0;

  // ── Book value ────────────────────────────────────────────────────────────
  const originalCost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
  const currentBookValue = dep?.currentBookValue != null ? Number(dep.currentBookValue) : originalCost;

  // ── Collect sub-asset IDs for cost rollup ────────────────────────────────
  const subAssets = await prisma.asset.findMany({
    where: { parentAssetId: assetDbId },
    select: { id: true },
  });
  const allAssetIds = [assetDbId, ...subAssets.map((s) => s.id)];

  // ── Maintenance cost (all time) ───────────────────────────────────────────
  const [maintenanceAgg, ticketAgg, spareAgg] = await Promise.all([
    prisma.maintenanceHistory.aggregate({
      where: { assetId: { in: allAssetIds } },
      _sum: { totalCost: true },
    }),
    prisma.ticket.aggregate({
      where: { assetId: { in: allAssetIds } },
      _sum: { totalCost: true },
    }),
    (prisma as any).sparePartUsage
      ? (prisma as any).sparePartUsage.aggregate({
          where: { assetId: { in: allAssetIds } },
          _sum: { costAtUse: true },
        }).catch(() => ({ _sum: { costAtUse: null } }))
      : Promise.resolve({ _sum: { costAtUse: null } }),
  ]);

  const totalMaintenanceCost =
    Number(maintenanceAgg._sum.totalCost ?? 0) +
    Number(ticketAgg._sum.totalCost ?? 0) +
    Number(spareAgg._sum?.costAtUse ?? 0);

  // ── Breakdown count (last 12 months) ──────────────────────────────────────
  const breakdownCount12m = await prisma.ticket.count({
    where: {
      assetId: { in: allAssetIds },
      workCategory: { in: ["BREAKDOWN", "CORRECTIVE"] },
      createdAt: { gte: oneYearAgo },
    },
  });

  // ── Downtime hours (last 12 months) ──────────────────────────────────────
  const downtimeTickets = await prisma.ticket.findMany({
    where: {
      assetId: { in: allAssetIds },
      downtimeStart: { not: null },
      createdAt: { gte: oneYearAgo },
    },
    select: { downtimeStart: true, downtimeEnd: true },
  });

  let downtimeHours12m = 0;
  for (const t of downtimeTickets) {
    if (t.downtimeStart) {
      const start = new Date(t.downtimeStart).getTime();
      const end = t.downtimeEnd ? new Date(t.downtimeEnd).getTime() : now;
      downtimeHours12m += (end - start) / msPerHour;
    }
  }

  // ── Cost trend: compare last 12 months vs prior 12 months ────────────────
  const twoYearsAgo = new Date(now - 2 * msPerYear);
  const [costRecent, costPrior] = await Promise.all([
    prisma.ticket.aggregate({
      where: {
        assetId: { in: allAssetIds },
        createdAt: { gte: oneYearAgo },
      },
      _sum: { totalCost: true },
    }),
    prisma.ticket.aggregate({
      where: {
        assetId: { in: allAssetIds },
        createdAt: { gte: twoYearsAgo, lt: oneYearAgo },
      },
      _sum: { totalCost: true },
    }),
  ]);

  const recentCost = Number(costRecent._sum.totalCost ?? 0);
  const priorCost = Number(costPrior._sum.totalCost ?? 0);
  const costTrendPct = priorCost > 0
    ? ((recentCost - priorCost) / priorCost) * 100
    : null;

  // ── Replacement estimate ─────────────────────────────────────────────────
  const inflationRate = 0.10;
  const replacementEstimate = originalCost > 0
    ? Math.round(originalCost * Math.pow(1 + inflationRate, Math.round(ageYears)))
    : null;

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNAL SCORING (each 0–100)
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Maintenance Ratio — maintenance cost vs book value
  const maintRatio = currentBookValue > 0 ? totalMaintenanceCost / currentBookValue : 0;
  const scoreMaintenanceRatio = clamp((maintRatio / config.maintenanceRatioCeiling) * 100);

  // 2. Age Factor — how far past useful life
  let scoreAgeFactor = 0;
  if (expectedLifeYears > 0) {
    const lifeUsed = ageYears / expectedLifeYears;
    if (lifeUsed >= 1.0) {
      // Past expected life — score 80 minimum, rising to 100 at 1.5x
      scoreAgeFactor = clamp(80 + ((lifeUsed - 1.0) / 0.5) * 20);
    } else {
      // Score rises more steeply after 60% life used
      scoreAgeFactor = clamp(lifeUsed <= 0.6 ? lifeUsed * 40 : 24 + ((lifeUsed - 0.6) / 0.4) * 56);
    }
  }

  // 3. Breakdown Frequency — normalized per year
  const breakdownsPerYear = ageYears > 0
    ? breakdownCount12m // already 12-month window
    : breakdownCount12m;
  const scoreBreakdownFreq = clamp((breakdownsPerYear / config.breakdownHighPerYear) * 100);

  // 4. Downtime Impact
  const scoreDowntimeImpact = clamp((downtimeHours12m / config.downtimeHighHours) * 100);

  // 5. Cost Trend
  let scoreCostTrend = 0;
  if (costTrendPct != null && costTrendPct > 0) {
    scoreCostTrend = clamp((costTrendPct / config.costTrendHighPct) * 100);
  }

  const signals: SignalScores = {
    maintenanceRatio: round1(scoreMaintenanceRatio),
    ageFactor: round1(scoreAgeFactor),
    breakdownFreq: round1(scoreBreakdownFreq),
    downtimeImpact: round1(scoreDowntimeImpact),
    costTrend: round1(scoreCostTrend),
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPOSITE SCORE (weighted average)
  // ═══════════════════════════════════════════════════════════════════════════
  const totalWeight =
    config.weightMaintenanceRatio +
    config.weightAgeFactor +
    config.weightBreakdownFreq +
    config.weightDowntimeImpact +
    config.weightCostTrend;

  const compositeScore = round1(
    (signals.maintenanceRatio * config.weightMaintenanceRatio +
      signals.ageFactor * config.weightAgeFactor +
      signals.breakdownFreq * config.weightBreakdownFreq +
      signals.downtimeImpact * config.weightDowntimeImpact +
      signals.costTrend * config.weightCostTrend) /
      totalWeight
  );

  const decision = mapDecision(compositeScore, config);

  // ═══════════════════════════════════════════════════════════════════════════
  // CapEx TRIGGER EVALUATION — compound conditions independent of score
  // ═══════════════════════════════════════════════════════════════════════════
  // SLA limit from asset (convert to hours)
  const slaVal = (asset as any).slaExpectedValue;
  const slaUnit = ((asset as any).slaExpectedUnit ?? "").toUpperCase();
  const slaLimitHours = slaVal != null
    ? (slaUnit === "DAYS" ? slaVal * 24 : slaVal)
    : null;

  const capex = evaluateCapExTriggers(
    maintRatio, config, breakdownCount12m, downtimeHours12m,
    ageYears, expectedLifeYears, slaLimitHours,
  );

  const reasons = buildReasons(signals, {
    maintenanceCost: totalMaintenanceCost,
    bookValue: currentBookValue,
    ageYears,
    expectedLifeYears,
    breakdownCount12m,
    downtimeHours12m,
    costTrendPct,
    replacementEstimate,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CALCULATION DETAILS — formula + real inputs + result for each signal
  // ═══════════════════════════════════════════════════════════════════════════
  const maintenanceHistoryCost = Number(maintenanceAgg._sum.totalCost ?? 0);
  const ticketCost = Number(ticketAgg._sum.totalCost ?? 0);
  const spareCost = Number(spareAgg._sum?.costAtUse ?? 0);
  const lifeUsed = expectedLifeYears > 0 ? round1(ageYears / expectedLifeYears) : 0;

  const calc = {
    compositeScore: {
      formula: "(Signal₁ × Weight₁ + Signal₂ × Weight₂ + ... + Signal₅ × Weight₅) ÷ Total Weight",
      inputs: {
        maintenanceRatio: { score: signals.maintenanceRatio, weight: config.weightMaintenanceRatio, product: round1(signals.maintenanceRatio * config.weightMaintenanceRatio) },
        ageFactor:        { score: signals.ageFactor,        weight: config.weightAgeFactor,        product: round1(signals.ageFactor * config.weightAgeFactor) },
        breakdownFreq:    { score: signals.breakdownFreq,    weight: config.weightBreakdownFreq,    product: round1(signals.breakdownFreq * config.weightBreakdownFreq) },
        downtimeImpact:   { score: signals.downtimeImpact,   weight: config.weightDowntimeImpact,   product: round1(signals.downtimeImpact * config.weightDowntimeImpact) },
        costTrend:        { score: signals.costTrend,        weight: config.weightCostTrend,        product: round1(signals.costTrend * config.weightCostTrend) },
      },
      totalWeight,
      weightedSum: round1(
        signals.maintenanceRatio * config.weightMaintenanceRatio +
        signals.ageFactor * config.weightAgeFactor +
        signals.breakdownFreq * config.weightBreakdownFreq +
        signals.downtimeImpact * config.weightDowntimeImpact +
        signals.costTrend * config.weightCostTrend
      ),
      result: compositeScore,
    },
    maintenanceRatio: {
      formula: "(Maintenance Cost ÷ Book Value) ÷ Ceiling × 100, clamped 0–100",
      maintenanceHistoryCost: round1(maintenanceHistoryCost),
      ticketCost: round1(ticketCost),
      spareCost: round1(spareCost),
      totalMaintenanceCost: round1(totalMaintenanceCost),
      bookValue: round1(currentBookValue),
      ratio: round1(maintRatio),
      ceiling: config.maintenanceRatioCeiling,
      rawScore: round1((maintRatio / config.maintenanceRatioCeiling) * 100),
      result: signals.maintenanceRatio,
    },
    ageFactor: {
      formula: expectedLifeYears > 0
        ? (ageYears / expectedLifeYears >= 1.0
          ? "Past useful life → 80 + ((lifeUsed − 1.0) ÷ 0.5) × 20"
          : (ageYears / expectedLifeYears <= 0.6
            ? "lifeUsed × 40 (gentle rise before 60%)"
            : "24 + ((lifeUsed − 0.6) ÷ 0.4) × 56 (steep rise after 60%)"))
        : "No expected life defined → score = 0",
      purchaseDate: ageBasisDate,
      ageYears: round1(ageYears),
      expectedLifeYears,
      lifeUsedRatio: lifeUsed,
      lifeUsedPct: round1(lifeUsed * 100),
      result: signals.ageFactor,
    },
    breakdownFreq: {
      formula: "Breakdowns (last 12m) ÷ High Threshold × 100, clamped 0–100",
      breakdownCount12m,
      highThreshold: config.breakdownHighPerYear,
      rawScore: round1((breakdownCount12m / config.breakdownHighPerYear) * 100),
      result: signals.breakdownFreq,
    },
    downtimeImpact: {
      formula: "Downtime Hours (last 12m) ÷ High Threshold × 100, clamped 0–100",
      downtimeHours12m: round1(downtimeHours12m),
      downtimeTicketCount: downtimeTickets.length,
      highThreshold: config.downtimeHighHours,
      rawScore: round1((downtimeHours12m / config.downtimeHighHours) * 100),
      result: signals.downtimeImpact,
    },
    costTrend: {
      formula: "((Recent 12m Cost − Prior 12m Cost) ÷ Prior 12m Cost) ÷ High Threshold × 100",
      recentCost: round1(recentCost),
      priorCost: round1(priorCost),
      trendPct: costTrendPct != null ? round1(costTrendPct) : null,
      highThreshold: config.costTrendHighPct,
      result: signals.costTrend,
    },
    replacementEstimate: {
      formula: "Original Cost × (1 + 10%)^Age",
      originalCost,
      inflationRate: 10,
      ageRounded: Math.round(ageYears),
      result: replacementEstimate,
    },
    decision: {
      formula: "Score ≥ Replace threshold → REPLACE | ≥ Review → REVIEW | ≥ Monitor → MONITOR | else CONTINUE",
      compositeScore,
      thresholds: {
        continueMaintenance: `0 – ${config.thresholdMonitor - 1}`,
        monitor: `${config.thresholdMonitor} – ${config.thresholdReview - 1}`,
        reviewForReplacement: `${config.thresholdReview} – ${config.thresholdReplace - 1}`,
        replaceImmediately: `${config.thresholdReplace} – 100`,
      },
      result: decision,
    },
  };

  return {
    asset: {
      id: asset.id,
      assetId: asset.assetId,
      assetName: asset.assetName,
      category: (asset as any).assetCategory?.name,
      categoryId: (asset as any).assetCategory?.id,
      department: (asset as any).department?.name,
      departmentId: (asset as any).department?.id,
      status: asset.status,
      criticalityLevel: asset.criticalityLevel,
      originalCost,
      currentBookValue,
      ageYears: round1(ageYears),
      expectedLifeYears,
      remainingLifeYears: round1(Math.max(0, expectedLifeYears - ageYears)),
    },
    signals,
    compositeScore,
    decision,
    reasons,
    capex,
    calc,
    data: {
      totalMaintenanceCost: round1(totalMaintenanceCost),
      breakdownCount12m,
      downtimeHours12m: round1(downtimeHours12m),
      costTrendPct: costTrendPct != null ? round1(costTrendPct) : null,
      replacementEstimate,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /decision-engine/evaluate/:id — Evaluate a single asset
export const evaluateSingleAsset = async (
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
      select: { assetCategoryId: true },
    });
    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const config = await loadConfig(asset.assetCategoryId);
    const result = await evaluateAsset(assetDbId, config);

    if (!result) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    // Persist to log
    const user = req.user as any;
    await prisma.decisionEngineLog.create({
      data: {
        assetId: assetDbId,
        scoreMaintenanceRatio: result.signals.maintenanceRatio,
        scoreAgeFactor: result.signals.ageFactor,
        scoreBreakdownFreq: result.signals.breakdownFreq,
        scoreDowntimeImpact: result.signals.downtimeImpact,
        scoreCostTrend: result.signals.costTrend,
        compositeScore: result.compositeScore,
        decision: result.decision,
        maintenanceCost: result.data.totalMaintenanceCost,
        bookValue: result.asset.currentBookValue,
        assetAgeYears: result.asset.ageYears,
        expectedLifeYears: result.asset.expectedLifeYears,
        breakdownCount12m: result.data.breakdownCount12m,
        downtimeHours12m: result.data.downtimeHours12m,
        costTrendPct: result.data.costTrendPct,
        reasons: result.reasons,
        evaluatedById: user?.employeeDbId ?? null,
      },
    });

    res.json({ ...result, config });
  } catch (error: any) {
    console.error("Decision engine evaluate error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /decision-engine/evaluate-all — Bulk evaluate all active assets
export const evaluateAllAssets = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const user = req.user as any;
    const query = req.query;

    // Build where clause
    const where: any = {
      status: { notIn: ["DISPOSED", "SCRAPPED"] },
    };

    // Role-based filtering: scope non-ADMIN users to their department
    if (user?.role !== "ADMIN" && user?.departmentId) {
      where.departmentId = Number(user.departmentId);
    }

    // Query filters
    if (query.categoryId) where.assetCategoryId = Number(query.categoryId);
    if (query.departmentId) where.departmentId = Number(query.departmentId);
    if (query.criticalityLevel) where.criticalityLevel = query.criticalityLevel as string;

    const assets = await prisma.asset.findMany({
      where,
      select: { id: true, assetCategoryId: true },
    });

    // Load configs per category (cache)
    const configCache = new Map<number | "default", EngineConfig>();
    const getConfigCached = async (catId: number | null): Promise<EngineConfig> => {
      const key = catId ?? "default";
      if (configCache.has(key)) return configCache.get(key)!;
      const cfg = await loadConfig(catId);
      configCache.set(key, cfg);
      return cfg;
    };

    // Evaluate all assets in parallel (batched)
    const batchSize = 20;
    const results: any[] = [];

    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (a) => {
          const cfg = await getConfigCached(a.assetCategoryId);
          return evaluateAsset(a.id, cfg);
        })
      );
      results.push(...batchResults.filter(Boolean));
    }

    // Sort by composite score descending (worst first)
    results.sort((a, b) => b.compositeScore - a.compositeScore);

    // Summary stats
    const summary = {
      total: results.length,
      continueMaintenance: results.filter((r) => r.decision === "CONTINUE_MAINTENANCE").length,
      monitor: results.filter((r) => r.decision === "MONITOR").length,
      reviewForReplacement: results.filter((r) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
      replaceImmediately: results.filter((r) => r.decision === "REPLACE_IMMEDIATELY").length,
    };

    // Optional: filter by decision
    let filtered = results;
    if (query.decision) {
      filtered = results.filter((r) => r.decision === query.decision);
    }

    // Pagination
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    res.json({
      summary,
      data: paginated,
      total: filtered.length,
      page,
      limit,
    });
  } catch (error: any) {
    console.error("Decision engine evaluate-all error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /decision-engine/history/:assetId — Get evaluation history for an asset
export const getAssetHistory = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) {
      res.status(400).json({ message: "Invalid asset id" });
      return;
    }

    const logs = await prisma.decisionEngineLog.findMany({
      where: { assetId },
      orderBy: { evaluatedAt: "desc" },
      take: 20,
      include: {
        evaluatedBy: { select: { id: true, name: true, employeeID: true } },
      },
    });

    res.json({ data: logs });
  } catch (error: any) {
    console.error("Decision engine history error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /decision-engine/config — Get all configs
export const getConfigs = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const configs = await prisma.decisionEngineConfig.findMany({
      include: { category: { select: { id: true, name: true } } },
      orderBy: { categoryId: "asc" },
    });
    res.json({ data: configs });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// POST /decision-engine/config — Create or update config
export const upsertConfig = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const body = req.body;
    const categoryId = body.categoryId != null ? Number(body.categoryId) : null;

    const data: any = {
      weightMaintenanceRatio: body.weightMaintenanceRatio ?? 30,
      weightAgeFactor: body.weightAgeFactor ?? 20,
      weightBreakdownFreq: body.weightBreakdownFreq ?? 20,
      weightDowntimeImpact: body.weightDowntimeImpact ?? 15,
      weightCostTrend: body.weightCostTrend ?? 15,
      thresholdMonitor: body.thresholdMonitor ?? 36,
      thresholdReview: body.thresholdReview ?? 56,
      thresholdReplace: body.thresholdReplace ?? 76,
      maintenanceRatioCeiling: body.maintenanceRatioCeiling ?? 1.5,
      breakdownHighPerYear: body.breakdownHighPerYear ?? 6,
      downtimeHighHours: body.downtimeHighHours ?? 720,
      costTrendHighPct: body.costTrendHighPct ?? 50,
    };

    let config;
    if (categoryId != null) {
      // Per-category config
      config = await prisma.decisionEngineConfig.upsert({
        where: { categoryId },
        update: data,
        create: { ...data, categoryId },
      });
    } else {
      // Global default — find or create
      const existing = await prisma.decisionEngineConfig.findFirst({
        where: { categoryId: null },
      });
      if (existing) {
        config = await prisma.decisionEngineConfig.update({
          where: { id: existing.id },
          data,
        });
      } else {
        config = await prisma.decisionEngineConfig.create({
          data: { ...data, categoryId: null },
        });
      }
    }

    res.json(config);
  } catch (error: any) {
    console.error("Decision engine config error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /decision-engine/dashboard-summary — KPI summary for dashboard
export const getDashboardSummary = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const user = req.user as any;

    const where: any = {
      status: { notIn: ["DISPOSED", "SCRAPPED"] },
    };

    // Scope non-ADMIN users to their department
    if (user?.role !== "ADMIN" && user?.departmentId) {
      where.departmentId = Number(user.departmentId);
    }

    const assets = await prisma.asset.findMany({
      where,
      select: { id: true, assetCategoryId: true },
    });

    const configCache = new Map<number | "default", EngineConfig>();
    const getConfigCached = async (catId: number | null): Promise<EngineConfig> => {
      const key = catId ?? "default";
      if (configCache.has(key)) return configCache.get(key)!;
      const cfg = await loadConfig(catId);
      configCache.set(key, cfg);
      return cfg;
    };

    // Evaluate all
    const results: any[] = [];
    const batchSize = 20;

    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (a) => {
          const cfg = await getConfigCached(a.assetCategoryId);
          return evaluateAsset(a.id, cfg);
        })
      );
      results.push(...batchResults.filter(Boolean));
    }

    const summary = {
      total: results.length,
      continueMaintenance: results.filter((r) => r.decision === "CONTINUE_MAINTENANCE").length,
      monitor: results.filter((r) => r.decision === "MONITOR").length,
      reviewForReplacement: results.filter((r) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
      replaceImmediately: results.filter((r) => r.decision === "REPLACE_IMMEDIATELY").length,
      avgCompositeScore: results.length > 0
        ? round1(results.reduce((s, r) => s + r.compositeScore, 0) / results.length)
        : 0,
      totalMaintenanceCost: round1(results.reduce((s, r) => s + r.data.totalMaintenanceCost, 0)),
      totalBookValue: round1(results.reduce((s, r) => s + r.asset.currentBookValue, 0)),
    };

    // Top 5 critical (highest composite score)
    const topCritical = results
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 5)
      .map((r) => ({
        id: r.asset.id,
        assetId: r.asset.assetId,
        assetName: r.asset.assetName,
        category: r.asset.category,
        department: r.asset.department,
        compositeScore: r.compositeScore,
        decision: r.decision,
        criticalityLevel: r.asset.criticalityLevel,
      }));

    // By category breakdown
    const byCategory = new Map<string, { count: number; replace: number; review: number }>();
    for (const r of results) {
      const cat = r.asset.category || "Uncategorized";
      const entry = byCategory.get(cat) || { count: 0, replace: 0, review: 0 };
      entry.count++;
      if (r.decision === "REPLACE_IMMEDIATELY") entry.replace++;
      if (r.decision === "REVIEW_FOR_REPLACEMENT") entry.review++;
      byCategory.set(cat, entry);
    }

    // By criticality breakdown — with full asset lists per level
    const criticalityLevels = ["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"];
    const byCriticality: any[] = [];

    for (const level of criticalityLevels) {
      const assetsAtLevel = results.filter(
        (r) => (r.asset.criticalityLevel || "").toUpperCase() === level
      );

      if (assetsAtLevel.length === 0) continue;

      // Sort by composite score descending (worst first)
      assetsAtLevel.sort((a: any, b: any) => b.compositeScore - a.compositeScore);

      const capexTriggeredCount = assetsAtLevel.filter((r: any) => r.capex?.triggered).length;

      byCriticality.push({
        level,
        count: assetsAtLevel.length,
        avgScore: round1(
          assetsAtLevel.reduce((s: number, r: any) => s + r.compositeScore, 0) / assetsAtLevel.length
        ),
        replaceImmediately: assetsAtLevel.filter((r: any) => r.decision === "REPLACE_IMMEDIATELY").length,
        reviewForReplacement: assetsAtLevel.filter((r: any) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
        monitor: assetsAtLevel.filter((r: any) => r.decision === "MONITOR").length,
        continueMaintenance: assetsAtLevel.filter((r: any) => r.decision === "CONTINUE_MAINTENANCE").length,
        capexTriggered: capexTriggeredCount,
        assets: assetsAtLevel.map((r: any) => ({
          id: r.asset.id,
          assetId: r.asset.assetId,
          assetName: r.asset.assetName,
          category: r.asset.category,
          department: r.asset.department,
          compositeScore: r.compositeScore,
          decision: r.decision,
          capexTriggered: r.capex?.triggered ?? false,
          capexTriggerCount: r.capex?.triggers?.filter((t: any) => t.fired).length ?? 0,
          totalMaintenanceCost: r.data.totalMaintenanceCost,
          currentBookValue: r.asset.currentBookValue,
          ageYears: r.asset.ageYears,
          expectedLifeYears: r.asset.expectedLifeYears,
          breakdownCount12m: r.data.breakdownCount12m,
        })),
      });
    }

    // Also include assets with no criticality level set
    const unsetAssets = results.filter(
      (r) => !r.asset.criticalityLevel
    );
    if (unsetAssets.length > 0) {
      unsetAssets.sort((a: any, b: any) => b.compositeScore - a.compositeScore);
      byCriticality.push({
        level: "UNSET",
        count: unsetAssets.length,
        avgScore: round1(
          unsetAssets.reduce((s: number, r: any) => s + r.compositeScore, 0) / unsetAssets.length
        ),
        replaceImmediately: unsetAssets.filter((r: any) => r.decision === "REPLACE_IMMEDIATELY").length,
        reviewForReplacement: unsetAssets.filter((r: any) => r.decision === "REVIEW_FOR_REPLACEMENT").length,
        monitor: unsetAssets.filter((r: any) => r.decision === "MONITOR").length,
        continueMaintenance: unsetAssets.filter((r: any) => r.decision === "CONTINUE_MAINTENANCE").length,
        capexTriggered: unsetAssets.filter((r: any) => r.capex?.triggered).length,
        assets: unsetAssets.map((r: any) => ({
          id: r.asset.id,
          assetId: r.asset.assetId,
          assetName: r.asset.assetName,
          category: r.asset.category,
          department: r.asset.department,
          compositeScore: r.compositeScore,
          decision: r.decision,
          capexTriggered: r.capex?.triggered ?? false,
          capexTriggerCount: r.capex?.triggers?.filter((t: any) => t.fired).length ?? 0,
          totalMaintenanceCost: r.data.totalMaintenanceCost,
          currentBookValue: r.asset.currentBookValue,
          ageYears: r.asset.ageYears,
          expectedLifeYears: r.asset.expectedLifeYears,
          breakdownCount12m: r.data.breakdownCount12m,
        })),
      });
    }

    // Total CapEx triggered across all assets
    const totalCapexTriggered = results.filter((r) => r.capex?.triggered).length;

    res.json({
      summary: { ...summary, capexTriggered: totalCapexTriggered },
      topCritical,
      byCategory: Array.from(byCategory.entries()).map(([category, data]) => ({
        category,
        ...data,
      })),
      byCriticality,
    });
  } catch (error: any) {
    console.error("Decision engine dashboard error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

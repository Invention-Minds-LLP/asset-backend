import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";

// ═══════════════════════════════════════════════════════════
// 1. GET /tco — Total Cost of Ownership
// ═══════════════════════════════════════════════════════════
export const getAssetTCO = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assetId, categoryId, departmentId, level = "asset" } = req.query;
    const user = (req as any).user;
    const broadAccess = ["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role);

    // ── Single asset TCO ──────────────────────────────────
    if (assetId) {
      const asset = await prisma.asset.findUnique({
        where: { id: Number(assetId) },
        include: {
          assetCategory: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      });
      if (!asset) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }

      // Non-broad-access users can only view TCO for assets in their own department.
      // Only block if the asset explicitly belongs to a DIFFERENT department — unassigned assets (no dept) are viewable.
      if (!broadAccess && user?.departmentId && asset.department?.id != null && asset.department.id !== Number(user.departmentId)) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }

      const capitalCost = Number(asset.purchaseCost ?? 0);

      // Repair cost from tickets
      const ticketAgg = await prisma.ticket.aggregate({
        where: { assetId: Number(assetId) },
        _sum: { totalCost: true },
      });
      const repairCost = Number(ticketAgg._sum.totalCost ?? 0);

      // PM cost from maintenance history
      const mhAgg = await prisma.maintenanceHistory.aggregate({
        where: { assetId: Number(assetId) },
        _sum: { totalCost: true },
      });
      const pmCost = Number(mhAgg._sum.totalCost ?? 0);

      // Material issue cost (via work orders linked to this asset)
      const materialAgg = await prisma.materialIssue.aggregate({
        where: { workOrder: { assetId: Number(assetId) } },
        _sum: { totalCost: true },
      });
      const consumableCost = Number(materialAgg._sum.totalCost ?? 0);

      // Spare part usage cost
      const spareAgg = await prisma.sparePartUsage.aggregate({
        where: { assetId: Number(assetId) },
        _sum: { costAtUse: true },
      });
      const sparePartCost = Number(spareAgg._sum.costAtUse ?? 0);

      // Cost allocations grouped by costType
      const allocations = await prisma.assetCostAllocation.groupBy({
        by: ["costType"],
        where: { assetId: Number(assetId) },
        _sum: { amount: true },
      });

      const allocationMap: Record<string, number> = {};
      for (const a of allocations) {
        allocationMap[a.costType] = Number(a._sum.amount ?? 0);
      }

      const laborCost = allocationMap["LABOR"] ?? 0;
      const utilityCost = allocationMap["UTILITY_POWER"] ?? 0;
      const spaceCost = allocationMap["SPACE_FACILITY"] ?? 0;
      const outsourcedCost = allocationMap["OUTSOURCED_SERVICE"] ?? 0;
      const allocConsumable = allocationMap["CONSUMABLE"] ?? 0;
      const otherCost = allocationMap["OTHER"] ?? 0;

      // Historical opening balance costs (legacy assets only)
      const historicalMaintenanceCost = Number((asset as any).historicalMaintenanceCost ?? 0);
      const historicalSparePartsCost  = Number((asset as any).historicalSparePartsCost ?? 0);
      const historicalOtherCost       = Number((asset as any).historicalOtherCost ?? 0);
      const totalHistoricalCost = historicalMaintenanceCost + historicalSparePartsCost + historicalOtherCost;

      const totalTCO =
        capitalCost +
        repairCost +
        pmCost +
        consumableCost +
        sparePartCost +
        laborCost +
        utilityCost +
        spaceCost +
        outsourcedCost +
        allocConsumable +
        otherCost +
        totalHistoricalCost;

      const purchaseDate = asset.purchaseDate ?? asset.grnDate;
      const ageYears = purchaseDate
        ? Math.max(
            (Date.now() - new Date(purchaseDate).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
            1
          )
        : 1;

      res.json({
        asset: {
          id: asset.id,
          assetId: asset.assetId,
          assetName: asset.assetName,
          category: asset.assetCategory.name,
          department: asset.department?.name ?? null,
        },
        capitalCost,
        repairCost,
        pmCost,
        laborCost,
        utilityCost,
        spaceCost,
        consumableCost: consumableCost + allocConsumable,
        outsourcedCost,
        sparePartCost,
        otherCost,
        totalTCO: Math.round(totalTCO * 100) / 100,
        costPerYear: Math.round((totalTCO / ageYears) * 100) / 100,
        totalHistoricalCost: (asset as any).isLegacyAsset ? totalHistoricalCost : null,
        costBreakdownByType: allocations.map((a) => ({
          costType: a.costType,
          amount: Number(a._sum.amount ?? 0),
        })),
      });
      return;
    }

    // ── Grouped TCO (category or department level) ────────
    const groupLevel = String(level) as "category" | "department" | "asset";
    if (groupLevel !== "category" && groupLevel !== "department") {
      res
        .status(400)
        .json({ error: "Provide assetId for asset-level, or set level=category|department" });
      return;
    }

    const assetWhere: Prisma.AssetWhereInput = {};
    if (categoryId) assetWhere.assetCategoryId = Number(categoryId);
    if (departmentId) {
      assetWhere.departmentId = Number(departmentId);
    } else if (!broadAccess && user?.departmentId) {
      assetWhere.departmentId = Number(user.departmentId);
    }

    const groupByField =
      groupLevel === "category" ? "assetCategoryId" : "departmentId";

    // Get assets grouped (filter out unassigned assets with no category/dept after query)
    const groups = (await prisma.asset.groupBy({
      by: [groupByField],
      where: {
        ...assetWhere,
        status: { notIn: ["DISPOSED", "SCRAPPED"] },
      },
      _count: { id: true },
      _sum: { purchaseCost: true },
    })).filter((g) => (g as any)[groupByField] != null);

    const results = await Promise.all(
      groups.map(async (g) => {
        const groupId = (g as any)[groupByField] as number;
        const assetFilter: Prisma.AssetWhereInput = { [groupByField]: groupId };

        // Get all asset IDs in this group
        const assetIds = (
          await prisma.asset.findMany({
            where: { ...assetFilter, status: { notIn: ["DISPOSED", "SCRAPPED"] } },
            select: { id: true },
          })
        ).map((a) => a.id);

        const [ticketSum, mhSum, materialSum, spareSum, allocSum, historicalSum] =
          await Promise.all([
            prisma.ticket.aggregate({
              where: { assetId: { in: assetIds } },
              _sum: { totalCost: true },
            }),
            prisma.maintenanceHistory.aggregate({
              where: { assetId: { in: assetIds } },
              _sum: { totalCost: true },
            }),
            prisma.materialIssue.aggregate({
              where: { workOrder: { assetId: { in: assetIds } } },
              _sum: { totalCost: true },
            }),
            prisma.sparePartUsage.aggregate({
              where: { assetId: { in: assetIds } },
              _sum: { costAtUse: true },
            }),
            prisma.assetCostAllocation.aggregate({
              where: { assetId: { in: assetIds } },
              _sum: { amount: true },
            }),
            // Historical opening balance costs from legacy assets in this group
            prisma.asset.aggregate({
              where: { id: { in: assetIds }, isLegacyAsset: true },
              _sum: { historicalMaintenanceCost: true, historicalSparePartsCost: true, historicalOtherCost: true },
            }),
          ]);

        const groupHistoricalCost =
          Number(historicalSum._sum.historicalMaintenanceCost ?? 0) +
          Number(historicalSum._sum.historicalSparePartsCost ?? 0) +
          Number(historicalSum._sum.historicalOtherCost ?? 0);

        const capitalCost = Number(g._sum.purchaseCost ?? 0);
        const totalTCO =
          capitalCost +
          Number(ticketSum._sum.totalCost ?? 0) +
          Number(mhSum._sum.totalCost ?? 0) +
          Number(materialSum._sum.totalCost ?? 0) +
          Number(spareSum._sum.costAtUse ?? 0) +
          Number(allocSum._sum.amount ?? 0) +
          groupHistoricalCost;

        // Resolve group name
        let groupName = "Unknown";
        if (groupLevel === "category") {
          const cat = await prisma.assetCategory.findUnique({
            where: { id: groupId },
            select: { name: true },
          });
          groupName = cat?.name ?? "Unknown";
        } else {
          const dept = await prisma.department.findUnique({
            where: { id: groupId },
            select: { name: true },
          });
          groupName = dept?.name ?? "Unknown";
        }

        return {
          groupId,
          groupName,
          assetCount: g._count.id,
          totalTCO: Math.round(totalTCO * 100) / 100,
          avgTCOPerAsset:
            g._count.id > 0
              ? Math.round((totalTCO / g._count.id) * 100) / 100
              : 0,
        };
      })
    );

    results.sort((a, b) => b.totalTCO - a.totalTCO);
    res.json(results);
  } catch (err: any) {
    console.error("getAssetTCO error:", err);
    res.status(500).json({ error: "Failed to compute TCO", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 2. GET /asset-turnover — Asset Turnover Ratio
// ═══════════════════════════════════════════════════════════
export const getAssetTurnover = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { categoryId, departmentId } = req.query;
    const user = (req as any).user;

    const where: Prisma.AssetWhereInput = {
      status: { notIn: ["DISPOSED", "SCRAPPED"] },
      purchaseCost: { not: null, gt: 0 },
    };
    const broadAccessTurnover = ["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role);
    if (categoryId) where.assetCategoryId = Number(categoryId);
    if (departmentId) {
      where.departmentId = Number(departmentId);
    } else if (!broadAccessTurnover && user?.departmentId) {
      where.departmentId = Number(user.departmentId);
    }


    const assets = await prisma.asset.findMany({
      where,
      select: {
        id: true,
        assetId: true,
        assetName: true,
        purchaseCost: true,
        assetCategory: { select: { name: true } },
      },
    });

    if (assets.length === 0) {
      res.json({
        avgTurnoverRatio: 0,
        totalRevenue: 0,
        totalAssetValue: 0,
        topPerformers: [],
        bottomPerformers: [],
      });
      return;
    }

    // Batch fetch revenue from daily usage logs (actual + estimated per asset)
    // AssetDailyUsageLog has richer real data — staff log it daily during operations.
    // AssetRevenueEntry requires manual Cost Analysis input which is rarely filled.
    const assetIds = assets.map((a) => a.id);
    const dailyRevByAsset = await (prisma as any).assetDailyUsageLog.groupBy({
      by: ["assetId"],
      where: { assetId: { in: assetIds } },
      _sum: { revenueGenerated: true, estimatedRevenue: true },
    });

    const revenueMap = new Map<number, number>();
    for (const r of dailyRevByAsset) {
      const actual    = Number(r._sum.revenueGenerated ?? 0);
      const estimated = Number(r._sum.estimatedRevenue ?? 0);
      // Prefer actual revenue; fall back to estimated when actual is not recorded
      revenueMap.set(r.assetId, actual > 0 ? actual : estimated);
    }

    let totalRevenue = 0;
    let totalAssetValue = 0;

    const items = assets.map((a) => {
      const revenue = revenueMap.get(a.id) ?? 0;
      const cost = Number(a.purchaseCost ?? 0);
      totalRevenue += revenue;
      totalAssetValue += cost;
      return {
        assetId: a.assetId,
        assetName: a.assetName,
        category: a.assetCategory.name,
        revenue: Math.round(revenue * 100) / 100,
        purchaseCost: cost,
        turnoverRatio: cost > 0 ? Math.round((revenue / cost) * 10000) / 10000 : 0,
      };
    });

    items.sort((a, b) => b.turnoverRatio - a.turnoverRatio);

    res.json({
      avgTurnoverRatio:
        totalAssetValue > 0
          ? Math.round((totalRevenue / totalAssetValue) * 10000) / 10000
          : 0,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalAssetValue: Math.round(totalAssetValue * 100) / 100,
      topPerformers: items.slice(0, 5),
      bottomPerformers: items.slice(-5).reverse(),
    });
  } catch (err: any) {
    console.error("getAssetTurnover error:", err);
    res.status(500).json({ error: "Failed to compute asset turnover", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 3. GET /cfo-dashboard — CFO Financial Summary
// ═══════════════════════════════════════════════════════════
export const getCfoDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { departmentId } = req.query;
    const user = (req as any).user;
    // Auto-inject departmentId for non-admin users
    const broadAccess = ["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role);
    const deptFilter = departmentId
      ? Number(departmentId)
      : (!broadAccess && user?.departmentId ? Number(user.departmentId) : undefined);

    // All KPIs sourced from the Asset module only — no PO/GRA workflow tables.
    // Basic PO/GRN details (purchaseOrderNo, grnNumber, purchaseCost, grnValue)
    // are stored directly on the Asset record.
    const [
      assetValueResult,
      bookValueResult,
      ticketCostResult,
      mhCostResult,
      activeAssetCount,
      disposedAssetCount,
    ] = await Promise.all([
      // Total capital invested — sum of purchase cost of all active assets
      prisma.asset.aggregate({
        where: {
          status: { notIn: ["DISPOSED", "SCRAPPED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
        _sum: { purchaseCost: true },
      }),
      // Total current book value (from depreciation records)
      prisma.assetDepreciation.aggregate({
        where: {
          isActive: true,
          ...(deptFilter ? { asset: { departmentId: deptFilter } } : {}),
        },
        _sum: { currentBookValue: true },
      }),
      // Maintenance cost — corrective tickets
      prisma.ticket.aggregate({
        where: deptFilter ? { departmentId: deptFilter } : {},
        _sum: { totalCost: true },
      }),
      // Maintenance cost — planned maintenance history
      prisma.maintenanceHistory.aggregate({
        where: deptFilter ? { asset: { departmentId: deptFilter } } : {},
        _sum: { totalCost: true },
      }),
      // Active asset count
      prisma.asset.count({
        where: {
          status: { notIn: ["DISPOSED", "SCRAPPED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
      }),
      // Disposed/scrapped assets
      prisma.asset.count({
        where: {
          status: { in: ["DISPOSED", "SCRAPPED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
      }),
    ]);

    // Monthly asset acquisitions (capital) — based on purchaseDate on the asset record
    // Monthly maintenance cost — ticket costs by creation month
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const monthlyAcquisitions: any[] = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(purchaseDate, '%Y-%m') AS month,
        COALESCE(SUM(purchaseCost), 0) AS capital
      FROM asset
      WHERE purchaseDate >= ${twelveMonthsAgo}
        AND status NOT IN ('DISPOSED', 'SCRAPPED')
        ${deptFilter ? Prisma.sql`AND departmentId = ${deptFilter}` : Prisma.empty}
      GROUP BY DATE_FORMAT(purchaseDate, '%Y-%m')
      ORDER BY month
    `;

    const monthlyMaintenance: any[] = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(createdAt, '%Y-%m') AS month,
        COALESCE(SUM(totalCost), 0) AS maintenance
      FROM ticket
      WHERE createdAt >= ${twelveMonthsAgo}
        ${deptFilter ? Prisma.sql`AND departmentId = ${deptFilter}` : Prisma.empty}
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
      ORDER BY month
    `;

    // Build 12-month scaffold and merge
    const monthMap = new Map<string, { month: string; capital: number; maintenance: number }>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, { month: key, capital: 0, maintenance: 0 });
    }
    for (const row of monthlyAcquisitions) {
      const entry = monthMap.get(row.month);
      if (entry) entry.capital = Number(row.capital);
    }
    for (const row of monthlyMaintenance) {
      const entry = monthMap.get(row.month);
      if (entry) entry.maintenance = Number(row.maintenance);
    }

    const liveMaintenanceCost =
      Number(ticketCostResult._sum.totalCost ?? 0) +
      Number(mhCostResult._sum.totalCost ?? 0);

    // Add historical opening balance costs from legacy assets
    const historicalCostAgg = await prisma.asset.aggregate({
      where: { isLegacyAsset: true, ...(deptFilter ? { departmentId: deptFilter } : {}) },
      _sum: { historicalMaintenanceCost: true, historicalSparePartsCost: true, historicalOtherCost: true },
    });
    const totalHistoricalCost =
      Number(historicalCostAgg._sum.historicalMaintenanceCost ?? 0) +
      Number(historicalCostAgg._sum.historicalSparePartsCost ?? 0) +
      Number(historicalCostAgg._sum.historicalOtherCost ?? 0);
    const totalMaintenanceCost = liveMaintenanceCost + totalHistoricalCost;

    const totalAssetValue = Number(assetValueResult._sum.purchaseCost ?? 0);

    // Pool undigitized balances (from FA register schedules)
    const cfoPools = await prisma.assetPool.findMany({
      select: { id: true, originalQuantity: true, status: true },
      where: deptFilter ? { departmentId: deptFilter } : {},
    });
    let cfoPoolGrossBlock = 0, cfoPoolNetBlock = 0, cfoUndigitizedAssets = 0;
    for (const pool of cfoPools) {
      const linkedCount = await prisma.asset.count({ where: { assetPoolId: pool.id } });
      cfoUndigitizedAssets += Math.max(0, pool.originalQuantity - linkedCount);
      const latestSched = await prisma.assetPoolDepreciationSchedule.findFirst({
        where: { poolId: pool.id }, orderBy: { financialYearEnd: "desc" },
      });
      if (latestSched) {
        const ratio = pool.originalQuantity > 0
          ? Math.max(0, pool.originalQuantity - linkedCount) / pool.originalQuantity : 0;
        cfoPoolGrossBlock += Number(latestSched.closingGrossBlock) * ratio;
        cfoPoolNetBlock   += Number(latestSched.closingNetBlock) * ratio;
      }
    }

    // E-Waste scrap value recovered (closed records)
    const fyStart = new Date(now.getFullYear() - (now.getMonth() < 3 ? 1 : 0), 3, 1); // April 1
    const eWasteClosedRecords = await prisma.eWasteRecord.findMany({
      where: { status: 'CLOSED', closedAt: { gte: fyStart } },
      include: { assetDisposal: { select: { actualSaleValue: true } } },
    });
    const eWasteScrapValueFY = eWasteClosedRecords.reduce(
      (sum, r) => sum + Number(r.assetDisposal?.actualSaleValue ?? 0), 0
    );
    const [eWastePendingTotal, eWasteClosedTotal] = await Promise.all([
      prisma.eWasteRecord.count({ where: { status: { not: 'CLOSED' } } }),
      prisma.eWasteRecord.count({ where: { status: 'CLOSED' } }),
    ]);

    res.json({
      totalAssetValue,
      totalBookValue: Number(bookValueResult._sum.currentBookValue ?? 0),
      liveMaintenanceCost,
      totalHistoricalCost,
      totalMaintenanceCost,
      maintenanceToAssetRatio: totalAssetValue > 0
        ? Math.round((totalMaintenanceCost / totalAssetValue) * 10000) / 100
        : 0,
      activeAssets: activeAssetCount,
      disposedAssets: disposedAssetCount,
      monthlyTrend: Array.from(monthMap.values()),
      eWaste: {
        pendingSignOff: eWastePendingTotal,
        closedTotal: eWasteClosedTotal,
        scrapValueRecoveredFY: Math.round(eWasteScrapValueFY * 100) / 100,
      },
      // Pool balances — adds undigitized FA register assets to the balance sheet
      poolSummary: {
        totalPools: cfoPools.length,
        totalUndigitizedAssets: cfoUndigitizedAssets,
        poolGrossBlock: Math.round(cfoPoolGrossBlock),
        poolNetBlock:   Math.round(cfoPoolNetBlock),
        // Combined balance sheet totals (individual + pool)
        combinedAssetValue: totalAssetValue + Math.round(cfoPoolGrossBlock),
        combinedBookValue:  Number(bookValueResult._sum.currentBookValue ?? 0) + Math.round(cfoPoolNetBlock),
      },
      legacyAssetCount: await prisma.asset.count({ where: { isLegacyAsset: true, ...(deptFilter ? { departmentId: deptFilter } : {}) } }),
      dataAvailableSince: await prisma.asset.findFirst({
        where: { isLegacyAsset: true, dataAvailableSince: { not: null }, ...(deptFilter ? { departmentId: deptFilter } : {}) },
        orderBy: { dataAvailableSince: 'asc' },
        select: { dataAvailableSince: true },
      }).then(r => r?.dataAvailableSince ?? null),
    });
  } catch (err: any) {
    console.error("getCfoDashboard error:", err);
    res.status(500).json({ error: "Failed to load CFO dashboard", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 4. GET /idle-capital — Idle Capital Analysis
// ═══════════════════════════════════════════════════════════
export const getIdleCapitalAnalysis = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const monthsThreshold = Number(req.query.monthsThreshold ?? 6);
    const user = (req as any).user;
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsThreshold);

    // Department-based scoping for non-admin users
    const deptScope: Prisma.AssetWhereInput = {};
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId) {
      deptScope.departmentId = Number(user.departmentId);
    }

    // Asset status buckets:
    //   Always idle  : IN_STORE (in warehouse, not deployed), RETIRED (withdrawn from service)
    //   Activity-based: ACTIVE, UNDER_OBSERVATION — deployed but may be unused
    //   Never idle   : IN_MAINTENANCE (currently being worked on)
    //   Excluded      : DISPOSED, SCRAPPED, CONDEMNED, REJECTED

    const assetSelect = {
      id: true,
      assetId: true,
      assetName: true,
      status: true,
      purchaseCost: true,
      departmentId: true,
      assetCategoryId: true,
      assetCategory: { select: { name: true } },
      department: { select: { name: true } },
    };

    // Fetch IN_STORE and RETIRED separately — they are always idle
    const alwaysIdleAssets = await prisma.asset.findMany({
      where: { status: { in: ["IN_STORE", "RETIRED"] }, ...deptScope },
      select: assetSelect,
    });

    // Fetch ACTIVE and UNDER_OBSERVATION — need activity check
    const deployedAssets = await prisma.asset.findMany({
      where: { status: { in: ["ACTIVE", "UNDER_OBSERVATION"] }, ...deptScope },
      select: assetSelect,
    });

    // Total active fleet value (for idlePctOfTotal denominator) = all non-disposed/scrapped
    const fleetAgg = await prisma.asset.aggregate({
      where: {
        status: { notIn: ["DISPOSED", "SCRAPPED", "CONDEMNED", "REJECTED"] },
        ...deptScope,
      },
      _sum: { purchaseCost: true },
    });
    const totalFleetValueNum = Number(fleetAgg._sum.purchaseCost ?? 0);

    const deployedIds = deployedAssets.map((a) => a.id);

    // Find deployed assets that had activity within the threshold window
    const [ticketActive, mhActive, dailyLogActive, pmRunActive] = deployedIds.length > 0
      ? await Promise.all([
          prisma.ticket.findMany({
            where: { assetId: { in: deployedIds }, createdAt: { gte: cutoffDate } },
            select: { assetId: true },
            distinct: ["assetId"],
          }),
          prisma.maintenanceHistory.findMany({
            where: { assetId: { in: deployedIds }, createdAt: { gte: cutoffDate } },
            select: { assetId: true },
            distinct: ["assetId"],
          }),
          (prisma as any).assetDailyUsageLog.findMany({
            where: { assetId: { in: deployedIds }, logDate: { gte: cutoffDate } },
            select: { assetId: true },
            distinct: ["assetId"],
          }),
          prisma.pMChecklistRun.findMany({
            where: { assetId: { in: deployedIds }, createdAt: { gte: cutoffDate } },
            select: { assetId: true },
            distinct: ["assetId"],
          }),
        ])
      : [[], [], [], []];

    const recentlyActiveIds = new Set<number>();
    for (const r of [...ticketActive, ...mhActive, ...dailyLogActive, ...pmRunActive]) {
      recentlyActiveIds.add(r.assetId);
    }

    // Deployed assets with no activity in threshold window
    const inactiveDeployedAssets = deployedAssets.filter((a) => !recentlyActiveIds.has(a.id));

    // Final idle list: always-idle (IN_STORE + RETIRED) + inactive deployed
    const idleAssetList = [...alwaysIdleAssets, ...inactiveDeployedAssets];

    if (idleAssetList.length === 0) {
      res.json({ idleAssets: [], totalIdleValue: 0, idleCount: 0, idlePctOfTotal: 0 });
      return;
    }

    // Batch-fetch last activity dates
    const idleIds = idleAssetList.map((a) => a.id);

    const [lastTickets, lastMH, lastDailyLog, lastPM] = await Promise.all([
      idleIds.length > 0
        ? (prisma.$queryRaw`
            SELECT assetId, MAX(createdAt) as lastDate
            FROM ticket WHERE assetId IN (${Prisma.join(idleIds)})
            GROUP BY assetId
          ` as Promise<{ assetId: number; lastDate: Date }[]>)
        : Promise.resolve([]),
      idleIds.length > 0
        ? (prisma.$queryRaw`
            SELECT assetId, MAX(createdAt) as lastDate
            FROM maintenancehistory WHERE assetId IN (${Prisma.join(idleIds)})
            GROUP BY assetId
          ` as Promise<{ assetId: number; lastDate: Date }[]>)
        : Promise.resolve([]),
      idleIds.length > 0
        ? (prisma.$queryRaw`
            SELECT assetId, MAX(logDate) as lastDate
            FROM assetdailyusagelog WHERE assetId IN (${Prisma.join(idleIds)})
            GROUP BY assetId
          ` as Promise<{ assetId: number; lastDate: Date }[]>)
        : Promise.resolve([]),
      idleIds.length > 0
        ? (prisma.$queryRaw`
            SELECT assetId, MAX(createdAt) as lastDate
            FROM pmchecklistrun WHERE assetId IN (${Prisma.join(idleIds)})
            GROUP BY assetId
          ` as Promise<{ assetId: number; lastDate: Date }[]>)
        : Promise.resolve([]),
    ]);

    const lastActivityMap = new Map<number, Date>();
    for (const rows of [lastTickets, lastMH, lastDailyLog, lastPM]) {
      for (const r of rows) {
        const current = lastActivityMap.get(r.assetId);
        const d = new Date(r.lastDate);
        if (!current || d > current) {
          lastActivityMap.set(r.assetId, d);
        }
      }
    }

    // Fetch book values for idle assets
    const depreciations = idleIds.length > 0
      ? await prisma.assetDepreciation.findMany({
          where: { assetId: { in: idleIds } },
          select: { assetId: true, currentBookValue: true },
        })
      : [];
    const bookValueMap = new Map<number, number>();
    for (const d of depreciations) {
      bookValueMap.set(d.assetId, Number(d.currentBookValue ?? 0));
    }

    const nowMs = Date.now();
    let totalIdleValue = 0;

    const idleAssets = idleAssetList.map((a) => {
      const cost = Number(a.purchaseCost ?? 0);
      totalIdleValue += cost;
      const lastActivity = lastActivityMap.get(a.id) ?? null;
      const daysSinceActivity = lastActivity
        ? Math.floor((nowMs - new Date(lastActivity).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      return {
        assetId: a.assetId,
        assetName: a.assetName,
        category: a.assetCategory.name,
        department: a.department?.name ?? null,
        purchaseCost: cost,
        currentBookValue: bookValueMap.get(a.id) ?? null,
        lastActivityDate: lastActivity,
        daysSinceActivity,
      };
    });

    idleAssets.sort(
      (a, b) => (b.daysSinceActivity ?? Infinity) - (a.daysSinceActivity ?? Infinity)
    );

    res.json({
      idleAssets,
      totalIdleValue: Math.round(totalIdleValue * 100) / 100,
      idleCount: idleAssets.length,
      idlePctOfTotal:
        totalFleetValueNum > 0
          ? Math.round((totalIdleValue / totalFleetValueNum) * 10000) / 100
          : 0,
    });
  } catch (err: any) {
    console.error("getIdleCapitalAnalysis error:", err);
    res.status(500).json({ error: "Failed to analyse idle capital", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 5. GET /coo-dashboard — COO Operational Dashboard
// ═══════════════════════════════════════════════════════════
export const getCooDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    // Support optional dateFrom / dateTo query params for ticket/WO stats
    const { dateFrom, dateTo } = req.query;
    const rangeStart = dateFrom ? new Date(String(dateFrom)) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rangeEnd = dateTo ? new Date(String(dateTo)) : now;
    const thirtyDaysAgo = rangeStart; // alias for readability in existing code
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Auto-inject departmentId for non-admin users
    const user = (req as any).user;
    const deptFilter = !["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId ? Number(user.departmentId) : undefined;
    const deptAssetWhere = deptFilter ? { departmentId: deptFilter } : {};
    const deptWhere = deptFilter ? { departmentId: deptFilter } : {};
    const deptAssetNestedWhere = deptFilter ? { asset: { departmentId: deptFilter } } : {};

    // ── 1. Asset Fleet Health ────────────────────────────────
    const [
      totalAssets, activeAssets, inMaintenanceAssets, inStoreAssets,
      underObservationAssets, retiredAssets, disposedAssets, scrappedAssets,
    ] = await Promise.all([
      prisma.asset.count({ where: { status: { notIn: ["DISPOSED", "SCRAPPED"] }, ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "ACTIVE", ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "IN_MAINTENANCE", ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "IN_STORE", ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "UNDER_OBSERVATION", ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "RETIRED", ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "DISPOSED", ...deptAssetWhere } }),
      prisma.asset.count({ where: { status: "SCRAPPED", ...deptAssetWhere } }),
    ]);

    const fleetAvailabilityPct =
      totalAssets > 0 ? Math.round((activeAssets / totalAssets) * 10000) / 100 : 0;

    // ── 1b. Financial Summary ───────────────────────────────
    const [totalPurchaseCostAgg, totalMaintenanceCost30dAgg] =
      await Promise.all([
        prisma.asset.aggregate({
          where: { status: "ACTIVE", ...deptAssetWhere },
          _sum: { purchaseCost: true },
        }),
        prisma.ticket.aggregate({
          where: { createdAt: { gte: thirtyDaysAgo, lte: rangeEnd }, ...deptWhere },
          _sum: { totalCost: true },
        }),
      ]);

    const totalPurchaseCost = Number(totalPurchaseCostAgg._sum.purchaseCost ?? 0);
    const totalMaintenanceCost30d = Number(totalMaintenanceCost30dAgg._sum.totalCost ?? 0);

    // ── 2. Ticket Operations (date range) ──────────────────
    const [openTickets, resolvedTickets30d, slaBreachedTickets, ticketsByPriority] =
      await Promise.all([
        prisma.ticket.count({
          where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] }, ...deptWhere },
        }),
        prisma.ticket.count({
          where: {
            status: { in: ["RESOLVED", "CLOSED"] },
            updatedAt: { gte: thirtyDaysAgo, lte: rangeEnd },
            ...deptWhere,
          },
        }),
        prisma.ticket.count({
          where: {
            slaBreached: true,
            createdAt: { gte: thirtyDaysAgo, lte: rangeEnd },
            ...deptWhere,
          },
        }),
        prisma.ticket.groupBy({
          by: ["priority"],
          where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] }, ...deptWhere },
          _count: { id: true },
        }),
      ]);

    // Avg resolution hours for resolved tickets in date range
    const resolvedTicketsForAvg = await prisma.ticket.findMany({
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
        updatedAt: { gte: thirtyDaysAgo, lte: rangeEnd },
        slaResolvedAt: { not: null },
        ...deptWhere,
      },
      select: { createdAt: true, slaResolvedAt: true },
    });

    let avgResolutionHours = 0;
    if (resolvedTicketsForAvg.length > 0) {
      const totalHours = resolvedTicketsForAvg.reduce((sum, t) => {
        const diffMs =
          new Date(t.slaResolvedAt!).getTime() - new Date(t.createdAt).getTime();
        return sum + diffMs / (1000 * 60 * 60);
      }, 0);
      avgResolutionHours =
        Math.round((totalHours / resolvedTicketsForAvg.length) * 100) / 100;
    }

    const priorityMap: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const g of ticketsByPriority) {
      priorityMap[g.priority] = g._count.id;
    }

    // ── 4. Preventive Maintenance Compliance ─────────────────
    const [totalSchedules, overdueSchedules, upcomingSchedules] = await Promise.all([
      prisma.maintenanceSchedule.count({ where: { isActive: true, ...deptAssetNestedWhere } }),
      prisma.maintenanceSchedule.count({
        where: { isActive: true, nextDueAt: { lt: now }, ...deptAssetNestedWhere },
      }),
      prisma.maintenanceSchedule.count({
        where: { isActive: true, nextDueAt: { gte: now, lte: sevenDaysFromNow }, ...deptAssetNestedWhere },
      }),
    ]);

    const pmCompliancePct =
      totalSchedules > 0
        ? Math.round(((totalSchedules - overdueSchedules) / totalSchedules) * 10000) / 100
        : 100;

    // Top 10 overdue schedules
    const overdueList = await prisma.maintenanceSchedule.findMany({
      where: { isActive: true, nextDueAt: { lt: now }, ...deptAssetNestedWhere },
      include: { asset: { select: { assetName: true, assetId: true } } },
      orderBy: { nextDueAt: "asc" },
      take: 10,
    });

    const overdueListFormatted = overdueList.map((s) => ({
      scheduleId: s.id,
      assetName: s.asset.assetName,
      assetCode: s.asset.assetId,
      frequencyUnit: s.frequencyUnit,
      nextDueAt: s.nextDueAt,
      daysOverdue: Math.floor(
        (now.getTime() - new Date(s.nextDueAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));

    // ── 5. Department Performance (last 30 days) ─────────────
    const deptTickets = await prisma.ticket.groupBy({
      by: ["departmentId"],
      where: { createdAt: { gte: thirtyDaysAgo }, ...deptWhere },
      _count: { id: true },
    });

    const deptResolved = await prisma.ticket.groupBy({
      by: ["departmentId"],
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
        updatedAt: { gte: thirtyDaysAgo },
        ...deptWhere,
      },
      _count: { id: true },
    });

    const deptSlaBreaches = await prisma.ticket.groupBy({
      by: ["departmentId"],
      where: {
        slaBreached: true,
        createdAt: { gte: thirtyDaysAgo },
        ...deptWhere,
      },
      _count: { id: true },
    });

    // Collect all department IDs
    const allDeptIds = new Set<number>();
    for (const g of [...deptTickets, ...deptResolved, ...deptSlaBreaches]) {
      allDeptIds.add(g.departmentId);
    }

    // Fetch department names
    const departments = await prisma.department.findMany({
      where: { id: { in: Array.from(allDeptIds) } },
      select: { id: true, name: true },
    });
    const deptNameMap = new Map(departments.map((d) => [d.id, d.name]));

    // Build maps
    const deptTicketMap = new Map(deptTickets.map((g) => [g.departmentId, g._count.id]));
    const deptResolvedMap = new Map(deptResolved.map((g) => [g.departmentId, g._count.id]));
    const deptSlaMap = new Map(deptSlaBreaches.map((g) => [g.departmentId, g._count.id]));

    // Avg resolution per department
    const resolvedByDept = await prisma.ticket.findMany({
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
        updatedAt: { gte: thirtyDaysAgo },
        slaResolvedAt: { not: null },
        departmentId: { in: Array.from(allDeptIds) },
      },
      select: { departmentId: true, createdAt: true, slaResolvedAt: true },
    });

    const deptResolutionHours = new Map<number, { total: number; count: number }>();
    for (const t of resolvedByDept) {
      const diffHrs =
        (new Date(t.slaResolvedAt!).getTime() - new Date(t.createdAt).getTime()) /
        (1000 * 60 * 60);
      const entry = deptResolutionHours.get(t.departmentId) ?? { total: 0, count: 0 };
      entry.total += diffHrs;
      entry.count += 1;
      deptResolutionHours.set(t.departmentId, entry);
    }

    const departmentPerformance = Array.from(allDeptIds)
      .map((deptId) => {
        const resEntry = deptResolutionHours.get(deptId);
        return {
          departmentId: deptId,
          departmentName: deptNameMap.get(deptId) ?? "Unknown",
          ticketCount: deptTicketMap.get(deptId) ?? 0,
          resolvedCount: deptResolvedMap.get(deptId) ?? 0,
          avgResolutionHours: resEntry
            ? Math.round((resEntry.total / resEntry.count) * 100) / 100
            : 0,
          slaBreaches: deptSlaMap.get(deptId) ?? 0,
        };
      })
      .sort((a, b) => b.slaBreaches - a.slaBreaches)
      .slice(0, 15);

    // ── 6. Critical Alerts ───────────────────────────────────
    const [assetsNeedingAttention, expiredWarranties, pendingTransfers] =
      await Promise.all([
        prisma.asset.count({
          where: { workingCondition: { in: ["NOT_WORKING", "PARTIAL"] }, ...deptAssetWhere },
        }),
        prisma.warranty.count({
          where: { warrantyEnd: { lt: now }, isUnderWarranty: true, ...(deptFilter ? { asset: { departmentId: deptFilter } } : {}) },
        }),
        prisma.assetTransferHistory.count({
          where: { status: { in: ["REQUESTED", "IN_TRANSIT"] }, ...(deptFilter ? { asset: { departmentId: deptFilter } } : {}) },
        }),
      ]);

    res.json({
      fleetHealth: {
        totalAssets,
        activeAssets,
        inMaintenanceAssets,
        inStoreAssets,
        underObservationAssets,
        retiredAssets,
        disposedAssets,
        scrappedAssets,
        fleetAvailabilityPct,
      },
      financialSummary: {
        totalPurchaseCost,
        totalMaintenanceCost30d,
      },
      ticketOperations: {
        openTickets,
        resolvedTickets30d,
        slaBreachedTickets,
        avgResolutionHours,
        ticketsByPriority: priorityMap,
      },
      pmCompliance: {
        totalSchedules,
        overdueSchedules,
        upcomingSchedules,
        pmCompliancePct,
        overdueList: overdueListFormatted,
      },
      departmentPerformance,
      criticalAlerts: {
        assetsNeedingAttention,
        expiredWarranties,
        pendingTransfers,
      },
      eWaste: await (async () => {
        const [pendingHOD, pendingOps, pendingSec, openOver30, closedThisMonth] = await Promise.all([
          prisma.eWasteRecord.count({ where: { status: 'PENDING_HOD' } }),
          prisma.eWasteRecord.count({ where: { status: 'PENDING_OPERATIONS' } }),
          prisma.eWasteRecord.count({ where: { status: 'PENDING_SECURITY' } }),
          prisma.eWasteRecord.count({ where: { status: { not: 'CLOSED' }, createdAt: { lte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
          prisma.eWasteRecord.count({ where: { status: 'CLOSED', closedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }),
        ]);
        // Avg days to close
        const closedRecords = await prisma.eWasteRecord.findMany({
          where: { status: 'CLOSED', closedAt: { not: null } },
          select: { createdAt: true, closedAt: true },
        });
        const avgDaysToClose = closedRecords.length > 0
          ? Math.round(closedRecords.reduce((sum, r) =>
              sum + (new Date(r.closedAt!).getTime() - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000), 0
            ) / closedRecords.length)
          : 0;
        return { pendingHOD, pendingOps, pendingSec, totalPending: pendingHOD + pendingOps + pendingSec, openOver30, closedThisMonth, avgDaysToClose };
      })(),
      legacyAssetCount: await prisma.asset.count({ where: { isLegacyAsset: true } }),
      dataAvailableSince: await prisma.asset.findFirst({
        where: { isLegacyAsset: true, dataAvailableSince: { not: null } },
        orderBy: { dataAvailableSince: 'asc' },
        select: { dataAvailableSince: true },
      }).then(r => r?.dataAvailableSince ?? null),
      // Pool digitization summary for COO operational view
      poolSummary: await (async () => {
        const pools = await prisma.assetPool.findMany({
          select: { id: true, originalQuantity: true, status: true },
          where: deptFilter ? { departmentId: deptFilter } : {},
        });
        let poolGrossBlock = 0, poolNetBlock = 0, notIndividualized = 0;
        for (const pool of pools) {
          const cnt = await prisma.asset.count({ where: { assetPoolId: pool.id } });
          notIndividualized += Math.max(0, pool.originalQuantity - cnt);
          const s = await prisma.assetPoolDepreciationSchedule.findFirst({
            where: { poolId: pool.id }, orderBy: { financialYearEnd: "desc" },
          });
          if (s) {
            const r = pool.originalQuantity > 0 ? Math.max(0, pool.originalQuantity - cnt) / pool.originalQuantity : 0;
            poolGrossBlock += Number(s.closingGrossBlock) * r;
            poolNetBlock   += Number(s.closingNetBlock) * r;
          }
        }
        const total = pools.reduce((s, p) => s + p.originalQuantity, 0);
        return {
          totalPools: pools.length,
          assetsNotIndividualized: notIndividualized,
          poolGrossBlock: Math.round(poolGrossBlock),
          poolNetBlock:   Math.round(poolNetBlock),
          digitizationPct: total > 0 ? Math.round((1 - notIndividualized / total) * 100) : 100,
        };
      })(),
    });
  } catch (err: any) {
    console.error("getCooDashboard error:", err);
    res.status(500).json({ error: "Failed to load COO dashboard", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 6. GET /in-store-aging — In-Store Asset Aging
// ═══════════════════════════════════════════════════════════
export const getInStoreAging = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const deptScope = !["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId ? Number(user.departmentId) : undefined;

    const assets = await prisma.asset.findMany({
      where: {
        OR: [
          { status: "IN_STORE" },
          { departmentId: null, allottedToId: null },
        ],
        ...(deptScope ? { departmentId: deptScope } : {}),
      },
      select: {
        id: true,
        assetId: true,
        assetName: true,
        purchaseCost: true,
        purchaseDate: true,
        grnDate: true,
        status: true,
        currentLocation: true,
        assetCategory: { select: { name: true } },
      },
      orderBy: { purchaseDate: "asc" },
    });

    const nowMs = Date.now();

    const result = assets.map((a) => {
      const referenceDate = a.grnDate ?? a.purchaseDate;
      const daysInStore = referenceDate
        ? Math.floor((nowMs - new Date(referenceDate).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      return {
        assetId: a.assetId,
        assetName: a.assetName,
        category: a.assetCategory.name,
        purchaseCost: Number(a.purchaseCost ?? 0),
        daysInStore,
        storeLocation: a.currentLocation ?? null,
      };
    });

    result.sort((a, b) => (b.daysInStore ?? 0) - (a.daysInStore ?? 0));

    res.json(result);
  } catch (err: any) {
    console.error("getInStoreAging error:", err);
    res.status(500).json({ error: "Failed to load in-store aging", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 7. GET /uncovered-assets — Assets with no warranty AND no contract
// ═══════════════════════════════════════════════════════════
export const getUncoveredAssets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const now = new Date();

    // Department scoping for non-admin users
    const assetWhere: Prisma.AssetWhereInput = {
      status: { notIn: ["DISPOSED", "SCRAPPED"] },
    };
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId) {
      assetWhere.departmentId = Number(user.departmentId);
    }

    const assets = await prisma.asset.findMany({
      where: assetWhere,
      select: {
        id: true,
        assetId: true,
        assetName: true,
        purchaseCost: true,
        assetCategoryId: true,
        assetCategory: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    if (assets.length === 0) {
      res.json({ uncoveredAssets: [], total: 0, totalValue: 0 });
      return;
    }

    // Batch-fetch active warranties and active contracts for all assets
    const assetIds = assets.map((a) => a.id);

    const [activeWarranties, activeContracts, lastMaintenanceDates] = await Promise.all([
      prisma.warranty.findMany({
        where: {
          assetId: { in: assetIds },
          isActive: true,
          isUnderWarranty: true,
          warrantyEnd: { gte: now },
        },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      prisma.serviceContract.findMany({
        where: {
          assetId: { in: assetIds },
          status: "ACTIVE",
        },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      assetIds.length > 0
        ? (prisma.$queryRaw`
            SELECT assetId, MAX(createdAt) AS lastDate
            FROM maintenancehistory
            WHERE assetId IN (${Prisma.join(assetIds)})
            GROUP BY assetId
          ` as Promise<{ assetId: number; lastDate: Date }[]>)
        : Promise.resolve([]),
    ]);

    const coveredByWarranty = new Set(activeWarranties.map((w) => w.assetId));
    const coveredByContract = new Set(activeContracts.map((c) => c.assetId));

    const lastMaintMap = new Map<number, Date>();
    for (const row of lastMaintenanceDates) {
      lastMaintMap.set(row.assetId, new Date(row.lastDate));
    }

    const nowMs = now.getTime();
    let totalValue = 0;

    const uncoveredAssets = assets
      .filter((a) => !coveredByWarranty.has(a.id) && !coveredByContract.has(a.id))
      .map((a) => {
        const cost = Number(a.purchaseCost ?? 0);
        totalValue += cost;
        const lastMaint = lastMaintMap.get(a.id) ?? null;
        const daysSinceLastService = lastMaint
          ? Math.floor((nowMs - lastMaint.getTime()) / (24 * 60 * 60 * 1000))
          : null;

        return {
          id: a.id,
          assetId: a.assetId,
          assetName: a.assetName,
          category: a.assetCategory.name,
          department: a.department?.name ?? null,
          purchaseCost: cost,
          lastMaintenanceDate: lastMaint,
          daysSinceLastService,
        };
      });

    res.json({
      uncoveredAssets,
      total: uncoveredAssets.length,
      totalValue: Math.round(totalValue * 100) / 100,
    });
  } catch (err: any) {
    console.error("getUncoveredAssets error:", err);
    res.status(500).json({ error: "Failed to load uncovered assets", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 8. GET /maintenance-by-category
//    Maintenance cost breakdown by asset category.
//    Returns categories sorted by total maintenance cost desc,
//    each with their assets sorted by individual cost desc.
// ═══════════════════════════════════════════════════════════
export const getMaintenanceByCategory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const deptFilter = !["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId
      ? Number(user.departmentId) : undefined;
    const deptAssetWhere = deptFilter ? { departmentId: deptFilter } : {};

    // Step 1: Aggregate ticket (corrective) costs per asset
    const ticketCosts = await prisma.ticket.groupBy({
      by: ["assetId"],
      where: { assetId: { not: undefined }, ...(deptFilter ? { departmentId: deptFilter } : {}) },
      _sum: { totalCost: true },
    });

    // Step 2: Aggregate maintenance history (PM) costs per asset
    const mhCosts = await prisma.maintenanceHistory.groupBy({
      by: ["assetId"],
      where: { assetId: { not: undefined }, ...(deptFilter ? { asset: deptAssetWhere } : {}) },
      _sum: { totalCost: true },
    });

    // Build cost map: assetDbId → { ticket, pm }
    const costMap = new Map<number, { ticket: number; pm: number }>();
    for (const t of ticketCosts) {
      if (!t.assetId) continue;
      const cur = costMap.get(t.assetId) ?? { ticket: 0, pm: 0 };
      cur.ticket += Number(t._sum?.totalCost ?? 0);
      costMap.set(t.assetId, cur);
    }
    for (const m of mhCosts) {
      if (!m.assetId) continue;
      const cur = costMap.get(m.assetId) ?? { ticket: 0, pm: 0 };
      cur.pm += Number(m._sum?.totalCost ?? 0);
      costMap.set(m.assetId, cur);
    }

    // Step 3: Load all assets with category & department
    const assets = await prisma.asset.findMany({
      where: deptFilter ? { departmentId: deptFilter } : {},
      select: {
        id: true,
        assetId: true,
        assetName: true,
        status: true,
        purchaseCost: true,
        estimatedValue: true,
        assetCategoryId: true,
        assetCategory: { select: { id: true, name: true } },
        department: { select: { name: true } },
      },
    });

    // Step 4: Group by category
    const catMap = new Map<number, {
      categoryId: number;
      categoryName: string;
      assetCount: number;
      totalMaintenanceCost: number;
      ticketCost: number;
      pmCost: number;
      assets: any[];
    }>();

    for (const asset of assets) {
      const catId = asset.assetCategoryId;
      if (!catId) continue;

      const costs = costMap.get(asset.id) ?? { ticket: 0, pm: 0 };
      const totalCost = costs.ticket + costs.pm;

      if (!catMap.has(catId)) {
        catMap.set(catId, {
          categoryId: catId,
          categoryName: asset.assetCategory?.name ?? "Uncategorized",
          assetCount: 0,
          totalMaintenanceCost: 0,
          ticketCost: 0,
          pmCost: 0,
          assets: [],
        });
      }

      const cat = catMap.get(catId)!;
      cat.assetCount++;
      cat.totalMaintenanceCost += totalCost;
      cat.ticketCost += costs.ticket;
      cat.pmCost += costs.pm;
      cat.assets.push({
        id: asset.id,
        assetId: asset.assetId,
        assetName: asset.assetName,
        department: asset.department?.name ?? null,
        status: asset.status,
        purchaseCost: Number(asset.purchaseCost ?? asset.estimatedValue ?? 0),
        ticketCost: Math.round(costs.ticket * 100) / 100,
        pmCost: Math.round(costs.pm * 100) / 100,
        totalMaintenanceCost: Math.round(totalCost * 100) / 100,
      });
    }

    // Step 5: Sort categories and their assets by cost desc
    const result = [...catMap.values()]
      .sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost)
      .map(cat => ({
        ...cat,
        totalMaintenanceCost: Math.round(cat.totalMaintenanceCost * 100) / 100,
        ticketCost: Math.round(cat.ticketCost * 100) / 100,
        pmCost: Math.round(cat.pmCost * 100) / 100,
        avgCostPerAsset: cat.assetCount > 0
          ? Math.round((cat.totalMaintenanceCost / cat.assetCount) * 100) / 100
          : 0,
        assets: cat.assets.sort((a: any, b: any) => b.totalMaintenanceCost - a.totalMaintenanceCost),
      }));

    res.json(result);
  } catch (err: any) {
    console.error("getMaintenanceByCategory error:", err);
    res.status(500).json({ error: "Failed to load maintenance breakdown", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 9. GET /asset-value-buckets — Asset count+value by cost range
// ═══════════════════════════════════════════════════════════
export const getAssetValueBuckets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const deptFilter = !["ADMIN", "CEO_COO", "FINANCE"].includes(user?.role) && user?.departmentId
      ? { departmentId: Number(user.departmentId) } : {};

    const activeWhere = { status: { notIn: ["DISPOSED", "SCRAPPED", "CONDEMNED"] }, ...deptFilter };

    const assets = await prisma.asset.findMany({
      where: activeWhere,
      select: {
        id: true, assetId: true, assetName: true,
        purchaseCost: true, estimatedValue: true,
        status: true,
        assetCategory: { select: { name: true } },
        department: { select: { name: true } },
        depreciation: { select: { currentBookValue: true } },
      },
    });

    const buckets = [
      { key: 'A', label: 'Below ₹1 Lakh',      min: 0,        max: 100000,   assets: [] as any[], count: 0, totalCost: 0, totalBookValue: 0 },
      { key: 'B', label: '₹1L – ₹10L',          min: 100000,   max: 1000000,  assets: [] as any[], count: 0, totalCost: 0, totalBookValue: 0 },
      { key: 'C', label: '₹10L – ₹50L',         min: 1000000,  max: 5000000,  assets: [] as any[], count: 0, totalCost: 0, totalBookValue: 0 },
      { key: 'D', label: 'Above ₹50 Lakh',      min: 5000000,  max: Infinity, assets: [] as any[], count: 0, totalCost: 0, totalBookValue: 0 },
    ];

    for (const asset of assets) {
      const cost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
      const bookVal = Number(asset.depreciation?.currentBookValue ?? cost);
      const bucket = buckets.find(b => cost >= b.min && cost < b.max);
      if (!bucket) continue;
      bucket.count++;
      bucket.totalCost += cost;
      bucket.totalBookValue += bookVal;
      bucket.assets.push({
        id: asset.id,
        assetId: asset.assetId,
        assetName: asset.assetName,
        category: asset.assetCategory?.name ?? '—',
        department: asset.department?.name ?? '—',
        status: asset.status,
        purchaseCost: cost,
        bookValue: Math.round(bookVal * 100) / 100,
      });
    }

    // Sort assets within each bucket by cost desc
    for (const b of buckets) {
      b.assets.sort((a, b) => b.purchaseCost - a.purchaseCost);
      (b as any).totalCost = Math.round(b.totalCost * 100) / 100;
      (b as any).totalBookValue = Math.round(b.totalBookValue * 100) / 100;
    }

    res.json({ buckets, totalAssets: assets.length });
  } catch (err: any) {
    console.error("getAssetValueBuckets error:", err);
    res.status(500).json({ error: "Failed to load asset value buckets", details: err.message });
  }
};

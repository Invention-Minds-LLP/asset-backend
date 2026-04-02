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
        otherCost;

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
    if (departmentId) assetWhere.departmentId = Number(departmentId);

    const groupByField =
      groupLevel === "category" ? "assetCategoryId" : "departmentId";

    // Get assets grouped
    const groups = await prisma.asset.groupBy({
      by: [groupByField],
      where: {
        ...assetWhere,
        status: { notIn: ["DISPOSED", "SCRAPPED"] },
        [groupByField]: { not: null },
      },
      _count: { id: true },
      _sum: { purchaseCost: true },
    });

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

        const [ticketSum, mhSum, materialSum, spareSum, allocSum] =
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
          ]);

        const capitalCost = Number(g._sum.purchaseCost ?? 0);
        const totalTCO =
          capitalCost +
          Number(ticketSum._sum.totalCost ?? 0) +
          Number(mhSum._sum.totalCost ?? 0) +
          Number(materialSum._sum.totalCost ?? 0) +
          Number(spareSum._sum.costAtUse ?? 0) +
          Number(allocSum._sum.amount ?? 0);

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
    if (categoryId) where.assetCategoryId = Number(categoryId);
    if (departmentId) {
      where.departmentId = Number(departmentId);
    } else if (user?.role !== "ADMIN" && user?.departmentId) {
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

    // Batch fetch revenue for all assets
    const assetIds = assets.map((a) => a.id);
    const revenueByAsset = await prisma.assetRevenueEntry.groupBy({
      by: ["assetId"],
      where: { assetId: { in: assetIds } },
      _sum: { totalRevenue: true },
    });

    const revenueMap = new Map<number, number>();
    for (const r of revenueByAsset) {
      revenueMap.set(r.assetId, Number(r._sum.totalRevenue ?? 0));
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
    const deptFilter = departmentId
      ? Number(departmentId)
      : (user?.role !== "ADMIN" && user?.departmentId ? Number(user.departmentId) : undefined);

    const [
      capExResult,
      opExResult,
      assetValueResult,
      bookValueResult,
      ticketCostResult,
      mhCostResult,
      activeAssetCount,
      pendingPOCount,
      openWOCount,
    ] = await Promise.all([
      // totalCapExSpend
      prisma.purchaseOrder.aggregate({
        where: {
          status: { in: ["FULLY_RECEIVED", "PARTIALLY_RECEIVED", "CLOSED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
        _sum: { totalAmount: true },
      }),
      // totalOpExSpend
      prisma.workOrder.aggregate({
        where: {
          woType: "OPEX",
          status: { in: ["WORK_COMPLETED", "WCC_ISSUED", "CLOSED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
        _sum: { actualCost: true },
      }),
      // totalAssetValue
      prisma.asset.aggregate({
        where: {
          status: { notIn: ["DISPOSED", "SCRAPPED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
        _sum: { purchaseCost: true },
      }),
      // totalBookValue
      prisma.assetDepreciation.aggregate({
        where: {
          isActive: true,
          ...(deptFilter
            ? { asset: { departmentId: deptFilter } }
            : {}),
        },
        _sum: { currentBookValue: true },
      }),
      // totalMaintenanceCost — tickets
      prisma.ticket.aggregate({
        where: deptFilter ? { departmentId: deptFilter } : {},
        _sum: { totalCost: true },
      }),
      // totalMaintenanceCost — maintenance history
      prisma.maintenanceHistory.aggregate({
        where: deptFilter ? { asset: { departmentId: deptFilter } } : {},
        _sum: { totalCost: true },
      }),
      // activeAssets
      prisma.asset.count({
        where: {
          status: { notIn: ["DISPOSED", "SCRAPPED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
      }),
      // pendingPOs
      prisma.purchaseOrder.count({
        where: {
          status: { in: ["DRAFT", "SUBMITTED", "HOD_APPROVED", "MGMT_APPROVED"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
      }),
      // openWorkOrders
      prisma.workOrder.count({
        where: {
          status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS"] },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
      }),
    ]);

    // monthlySpend — last 12 months via raw SQL
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const monthlyCapex: any[] = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(poDate, '%Y-%m') AS month,
        COALESCE(SUM(totalAmount), 0) AS capex
      FROM purchaseorder
      WHERE status IN ('FULLY_RECEIVED','PARTIALLY_RECEIVED','CLOSED')
        AND poDate >= ${twelveMonthsAgo}
        ${deptFilter ? Prisma.sql`AND departmentId = ${deptFilter}` : Prisma.empty}
      GROUP BY DATE_FORMAT(poDate, '%Y-%m')
      ORDER BY month
    `;

    const monthlyOpex: any[] = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(woDate, '%Y-%m') AS month,
        COALESCE(SUM(actualCost), 0) AS opex
      FROM workorder
      WHERE woType = 'OPEX'
        AND status IN ('WORK_COMPLETED','WCC_ISSUED','CLOSED')
        AND woDate >= ${twelveMonthsAgo}
        ${deptFilter ? Prisma.sql`AND departmentId = ${deptFilter}` : Prisma.empty}
      GROUP BY DATE_FORMAT(woDate, '%Y-%m')
      ORDER BY month
    `;

    // Merge into single monthly array
    const monthMap = new Map<string, { month: string; capex: number; opex: number }>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, { month: key, capex: 0, opex: 0 });
    }
    for (const row of monthlyCapex) {
      const entry = monthMap.get(row.month);
      if (entry) entry.capex = Number(row.capex);
    }
    for (const row of monthlyOpex) {
      const entry = monthMap.get(row.month);
      if (entry) entry.opex = Number(row.opex);
    }

    res.json({
      totalCapExSpend: Number(capExResult._sum.totalAmount ?? 0),
      totalOpExSpend: Number(opExResult._sum.actualCost ?? 0),
      totalAssetValue: Number(assetValueResult._sum.purchaseCost ?? 0),
      totalBookValue: Number(bookValueResult._sum.currentBookValue ?? 0),
      totalMaintenanceCost:
        Number(ticketCostResult._sum.totalCost ?? 0) +
        Number(mhCostResult._sum.totalCost ?? 0),
      activeAssets: activeAssetCount,
      pendingPOs: pendingPOCount,
      openWorkOrders: openWOCount,
      monthlySpend: Array.from(monthMap.values()),
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
    const assetWhere: Prisma.AssetWhereInput = { status: { notIn: ["DISPOSED", "SCRAPPED"] } };
    if (user?.role !== "ADMIN" && user?.departmentId) {
      assetWhere.departmentId = Number(user.departmentId);
    }

    // Find active assets
    const activeAssets = await prisma.asset.findMany({
      where: assetWhere,
      select: {
        id: true,
        assetId: true,
        assetName: true,
        purchaseCost: true,
        departmentId: true,
        assetCategoryId: true,
        assetCategory: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    if (activeAssets.length === 0) {
      res.json({
        idleAssets: [],
        totalIdleValue: 0,
        idleCount: 0,
        idlePctOfTotal: 0,
      });
      return;
    }

    const allIds = activeAssets.map((a) => a.id);

    // Find assets with activity after cutoff in each source
    const [
      ticketActive,
      mhActive,
      revenueActive,
      pmRunActive,
    ] = await Promise.all([
      prisma.ticket.findMany({
        where: { assetId: { in: allIds }, createdAt: { gte: cutoffDate } },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      prisma.maintenanceHistory.findMany({
        where: { assetId: { in: allIds }, createdAt: { gte: cutoffDate } },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      prisma.assetRevenueEntry.findMany({
        where: { assetId: { in: allIds }, createdAt: { gte: cutoffDate } },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      prisma.pMChecklistRun.findMany({
        where: { assetId: { in: allIds }, createdAt: { gte: cutoffDate } },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
    ]);

    const activeIds = new Set<number>();
    for (const r of [...ticketActive, ...mhActive, ...revenueActive, ...pmRunActive]) {
      activeIds.add(r.assetId);
    }

    // For idle assets, find their last activity date
    const idleAssetList = activeAssets.filter((a) => !activeIds.has(a.id));

    // Batch-fetch last activity dates
    const idleIds = idleAssetList.map((a) => a.id);

    const [lastTickets, lastMH, lastRevenue, lastPM] = await Promise.all([
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
            SELECT assetId, MAX(createdAt) as lastDate
            FROM assetrevenueentry WHERE assetId IN (${Prisma.join(idleIds)})
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
    for (const rows of [lastTickets, lastMH, lastRevenue, lastPM]) {
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

    const totalActiveValue = activeAssets.reduce(
      (sum, a) => sum + Number(a.purchaseCost ?? 0),
      0
    );

    res.json({
      idleAssets,
      totalIdleValue: Math.round(totalIdleValue * 100) / 100,
      idleCount: idleAssets.length,
      idlePctOfTotal:
        totalActiveValue > 0
          ? Math.round((totalIdleValue / totalActiveValue) * 10000) / 100
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
    const deptFilter = user?.role !== "ADMIN" && user?.departmentId ? Number(user.departmentId) : undefined;
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
    const [totalPurchaseCostAgg, totalMaintenanceCost30dAgg, pendingPOValueAgg] =
      await Promise.all([
        prisma.asset.aggregate({
          where: { status: "ACTIVE", ...deptAssetWhere },
          _sum: { purchaseCost: true },
        }),
        prisma.ticket.aggregate({
          where: { createdAt: { gte: thirtyDaysAgo, lte: rangeEnd }, ...deptWhere },
          _sum: { totalCost: true },
        }),
        prisma.purchaseOrder.aggregate({
          where: { status: { in: ["DRAFT", "SUBMITTED", "HOD_APPROVED"] }, ...deptWhere },
          _sum: { totalAmount: true },
        }),
      ]);

    const totalPurchaseCost = Number(totalPurchaseCostAgg._sum.purchaseCost ?? 0);
    const totalMaintenanceCost30d = Number(totalMaintenanceCost30dAgg._sum.totalCost ?? 0);
    const pendingPOValue = Number(pendingPOValueAgg._sum.totalAmount ?? 0);

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

    // ── 3. Work Order Throughput (date range) ──────────────
    const [totalWOs30d, completedWOs30d, pendingWOs, woByTypeRaw] = await Promise.all([
      prisma.workOrder.count({ where: { createdAt: { gte: thirtyDaysAgo, lte: rangeEnd }, ...deptWhere } }),
      prisma.workOrder.count({
        where: {
          status: { in: ["WORK_COMPLETED", "WCC_ISSUED", "CLOSED"] },
          createdAt: { gte: thirtyDaysAgo, lte: rangeEnd },
          ...deptWhere,
        },
      }),
      prisma.workOrder.count({
        where: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS"] }, ...deptWhere },
      }),
      prisma.workOrder.groupBy({
        by: ["woType"],
        where: { createdAt: { gte: thirtyDaysAgo, lte: rangeEnd }, ...deptWhere },
        _count: { id: true },
      }),
    ]);

    // Avg completion days
    const completedWOsForAvg = await prisma.workOrder.findMany({
      where: {
        status: { in: ["WORK_COMPLETED", "WCC_ISSUED", "CLOSED"] },
        createdAt: { gte: thirtyDaysAgo, lte: rangeEnd },
        actualEnd: { not: null },
        ...deptWhere,
      },
      select: { createdAt: true, actualEnd: true },
    });

    let avgCompletionDays = 0;
    if (completedWOsForAvg.length > 0) {
      const totalDays = completedWOsForAvg.reduce((sum, wo) => {
        const diffMs =
          new Date(wo.actualEnd!).getTime() - new Date(wo.createdAt).getTime();
        return sum + diffMs / (1000 * 60 * 60 * 24);
      }, 0);
      avgCompletionDays =
        Math.round((totalDays / completedWOsForAvg.length) * 100) / 100;
    }

    const woByType: Record<string, number> = { opex: 0, capex: 0 };
    for (const g of woByTypeRaw) {
      if (g.woType === "OPEX") woByType.opex = g._count.id;
      if (g.woType === "CAPEX") woByType.capex = g._count.id;
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
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    });

    const deptResolved = await prisma.ticket.groupBy({
      by: ["departmentId"],
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
        updatedAt: { gte: thirtyDaysAgo },
      },
      _count: { id: true },
    });

    const deptSlaBreaches = await prisma.ticket.groupBy({
      by: ["departmentId"],
      where: {
        slaBreached: true,
        createdAt: { gte: thirtyDaysAgo },
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
    const [assetsNeedingAttention, expiredWarranties, pendingTransfers, pendingPOs, pendingWOApprovals] =
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
        prisma.purchaseOrder.count({
          where: { status: { in: ["DRAFT", "SUBMITTED", "HOD_APPROVED"] }, ...deptWhere },
        }),
        prisma.workOrder.count({
          where: { status: { in: ["DRAFT", "SUBMITTED"] }, ...deptWhere },
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
        pendingPOValue,
      },
      ticketOperations: {
        openTickets,
        resolvedTickets30d,
        slaBreachedTickets,
        avgResolutionHours,
        ticketsByPriority: priorityMap,
      },
      workOrderThroughput: {
        totalWOs30d,
        completedWOs30d,
        pendingWOs,
        avgCompletionDays,
        woByType,
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
        pendingApprovals: pendingPOs + pendingWOApprovals,
      },
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
    const deptScope = user?.role !== "ADMIN" && user?.departmentId ? Number(user.departmentId) : undefined;

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
    if (user?.role !== "ADMIN" && user?.departmentId) {
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

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import {
  buildAssetWhere,
  buildRawWhereClause,
  buildFYTree,
  getFYLabel,
} from "./financial-dashboard.utils";

// ─── 1. Filter Options ─────────────────────────────────────────────────────────
export const getFilterOptions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [departments, categories, branches, vendors] = await Promise.all([
      prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.assetCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    // Compute available financial years from actual data
    const fyRaw: any[] = await prisma.$queryRaw`
      SELECT DISTINCT YEAR(purchaseDate) as yr, MONTH(purchaseDate) as mo
      FROM asset WHERE purchaseDate IS NOT NULL
    `;
    const fySet = new Set<number>();
    for (const r of fyRaw) {
      fySet.add(Number(r.mo) >= 4 ? Number(r.yr) : Number(r.yr) - 1);
    }
    const financialYears = [...fySet]
      .sort((a, b) => b - a)
      .map((y) => ({ label: getFYLabel(y), value: y }));

    res.json({
      departments,
      categories,
      branches,
      vendors,
      financialYears,
      procurementModes: [
        { label: "Purchase", value: "PURCHASE" },
        { label: "Donation", value: "DONATION" },
        { label: "Lease", value: "LEASE" },
        { label: "Rental", value: "RENTAL" },
      ],
      assetStatuses: [
        { label: "Active", value: "ACTIVE" },
        { label: "Retired", value: "RETIRED" },
        { label: "In Maintenance", value: "IN_MAINTENANCE" },
        { label: "Disposed", value: "DISPOSED" },
        { label: "In Transit", value: "IN_TRANSIT" },
      ],
    });
  } catch (err: any) {
    console.error("getFilterOptions error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 2. Financial Summary ───────────────────────────────────────────────────────
export const getFinancialSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const assetWhere = buildAssetWhere(query, user);

    // Get matching asset IDs for related model queries
    const matchingAssets = await prisma.asset.findMany({
      where: assetWhere,
      select: { id: true, purchaseCost: true, leaseAmount: true, rentalAmount: true, estimatedValue: true },
    });
    const assetIds = matchingAssets.map((a) => a.id);

    const [
      maintenanceSum,
      ticketCostSum,
      insuranceSum,
      contractSum,
      depreciationSum,
      sparePartUsageSum,
    ] = await Promise.all([
      prisma.maintenanceHistory.aggregate({
        where: { assetId: { in: assetIds } },
        _sum: { totalCost: true },
      }),
      prisma.ticket.aggregate({
        where: { assetId: { in: assetIds } },
        _sum: { totalCost: true },
      }),
      prisma.assetInsurance.aggregate({
        where: { assetId: { in: assetIds } },
        _sum: { premiumAmount: true },
      }),
      prisma.serviceContract.aggregate({
        where: { assetId: { in: assetIds } },
        _sum: { cost: true },
      }),
      prisma.assetDepreciation.aggregate({
        where: { assetId: { in: assetIds } },
        _sum: { accumulatedDepreciation: true },
      }),
      prisma.sparePartUsage.aggregate({
        where: { assetId: { in: assetIds } },
        _sum: { costAtUse: true },
      }),
    ]);

    // Compute totals
    const totalPurchaseCost = matchingAssets.reduce(
      (s, a) => s + Number(a.purchaseCost || 0), 0
    );
    const totalLeaseAmount = matchingAssets.reduce(
      (s, a) => s + Number(a.leaseAmount || 0), 0
    );
    const totalRentalAmount = matchingAssets.reduce(
      (s, a) => s + Number(a.rentalAmount || 0), 0
    );
    const totalDonationValue = matchingAssets.reduce(
      (s, a) => s + Number(a.estimatedValue || 0), 0
    );

    const totalMaintenanceCost =
      Number(maintenanceSum._sum.totalCost || 0) + Number(ticketCostSum._sum.totalCost || 0);
    const totalInsurancePremiums = Number(insuranceSum._sum.premiumAmount || 0);
    const totalAmcCmcCost = Number(contractSum._sum.cost || 0);
    const totalDepreciation = Number(depreciationSum._sum.accumulatedDepreciation || 0);
    const totalSparePartCost = Number(sparePartUsageSum._sum.costAtUse || 0);

    const totalCostOfOwnership =
      totalPurchaseCost + totalMaintenanceCost + totalInsurancePremiums +
      totalAmcCmcCost + totalSparePartCost + totalLeaseAmount + totalRentalAmount;

    // Breakdowns
    const [costByCategory, costByDepartment, costByProcurement] = await Promise.all([
      prisma.asset.groupBy({
        by: ["assetCategoryId"],
        where: assetWhere,
        _sum: { purchaseCost: true },
        _count: true,
      }),
      prisma.asset.groupBy({
        by: ["departmentId"],
        where: assetWhere,
        _sum: { purchaseCost: true },
        _count: true,
      }),
      prisma.asset.groupBy({
        by: ["modeOfProcurement"],
        where: assetWhere,
        _sum: { purchaseCost: true, leaseAmount: true, rentalAmount: true, estimatedValue: true },
        _count: true,
      }),
    ]);

    // Resolve names
    const catIds = costByCategory.map((c) => c.assetCategoryId).filter(Boolean);
    const deptIds = costByDepartment.map((d) => d.departmentId).filter(Boolean) as number[];
    const [cats, depts] = await Promise.all([
      prisma.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }),
      prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
    ]);
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));

    res.json({
      assetCount: matchingAssets.length,
      totalPurchaseCost,
      totalLeaseAmount,
      totalRentalAmount,
      totalDonationValue,
      totalMaintenanceCost,
      totalInsurancePremiums,
      totalAmcCmcCost,
      totalDepreciation,
      totalSparePartCost,
      totalCostOfOwnership,
      avgCostPerAsset: matchingAssets.length > 0 ? +(totalCostOfOwnership / matchingAssets.length).toFixed(2) : 0,
      costByCategory: costByCategory.map((c) => ({
        category: catMap.get(c.assetCategoryId) || "Unknown",
        total: Number(c._sum.purchaseCost || 0),
        count: c._count,
      })),
      costByDepartment: costByDepartment.map((d) => ({
        department: deptMap.get(d.departmentId!) || "Unassigned",
        total: Number(d._sum.purchaseCost || 0),
        count: d._count,
      })),
      costByProcurement: costByProcurement.map((p) => ({
        mode: p.modeOfProcurement,
        total:
          Number(p._sum.purchaseCost || 0) +
          Number(p._sum.leaseAmount || 0) +
          Number(p._sum.rentalAmount || 0) +
          Number(p._sum.estimatedValue || 0),
        count: p._count,
      })),
    });
  } catch (err: any) {
    console.error("getFinancialSummary error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 3. FY Breakdown (Tree Data) ───────────────────────────────────────────────
export const getFYBreakdown = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const view = (query.view as string) || "purchase";

    const { clause, params } = buildRawWhereClause(query, user);

    let rows: any[];

    switch (view) {
      case "purchase":
        rows = await prisma.$queryRawUnsafe(
          `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(a.purchaseCost),0) as total, COUNT(*) as assetCount
           FROM asset a WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`,
          ...params
        );
        break;

      case "maintenance":
        rows = await prisma.$queryRawUnsafe(
          `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(mh.totalCost),0) + COALESCE(SUM(t.totalCost),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN maintenancehistory mh ON mh.assetId = a.id
           LEFT JOIN ticket t ON t.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`,
          ...params
        );
        break;

      case "insurance":
        rows = await prisma.$queryRawUnsafe(
          `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(ai.premiumAmount),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN assetinsurance ai ON ai.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`,
          ...params
        );
        break;

      case "amc_cmc":
        rows = await prisma.$queryRawUnsafe(
          `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(sc.cost),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN servicecontract sc ON sc.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`,
          ...params
        );
        break;

      case "depreciation":
        rows = await prisma.$queryRawUnsafe(
          `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(ad.accumulatedDepreciation),0) as total,
                  COUNT(DISTINCT a.id) as assetCount
           FROM asset a
           LEFT JOIN assetdepreciation ad ON ad.assetId = a.id
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`,
          ...params
        );
        break;

      case "total_cost":
      default:
        rows = await prisma.$queryRawUnsafe(
          `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
                  COALESCE(SUM(a.purchaseCost),0) +
                  COALESCE(SUM(a.leaseAmount),0) +
                  COALESCE(SUM(a.rentalAmount),0) as total,
                  COUNT(*) as assetCount
           FROM asset a
           WHERE ${clause}
           GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
           ORDER BY yr, mo`,
          ...params
        );
        break;
    }

    // Normalize BigInt to Number
    const normalizedRows = rows.map((r: any) => ({
      yr: Number(r.yr),
      mo: Number(r.mo),
      total: Number(r.total || 0),
      assetCount: Number(r.assetCount || 0),
    }));

    const tree = buildFYTree(normalizedRows);

    res.json({ financialYears: tree, view });
  } catch (err: any) {
    console.error("getFYBreakdown error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 4. Monthly Assets (Leaf-Level Detail) ──────────────────────────────────────
export const getMonthlyAssets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const year = Number(query.year);
    const month = Number(query.month);
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;

    if (!year || !month) {
      res.status(400).json({ message: "year and month are required" });
      return;
    }

    // Build base where from filters + role
    const baseWhere = buildAssetWhere(query, user);

    // Override date filter to target specific month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1); // first day of next month
    baseWhere.purchaseDate = { gte: startDate, lt: endDate };

    const [total, assets] = await Promise.all([
      prisma.asset.count({ where: baseWhere }),
      prisma.asset.findMany({
        where: baseWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { purchaseDate: "desc" },
        select: {
          id: true,
          assetId: true,
          assetName: true,
          purchaseDate: true,
          purchaseCost: true,
          leaseAmount: true,
          rentalAmount: true,
          estimatedValue: true,
          modeOfProcurement: true,
          status: true,
          assetCategory: { select: { name: true } },
          department: { select: { name: true } },
          vendor: { select: { name: true } },
        },
      }),
    ]);

    // Fetch per-asset cost summaries
    const assetIds = assets.map((a) => a.id);

    const [maintenanceCosts, ticketCosts, insuranceCosts, contractCosts, depreciationData] =
      await Promise.all([
        prisma.maintenanceHistory.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIds } },
          _sum: { totalCost: true },
        }),
        prisma.ticket.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIds } },
          _sum: { totalCost: true },
        }),
        prisma.assetInsurance.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIds } },
          _sum: { premiumAmount: true },
        }),
        prisma.serviceContract.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIds } },
          _sum: { cost: true },
        }),
        prisma.assetDepreciation.findMany({
          where: { assetId: { in: assetIds } },
          select: { assetId: true, accumulatedDepreciation: true, currentBookValue: true },
        }),
      ]);

    // Build lookup maps
    const mCostMap = new Map(maintenanceCosts.map((m) => [m.assetId, Number(m._sum.totalCost || 0)]));
    const tCostMap = new Map(ticketCosts.map((t) => [t.assetId, Number(t._sum.totalCost || 0)]));
    const iCostMap = new Map(insuranceCosts.map((i) => [i.assetId, Number(i._sum.premiumAmount || 0)]));
    const sCostMap = new Map(contractCosts.map((s) => [s.assetId, Number(s._sum.cost || 0)]));
    const dMap = new Map(depreciationData.map((d) => [d.assetId, {
      depreciation: Number(d.accumulatedDepreciation || 0),
      bookValue: Number(d.currentBookValue || 0),
    }]));

    const enriched = assets.map((a) => {
      const purchaseCost = Number(a.purchaseCost || 0);
      const maintenanceCost = (mCostMap.get(a.id) || 0) + (tCostMap.get(a.id) || 0);
      const insurancePremium = iCostMap.get(a.id) || 0;
      const amcCmcCost = sCostMap.get(a.id) || 0;
      const dep = dMap.get(a.id);
      const depreciation = dep?.depreciation || 0;
      const bookValue = dep?.bookValue || 0;

      return {
        id: a.id,
        assetId: a.assetId,
        assetName: a.assetName,
        category: a.assetCategory?.name || "",
        department: a.department?.name || "",
        vendor: a.vendor?.name || "",
        purchaseDate: a.purchaseDate,
        modeOfProcurement: a.modeOfProcurement,
        status: a.status,
        purchaseCost,
        leaseAmount: Number(a.leaseAmount || 0),
        rentalAmount: Number(a.rentalAmount || 0),
        maintenanceCost,
        insurancePremium,
        amcCmcCost,
        depreciation,
        bookValue,
        totalCost: purchaseCost + maintenanceCost + insurancePremium + amcCmcCost,
      };
    });

    res.json({
      assets: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("getMonthlyAssets error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 5. Cost Trend (for charts) ─────────────────────────────────────────────────
export const getCostTrend = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const { clause, params } = buildRawWhereClause(query, user);

    // Multi-view: purchase + maintenance + insurance + AMC in one pass
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT YEAR(a.purchaseDate) as yr, MONTH(a.purchaseDate) as mo,
              COALESCE(SUM(a.purchaseCost),0) as purchaseTotal,
              COUNT(*) as assetCount
       FROM asset a WHERE ${clause}
       GROUP BY YEAR(a.purchaseDate), MONTH(a.purchaseDate)
       ORDER BY yr, mo`,
      ...params
    );

    res.json({
      trend: rows.map((r: any) => ({
        year: Number(r.yr),
        month: Number(r.mo),
        purchaseTotal: Number(r.purchaseTotal || 0),
        assetCount: Number(r.assetCount || 0),
      })),
    });
  } catch (err: any) {
    console.error("getCostTrend error:", err);
    res.status(500).json({ message: err.message });
  }
};

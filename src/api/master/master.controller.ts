import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── Dashboard Stats ───────────────────────────────────────────────────────────
export const getDashboardStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const role = user?.role;
    const departmentId = user?.departmentId;
    const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;

    let assetWhere: any = {};
    let ticketWhere: any = {};

    if (role === "HOD") {
      assetWhere = { departmentId: Number(departmentId) };
      ticketWhere = { departmentId: Number(departmentId) };
    } else if (role === "SUPERVISOR") {
      assetWhere = { supervisorId: Number(employeeDbId) };
    }

    // Get asset IDs for department-scoped queries on related models
    let scopedAssetIds: number[] | null = null; // null = no filter (ADMIN sees all)
    if (Object.keys(assetWhere).length > 0) {
      const scopedAssets = await prisma.asset.findMany({
        where: assetWhere,
        select: { id: true },
      });
      scopedAssetIds = scopedAssets.map(a => a.id);
    }

    // Build where clauses for related models (scoped by department's assets)
    const warrantyWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
    const contractWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
    const calibrationWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};
    const pmWhere = scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {};

    const [
      totalAssets,
      activeAssets,
      inStoreAssets,
      inMaintenanceAssets,
      retiredAssets,
      disposedAssets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      pendingAssignments,
      expiredWarranties,
      expiredContracts,
      activeContracts,
      dueCalibrations,
      duePMSchedules,
      totalVendors,
      totalEmployees,
      totalDepartments,
      slaBreachedTickets,
    ] = await Promise.all([
      prisma.asset.count({ where: assetWhere }),
      prisma.asset.count({ where: { ...assetWhere, status: "ACTIVE" } }),
      prisma.asset.count({ where: { ...assetWhere, status: "IN_STORE" } }),
      prisma.asset.count({ where: { ...assetWhere, status: "IN_MAINTENANCE" } }),
      prisma.asset.count({ where: { ...assetWhere, status: "RETIRED" } }),
      prisma.asset.count({ where: { ...assetWhere, status: { in: ["DISPOSED", "SCRAPPED"] } } }),
      prisma.ticket.count({ where: { ...ticketWhere, status: "OPEN" } }),
      prisma.ticket.count({ where: { ...ticketWhere, status: "IN_PROGRESS" } }),
      prisma.ticket.count({ where: { ...ticketWhere, status: "RESOLVED" } }),
      scopedAssetIds
        ? prisma.assetAssignment.count({ where: { status: "PENDING", isActive: true, asset: { id: { in: scopedAssetIds } } } })
        : prisma.assetAssignment.count({ where: { status: "PENDING", isActive: true } }),
      prisma.warranty.count({ where: { ...warrantyWhere, isUnderWarranty: false, isActive: true } }),
      prisma.serviceContract.count({ where: { ...contractWhere, status: "EXPIRED" } }),
      prisma.serviceContract.count({ where: { ...contractWhere, status: "ACTIVE" } }),
      prisma.calibrationSchedule.count({ where: { ...calibrationWhere, nextDueAt: { lte: new Date() }, isActive: true } }),
      prisma.maintenanceSchedule.count({ where: { ...pmWhere, nextDueAt: { lte: new Date() }, isActive: true } }),
      prisma.vendor.count(),
      prisma.employee.count(),
      prisma.department.count(),
      prisma.ticket.count({ where: { ...ticketWhere, slaBreached: true, status: { notIn: ["CLOSED", "RESOLVED"] } } }),
    ]);

    // Ticket status breakdown
    const ticketStatusBreakdown = await prisma.ticket.groupBy({
      by: ["status"],
      _count: { id: true },
      where: ticketWhere,
    });

    // Asset category breakdown
    const assetCategoryBreakdown = await prisma.asset.groupBy({
      by: ["assetCategoryId"],
      _count: { id: true },
      where: assetWhere,
    });

    const categoryIds = assetCategoryBreakdown.map((c) => c.assetCategoryId).filter(Boolean) as number[];
    const categories = await prisma.assetCategory.findMany({ where: { id: { in: categoryIds } } });
    const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

    const assetsByCategory = assetCategoryBreakdown.map((row) => ({
      category: categoryMap[row.assetCategoryId!] ?? "Unknown",
      count: row._count.id,
    }));

    // Recent tickets (configurable limit)
    const recentLimit = Math.min(Number(req.query.recentLimit) || 5, 25);
    const recentTickets = await prisma.ticket.findMany({
      where: ticketWhere,
      orderBy: { createdAt: "desc" },
      take: recentLimit,
      include: { asset: { select: { assetName: true, assetId: true } }, department: { select: { name: true } } },
    });

    // Recent assets (configurable limit)
    const recentAssets = await prisma.asset.findMany({
      where: assetWhere,
      orderBy: { createdAt: "desc" },
      take: recentLimit,
      include: { assetCategory: { select: { name: true } }, department: { select: { name: true } } },
    });

    res.json({
      summary: {
        totalAssets,
        activeAssets,
        inStoreAssets,
        inMaintenanceAssets,
        retiredAssets,
        disposedAssets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        pendingAssignments,
        expiredWarranties,
        expiredContracts,
        activeContracts,
        dueCalibrations,
        duePMSchedules,
        totalVendors,
        totalEmployees,
        totalDepartments,
        slaBreachedTickets,
      },
      ticketStatusBreakdown: ticketStatusBreakdown.map((t) => ({
        status: t.status,
        count: t._count.id,
      })),
      assetsByCategory,
      recentTickets,
      recentAssets,
    });
  } catch (error) {
    console.error("getDashboardStats error:", error);
    res.status(500).json({ message: "Failed to fetch dashboard stats" });
  }
};

// ─── Lookup (master data for dropdowns) ───────────────────────────────────────
export const getLookupData = async (req: Request, res: Response) => {
  try {
    const [
      categories,
      departments,
      employees,
      vendors,
      branches,
    ] = await Promise.all([
      prisma.assetCategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.employee.findMany({
        select: { id: true, name: true, employeeID: true, role: true, departmentId: true, department: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.vendor.findMany({ select: { id: true, name: true, contact: true, email: true }, orderBy: { name: "asc" } }),
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    res.json({ categories, departments, employees, vendors, branches });
  } catch (error) {
    console.error("getLookupData error:", error);
    res.status(500).json({ message: "Failed to fetch lookup data" });
  }
};

// ─── Asset Lifecycle Summary ───────────────────────────────────────────────────
export const getAssetLifecycleSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assetId } = req.params;
    const id = parseInt(assetId);

    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        assetCategory: true,
        department: true,
        vendor: true,
        allottedTo: true,
        supervisor: true,
        warranties: { where: { isActive: true } },
        insurance: { where: { isActive: true } },
        serviceContracts: { where: { status: "ACTIVE" } },
        depreciation: true,
        tickets: { orderBy: { createdAt: "desc" }, take: 5 },
        maintenanceHistory: { orderBy: { createdAt: "desc" }, take: 5 },
        calibrationHistory: { orderBy: { calibratedAt: "desc" }, take: 3 },
        calibrationSchedules: { where: { isActive: true } },
        maintenanceSchedules: { where: { isActive: true } },
        assignments: { where: { isActive: true }, include: { assignedTo: true } },
        transfers: { orderBy: { createdAt: "desc" }, take: 5 },
        locations: { where: { isActive: true }, include: { branch: true } },
        specifications: true,
        subAssets: { select: { id: true, assetId: true, assetName: true, status: true } },
        gatePasses: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    res.json(asset);
  } catch (error) {
    console.error("getAssetLifecycleSummary error:", error);
    res.status(500).json({ message: "Failed to fetch asset lifecycle summary" });
  }
};

// ─── Expiry Alerts ─────────────────────────────────────────────────────────────
export const getExpiryAlerts = async (req: Request, res: Response) => {
  try {
    const daysAhead = parseInt((req.query.days as string) || "30");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

    const [expiringWarranties, expiringInsurance, expiringContracts, dueCalibrations, dueMaintenances] = await Promise.all([
      prisma.warranty.findMany({
        where: { warrantyEnd: { lte: cutoffDate }, isActive: true },
        include: { asset: { select: { assetId: true, assetName: true } } },
        orderBy: { warrantyEnd: "asc" },
      }),
      prisma.assetInsurance.findMany({
        where: { endDate: { lte: cutoffDate }, isActive: true },
        include: { asset: { select: { assetId: true, assetName: true } } },
        orderBy: { endDate: "asc" },
      }),
      prisma.serviceContract.findMany({
        where: { endDate: { lte: cutoffDate }, status: "ACTIVE" },
        include: { asset: { select: { assetId: true, assetName: true } } },
        orderBy: { endDate: "asc" },
      }),
      prisma.calibrationSchedule.findMany({
        where: { nextDueAt: { lte: cutoffDate }, isActive: true },
        include: { asset: { select: { assetId: true, assetName: true } } },
        orderBy: { nextDueAt: "asc" },
      }),
      prisma.maintenanceSchedule.findMany({
        where: { nextDueAt: { lte: cutoffDate }, isActive: true },
        include: { asset: { select: { assetId: true, assetName: true } } },
        orderBy: { nextDueAt: "asc" },
      }),
    ]);

    res.json({
      expiringWarranties,
      expiringInsurance,
      expiringContracts,
      dueCalibrations,
      dueMaintenances,
      summary: {
        expiringWarranties: expiringWarranties.length,
        expiringInsurance: expiringInsurance.length,
        expiringContracts: expiringContracts.length,
        dueCalibrations: dueCalibrations.length,
        dueMaintenances: dueMaintenances.length,
      },
    });
  } catch (error) {
    console.error("getExpiryAlerts error:", error);
    res.status(500).json({ message: "Failed to fetch expiry alerts" });
  }
};

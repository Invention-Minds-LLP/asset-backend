import { Response } from "express";
import prisma from "../../prismaClient";
import { BOOKED_LOG_WHERE } from "../../utilis/depreciationEngine";
import {
  _faIsSecondHalfFY,
  _wdvAtDate,
  scheduleFyBounds,
  buildScheduleLines,
  aggregateScheduleLines,
  finalizedScheduleLines,
} from "../../utilis/fixedAssetsSchedule";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import XLSX from "xlsx";
import ExcelJS from "exceljs";

// ─── Role-based Filter Helper ───────────────────────────────────────────────

function buildRoleFilter(user: any): any {
  const role = user?.role;
  const departmentId = user?.departmentId;
  const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;

  if (role === "HOD") return { departmentId: Number(departmentId) };
  if (role === "SUPERVISOR") return {
    OR: [
      { supervisorId: Number(employeeDbId) },
      { supervisors: { some: { employeeId: Number(employeeDbId), isActive: true } } },
    ],
  };
  return {}; // ADMIN and others see everything
}

// ─── Export Helpers ──────────────────────────────────────────────────────────

function sendCsv(res: Response, rows: any[], filename: string) {
  if (rows.length === 0) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
    res.send("");
    return;
  }
  const headers = Object.keys(rows[0]).join(",");
  const csvRows = rows.map((r) =>
    Object.values(r)
      .map((v) => {
        const str = String(v ?? "").replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      })
      .join(",")
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
  res.send(headers + "\n" + csvRows.join("\n"));
}

function sendExcel(res: Response, rows: any[], filename: string, sheetName = "Report") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}.xlsx`);
  res.send(buffer);
}

function formatDate(d: any): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

// ─── 1. Asset Register Report ───────────────────────────────────────────────

export const getAssetRegisterReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const exportFormat = query.export as string; // "csv" | "excel"

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;

    const where: any = { ...buildRoleFilter(user) };

    if (query.departmentId) where.departmentId = Number(query.departmentId);
    if (query.branchId) where.currentBranchId = Number(query.branchId);
    if (query.categoryId) where.assetCategoryId = Number(query.categoryId);
    if (query.vendorId) where.vendorId = Number(query.vendorId);
    if (query.status) where.status = query.status;
    if (query.modeOfProcurement) where.modeOfProcurement = query.modeOfProcurement;
    if (query.search) {
      where.OR = [
        { assetId: { contains: String(query.search) } },
        { assetName: { contains: String(query.search) } },
        { serialNumber: { contains: String(query.search) } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      const dateField = String(query.dateField || 'purchaseDate') as 'purchaseDate' | 'installedAt';
      where[dateField] = {};
      if (query.dateFrom) where[dateField].gte = new Date(query.dateFrom as string);
      if (query.dateTo)   where[dateField].lte = new Date(query.dateTo as string);
    }

    const [total, assets] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        ...(!exportFormat ? { skip: (page - 1) * limit, take: limit } : {}),
        orderBy: { purchaseDate: "desc" },
        select: {
          id: true, assetId: true, assetName: true, referenceCode: true, serialNumber: true,
          purchaseDate: true, purchaseCost: true, modeOfProcurement: true,
          status: true, manufacturer: true, modelNumber: true,
          currentLocation: true, physicalCondition: true, warrantyStatus: true,
          assetCategory: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
          currentBranch: { select: { id: true, name: true } },
        },
      }),
    ]);

    // Fetch warranty status
    const assetIds = assets.map((a) => a.id);
    const warranties = await prisma.warranty.findMany({
      where: { assetId: { in: assetIds }, isActive: true },
      select: { assetId: true, warrantyEnd: true, isUnderWarranty: true },
    });
    const warrantyMap = new Map(warranties.map((w) => [w.assetId, w]));

    const data = assets.map((a) => {
      const warranty = warrantyMap.get(a.id);
      return {
        assetId: a.assetId,
        assetName: a.assetName,
        referenceCode: a.referenceCode || "",
        serialNumber: a.serialNumber,
        category: a.assetCategory?.name || "N/A",
        department: a.department?.name || "N/A",
        branch: (a as any).currentBranch?.name || "—",
        vendor: a.vendor?.name || "N/A",
        manufacturer: a.manufacturer || "",
        modelNumber: a.modelNumber || "",
        purchaseDate: a.purchaseDate,
        purchaseCost: Number(a.purchaseCost || 0),
        modeOfProcurement: a.modeOfProcurement,
        status: a.status,
        location: a.currentLocation || "",
        physicalCondition: a.physicalCondition || "",
        warrantyEnd: warranty?.warrantyEnd || null,
        isUnderWarranty: warranty?.isUnderWarranty ?? false,
      };
    });

    // Export
    if (exportFormat === "csv" || exportFormat === "excel") {
      const exportRows = data.map((d) => ({
        "Asset ID": d.assetId,
        "Asset Name": d.assetName,
        "Reference Code": d.referenceCode,
        "Serial Number": d.serialNumber,
        "Category": d.category,
        "Department": d.department,
        "Branch": d.branch,
        "Vendor": d.vendor,
        "Manufacturer": d.manufacturer,
        "Model Number": d.modelNumber,
        "Purchase Date": formatDate(d.purchaseDate),
        "Purchase Cost": d.purchaseCost,
        "Mode of Procurement": d.modeOfProcurement,
        "Status": d.status,
        "Location": d.location,
        "Physical Condition": d.physicalCondition,
        "Warranty End": formatDate(d.warrantyEnd),
        "Under Warranty": d.isUnderWarranty ? "Yes" : "No",
      }));

      if (exportFormat === "csv") return sendCsv(res, exportRows, "asset-register-report");
      return sendExcel(res, exportRows, "asset-register-report", "Asset Register");
    }

    // Branch-wise subtotals over the WHOLE filtered set (not just this page)
    const branchAgg = await prisma.asset.groupBy({
      by: ["currentBranchId"],
      where,
      _count: { id: true },
      _sum: { purchaseCost: true },
    });
    const branchNames = await prisma.branch.findMany({ select: { id: true, name: true } });
    const branchNameById = new Map(branchNames.map((b) => [b.id, b.name]));
    const branchSummary = branchAgg
      .map((b) => ({
        branch: b.currentBranchId == null ? "Unassigned" : (branchNameById.get(b.currentBranchId) ?? "Unknown"),
        count: b._count.id,
        totalCost: Number(b._sum.purchaseCost || 0),
      }))
      .sort((a, z) => z.totalCost - a.totalCost);

    res.json({
      data,
      branchSummary,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("getAssetRegisterReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 2. Maintenance Cost Report ─────────────────────────────────────────────

export const getMaintenanceCostReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const exportFormat = query.export as string;

    const assetWhere: any = { ...buildRoleFilter(user) };
    if (query.departmentId) assetWhere.departmentId = Number(query.departmentId);
    if (query.branchId) assetWhere.currentBranchId = Number(query.branchId);
    if (query.vendorId) assetWhere.vendorId = Number(query.vendorId);
    if (query.assetId) assetWhere.id = Number(query.assetId);

    const matchingAssets = await prisma.asset.findMany({
      where: assetWhere,
      select: {
        id: true, assetId: true, assetName: true,
        department: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });
    const assetIds = matchingAssets.map((a) => a.id);

    const dateFilter: any = {};
    if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom as string);
    if (query.dateTo) dateFilter.lte = new Date(query.dateTo as string);

    const maintenanceWhere: any = { assetId: { in: assetIds } };
    if (query.dateFrom || query.dateTo) maintenanceWhere.actualDoneAt = dateFilter;

    const ticketWhere: any = { assetId: { in: assetIds } };
    if (query.dateFrom || query.dateTo) ticketWhere.createdAt = dateFilter;

    const [maintenanceByAsset, maintenanceByType, ticketCostByAsset] = await Promise.all([
      prisma.maintenanceHistory.groupBy({
        by: ["assetId"], where: maintenanceWhere,
        _sum: { totalCost: true, serviceCost: true, partsCost: true }, _count: true,
      }),
      prisma.maintenanceHistory.groupBy({
        by: ["assetId", "serviceType"], where: maintenanceWhere,
        _sum: { totalCost: true }, _count: true,
      }),
      prisma.ticket.groupBy({
        by: ["assetId"], where: ticketWhere,
        _sum: { totalCost: true }, _count: true,
      }),
    ]);

    const maintenanceCostMap = new Map(
      maintenanceByAsset.map((m) => [m.assetId, {
        total: Number(m._sum.totalCost || 0),
        serviceCost: Number(m._sum.serviceCost || 0),
        partsCost: Number(m._sum.partsCost || 0),
        count: m._count,
      }])
    );
    const ticketCostMap = new Map(
      ticketCostByAsset.map((t) => [t.assetId, { total: Number(t._sum.totalCost || 0), count: t._count }])
    );

    const typeBreakdownMap = new Map<number, Array<{ serviceType: string; total: number; count: number }>>();
    for (const row of maintenanceByType) {
      if (!typeBreakdownMap.has(row.assetId)) typeBreakdownMap.set(row.assetId, []);
      typeBreakdownMap.get(row.assetId)!.push({
        serviceType: row.serviceType || "Unknown", total: Number(row._sum.totalCost || 0), count: row._count,
      });
    }

    const assetMap = new Map(matchingAssets.map((a) => [a.id, a]));

    const data = assetIds
      .filter((id) => maintenanceCostMap.has(id) || ticketCostMap.has(id))
      .map((id) => {
        const asset = assetMap.get(id)!;
        const maintenance = maintenanceCostMap.get(id) || { total: 0, serviceCost: 0, partsCost: 0, count: 0 };
        const tickets = ticketCostMap.get(id) || { total: 0, count: 0 };

        return {
          assetId: asset.assetId,
          assetName: asset.assetName,
          department: asset.department?.name || "N/A",
          vendor: (asset as any).vendor?.name || "N/A",
          maintenanceCost: maintenance.total,
          maintenanceServiceCost: maintenance.serviceCost,
          maintenancePartsCost: maintenance.partsCost,
          maintenanceCount: maintenance.count,
          ticketCost: tickets.total,
          ticketCount: tickets.count,
          totalCost: maintenance.total + tickets.total,
          serviceTypeBreakdown: typeBreakdownMap.get(id) || [],
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);

    const grandTotal = data.reduce((sum, d) => sum + d.totalCost, 0);

    if (exportFormat === "csv" || exportFormat === "excel") {
      const exportRows = data.map((d) => ({
        "Asset ID": d.assetId,
        "Asset Name": d.assetName,
        "Department": d.department,
        "Vendor": d.vendor,
        "Maintenance Service Cost": d.maintenanceServiceCost,
        "Maintenance Parts Cost": d.maintenancePartsCost,
        "Total Maintenance Cost": d.maintenanceCost,
        "Maintenance Count": d.maintenanceCount,
        "Ticket Repair Cost": d.ticketCost,
        "Ticket Count": d.ticketCount,
        "Grand Total Cost": d.totalCost,
      }));

      if (exportFormat === "csv") return sendCsv(res, exportRows, "maintenance-cost-report");
      return sendExcel(res, exportRows, "maintenance-cost-report", "Maintenance Cost");
    }

    res.json({
      data,
      summary: { totalAssets: data.length, grandTotalCost: grandTotal },
    });
  } catch (err: any) {
    console.error("getMaintenanceCostReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 3. Ticket Analytics Report ─────────────────────────────────────────────

export const getTicketAnalyticsReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const exportFormat = query.export as string;

    const ticketWhere: any = {};
    const role = user?.role;
    if (role === "HOD" && user?.departmentId) {
      ticketWhere.departmentId = Number(user.departmentId);
    } else if (role === "SUPERVISOR") {
      const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;
      ticketWhere.asset = {
        OR: [
          { supervisorId: Number(employeeDbId) },
          { supervisors: { some: { employeeId: Number(employeeDbId), isActive: true } } },
        ],
      };
    }

    if (query.departmentId) ticketWhere.departmentId = Number(query.departmentId);
    if (query.priority) ticketWhere.priority = query.priority;
    // Branch scoping via the ticket's asset (merges with any role-based asset scope)
    if (query.branchId) {
      ticketWhere.asset = { ...(ticketWhere.asset || {}), currentBranchId: Number(query.branchId) };
    }

    if (query.dateFrom || query.dateTo) {
      ticketWhere.createdAt = {};
      if (query.dateFrom) ticketWhere.createdAt.gte = new Date(query.dateFrom as string);
      if (query.dateTo) ticketWhere.createdAt.lte = new Date(query.dateTo as string);
    }

    const [countByStatus, countByPriority, countByServiceType] = await Promise.all([
      prisma.ticket.groupBy({ by: ["status"], where: ticketWhere, _count: true }),
      prisma.ticket.groupBy({ by: ["priority"], where: ticketWhere, _count: true }),
      prisma.ticket.groupBy({ by: ["serviceType"], where: ticketWhere, _count: true }),
    ]);

    const tickets = await prisma.ticket.findMany({
      where: ticketWhere,
      select: {
        id: true, ticketId: true, status: true, priority: true, issueType: true,
        slaBreached: true, downtimeStart: true, downtimeEnd: true,
        rootCause: true, resolutionSummary: true, customerSatisfaction: true,
        serviceType: true, totalCost: true,
        createdAt: true, slaResolvedAt: true,
        asset: { select: { assetId: true, assetName: true } },
        department: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    });

    const totalTickets = tickets.length;

    const resolvedTickets = tickets.filter((t) => t.downtimeStart && t.downtimeEnd);
    let avgResolutionTimeHours = 0;
    if (resolvedTickets.length > 0) {
      const totalHours = resolvedTickets.reduce((sum, t) => {
        return sum + (new Date(t.downtimeEnd!).getTime() - new Date(t.downtimeStart!).getTime()) / (1000 * 60 * 60);
      }, 0);
      avgResolutionTimeHours = +(totalHours / resolvedTickets.length).toFixed(2);
    }

    const slaBreachCount = tickets.filter((t) => t.slaBreached === true).length;

    const satisfactionTickets = tickets.filter((t) => t.customerSatisfaction != null);
    let avgCustomerSatisfaction = 0;
    if (satisfactionTickets.length > 0) {
      avgCustomerSatisfaction = +(satisfactionTickets.reduce((sum, t) => sum + Number(t.customerSatisfaction || 0), 0) / satisfactionTickets.length).toFixed(2);
    }

    const rootCauseCounts = new Map<string, number>();
    for (const t of tickets) {
      if (t.rootCause) {
        const cause = t.rootCause.trim();
        rootCauseCounts.set(cause, (rootCauseCounts.get(cause) || 0) + 1);
      }
    }
    const topRootCauses = [...rootCauseCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([cause, count]) => ({ cause, count }));

    // Export - detailed ticket list
    if (exportFormat === "csv" || exportFormat === "excel") {
      const exportRows = tickets.map((t: any) => ({
        "Ticket ID": t.ticketId,
        "Asset ID": t.asset?.assetId || "",
        "Asset Name": t.asset?.assetName || "",
        "Department": t.department?.name || "",
        "Issue Type": t.issueType,
        "Priority": t.priority,
        "Status": t.status,
        "Assigned To": t.assignedTo?.name || "",
        "Service Type": t.serviceType || "",
        "Total Cost": t.totalCost ? Number(t.totalCost) : "",
        "SLA Breached": t.slaBreached ? "Yes" : "No",
        "Root Cause": t.rootCause || "",
        "Resolution": t.resolutionSummary || "",
        "Satisfaction": t.customerSatisfaction || "",
        "Created At": formatDate(t.createdAt),
        "Resolved At": formatDate(t.slaResolvedAt),
      }));

      if (exportFormat === "csv") return sendCsv(res, exportRows, "ticket-analytics-report");
      return sendExcel(res, exportRows, "ticket-analytics-report", "Ticket Analytics");
    }

    res.json({
      totalTickets,
      countByStatus: countByStatus.map((s) => ({ status: s.status, count: s._count })),
      countByPriority: countByPriority.map((p) => ({ priority: p.priority, count: p._count })),
      countByServiceType: countByServiceType.map((s) => ({ serviceType: s.serviceType, count: s._count })),
      avgResolutionTimeHours,
      slaBreachCount,
      avgCustomerSatisfaction,
      topRootCauses,
    });
  } catch (err: any) {
    console.error("getTicketAnalyticsReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 4. Expiry Report ───────────────────────────────────────────────────────

export const getExpiryReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const exportFormat = query.export as string;

    const days = Number(query.days) || 90;
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);

    const assetWhere: any = { ...buildRoleFilter(user) };
    if (query.branchId) assetWhere.currentBranchId = Number(query.branchId);
    const matchingAssets = await prisma.asset.findMany({
      where: assetWhere,
      select: { id: true, assetId: true, assetName: true, department: { select: { name: true } } },
    });
    const assetIds = matchingAssets.map((a) => a.id);
    const assetMap = new Map(matchingAssets.map((a) => [a.id, a]));

    const [expiringWarranties, expiringInsurance, expiringContracts] = await Promise.all([
      prisma.warranty.findMany({
        where: { assetId: { in: assetIds }, warrantyEnd: { gte: now, lte: cutoffDate } },
        select: { id: true, assetId: true, warrantyEnd: true, isUnderWarranty: true, warrantyProvider: true },
        orderBy: { warrantyEnd: "asc" },
      }),
      prisma.assetInsurance.findMany({
        where: { assetId: { in: assetIds }, endDate: { gte: now, lte: cutoffDate } },
        select: { id: true, assetId: true, endDate: true, policyStatus: true, premiumAmount: true, provider: true, policyNumber: true },
        orderBy: { endDate: "asc" },
      }),
      prisma.serviceContract.findMany({
        where: { assetId: { in: assetIds }, endDate: { gte: now, lte: cutoffDate } },
        select: { id: true, assetId: true, endDate: true, status: true, cost: true, contractType: true, contractNumber: true },
        orderBy: { endDate: "asc" },
      }),
    ]);

    const warranties = expiringWarranties.map((w) => {
      const asset = assetMap.get(w.assetId);
      return {
        type: "WARRANTY" as const, id: w.id,
        assetId: asset?.assetId || "N/A", assetName: asset?.assetName || "N/A",
        department: (asset as any)?.department?.name || "",
        provider: w.warrantyProvider || "",
        expiryDate: w.warrantyEnd,
        daysRemaining: Math.ceil((new Date(w.warrantyEnd!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

    const insurance = expiringInsurance.map((i) => {
      const asset = assetMap.get(i.assetId);
      return {
        type: "INSURANCE" as const, id: i.id,
        assetId: asset?.assetId || "N/A", assetName: asset?.assetName || "N/A",
        department: (asset as any)?.department?.name || "",
        provider: i.provider || "", policyNumber: i.policyNumber || "",
        expiryDate: i.endDate,
        daysRemaining: Math.ceil((new Date(i.endDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        premiumAmount: Number(i.premiumAmount || 0),
      };
    });

    const contracts = expiringContracts.map((c) => {
      const asset = assetMap.get(c.assetId);
      return {
        type: "SERVICE_CONTRACT" as const, id: c.id,
        assetId: asset?.assetId || "N/A", assetName: asset?.assetName || "N/A",
        department: (asset as any)?.department?.name || "",
        contractType: c.contractType, contractNumber: c.contractNumber || "",
        expiryDate: c.endDate,
        daysRemaining: Math.ceil((new Date(c.endDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        cost: Number(c.cost || 0),
      };
    });

    if (exportFormat === "csv" || exportFormat === "excel") {
      const allExpiring = [
        ...warranties.map((w) => ({
          "Type": "Warranty", "Asset ID": w.assetId, "Asset Name": w.assetName,
          "Department": w.department, "Provider/Vendor": w.provider,
          "Reference": "", "Expiry Date": formatDate(w.expiryDate),
          "Days Remaining": w.daysRemaining, "Cost/Premium": "",
        })),
        ...insurance.map((i) => ({
          "Type": "Insurance", "Asset ID": i.assetId, "Asset Name": i.assetName,
          "Department": i.department, "Provider/Vendor": i.provider,
          "Reference": i.policyNumber, "Expiry Date": formatDate(i.expiryDate),
          "Days Remaining": i.daysRemaining, "Cost/Premium": i.premiumAmount,
        })),
        ...contracts.map((c) => ({
          "Type": `Service Contract (${c.contractType})`, "Asset ID": c.assetId, "Asset Name": c.assetName,
          "Department": c.department, "Provider/Vendor": "",
          "Reference": c.contractNumber, "Expiry Date": formatDate(c.expiryDate),
          "Days Remaining": c.daysRemaining, "Cost/Premium": c.cost,
        })),
      ].sort((a, b) => a["Days Remaining"] - b["Days Remaining"]);

      if (exportFormat === "csv") return sendCsv(res, allExpiring, "expiry-report");
      return sendExcel(res, allExpiring, "expiry-report", "Expiry Alerts");
    }

    res.json({
      filterDays: days, warranties, insurance, serviceContracts: contracts,
      summary: {
        totalExpiring: warranties.length + insurance.length + contracts.length,
        warrantiesExpiring: warranties.length, insuranceExpiring: insurance.length,
        contractsExpiring: contracts.length,
      },
    });
  } catch (err: any) {
    console.error("getExpiryReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 5. Depreciation Report ─────────────────────────────────────────────────

export const getDepreciationReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const exportFormat = query.export as string;

    const assetWhere: any = { ...buildRoleFilter(user) };
    if (query.departmentId) assetWhere.departmentId = Number(query.departmentId);
    if (query.branchId) assetWhere.currentBranchId = Number(query.branchId);
    if (query.categoryId) assetWhere.assetCategoryId = Number(query.categoryId);
    if (query.status) assetWhere.status = query.status;
    if (query.dateFrom || query.dateTo) {
      const dateField = String(query.dateField || 'purchaseDate') as 'purchaseDate' | 'installedAt';
      assetWhere[dateField] = {};
      if (query.dateFrom) assetWhere[dateField].gte = new Date(query.dateFrom as string);
      if (query.dateTo)   assetWhere[dateField].lte = new Date(query.dateTo as string);
    }

    const assets = await prisma.asset.findMany({
      where: assetWhere,
      select: {
        id: true, assetId: true, assetName: true, serialNumber: true,
        purchaseCost: true, purchaseDate: true, status: true,
        assetCategory: { select: { name: true } },
        department: { select: { name: true } },
        depreciation: {
          select: {
            depreciationMethod: true, depreciationRate: true,
            expectedLifeYears: true, salvageValue: true,
            accumulatedDepreciation: true, currentBookValue: true,
            depreciationFrequency: true, lastCalculatedAt: true,
          },
        },
      },
    });

    const data = assets
      .filter((a) => a.depreciation)
      .map((a) => {
        const dep = a.depreciation!;
        const originalCost = Number(a.purchaseCost || 0);
        const accumulatedDepreciation = Number(dep.accumulatedDepreciation || 0);
        const currentBookValue = Number(dep.currentBookValue || 0);

        return {
          assetId: a.assetId,
          assetName: a.assetName,
          serialNumber: a.serialNumber,
          category: a.assetCategory?.name || "N/A",
          department: a.department?.name || "N/A",
          purchaseDate: a.purchaseDate,
          status: a.status,
          method: dep.depreciationMethod,
          rate: Number(dep.depreciationRate),
          lifeYears: dep.expectedLifeYears,
          frequency: dep.depreciationFrequency || "YEARLY",
          originalCost,
          salvageValue: Number(dep.salvageValue || 0),
          accumulatedDepreciation,
          currentBookValue,
          depreciationPercentage: originalCost > 0
            ? +((accumulatedDepreciation / originalCost) * 100).toFixed(2)
            : 0,
          lastCalculated: dep.lastCalculatedAt,
        };
      });

    const totalOriginalCost = data.reduce((sum, d) => sum + d.originalCost, 0);
    const totalDepreciation = data.reduce((sum, d) => sum + d.accumulatedDepreciation, 0);
    const totalBookValue = data.reduce((sum, d) => sum + d.currentBookValue, 0);

    if (exportFormat === "csv" || exportFormat === "excel") {
      const exportRows = data.map((d) => ({
        "Asset ID": d.assetId, "Asset Name": d.assetName, "Serial Number": d.serialNumber,
        "Category": d.category, "Department": d.department,
        "Purchase Date": formatDate(d.purchaseDate), "Status": d.status,
        "Method": d.method, "Rate (%)": d.rate, "Life (Years)": d.lifeYears,
        "Frequency": d.frequency, "Original Cost": d.originalCost,
        "Salvage Value": d.salvageValue,
        "Accumulated Depreciation": d.accumulatedDepreciation,
        "Current Book Value": d.currentBookValue,
        "Depreciation %": d.depreciationPercentage,
        "Last Calculated": formatDate(d.lastCalculated),
      }));

      if (exportFormat === "csv") return sendCsv(res, exportRows, "depreciation-report");
      return sendExcel(res, exportRows, "depreciation-report", "Depreciation Schedule");
    }

    res.json({
      data,
      summary: { totalAssets: data.length, totalOriginalCost, totalDepreciation, totalBookValue },
    });
  } catch (err: any) {
    console.error("getDepreciationReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 7. Fixed Assets Schedule ───────────────────────────────────────────────

async function sendFixedAssetsScheduleExcel(
  res: Response,
  rows: any[],
  grandTotal: any,
  fiscalYear: number
) {
  const fyEndYear = fiscalYear + 1;
  const fyStartLabel = `01.04.${fiscalYear}`;
  const fyEndLabel = `31.03.${fyEndYear}`;
  const prevFyEnd = `31.03.${fiscalYear}`;
  const fyLabel = `${fiscalYear}-${String(fyEndYear).slice(2)}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fixed Assets Schedule");

  // Column widths
  ws.columns = [
    { width: 34 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 },
    { width: 9 },  { width: 16 }, { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 },
  ];

  // ── Row 1: Title ──────────────────────────────────────────
  const titleRow = ws.addRow(["SCHEDULE OF FIXED ASSETS"]);
  ws.mergeCells(1, 1, 1, 11);
  titleRow.height = 24;
  const titleCell = titleRow.getCell(1);
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } };
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };

  // ── Row 2: FY label ───────────────────────────────────────
  const fyRow = ws.addRow([`FOR THE YEAR ENDED ${fyEndLabel}`]);
  ws.mergeCells(2, 1, 2, 11);
  fyRow.height = 18;
  const fyCell = fyRow.getCell(1);
  fyCell.font = { bold: true, size: 11, color: { argb: "FF1A237E" } };
  fyCell.alignment = { horizontal: "center", vertical: "middle" };
  fyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } };

  // ── Row 3: blank ──────────────────────────────────────────
  ws.addRow([]);

  // ── Row 4: Group headers ──────────────────────────────────
  const GROSS_BG  = "FF1565C0"; // deep blue
  const DEP_BG    = "FFE65100"; // deep orange
  const NET_BG    = "FF1B5E20"; // deep green
  const WHITE     = "FFFFFFFF";

  const grpRow = ws.addRow(["PARTICULARS", "GROSS BLOCK", "", "", "", "DEPRECIATION", "", "", "", "NET BLOCK", ""]);
  grpRow.height = 20;

  ws.mergeCells(4, 1, 5, 1);  // PARTICULARS spans 2 rows
  ws.mergeCells(4, 2, 4, 5);  // GROSS BLOCK
  ws.mergeCells(4, 6, 4, 9);  // DEPRECIATION
  ws.mergeCells(4, 10, 4, 11); // NET BLOCK

  const styleGroupCell = (cell: ExcelJS.Cell, bg: string) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.border = { bottom: { style: "medium", color: { argb: "FF000000" } } };
  };

  styleGroupCell(grpRow.getCell(1), "FF37474F");  // Particulars: dark grey
  styleGroupCell(grpRow.getCell(2), GROSS_BG);
  styleGroupCell(grpRow.getCell(6), DEP_BG);
  styleGroupCell(grpRow.getCell(10), NET_BG);

  // ── Row 5: Sub-headers ────────────────────────────────────
  const GROSS_LIGHT = "FFBBDEFB";
  const DEP_LIGHT   = "FFFFE0B2";
  const NET_LIGHT   = "FFC8E6C9";
  const PART_LIGHT  = "FFECEFF1";

  const subRow = ws.addRow([
    "",
    `AS ON\n${fyStartLabel}`, `ADDITIONS\nDURING YEAR`, `DELETIONS\nDURING YEAR`, `UPTO\n${fyEndLabel}`,
    "RATE %",
    `UPTO\n${prevFyEnd}`, `FOR THE\nPERIOD`, `UPTO\n${fyEndLabel}`,
    `AS ON\n${fyEndLabel}`, `AS ON\n${prevFyEnd}`,
  ]);
  subRow.height = 36;

  const styleSubCell = (cell: ExcelJS.Cell, bg: string, fgColor = "FF0D0D0D") => {
    cell.font = { bold: true, size: 9, color: { argb: fgColor } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.border = { bottom: { style: "medium" } };
  };

  styleSubCell(subRow.getCell(1), PART_LIGHT);
  for (let c = 2; c <= 5; c++) styleSubCell(subRow.getCell(c), GROSS_LIGHT, "FF0D47A1");
  styleSubCell(subRow.getCell(6), DEP_LIGHT, "FFBF360C");
  for (let c = 7; c <= 9; c++) styleSubCell(subRow.getCell(c), DEP_LIGHT, "FFBF360C");
  for (let c = 10; c <= 11; c++) styleSubCell(subRow.getCell(c), NET_LIGHT, "FF1B5E20");

  // ── Data rows ─────────────────────────────────────────────
  const numFmt = '#,##0.00';
  const styleDataCell = (cell: ExcelJS.Cell, bg: string, bold = false) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.alignment = { horizontal: "right", vertical: "middle" };
    cell.font = { bold, size: 10 };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } } };
    cell.numFmt = numFmt;
  };

  const GROSS_ROW  = "FFE3F2FD";
  const DEP_ROW    = "FFFFF3E0";
  const NET_ROW    = "FFE8F5E9";
  const PART_ROW   = "FFF5F5F5";

  for (const row of rows) {
    const r = ws.addRow([
      row.category,
      row.openingGross, row.additions, row.deletions, row.closingGross,
      row.rate > 0 ? row.rate : "",
      row.openingDep, row.periodDep, row.closingDep,
      row.netCurrent, row.netPrevious,
    ]);
    r.height = 16;

    const partCell = r.getCell(1);
    partCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PART_ROW } };
    partCell.font = { size: 10 };
    partCell.border = { right: { style: "medium" }, bottom: { style: "thin", color: { argb: "FFE0E0E0" } } };

    styleDataCell(r.getCell(2), GROSS_ROW);
    styleDataCell(r.getCell(3), GROSS_ROW);
    styleDataCell(r.getCell(4), GROSS_ROW);
    styleDataCell(r.getCell(5), GROSS_ROW, true);  // closing gross: bold

    const rateCell = r.getCell(6);
    rateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DEP_ROW } };
    rateCell.alignment = { horizontal: "center" };
    rateCell.font = { size: 10 };
    if (row.rate > 0) { rateCell.value = `${row.rate}%`; }

    styleDataCell(r.getCell(7), DEP_ROW);
    styleDataCell(r.getCell(8), DEP_ROW);
    r.getCell(8).font = { size: 10, color: { argb: "FFBF360C" }, bold: true };
    styleDataCell(r.getCell(9), DEP_ROW, true);  // closing dep: bold

    styleDataCell(r.getCell(10), NET_ROW, true); // net current: bold
    r.getCell(10).font = { size: 10, color: { argb: "FF1B5E20" }, bold: true };
    styleDataCell(r.getCell(11), NET_ROW);
  }

  // ── Grand total row ───────────────────────────────────────
  const totRow = ws.addRow([
    "TOTAL",
    grandTotal.openingGross, grandTotal.additions, grandTotal.deletions, grandTotal.closingGross,
    "",
    grandTotal.openingDep, grandTotal.periodDep, grandTotal.closingDep,
    grandTotal.netCurrent, grandTotal.netPrevious,
  ]);
  totRow.height = 18;

  const styleTotalCell = (cell: ExcelJS.Cell) => {
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "right", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
    cell.border = { top: { style: "medium" }, bottom: { style: "double" } };
    cell.numFmt = numFmt;
  };

  totRow.getCell(1).font = { bold: true, size: 10 };
  totRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
  totRow.getCell(1).border = { top: { style: "medium" }, bottom: { style: "double" } };
  for (let c = 2; c <= 11; c++) styleTotalCell(totRow.getCell(c));
  totRow.getCell(6).value = ""; // no rate in total

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=fixed-assets-schedule-${fyLabel}.xlsx`);
  res.send(buf);
}

// Combined export: same 11-column layout as sendFixedAssetsScheduleExcel,
// but each category section expands into the per-asset rows that make up
// the category total, followed by a SUBTOTAL row, a blank spacer, and the
// next category. Pool-remainder rows are surfaced as their own lines so
// the asset subtotal still ties out to the category aggregate.
async function sendFixedAssetsScheduleCombinedExcel(
  res: Response,
  categoryRows: any[],
  assetRowsByCategory: Map<string, any[]>,
  grandTotal: any,
  fiscalYear: number,
) {
  const fyEndYear = fiscalYear + 1;
  const fyStartLabel = `01.04.${fiscalYear}`;
  const fyEndLabel = `31.03.${fyEndYear}`;
  const prevFyEnd = `31.03.${fiscalYear}`;
  const fyLabel = `${fiscalYear}-${String(fyEndYear).slice(2)}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fixed Assets Schedule");

  ws.columns = [
    { width: 50 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 },
    { width: 9 },  { width: 16 }, { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 },
  ];

  // ── Title + FY rows ──────────────────────────────────────────
  const titleRow = ws.addRow(["SCHEDULE OF FIXED ASSETS — WITH ASSET BREAKDOWN"]);
  ws.mergeCells(1, 1, 1, 11);
  titleRow.height = 24;
  const tCell = titleRow.getCell(1);
  tCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  tCell.alignment = { horizontal: "center", vertical: "middle" };
  tCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } };

  const fyRow = ws.addRow([`FOR THE YEAR ENDED ${fyEndLabel}`]);
  ws.mergeCells(2, 1, 2, 11);
  fyRow.height = 18;
  const fyCell = fyRow.getCell(1);
  fyCell.font = { bold: true, size: 11, color: { argb: "FF1A237E" } };
  fyCell.alignment = { horizontal: "center", vertical: "middle" };
  fyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } };

  ws.addRow([]);

  // ── Group + sub-headers (same scheme as the summary writer) ──
  const GROSS_BG = "FF1565C0", DEP_BG = "FFE65100", NET_BG = "FF1B5E20";
  const grpRow = ws.addRow(["PARTICULARS", "GROSS BLOCK", "", "", "", "DEPRECIATION", "", "", "", "NET BLOCK", ""]);
  grpRow.height = 20;
  ws.mergeCells(4, 1, 5, 1);
  ws.mergeCells(4, 2, 4, 5);
  ws.mergeCells(4, 6, 4, 9);
  ws.mergeCells(4, 10, 4, 11);

  const styleGroupCell = (cell: ExcelJS.Cell, bg: string) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.border = { bottom: { style: "medium", color: { argb: "FF000000" } } };
  };
  styleGroupCell(grpRow.getCell(1), "FF37474F");
  styleGroupCell(grpRow.getCell(2), GROSS_BG);
  styleGroupCell(grpRow.getCell(6), DEP_BG);
  styleGroupCell(grpRow.getCell(10), NET_BG);

  const GROSS_LIGHT = "FFBBDEFB", DEP_LIGHT = "FFFFE0B2", NET_LIGHT = "FFC8E6C9", PART_LIGHT = "FFECEFF1";
  const subRow = ws.addRow([
    "",
    `AS ON\n${fyStartLabel}`, `ADDITIONS\nDURING YEAR`, `DELETIONS\nDURING YEAR`, `UPTO\n${fyEndLabel}`,
    "RATE %",
    `UPTO\n${prevFyEnd}`, `FOR THE\nPERIOD`, `UPTO\n${fyEndLabel}`,
    `AS ON\n${fyEndLabel}`, `AS ON\n${prevFyEnd}`,
  ]);
  subRow.height = 36;
  const styleSubCell = (cell: ExcelJS.Cell, bg: string, fg = "FF0D0D0D") => {
    cell.font = { bold: true, size: 9, color: { argb: fg } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.border = { bottom: { style: "medium" } };
  };
  styleSubCell(subRow.getCell(1), PART_LIGHT);
  for (let c = 2; c <= 5; c++) styleSubCell(subRow.getCell(c), GROSS_LIGHT, "FF0D47A1");
  for (let c = 6; c <= 9; c++) styleSubCell(subRow.getCell(c), DEP_LIGHT, "FFBF360C");
  for (let c = 10; c <= 11; c++) styleSubCell(subRow.getCell(c), NET_LIGHT, "FF1B5E20");

  const numFmt = "#,##0.00";

  // ── Per-category section ─────────────────────────────────────
  // Each section: category banner → asset rows → subtotal → blank spacer.
  // Category banner uses a darker block so the CFO can scan to the section break.
  const writeCategoryBanner = (catName: string) => {
    const r = ws.addRow([`▌ ${catName.toUpperCase()}`, "", "", "", "", "", "", "", "", "", ""]);
    ws.mergeCells(r.number, 1, r.number, 11);
    r.height = 22;
    const cell = r.getCell(1);
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF455A64" } };
  };

  const writeAssetRow = (idx: number, a: any) => {
    const label = a.isPoolRow
      ? a.assetName                                          // "Asset Pool — POOL-CODE …"
      : `${idx.toString().padStart(3, "0")}  ${a.assetName}${a.serialNumber ? `  (SN: ${a.serialNumber})` : ""}`;
    const r = ws.addRow([
      label,
      a.openingGross, a.additions, a.deletions, a.closingGross,
      a.rate > 0 ? a.rate : "",
      a.openingDep, a.periodDep, a.closingDep,
      a.netCurrent, a.netPrevious,
    ]);
    r.height = 15;

    // Particulars cell: lighter background, italic for pool rows, slight indent
    const partCell = r.getCell(1);
    partCell.font = { size: 9, italic: !!a.isPoolRow };
    partCell.alignment = { vertical: "middle", indent: 2, wrapText: false };
    partCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } };
    partCell.border = { bottom: { style: "thin", color: { argb: "FFEEEEEE" } } };

    const styleAmt = (col: number, bg: string) => {
      const c = r.getCell(col);
      c.numFmt = numFmt;
      c.font = { size: 9 };
      c.alignment = { horizontal: "right", vertical: "middle" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      c.border = { bottom: { style: "thin", color: { argb: "FFEEEEEE" } } };
    };
    styleAmt(2, "FFF1F8FE"); styleAmt(3, "FFF1F8FE"); styleAmt(4, "FFF1F8FE"); styleAmt(5, "FFF1F8FE");
    const rateCell = r.getCell(6);
    rateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
    rateCell.alignment = { horizontal: "center", vertical: "middle" };
    rateCell.font = { size: 9 };
    if (a.rate > 0) rateCell.value = `${a.rate}%`;
    styleAmt(7, "FFFFF8E1"); styleAmt(8, "FFFFF8E1"); styleAmt(9, "FFFFF8E1");
    styleAmt(10, "FFF1F8E9"); styleAmt(11, "FFF1F8E9");
  };

  const writeSubtotalRow = (catName: string, count: number, catRow: any) => {
    const r = ws.addRow([
      `SUBTOTAL — ${catName.toUpperCase()} (${count} ${count === 1 ? "asset" : "assets"})`,
      catRow.openingGross, catRow.additions, catRow.deletions, catRow.closingGross,
      "",
      catRow.openingDep, catRow.periodDep, catRow.closingDep,
      catRow.netCurrent, catRow.netPrevious,
    ]);
    r.height = 18;
    const partCell = r.getCell(1);
    partCell.font = { bold: true, size: 10, color: { argb: "FF263238" } };
    partCell.alignment = { vertical: "middle", indent: 1 };
    partCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFD8DC" } };
    partCell.border = { top: { style: "thin" }, bottom: { style: "medium" } };

    const styleSubtot = (col: number) => {
      const c = r.getCell(col);
      c.numFmt = numFmt;
      c.font = { bold: true, size: 10 };
      c.alignment = { horizontal: "right", vertical: "middle" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFD8DC" } };
      c.border = { top: { style: "thin" }, bottom: { style: "medium" } };
    };
    for (let c = 2; c <= 11; c++) styleSubtot(c);
  };

  // Walk categoryRows in the same order they were computed; for each, drop the
  // category section into the sheet.
  for (const catRow of categoryRows) {
    const assetRows = assetRowsByCategory.get(catRow.category) ?? [];
    writeCategoryBanner(catRow.category);
    assetRows.forEach((a, i) => writeAssetRow(i + 1, a));
    writeSubtotalRow(catRow.category, assetRows.filter(a => !a.isPoolRow).length, catRow);
    ws.addRow([]); // blank spacer
  }

  // ── Grand total ──────────────────────────────────────────────
  const totRow = ws.addRow([
    "GRAND TOTAL",
    grandTotal.openingGross, grandTotal.additions, grandTotal.deletions, grandTotal.closingGross,
    "",
    grandTotal.openingDep, grandTotal.periodDep, grandTotal.closingDep,
    grandTotal.netCurrent, grandTotal.netPrevious,
  ]);
  totRow.height = 20;
  const styleGrand = (col: number) => {
    const c = totRow.getCell(col);
    c.numFmt = numFmt;
    c.font = { bold: true, size: 11 };
    c.alignment = { horizontal: "right", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
    c.border = { top: { style: "medium" }, bottom: { style: "double" } };
  };
  totRow.getCell(1).font = { bold: true, size: 11 };
  totRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
  totRow.getCell(1).border = { top: { style: "medium" }, bottom: { style: "double" } };
  for (let c = 2; c <= 11; c++) styleGrand(c);

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=fixed-assets-schedule-with-breakdown-${fyLabel}.xlsx`);
  res.send(buf);
}

// ─── Fixed Assets Schedule ────────────────────────────────────────────────────
// The per-asset computation lives in utilis/fixedAssetsSchedule.ts, shared with
// financial-year finalization. A FINALIZED year is served from its frozen
// snapshot — rebuilt through the same aggregation — so nothing done after the
// CFO's approval (reclassification, rate or cost corrections) can move it.
export const getFixedAssetsSchedule = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = req.query;
    const exportFormat = query.export as string;

    // Default fiscal year: current FY (Apr–Mar)
    const now = new Date();
    const defaultFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fiscalYear = Number(query.fiscalYear) || defaultFY;

    const { fyStart, fyEnd } = scheduleFyBounds(fiscalYear);
    const branchId = query.branchId ? Number(query.branchId) : undefined;

    const frozen = await finalizedScheduleLines(fiscalYear, { branchId });
    const lines = frozen ? frozen.lines : await buildScheduleLines(fiscalYear, { branchId });

    const { rows, grandTotal, assetRowsByCategory } = aggregateScheduleLines(lines, {
      collectAssetRows: exportFormat === "combined",
    });

    if (exportFormat === "excel") {
      return await sendFixedAssetsScheduleExcel(res, rows, grandTotal, fiscalYear);
    }
    if (exportFormat === "combined") {
      return await sendFixedAssetsScheduleCombinedExcel(res, rows, assetRowsByCategory, grandTotal, fiscalYear);
    }

    res.json({
      fiscalYear,
      fyLabel: `FY ${fiscalYear}-${String(fiscalYear + 1).slice(2)}`,
      fyStart: fyStart.toISOString().split("T")[0],
      fyEnd: fyEnd.toISOString().split("T")[0],
      rows,
      grandTotal,
      // Present only for a closed year, so the UI can label it as frozen.
      ...(frozen ? { finalized: true, finalizedAt: frozen.finalizedAt } : {}),
    });
  } catch (err: any) {
    console.error("getFixedAssetsSchedule error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 6. Inventory Stock Report ──────────────────────────────────────────────

export const getInventoryStockReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = req.query;
    const exportFormat = query.export as string;

    const spareParts = await prisma.sparePart.findMany({
      include: { vendor: { select: { name: true } } },
      orderBy: { stockQuantity: "asc" },
    });

    const data = spareParts.map((sp: any) => {
      const stockQuantity = Number(sp.stockQuantity || 0);
      const reorderLevel = Number(sp.reorderLevel || 0);
      const cost = Number(sp.cost || 0);

      return {
        id: sp.id, name: sp.name, partNumber: sp.partNumber || "",
        category: sp.category || "", vendor: sp.vendor?.name || "",
        stockQuantity, reorderLevel, cost,
        totalValue: +(stockQuantity * cost).toFixed(2),
        needsReorder: stockQuantity <= reorderLevel,
      };
    });

    const reorderAlerts = data.filter((d) => d.needsReorder);
    const totalInventoryValue = data.reduce((sum, d) => sum + d.totalValue, 0);

    if (exportFormat === "csv" || exportFormat === "excel") {
      const exportRows = data.map((d) => ({
        "Part Name": d.name, "Part Number": d.partNumber,
        "Category": d.category, "Vendor": d.vendor,
        "Stock Qty": d.stockQuantity, "Reorder Level": d.reorderLevel,
        "Unit Cost": d.cost, "Total Value": d.totalValue,
        "Needs Reorder": d.needsReorder ? "YES" : "No",
      }));

      if (exportFormat === "csv") return sendCsv(res, exportRows, "inventory-stock-report");
      return sendExcel(res, exportRows, "inventory-stock-report", "Inventory Stock");
    }

    res.json({
      data, reorderAlerts,
      summary: { totalParts: data.length, totalInventoryValue, reorderAlertCount: reorderAlerts.length },
    });
  } catch (err: any) {
    console.error("getInventoryStockReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── 7. Consolidated Asset Report ───────────────────────────────────────────

export const getConsolidatedAssetReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const query = req.query;
    const exportFormat = query.export as string;

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;

    const where: any = { ...buildRoleFilter(user) };
    if (query.departmentId) where.departmentId = Number(query.departmentId);
    if (query.branchId) where.currentBranchId = Number(query.branchId);
    if (query.categoryId) where.assetCategoryId = Number(query.categoryId);
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { assetId: { contains: String(query.search) } },
        { assetName: { contains: String(query.search) } },
        { serialNumber: { contains: String(query.search) } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      const dateField = String(query.dateField || 'purchaseDate') as 'purchaseDate' | 'installedAt';
      where[dateField] = {};
      if (query.dateFrom) where[dateField].gte = new Date(query.dateFrom as string);
      if (query.dateTo)   where[dateField].lte = new Date(query.dateTo as string);
    }

    const [total, assets] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        ...(!exportFormat ? { skip: (page - 1) * limit, take: limit } : {}),
        orderBy: { createdAt: "desc" },
        select: {
          id: true, assetId: true, assetName: true, serialNumber: true,
          assetType: true, status: true, purchaseDate: true, purchaseCost: true,
          modeOfProcurement: true, manufacturer: true, modelNumber: true,
          currentLocation: true, physicalCondition: true, criticalityLevel: true,
          workingCondition: true, warrantyStatus: true, createdAt: true,
          assetCategory: { select: { name: true } },
          department: { select: { name: true } },
          vendor: { select: { name: true } },
          allottedTo: { select: { name: true } },
          currentBranch: { select: { name: true } },
        },
      }),
    ]);

    const assetIds = assets.map((a) => a.id);

    // Fetch related data in parallel
    const [depreciation, warranties, insurance, contracts, ticketCounts, lastTickets, lastMaintenance] =
      await Promise.all([
        prisma.assetDepreciation.findMany({
          where: { assetId: { in: assetIds } },
          select: { assetId: true, currentBookValue: true, depreciationMethod: true },
        }),
        prisma.warranty.findMany({
          where: { assetId: { in: assetIds }, isActive: true },
          select: { assetId: true, warrantyEnd: true, isUnderWarranty: true },
          orderBy: { warrantyEnd: "desc" },
        }),
        prisma.assetInsurance.findMany({
          where: { assetId: { in: assetIds }, isActive: true },
          select: { assetId: true, endDate: true },
          orderBy: { endDate: "desc" },
        }),
        prisma.serviceContract.findMany({
          where: { assetId: { in: assetIds }, endDate: { gte: new Date() } },
          select: { assetId: true, endDate: true },
          orderBy: { endDate: "desc" },
        }),
        prisma.ticket.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIds } },
          _count: { id: true },
        }),
        prisma.ticket.findMany({
          where: { assetId: { in: assetIds } },
          select: { assetId: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          distinct: ["assetId"],
        }),
        prisma.maintenanceHistory.findMany({
          where: { assetId: { in: assetIds } },
          select: { assetId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          distinct: ["assetId"],
        }),
      ]);

    // Build lookup maps
    const deprMap = new Map(depreciation.map((d) => [d.assetId, d]));
    const warrantyMap = new Map(warranties.map((w) => [w.assetId, w]));
    const insuranceMap = new Map(insurance.map((i) => [i.assetId, i]));
    const contractMap = new Map(contracts.map((c) => [c.assetId, c]));
    const ticketCountMap = new Map(ticketCounts.map((t) => [t.assetId, t._count.id]));
    const lastTicketMap = new Map(lastTickets.map((t) => [t.assetId, t]));
    const lastMaintenanceMap = new Map(lastMaintenance.map((m) => [m.assetId, m]));

    const openStatuses = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "WORK_COMPLETED"] as any[];

    const openTicketCounts = await prisma.ticket.groupBy({
      by: ["assetId"],
      where: { assetId: { in: assetIds }, status: { in: openStatuses } },
      _count: { id: true },
    });
    const openTicketMap = new Map(openTicketCounts.map((t) => [t.assetId, (t._count?.id ?? 0)]));

    const data = assets.map((a) => {
      const dep = deprMap.get(a.id);
      const war = warrantyMap.get(a.id);
      const ins = insuranceMap.get(a.id);
      const con = contractMap.get(a.id);
      const lastTkt = lastTicketMap.get(a.id);
      const lastMaint = lastMaintenanceMap.get(a.id);
      return {
        assetId: a.assetId,
        assetName: a.assetName,
        serialNumber: a.serialNumber,
        assetType: a.assetType,
        category: a.assetCategory?.name || "",
        department: a.department?.name || "",
        branch: (a as any).currentBranch?.name || "—",
        vendor: a.vendor?.name || "",
        manufacturer: a.manufacturer || "",
        modelNumber: a.modelNumber || "",
        modeOfProcurement: a.modeOfProcurement,
        purchaseDate: a.purchaseDate,
        purchaseCost: Number(a.purchaseCost || 0),
        status: a.status,
        location: a.currentLocation || "",
        physicalCondition: a.physicalCondition || "",
        criticalityLevel: a.criticalityLevel || "",
        workingCondition: a.workingCondition || "",
        assignedTo: a.allottedTo?.name || "",
        currentBookValue: dep ? Number(dep.currentBookValue || 0) : null,
        depreciationMethod: dep?.depreciationMethod || "",
        warrantyEnd: war?.warrantyEnd || null,
        underWarranty: war?.isUnderWarranty ?? false,
        insuranceExpiry: ins?.endDate || null,
        contractExpiry: con?.endDate || null,
        totalTickets: ticketCountMap.get(a.id) ?? 0,
        openTickets: openTicketMap.get(a.id) ?? 0,
        lastTicketDate: lastTkt?.createdAt || null,
        lastMaintenanceDate: lastMaint?.createdAt || null,
      };
    });

    if (exportFormat === "csv" || exportFormat === "excel") {
      const exportRows = data.map((d) => ({
        "Asset ID": d.assetId,
        "Asset Name": d.assetName,
        "Serial Number": d.serialNumber,
        "Asset Type": d.assetType,
        "Category": d.category,
        "Department": d.department,
        "Branch": d.branch,
        "Vendor": d.vendor,
        "Manufacturer": d.manufacturer,
        "Model Number": d.modelNumber,
        "Mode of Procurement": d.modeOfProcurement,
        "Purchase Date": formatDate(d.purchaseDate),
        "Purchase Cost (₹)": d.purchaseCost,
        "Status": d.status,
        "Location": d.location,
        "Physical Condition": d.physicalCondition,
        "Criticality": d.criticalityLevel,
        "Working Condition": d.workingCondition,
        "Assigned To": d.assignedTo,
        "Current Book Value (₹)": d.currentBookValue ?? "",
        "Depreciation Method": d.depreciationMethod,
        "Warranty End": formatDate(d.warrantyEnd),
        "Under Warranty": d.underWarranty ? "Yes" : "No",
        "Insurance Expiry": formatDate(d.insuranceExpiry),
        "Contract Expiry": formatDate(d.contractExpiry),
        "Total Tickets": d.totalTickets,
        "Open Tickets": d.openTickets,
        "Last Ticket Date": formatDate(d.lastTicketDate),
        "Last Maintenance Date": formatDate(d.lastMaintenanceDate),
      }));

      if (exportFormat === "csv") return sendCsv(res, exportRows, "consolidated-asset-report");
      return sendExcel(res, exportRows, "consolidated-asset-report", "Consolidated Assets");
    }

    // Branch-wise subtotals over the WHOLE filtered set (not just this page)
    const branchAgg = await prisma.asset.groupBy({
      by: ["currentBranchId"],
      where,
      _count: { id: true },
      _sum: { purchaseCost: true },
    });
    const branchNames = await prisma.branch.findMany({ select: { id: true, name: true } });
    const branchNameById = new Map(branchNames.map((b) => [b.id, b.name]));
    const branchSummary = branchAgg
      .map((b) => ({
        branch: b.currentBranchId == null ? "Unassigned" : (branchNameById.get(b.currentBranchId) ?? "Unknown"),
        count: b._count.id,
        totalCost: Number(b._sum.purchaseCost || 0),
      }))
      .sort((a, z) => z.totalCost - a.totalCost);

    res.json({ data, branchSummary, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    console.error("getConsolidatedAssetReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ── GET /reports/fixed-assets-schedule/category-detail ───────────────────────
// Returns per-asset breakdown for a single category in the FA schedule
// matching the same Opening / Addition / Deletion / Depreciation / Net layout.
// The sum of per-asset values MUST equal the category-level totals.
export const getCategoryAssetDetail = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const fiscalYear = Number(req.query.fiscalYear) || new Date().getFullYear();
    const categoryName = String(req.query.category || "").trim();
    if (!categoryName) {
      res.status(400).json({ message: "category is required" });
      return;
    }

    const fyStart = new Date(`${fiscalYear}-04-01T00:00:00.000`);
    const fyEnd = new Date(`${fiscalYear + 1}-03-31T23:59:59.999`);

    // A finalized year is served from its frozen snapshot, by the category name
    // it was closed under — so it ties exactly to the schedule's category total
    // (pool balances included) and can't be moved by a later reclassification.
    const frozen = await finalizedScheduleLines(fiscalYear, {
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
    });
    let rows: any[];

    if (frozen) {
      const catLines = frozen.lines.filter(l => l.categoryName === categoryName);
      if (!catLines.length) { res.status(404).json({ message: `Category "${categoryName}" has no lines in finalized FY${fiscalYear}` }); return; }
      const { assetRowsByCategory } = aggregateScheduleLines(catLines, { collectAssetRows: true });
      rows = (assetRowsByCategory.get(categoryName) ?? []).map((r: any) => ({
        assetId: r.assetIdCode,
        assetName: r.assetName,
        serialNumber: r.serialNumber || null,
        modeOfProcurement: r.modeOfProcurement ?? null,
        donated: r.modeOfProcurement === "DONATION",
        purchaseDate: r.acquisitionDate ? new Date(r.acquisitionDate).toISOString().split("T")[0] : null,
        openingGross: r.openingGross,
        additions: r.additions,
        additions1H: r.additions1H,
        additions2H: r.additions2H,
        deletions: r.deletions,
        deletions1H: r.deletions1H,
        deletions2H: r.deletions2H,
        closingGross: r.closingGross,
        rate: r.rate,
        openingDep: r.openingDep,
        depOnOpening: r.depOnOpening,
        depOnAdditions: r.depOnAdditions,
        periodDep: r.periodDep,
        closingDep: r.closingDep,
        netCurrent: r.netCurrent,
        netPrevious: r.netPrevious,
        ...(r.isPoolRow ? { isPoolRow: true } : {}),
      }));
    } else {

    // Find category
    const category = await prisma.assetCategory.findFirst({ where: { name: categoryName } });
    if (!category) { res.status(404).json({ message: `Category "${categoryName}" not found` }); return; }

    // Fetch all assets in this category that could appear in this FY
    const assets = await prisma.asset.findMany({
      where: {
        assetCategoryId: category.id,
        // Top-level assets only — must match getFixedAssetsSchedule, or this
        // drill-down will not tie back to the category subtotal.
        parentAssetId: null,
        OR: [
          { purchaseDate: { lte: fyEnd } },
          { donationDate: { lte: fyEnd } },
        ],
        ...(req.query.branchId ? { currentBranchId: Number(req.query.branchId) } : {}),
      },
      select: {
        id: true, assetId: true, assetName: true, serialNumber: true,
        purchaseCost: true, purchaseDate: true, donationDate: true, estimatedValue: true,
        modeOfProcurement: true,
        disposalDate: true, status: true,
        depreciation: {
          select: {
            depreciationRate: true, depreciationMethod: true, depreciationStart: true,
            salvageValue: true, accumulatedDepreciation: true, currentBookValue: true,
          },
        },
      },
      orderBy: { purchaseDate: "asc" },
    });

    // Pre-fetch FY-scoped logs (same source-of-truth priority as category view)
    const fyLogs = await prisma.depreciationLog.findMany({
      where: { assetId: { in: assets.map(a => a.id) }, periodStart: { gte: fyStart, lte: fyEnd }, ...BOOKED_LOG_WHERE },
      select: { assetId: true, depreciationAmount: true, bookValueAfter: true, depOnOpening: true, depOnAdditions: true },
    });
    const logByAssetId = new Map<number, typeof fyLogs[0]>();
    for (const l of fyLogs) logByAssetId.set(l.assetId, l);

    const isSecondHalf = (d: Date) => { const m = d.getMonth(); return m >= 9 || m <= 2; };

    rows = assets.map(a => {
      const cost = Number(a.purchaseCost ?? a.estimatedValue ?? 0);
      const acqDate = a.purchaseDate ?? a.donationDate;
      const purchaseDate = acqDate ? new Date(acqDate) : null;
      const disposalDate = a.disposalDate ? new Date(a.disposalDate) : null;

      const isDisposedBeforeFY = disposalDate && disposalDate < fyStart;
      const isDisposedInFY = disposalDate && disposalDate >= fyStart && disposalDate <= fyEnd;
      const isAcquiredBeforeFY = purchaseDate && purchaseDate < fyStart;
      const isAcquiredInFY = purchaseDate && purchaseDate >= fyStart && purchaseDate <= fyEnd;

      let openingGross = 0, additions = 0, additions1H = 0, additions2H = 0;
      let deletions = 0, deletions1H = 0, deletions2H = 0;

      if (isAcquiredBeforeFY && !isDisposedBeforeFY) openingGross = cost;
      if (isAcquiredInFY && purchaseDate) {
        additions = cost;
        if (isSecondHalf(purchaseDate)) additions2H = cost; else additions1H = cost;
      }
      if (isDisposedInFY && disposalDate) {
        deletions = cost;
        if (isSecondHalf(disposalDate)) deletions2H = cost; else deletions1H = cost;
      }
      const closingGross = openingGross + additions - deletions;

      const dep = a.depreciation;
      const rate = Number(dep?.depreciationRate || 0);
      const method = dep?.depreciationMethod;
      const depStart = dep?.depreciationStart ? new Date(dep.depreciationStart) : purchaseDate;
      const salvage = Number(dep?.salvageValue ?? 0);

      // FY-scoped closing dep (must match category view's logic, not live DB value)
      let depOnOpening = 0, depOnAdditions = 0, closingDep = 0;
      const fyLog = logByAssetId.get(a.id);

      if (fyLog) {
        // Source of truth: stored log for this FY
        closingDep = Math.max(0, cost - Number(fyLog.bookValueAfter));
        depOnOpening = Number(fyLog.depOnOpening ?? 0);
        depOnAdditions = Number(fyLog.depOnAdditions ?? 0);
      } else if (rate > 0 && depStart && !isDisposedBeforeFY) {
        if (method === "DB") {
          const openingWDV = _wdvAtDate(cost, salvage, rate, depStart, fyStart);
          const closingWDV = _wdvAtDate(cost, salvage, rate, depStart, fyEnd);
          closingDep = Math.max(0, cost - closingWDV);
          if (isAcquiredBeforeFY) {
            depOnOpening = Math.min(openingWDV * rate / 100, Math.max(0, openingWDV - salvage));
          } else if (isAcquiredInFY && purchaseDate) {
            const halfYear = _faIsSecondHalfFY(purchaseDate);
            depOnAdditions = cost * (halfYear ? rate / 200 : rate / 100);
          }
        } else {
          // SL
          if (isAcquiredBeforeFY) {
            depOnOpening = Math.min((cost - salvage) * rate / 100, Math.max(0, cost - salvage));
          } else if (isAcquiredInFY) {
            depOnAdditions = Math.min((cost - salvage) * rate / 100, Math.max(0, cost - salvage));
          }
          // SL closing dep: replay from depStart to fyEnd
          const yearsToFyEnd = Math.max(0, (fyEnd.getTime() - depStart.getTime()) / (365.25 * 86400000));
          const annual = (cost - salvage) * rate / 100;
          closingDep = Math.min(yearsToFyEnd * annual, Math.max(0, cost - salvage));
        }
      }

      const periodDep = +(depOnOpening + depOnAdditions).toFixed(2);
      const openingDep = +Math.max(0, closingDep - periodDep).toFixed(2);
      const netCurrent = +(closingGross - closingDep).toFixed(2);
      const netPrevious = +(openingGross - openingDep).toFixed(2);

      return {
        assetId: a.assetId,
        assetName: a.assetName,
        serialNumber: a.serialNumber,
        modeOfProcurement: a.modeOfProcurement,
        donated: a.modeOfProcurement === "DONATION",
        purchaseDate: purchaseDate?.toISOString().split("T")[0] ?? null,
        openingGross: +openingGross.toFixed(2),
        additions: +additions.toFixed(2),
        additions1H: +additions1H.toFixed(2),
        additions2H: +additions2H.toFixed(2),
        deletions: +deletions.toFixed(2),
        deletions1H: +deletions1H.toFixed(2),
        deletions2H: +deletions2H.toFixed(2),
        closingGross: +closingGross.toFixed(2),
        rate,
        openingDep,
        depOnOpening: +depOnOpening.toFixed(2),
        depOnAdditions: +depOnAdditions.toFixed(2),
        periodDep,
        closingDep: +closingDep.toFixed(2),
        netCurrent,
        netPrevious,
      };
    }).filter(r => r.openingGross !== 0 || r.additions !== 0 || r.deletions !== 0 || r.closingDep !== 0);
    } // end live (not finalized) branch

    // Sum totals
    const totals = rows.reduce((acc, r) => ({
      openingGross: acc.openingGross + r.openingGross,
      additions: acc.additions + r.additions,
      additions1H: acc.additions1H + r.additions1H,
      additions2H: acc.additions2H + r.additions2H,
      deletions: acc.deletions + r.deletions,
      deletions1H: acc.deletions1H + r.deletions1H,
      deletions2H: acc.deletions2H + r.deletions2H,
      closingGross: acc.closingGross + r.closingGross,
      openingDep: acc.openingDep + r.openingDep,
      depOnOpening: acc.depOnOpening + r.depOnOpening,
      depOnAdditions: acc.depOnAdditions + r.depOnAdditions,
      periodDep: acc.periodDep + r.periodDep,
      closingDep: acc.closingDep + r.closingDep,
      netCurrent: acc.netCurrent + r.netCurrent,
      netPrevious: acc.netPrevious + r.netPrevious,
    }), {
      openingGross: 0, additions: 0, additions1H: 0, additions2H: 0,
      deletions: 0, deletions1H: 0, deletions2H: 0, closingGross: 0,
      openingDep: 0, depOnOpening: 0, depOnAdditions: 0, periodDep: 0,
      closingDep: 0, netCurrent: 0, netPrevious: 0,
    });

    Object.keys(totals).forEach(k => { (totals as any)[k] = +(totals as any)[k].toFixed(2); });

    // ── Excel export ──────────────────────────────────────────────────────────
    const exportFormat = req.query.export as string;
    if (exportFormat === "excel" || exportFormat === "csv") {
      const exportRows = rows.map((r, i) => ({
        "#": i + 1,
        "Asset ID": r.assetId,
        "Asset Name": r.assetName,
        "Serial Number": r.serialNumber || "",
        "Opening Gross": r.openingGross,
        "Additions 1H (Apr-Sep)": r.additions1H,
        "Additions 2H (Oct-Mar)": r.additions2H,
        "Deletions": r.deletions,
        "Closing Gross": r.closingGross,
        "Rate %": r.rate,
        "Dep. On Opening": r.depOnOpening,
        "Dep. On Additions": r.depOnAdditions,
        "Closing Acc. Dep.": r.closingDep,
        "Net Block (Current)": r.netCurrent,
        "Net Block (Prev.)": r.netPrevious,
      }));
      // Append a subtotal row
      exportRows.push({
        "#": "" as any,
        "Asset ID": "",
        "Asset Name": `SUBTOTAL (${rows.length} assets)`,
        "Serial Number": "",
        "Opening Gross": totals.openingGross,
        "Additions 1H (Apr-Sep)": totals.additions1H,
        "Additions 2H (Oct-Mar)": totals.additions2H,
        "Deletions": totals.deletions,
        "Closing Gross": totals.closingGross,
        "Rate %": "" as any,
        "Dep. On Opening": totals.depOnOpening,
        "Dep. On Additions": totals.depOnAdditions,
        "Closing Acc. Dep.": totals.closingDep,
        "Net Block (Current)": totals.netCurrent,
        "Net Block (Prev.)": totals.netPrevious,
      });

      const safeCat = categoryName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
      const fname = `asset-breakdown-${safeCat}-${fiscalYear}-${String(fiscalYear + 1).slice(2)}`;
      if (exportFormat === "csv") return sendCsv(res, exportRows, fname);
      return sendExcel(res, exportRows, fname, "Asset Breakdown");
    }

    res.json({
      category: categoryName,
      fiscalYear,
      fyLabel: `FY ${fiscalYear}-${String(fiscalYear + 1).slice(2)}`,
      assetCount: rows.length,
      rows,
      totals,
      ...(frozen ? { finalized: true, finalizedAt: frozen.finalizedAt } : {}),
    });
  } catch (err: any) {
    console.error("getCategoryAssetDetail error:", err);
    res.status(500).json({ message: err.message });
  }
};

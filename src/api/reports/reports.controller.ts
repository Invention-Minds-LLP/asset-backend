import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import XLSX from "xlsx";
import ExcelJS from "exceljs";

// ─── Role-based Filter Helper ───────────────────────────────────────────────

function buildRoleFilter(user: any): any {
  const role = user?.role;
  const departmentId = user?.departmentId;
  const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;

  if (role === "HOD") return { departmentId: Number(departmentId) };
  if (role === "SUPERVISOR") return { supervisorId: Number(employeeDbId) };
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
          id: true, assetId: true, assetName: true, serialNumber: true,
          purchaseDate: true, purchaseCost: true, modeOfProcurement: true,
          status: true, manufacturer: true, modelNumber: true,
          currentLocation: true, physicalCondition: true, warrantyStatus: true,
          assetCategory: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
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
        serialNumber: a.serialNumber,
        category: a.assetCategory?.name || "N/A",
        department: a.department?.name || "N/A",
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
        "Serial Number": d.serialNumber,
        "Category": d.category,
        "Department": d.department,
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

    res.json({
      data,
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
      ticketWhere.asset = { supervisorId: Number(employeeDbId) };
    }

    if (query.departmentId) ticketWhere.departmentId = Number(query.departmentId);
    if (query.priority) ticketWhere.priority = query.priority;

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

// ─── Indian IT Act 180-day convention helpers ─────────────────────────────────
// Assets purchased Oct–Mar (second half of Indian FY Apr–Mar) get 50% rate in year 1.
function _faIsSecondHalfFY(date: Date): boolean {
  const m = date.getMonth(); // 0=Jan … 11=Dec
  return m >= 9 || m <= 2;  // Oct(9), Nov(10), Dec(11), Jan(0), Feb(1), Mar(2)
}

// Replay annual WDV from depStart and return the WDV at targetDate (before that period's dep).
function _wdvAtDate(cost: number, salvage: number, rate: number, depStart: Date, targetDate: Date): number {
  let wdv = cost;
  let periodStart = new Date(depStart);
  let yearNum = 0;

  while (wdv > salvage) {
    const periodEnd = new Date(periodStart);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    if (periodEnd > targetDate) break; // targetDate is inside this period — stop before applying dep

    yearNum++;
    const effectiveRate = (yearNum === 1 && _faIsSecondHalfFY(depStart)) ? rate / 200 : rate / 100;
    const dep = Math.min(wdv * effectiveRate, Math.max(0, wdv - salvage));
    wdv = Math.max(salvage, wdv - dep);
    periodStart = periodEnd;
  }

  return wdv;
}

export const getFixedAssetsSchedule = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = req.query;
    const exportFormat = query.export as string;

    // Default fiscal year: current FY (Apr–Mar)
    const now = new Date();
    const defaultFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fiscalYear = Number(query.fiscalYear) || defaultFY;

    const fyStart = new Date(`${fiscalYear}-04-01T00:00:00.000`);
    const fyEnd = new Date(`${fiscalYear + 1}-03-31T23:59:59.999`);

    // Fetch all assets that could appear in this FY schedule
    const assets = await prisma.asset.findMany({
      where: {
        purchaseDate: { lte: fyEnd },
      },
      select: {
        id: true,
        assetName: true,
        assetNature: true,
        purchaseCost: true,
        purchaseDate: true,
        disposalDate: true,
        status: true,
        assetPoolId: true,
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

    // ── Fetch pool depreciation schedules for this FY ──────────────────────────
    // The FA schedule stored per pool is the auditor-certified source of truth for
    // undigitized (not-yet-individualized) asset balances.
    const fyLabel = `FY${fiscalYear}-${String(fiscalYear + 1).slice(2)}`;
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

    // Build a map: categoryName → pool remainder rows (to merge after individual rows)
    // For each pool schedule, subtract what's already individualized so we don't double-count.
    const poolRemainderMap = new Map<string, {
      openingGross: number; additions: number; deletions: number; closingGross: number;
      openingDep: number; periodDep: number; closingDep: number;
      openingNetBlock: number; closingNetBlock: number; rate: number;
      poolCode: string;
    }[]>();

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
      const remainingPeriodDep   = +(Number(sched.depreciationForPeriod) * remainingRatio).toFixed(2);
      const remainingOpenGross   = +(Number(sched.openingGrossBlock) * remainingRatio).toFixed(2);
      const remainingAdditions   = +(Number(sched.additions) * remainingRatio).toFixed(2);
      const remainingDeletions   = +(Number(sched.deletions) * remainingRatio).toFixed(2);
      const remainingOpenNet     = +(remainingOpenGross - remainingOpenDep).toFixed(2);
      const remainingCloseNet    = +(remainingGross - Math.max(0, remainingCloseDep)).toFixed(2);

      // Only add a pool remainder row if there's actually undigitized balance left
      if (remainingGross > 0) {
        if (!poolRemainderMap.has(catName)) poolRemainderMap.set(catName, []);
        poolRemainderMap.get(catName)!.push({
          openingGross: remainingOpenGross,
          additions: remainingAdditions,
          deletions: remainingDeletions,
          closingGross: +remainingGross.toFixed(2),
          openingDep: remainingOpenDep,
          periodDep: remainingPeriodDep,
          closingDep: Math.max(0, remainingCloseDep),
          openingNetBlock: remainingOpenNet,
          closingNetBlock: remainingCloseNet,
          rate: Number(sched.depreciationRate),
          poolCode: pool.poolCode ?? "",
        });
      }
    }

    // Group assets by category
    const categoryMap = new Map<string, typeof assets>();
    for (const asset of assets) {
      const catName = asset.assetCategory?.name || "Uncategorized";
      if (!categoryMap.has(catName)) categoryMap.set(catName, []);
      categoryMap.get(catName)!.push(asset);
    }

    // Also collect all category names from pool remainders that have no individual assets
    const allCatNames = new Set<string>([...categoryMap.keys(), ...poolRemainderMap.keys()]);

    const rows: any[] = [];
    let gOpenGross = 0, gAdditions = 0, gDeletions = 0, gCloseGross = 0;
    let gOpenDep = 0, gPeriodDep = 0, gCloseDep = 0;
    let gNetCurrent = 0, gNetPrevious = 0;

    for (const catName of allCatNames) {
      let openingGross = 0, additions = 0, deletions = 0;
      let closingAccDep = 0;
      let catAssetPeriodDep = 0; // per-asset computed period dep (with half-year convention)
      let totalRate = 0, rateCount = 0;

      const catAssets = categoryMap.get(catName) ?? [];

      for (const asset of catAssets) {
        const cost = Number(asset.purchaseCost || 0);
        const purchaseDate = asset.purchaseDate ? new Date(asset.purchaseDate) : null;
        const disposalDate = asset.disposalDate ? new Date(asset.disposalDate) : null;

        const isDisposedBeforeFY = disposalDate && disposalDate < fyStart;
        const isDisposedInFY = disposalDate && disposalDate >= fyStart && disposalDate <= fyEnd;
        const isAcquiredBeforeFY = purchaseDate && purchaseDate < fyStart;
        const isAcquiredInFY = purchaseDate && purchaseDate >= fyStart && purchaseDate <= fyEnd;

        // Opening Gross Block: acquired before FY start, not disposed before FY start
        if (isAcquiredBeforeFY && !isDisposedBeforeFY) {
          openingGross += cost;
        }

        // Additions: acquired during FY
        if (isAcquiredInFY) {
          additions += cost;
        }

        // Deletions: disposed during FY (use original cost)
        if (isDisposedInFY) {
          deletions += cost;
        }

        const dep = asset.depreciation;
        if (!dep) continue;

        const assetRate    = Number(dep.depreciationRate || 0);
        const method       = dep.depreciationMethod;
        const depStart     = dep.depreciationStart ? new Date(dep.depreciationStart) : purchaseDate;
        const salvageVal   = Number(dep.salvageValue ?? 0);

        if (assetRate > 0) { totalRate += assetRate; rateCount++; }

        // ── Per-asset period depreciation (Indian IT Act 180-day convention) ──
        if (isAcquiredBeforeFY && !isDisposedBeforeFY) {
          // Opening block: asset is in year 2+ → full rate on opening WDV
          closingAccDep += Number(dep.accumulatedDepreciation || 0);
          if (assetRate > 0 && depStart) {
            if (method === "DB") {
              const openingWDV = _wdvAtDate(cost, salvageVal, assetRate, depStart, fyStart);
              catAssetPeriodDep += Math.min(openingWDV * assetRate / 100, Math.max(0, openingWDV - salvageVal));
            } else { // SL
              catAssetPeriodDep += Math.min((cost - salvageVal) * assetRate / 100, Math.max(0, cost - salvageVal));
            }
          }
        } else if (isAcquiredInFY && assetRate > 0 && purchaseDate) {
          // Addition: Indian IT Act half-year rule applies for DB method only
          if (method === "DB") {
            const halfYear = _faIsSecondHalfFY(purchaseDate);
            catAssetPeriodDep += cost * (halfYear ? assetRate / 200 : assetRate / 100);
          } else { // SL
            catAssetPeriodDep += Math.min((cost - salvageVal) * assetRate / 100, Math.max(0, cost - salvageVal));
          }
        }
      }

      // ── Merge pool remainder rows for this category ──────────────────────────
      // These represent the auditor-certified balance of assets not yet individualized.
      // Added on top of individual asset figures — no double count because
      // pool remainder = pool total MINUS already-extracted individual asset costs.
      const poolRemainders = poolRemainderMap.get(catName) ?? [];
      let poolPeriodDep = 0;
      for (const pr of poolRemainders) {
        openingGross  += pr.openingGross;
        additions     += pr.additions;
        deletions     += pr.deletions;
        closingAccDep += pr.closingDep;
        poolPeriodDep += pr.periodDep;
        totalRate     += pr.rate;
        rateCount     += 1;
      }

      const closingGross = openingGross + additions - deletions;
      const avgRate = rateCount > 0 ? +(totalRate / rateCount).toFixed(2) : 0;

      // Period dep: per-asset computed (individual assets) + auditor-certified (pool remainder)
      const periodDep = +(catAssetPeriodDep + poolPeriodDep).toFixed(2);
      let openingDep = +(closingAccDep - periodDep).toFixed(2);
      if (openingDep < 0) openingDep = 0;

      const netCurrent  = +(closingGross - closingAccDep).toFixed(2);
      const netPrevious = +(openingGross - openingDep).toFixed(2);

      // Flag if this category has undigitized pool balance (useful for frontend warning)
      const hasPoolBalance = poolRemainders.length > 0;
      const poolCodes      = poolRemainders.map(p => p.poolCode);

      rows.push({
        category: catName,
        openingGross: +openingGross.toFixed(2),
        additions: +additions.toFixed(2),
        deletions: +deletions.toFixed(2),
        closingGross: +closingGross.toFixed(2),
        rate: avgRate,
        openingDep: +openingDep.toFixed(2),
        periodDep: +periodDep.toFixed(2),
        closingDep: +closingAccDep.toFixed(2),
        netCurrent: +netCurrent.toFixed(2),
        netPrevious: +netPrevious.toFixed(2),
        hasPoolBalance,
        poolCodes,
      });

      gOpenGross += openingGross; gAdditions += additions; gDeletions += deletions;
      gCloseGross += closingGross; gOpenDep += openingDep; gPeriodDep += periodDep;
      gCloseDep += closingAccDep; gNetCurrent += netCurrent; gNetPrevious += netPrevious;
    }

    const grandTotal = {
      openingGross: +gOpenGross.toFixed(2), additions: +gAdditions.toFixed(2),
      deletions: +gDeletions.toFixed(2), closingGross: +gCloseGross.toFixed(2),
      openingDep: +gOpenDep.toFixed(2), periodDep: +gPeriodDep.toFixed(2),
      closingDep: +gCloseDep.toFixed(2), netCurrent: +gNetCurrent.toFixed(2),
      netPrevious: +gNetPrevious.toFixed(2),
    };

    if (exportFormat === "excel") {
      return await sendFixedAssetsScheduleExcel(res, rows, grandTotal, fiscalYear);
    }

    res.json({
      fiscalYear,
      fyLabel: `FY ${fiscalYear}-${String(fiscalYear + 1).slice(2)}`,
      fyStart: fyStart.toISOString().split("T")[0],
      fyEnd: fyEnd.toISOString().split("T")[0],
      rows,
      grandTotal,
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

    res.json({ data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    console.error("getConsolidatedAssetReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

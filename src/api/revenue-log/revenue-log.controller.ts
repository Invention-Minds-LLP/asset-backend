import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";

// ─── Prisma shorthand (models not yet in generated client) ──────────────────
const db = prisma as any;

// ─── Helpers ────────────────────────────────────────────────────────────────

const toNum = (v: any): number => (v == null ? 0 : Number(v));

/** Build a Date (midnight UTC) from a YYYY-MM-DD string */
const toDateOnly = (s: string): Date => {
  const d = new Date(s + "T00:00:00.000Z");
  if (isNaN(d.getTime())) throw new Error("Invalid date: " + s);
  return d;
};

/** Subtract N days from today (midnight UTC) */
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

const todayMidnight = (): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// ─── 1. GET /rate-card/:assetId ─────────────────────────────────────────────

export const getRateCard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const rateCard = await db.assetRateCard.findUnique({ where: { assetId } });
    if (!rateCard) { res.status(404).json({ message: "Rate card not found for this asset" }); return; }

    res.json(rateCard);
  } catch (err: any) {
    console.error("getRateCard error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 2. POST /rate-card/:assetId ────────────────────────────────────────────

export const upsertRateCard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const {
      revenuePerUnit, revenueUnit, currency,
      maxHoursPerDay, maxUsesPerDay, plannedHoursPerDay,
      operatingDaysPerWeek, shiftsPerDay, shiftDurationHours,
      targetUtilizationPct, targetOeeScore, qualityPassRatePct,
    } = req.body;

    const data: any = {};
    if (revenuePerUnit !== undefined) data.avgRevenuePerUnit = new Prisma.Decimal(revenuePerUnit);
    if (revenueUnit !== undefined) data.revenueUnit = revenueUnit;
    if (currency !== undefined) data.currency = currency;
    if (maxHoursPerDay !== undefined) data.maxHoursPerDay = new Prisma.Decimal(maxHoursPerDay);
    if (maxUsesPerDay !== undefined) data.maxUsesPerDay = maxUsesPerDay != null ? Number(maxUsesPerDay) : null;
    if (plannedHoursPerDay !== undefined) data.plannedHoursPerDay = new Prisma.Decimal(plannedHoursPerDay);
    if (operatingDaysPerWeek !== undefined) data.operatingDaysPerWeek = Number(operatingDaysPerWeek);
    if (shiftsPerDay !== undefined) data.shiftsPerDay = Number(shiftsPerDay);
    if (shiftDurationHours !== undefined) data.shiftDurationHours = new Prisma.Decimal(shiftDurationHours);
    if (targetUtilizationPct !== undefined) data.targetUtilizationPct = new Prisma.Decimal(targetUtilizationPct);
    if (targetOeeScore !== undefined) data.targetOeeScore = new Prisma.Decimal(targetOeeScore);
    if (qualityPassRatePct !== undefined) data.qualityPassRatePct = new Prisma.Decimal(qualityPassRatePct);

    const rateCard = await db.assetRateCard.upsert({
      where: { assetId },
      create: {
        assetId,
        avgRevenuePerUnit: data.revenuePerUnit ?? new Prisma.Decimal(0),
        revenueUnit: data.revenueUnit ?? "PER_USE",
        ...data,
        createdById: (req as any).user?.employeeDbId ?? null,
      },
      update: {
        avgRevenuePerUnit: data.revenuePerUnit,
        ...data
      },
    });

    res.json(rateCard);
  } catch (err: any) {
    console.error("upsertRateCard error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 3. GET /daily/:assetId ─────────────────────────────────────────────────

export const getDailyLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const skip = (page - 1) * limit;

    const where: any = { assetId };
    if (req.query.from || req.query.to) {
      where.logDate = {};
      if (req.query.from) where.logDate.gte = toDateOnly(req.query.from as string);
      if (req.query.to) where.logDate.lte = toDateOnly(req.query.to as string);
    }

    const [logs, total]: [any[], number] = await Promise.all([
      db.assetDailyUsageLog.findMany({
        where,
        orderBy: { logDate: "desc" },
        skip,
        take: limit,
        include: {
          loggedBy: { select: { id: true, name: true, employeeID: true } },
        },
      }),
      db.assetDailyUsageLog.count({ where }),
    ]);

    res.json({ data: logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error("getDailyLogs error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 4. POST /daily/:assetId ────────────────────────────────────────────────

export const upsertDailyLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const {
      logDate, hoursUsed, procedureCount, patientsServed,
      shift1Hours, shift2Hours, shift3Hours,
      revenueGenerated, downtimeHours, downtimeType, downtimeRemarks,
      conditionAfterUse, remarks,
    } = req.body;

    if (!logDate || hoursUsed == null) {
      res.status(400).json({ message: "logDate and hoursUsed are required" });
      return;
    }

    const parsedDate = toDateOnly(logDate);
    const hoursUsedNum = toNum(hoursUsed);
    const downtimeNum = toNum(downtimeHours);
    const procedureCountNum = procedureCount != null ? Number(procedureCount) : null;

    // Fetch rate card for auto-calculations
    const rateCard: any = await db.assetRateCard.findUnique({ where: { assetId } });

    const plannedHours = rateCard ? toNum(rateCard.plannedHoursPerDay) : 8;
    const qualityPctVal = rateCard ? toNum(rateCard.qualityPassRatePct) : 98;

    // Auto-calculate OEE components
    const availableHours = Math.max(plannedHours - downtimeNum, 0);
    const availabilityPct = plannedHours > 0
      ? Math.min((availableHours / plannedHours) * 100, 100)
      : 0;
    const performancePct = availableHours > 0
      ? Math.min((hoursUsedNum / availableHours) * 100, 100)
      : 0;
    const oeeScore = (availabilityPct * performancePct * qualityPctVal) / 10000;

    // Auto-calculate estimated revenue
    let estimatedRevenue: number | null = null;
    if (rateCard) {
      const rate = toNum(rateCard.avgRevenuePerUnit);
      const unit = rateCard.revenueUnit;
      if (unit === "PER_HOUR" || unit === "PER_DAY") {
        estimatedRevenue = hoursUsedNum * rate;
      } else if (
        (unit === "PER_USE" || unit === "PER_PROCEDURE" || unit === "PER_TEST") &&
        procedureCountNum != null
      ) {
        estimatedRevenue = procedureCountNum * rate;
      }
    }

    const loggedById = (req as any).user?.employeeDbId ?? null;

    const logData: any = {
      hoursUsed: new Prisma.Decimal(hoursUsedNum),
      procedureCount: procedureCountNum,
      patientsServed: patientsServed != null ? Number(patientsServed) : null,
      shift1Hours: shift1Hours != null ? new Prisma.Decimal(shift1Hours) : null,
      shift2Hours: shift2Hours != null ? new Prisma.Decimal(shift2Hours) : null,
      shift3Hours: shift3Hours != null ? new Prisma.Decimal(shift3Hours) : null,
      revenueGenerated: revenueGenerated != null ? new Prisma.Decimal(revenueGenerated) : null,
      estimatedRevenue: estimatedRevenue != null ? new Prisma.Decimal(estimatedRevenue) : null,
      downtimeHours: new Prisma.Decimal(downtimeNum),
      downtimeType: downtimeType ?? null,
      downtimeRemarks: downtimeRemarks ?? null,
      availabilityPct: new Prisma.Decimal(Math.round(availabilityPct * 100) / 100),
      performancePct: new Prisma.Decimal(Math.round(performancePct * 100) / 100),
      qualityPct: new Prisma.Decimal(qualityPctVal),
      oeeScore: new Prisma.Decimal(Math.round(oeeScore * 100) / 100),
      conditionAfterUse: conditionAfterUse ?? null,
      remarks: remarks ?? null,
      loggedById,
    };

    const log = await db.assetDailyUsageLog.upsert({
      where: { assetId_logDate: { assetId, logDate: parsedDate } },
      create: { assetId, logDate: parsedDate, ...logData },
      update: { ...logData, status: "LOGGED", verifiedById: null, verifiedAt: null },
    });

    res.json(log);
  } catch (err: any) {
    console.error("upsertDailyLog error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 5. DELETE /daily/:logId ────────────────────────────────────────────────

export const deleteDailyLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logId = Number(req.params.logId);
    if (isNaN(logId)) { res.status(400).json({ message: "Invalid logId" }); return; }

    const existing = await db.assetDailyUsageLog.findUnique({ where: { id: logId } });
    if (!existing) { res.status(404).json({ message: "Log entry not found" }); return; }

    await db.assetDailyUsageLog.delete({ where: { id: logId } });
    res.json({ message: "Log entry deleted" });
  } catch (err: any) {
    console.error("deleteDailyLog error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 6. PATCH /daily/:logId/verify ──────────────────────────────────────────

export const verifyDailyLog = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logId = Number(req.params.logId);
    if (isNaN(logId)) { res.status(400).json({ message: "Invalid logId" }); return; }

    const existing = await db.assetDailyUsageLog.findUnique({ where: { id: logId } });
    if (!existing) { res.status(404).json({ message: "Log entry not found" }); return; }

    const verifiedById = (req as any).user?.employeeDbId ?? null;

    const log = await db.assetDailyUsageLog.update({
      where: { id: logId },
      data: { status: "VERIFIED", verifiedById, verifiedAt: new Date() },
    });

    res.json(log);
  } catch (err: any) {
    console.error("verifyDailyLog error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 7. GET /utilization/:assetId ───────────────────────────────────────────

export const getUtilizationSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const rateCard: any = await db.assetRateCard.findUnique({ where: { assetId } });
    const plannedHours = rateCard ? toNum(rateCard.plannedHoursPerDay) : 8;
    const opDays = rateCard ? rateCard.operatingDaysPerWeek : 6;

    const today = todayMidnight();

    const buildWindow = async (days: number) => {
      const from = daysAgo(days);
      const logs: any[] = await db.assetDailyUsageLog.findMany({
        where: { assetId, logDate: { gte: from, lte: today } },
        select: {
          hoursUsed: true, procedureCount: true, revenueGenerated: true,
          estimatedRevenue: true, oeeScore: true, downtimeHours: true,
        },
      });

      const daysLogged = logs.length;
      const totalHours = logs.reduce((s: number, l: any) => s + toNum(l.hoursUsed), 0);
      const totalProcedures = logs.reduce((s: number, l: any) => s + (l.procedureCount ?? 0), 0);
      const totalRevenue = logs.reduce((s: number, l: any) => s + toNum(l.revenueGenerated) + toNum(l.estimatedRevenue), 0);
      const avgOee = daysLogged > 0 ? logs.reduce((s: number, l: any) => s + toNum(l.oeeScore), 0) / daysLogged : 0;
      const avgHoursPerDay = daysLogged > 0 ? totalHours / daysLogged : 0;
      const utilizationPct = plannedHours > 0 ? (avgHoursPerDay / plannedHours) * 100 : 0;
      // Expected operating days in the window
      const expectedDays = Math.round((days / 7) * opDays);
      const daysMissed = Math.max(expectedDays - daysLogged, 0);

      return {
        days, daysLogged, daysMissed,
        totalHours: Math.round(totalHours * 100) / 100,
        avgHoursPerDay: Math.round(avgHoursPerDay * 100) / 100,
        totalProcedures,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        avgOee: Math.round(avgOee * 100) / 100,
        utilizationPct: Math.round(utilizationPct * 100) / 100,
      };
    };

    const [w7, w15, w30] = await Promise.all([buildWindow(7), buildWindow(15), buildWindow(30)]);

    // Trend: compare current 30d vs previous 30d
    const prev30From = daysAgo(60);
    const prev30To = daysAgo(31);
    const prevLogs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId, logDate: { gte: prev30From, lte: prev30To } },
      select: { hoursUsed: true, procedureCount: true, revenueGenerated: true, estimatedRevenue: true, oeeScore: true },
    });
    const prevDaysLogged = prevLogs.length;
    const prevTotalHours = prevLogs.reduce((s: number, l: any) => s + toNum(l.hoursUsed), 0);
    const prevAvgHours = prevDaysLogged > 0 ? prevTotalHours / prevDaysLogged : 0;
    const prevTotalRevenue = prevLogs.reduce((s: number, l: any) => s + toNum(l.revenueGenerated) + toNum(l.estimatedRevenue), 0);
    const prevAvgOee = prevDaysLogged > 0 ? prevLogs.reduce((s: number, l: any) => s + toNum(l.oeeScore), 0) / prevDaysLogged : 0;

    const trend = {
      hoursChange: Math.round((w30.avgHoursPerDay - prevAvgHours) * 100) / 100,
      revenueChange: Math.round((w30.totalRevenue - prevTotalRevenue) * 100) / 100,
      oeeChange: Math.round((w30.avgOee - prevAvgOee) * 100) / 100,
      utilizationDirection: w30.avgHoursPerDay > prevAvgHours ? "UP" : w30.avgHoursPerDay < prevAvgHours ? "DOWN" : "FLAT",
    };

    res.json({ rateCard, windows: { "7d": w7, "15d": w15, "30d": w30 }, trend });
  } catch (err: any) {
    console.error("getUtilizationSummary error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 8. GET /oee/:assetId ───────────────────────────────────────────────────

export const getOeeDetail = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const from = daysAgo(30);
    const logs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId, logDate: { gte: from } },
      orderBy: { logDate: "asc" },
      select: {
        logDate: true, availabilityPct: true, performancePct: true,
        qualityPct: true, oeeScore: true,
      },
    });

    const count = logs.length;
    const avgAvailability = count > 0 ? logs.reduce((s: number, l: any) => s + toNum(l.availabilityPct), 0) / count : 0;
    const avgPerformance = count > 0 ? logs.reduce((s: number, l: any) => s + toNum(l.performancePct), 0) / count : 0;
    const avgQuality = count > 0 ? logs.reduce((s: number, l: any) => s + toNum(l.qualityPct), 0) / count : 0;
    const avgOee = count > 0 ? logs.reduce((s: number, l: any) => s + toNum(l.oeeScore), 0) / count : 0;

    let classification: string;
    if (avgOee >= 85) classification = "WORLD_CLASS";
    else if (avgOee >= 70) classification = "GOOD";
    else if (avgOee >= 55) classification = "AVERAGE";
    else classification = "POOR";

    // Identify biggest OEE detractor
    const components = [
      { name: "availability", value: avgAvailability },
      { name: "performance", value: avgPerformance },
      { name: "quality", value: avgQuality },
    ];
    components.sort((a, b) => a.value - b.value);
    const biggestDetractor = components[0];

    res.json({
      dailyOee: logs.map((l: any) => ({
        date: l.logDate,
        availability: toNum(l.availabilityPct),
        performance: toNum(l.performancePct),
        quality: toNum(l.qualityPct),
        oee: toNum(l.oeeScore),
      })),
      averages: {
        availability: Math.round(avgAvailability * 100) / 100,
        performance: Math.round(avgPerformance * 100) / 100,
        quality: Math.round(avgQuality * 100) / 100,
        oee: Math.round(avgOee * 100) / 100,
      },
      classification,
      biggestDetractor: { component: biggestDetractor.name, score: Math.round(biggestDetractor.value * 100) / 100 },
      daysAnalyzed: count,
    });
  } catch (err: any) {
    console.error("getOeeDetail error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 9. GET /revenue-summary/:assetId ───────────────────────────────────────

export const getRevenueSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const from = daysAgo(30);
    const logs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId, logDate: { gte: from } },
      orderBy: { logDate: "asc" },
      select: {
        logDate: true, hoursUsed: true, revenueGenerated: true,
        estimatedRevenue: true, downtimeHours: true,
      },
    });

    const rateCard: any = await db.assetRateCard.findUnique({ where: { assetId } });
    const ratePerUnit = rateCard ? toNum(rateCard.avgRevenuePerUnit) : 0;

    // Daily revenue
    const dailyRevenue = logs.map((l: any) => ({
      date: l.logDate,
      actual: toNum(l.revenueGenerated),
      estimated: toNum(l.estimatedRevenue),
      total: toNum(l.revenueGenerated) + toNum(l.estimatedRevenue),
    }));

    // Weekly aggregation
    const weeklyMap = new Map<string, { actual: number; estimated: number }>();
    logs.forEach((l: any) => {
      const d = new Date(l.logDate);
      const weekStart = new Date(d);
      weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const key = weekStart.toISOString().slice(0, 10);
      const existing = weeklyMap.get(key) || { actual: 0, estimated: 0 };
      existing.actual += toNum(l.revenueGenerated);
      existing.estimated += toNum(l.estimatedRevenue);
      weeklyMap.set(key, existing);
    });
    const weeklyRevenue = Array.from(weeklyMap.entries()).map(([weekStart, v]) => ({
      weekStart, actual: Math.round(v.actual * 100) / 100, estimated: Math.round(v.estimated * 100) / 100,
    }));

    // Monthly totals
    const totalActual = logs.reduce((s: number, l: any) => s + toNum(l.revenueGenerated), 0);
    const totalEstimated = logs.reduce((s: number, l: any) => s + toNum(l.estimatedRevenue), 0);
    const totalHours = logs.reduce((s: number, l: any) => s + toNum(l.hoursUsed), 0);
    const totalDowntime = logs.reduce((s: number, l: any) => s + toNum(l.downtimeHours), 0);

    const revenuePerHour = totalHours > 0 ? (totalActual + totalEstimated) / totalHours : 0;
    const revenueLossFromDowntime = totalDowntime * ratePerUnit;

    // Projected monthly revenue (based on avg daily over last 30d)
    const daysLogged = logs.length;
    const avgDailyRevenue = daysLogged > 0 ? (totalActual + totalEstimated) / daysLogged : 0;
    const projectedMonthlyRevenue = avgDailyRevenue * 30;

    res.json({
      dailyRevenue,
      weeklyRevenue,
      monthlyTotals: {
        actual: Math.round(totalActual * 100) / 100,
        estimated: Math.round(totalEstimated * 100) / 100,
        combined: Math.round((totalActual + totalEstimated) * 100) / 100,
      },
      revenuePerHour: Math.round(revenuePerHour * 100) / 100,
      revenueLossFromDowntime: Math.round(revenueLossFromDowntime * 100) / 100,
      totalDowntimeHours: Math.round(totalDowntime * 100) / 100,
      projectedMonthlyRevenue: Math.round(projectedMonthlyRevenue * 100) / 100,
      daysAnalyzed: daysLogged,
    });
  } catch (err: any) {
    console.error("getRevenueSummary error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 10. GET /dashboard ─────────────────────────────────────────────────────

export const getUtilizationDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const today = todayMidnight();
    const user = (req as any).user;

    // Department-based scoping for non-admin users
    let scopedAssetIds: number[] | undefined;
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      scopedAssetIds = deptAssets.map(a => a.id);
    }

    // Fetch rate cards for reference (scoped if non-admin)
    const rateCards: any[] = await db.assetRateCard.findMany(
      scopedAssetIds ? { where: { assetId: { in: scopedAssetIds } } } : undefined
    );
    const rateCardMap = new Map<number, any>(rateCards.map((rc: any) => [rc.assetId, rc]));

    // Aggregation helper: get logs for a window
    const getWindowAgg = async (days: number) => {
      const from = daysAgo(days);
      const logs: any[] = await db.assetDailyUsageLog.findMany({
        where: { logDate: { gte: from, lte: today }, ...(scopedAssetIds ? { assetId: { in: scopedAssetIds } } : {}) },
        select: { assetId: true, hoursUsed: true, oeeScore: true, revenueGenerated: true, estimatedRevenue: true },
      });

      // Group by assetId
      const byAsset = new Map<number, { hours: number; revenue: number; oeeSum: number; count: number }>();
      logs.forEach((l: any) => {
        const entry = byAsset.get(l.assetId) || { hours: 0, revenue: 0, oeeSum: 0, count: 0 };
        entry.hours += toNum(l.hoursUsed);
        entry.revenue += toNum(l.revenueGenerated) + toNum(l.estimatedRevenue);
        entry.oeeSum += toNum(l.oeeScore);
        entry.count += 1;
        byAsset.set(l.assetId, entry);
      });
      return byAsset;
    };

    const [agg7, agg15, agg30] = await Promise.all([getWindowAgg(7), getWindowAgg(15), getWindowAgg(30)]);

    // Fetch asset details for top/bottom lists
    const allAssetIds = Array.from(agg30.keys());
    const assets: any[] = allAssetIds.length > 0
      ? await prisma.asset.findMany({
          where: { id: { in: allAssetIds } },
          select: {
            id: true, assetId: true, assetName: true, departmentId: true,
            department: { select: { id: true, name: true } },
            assetCategory: { select: { id: true, name: true } },
          },
        })
      : [];
    const assetMap = new Map<number, any>(assets.map((a: any) => [a.id, a]));

    // Build ranked list from 30d aggregation
    const ranked = Array.from(agg30.entries()).map(([assetId, agg]) => {
      const asset = assetMap.get(assetId);
      const rc = rateCardMap.get(assetId);
      const plannedHours = rc ? toNum(rc.plannedHoursPerDay) : 8;
      const avgHours = agg.count > 0 ? agg.hours / agg.count : 0;
      const utilizationPct = plannedHours > 0 ? (avgHours / plannedHours) * 100 : 0;
      const avgOee = agg.count > 0 ? agg.oeeSum / agg.count : 0;
      const potentialRevenue = rc ? plannedHours * 30 * toNum(rc.avgRevenuePerUnit) : 0;
      const revenueLoss = Math.max(potentialRevenue - agg.revenue, 0);

      return {
        assetId: asset?.assetId ?? String(assetId),
        assetDbId: assetId,
        assetName: asset?.assetName ?? "Unknown",
        department: asset?.department?.name ?? null,
        departmentId: asset?.departmentId ?? null,
        category: asset?.assetCategory?.name ?? null,
        totalHours: Math.round(agg.hours * 100) / 100,
        totalRevenue: Math.round(agg.revenue * 100) / 100,
        utilizationPct: Math.round(utilizationPct * 100) / 100,
        avgOee: Math.round(avgOee * 100) / 100,
        revenueLoss: Math.round(revenueLoss * 100) / 100,
        daysLogged: agg.count,
      };
    });

    // Top 10 by hours
    const top10Utilized = [...ranked].sort((a, b) => b.totalHours - a.totalHours).slice(0, 10);
    // Top 10 revenue generators
    const top10Revenue = [...ranked].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 10);
    // Bottom 10 underutilized (with rate cards — meaningful comparison)
    const bottom10 = [...ranked]
      .filter((r) => rateCardMap.has(r.assetDbId))
      .sort((a, b) => a.utilizationPct - b.utilizationPct)
      .slice(0, 10);

    // Overall fleet OEE
    const allOeeValues = ranked.filter((r) => r.daysLogged > 0);
    const fleetOee = allOeeValues.length > 0
      ? allOeeValues.reduce((s: number, r) => s + r.avgOee, 0) / allOeeValues.length
      : 0;

    // Overall utilization for each window
    const calcOverallUtil = (agg: Map<number, any>) => {
      let totalUtil = 0; let count = 0;
      agg.forEach((v: any, assetId: number) => {
        const rc = rateCardMap.get(assetId);
        const planned = rc ? toNum(rc.plannedHoursPerDay) : 8;
        if (v.count > 0 && planned > 0) {
          totalUtil += ((v.hours / v.count) / planned) * 100;
          count++;
        }
      });
      return count > 0 ? Math.round((totalUtil / count) * 100) / 100 : 0;
    };

    // Department-wise breakdown from 30d
    const deptMap = new Map<string, { hours: number; revenue: number; oeeSum: number; count: number; assetCount: number }>();
    ranked.forEach((r) => {
      const dept = r.department ?? "Unassigned";
      const entry = deptMap.get(dept) || { hours: 0, revenue: 0, oeeSum: 0, count: 0, assetCount: 0 };
      entry.hours += r.totalHours;
      entry.revenue += r.totalRevenue;
      entry.oeeSum += r.avgOee;
      entry.count++;
      entry.assetCount++;
      deptMap.set(dept, entry);
    });
    const departmentBreakdown = Array.from(deptMap.entries()).map(([dept, v]) => ({
      department: dept,
      assetCount: v.assetCount,
      totalHours: Math.round(v.hours * 100) / 100,
      totalRevenue: Math.round(v.revenue * 100) / 100,
      avgOee: v.count > 0 ? Math.round((v.oeeSum / v.count) * 100) / 100 : 0,
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Assets with missing logs (no entry in last 3 days)
    const threeDaysAgo = daysAgo(3);
    const assetsWithRateCards = rateCards.map((rc: any) => rc.assetId);
    const recentLogs: any[] = assetsWithRateCards.length > 0
      ? await db.assetDailyUsageLog.findMany({
          where: { assetId: { in: assetsWithRateCards }, logDate: { gte: threeDaysAgo } },
          select: { assetId: true },
          distinct: ["assetId"],
        })
      : [];
    const recentlyLoggedIds = new Set(recentLogs.map((l: any) => l.assetId));
    const missingLogAssetIds = assetsWithRateCards.filter((id: number) => !recentlyLoggedIds.has(id));

    const missingLogAssets: any[] = missingLogAssetIds.length > 0
      ? await prisma.asset.findMany({
          where: { id: { in: missingLogAssetIds } },
          select: { id: true, assetId: true, assetName: true, department: { select: { name: true } } },
          take: 20,
        })
      : [];

    const totalRevenue30d = ranked.reduce((s, r) => s + r.totalRevenue, 0);

    res.json({
      top10Utilized,
      topRevenue: top10Revenue,
      underutilized: bottom10,
      fleetAvgOee: Math.round(fleetOee * 100) / 100,
      fleetUtilization: calcOverallUtil(agg30),
      totalRevenue30d: Math.round(totalRevenue30d * 100) / 100,
      assetsTracked: ranked.length,
      overallUtilization: {
        "7d": calcOverallUtil(agg7),
        "15d": calcOverallUtil(agg15),
        "30d": calcOverallUtil(agg30),
      },
      departmentBreakdown,
      missingLogAlerts: {
        count: missingLogAssets.length,
        assets: missingLogAssets.map((a: any) => ({
          assetDbId: a.id,
          assetId: a.assetId,
          assetName: a.assetName,
          department: a.department?.name ?? null,
        })),
      },
    });
  } catch (err: any) {
    console.error("getUtilizationDashboard error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 11. GET /missing-logs ──────────────────────────────────────────────────

export const getMissingLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.max(1, Number(req.query.days) || 3);
    const cutoff = daysAgo(days);
    const user = (req as any).user;

    // Department-based scoping for non-admin users
    let scopedAssetIds: number[] | undefined;
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      scopedAssetIds = deptAssets.map(a => a.id);
    }

    // All assets that have a rate card (i.e., expected to be tracked)
    const rateCards: any[] = await db.assetRateCard.findMany(
      scopedAssetIds
        ? { where: { assetId: { in: scopedAssetIds } }, select: { assetId: true } }
        : { select: { assetId: true } }
    );
    const trackedAssetIds: number[] = rateCards.map((rc: any) => rc.assetId);

    if (trackedAssetIds.length === 0) {
      res.json({ data: [], total: 0 });
      return;
    }

    // Find the most recent log for each tracked asset
    const latestLogs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId: { in: trackedAssetIds } },
      orderBy: { logDate: "desc" },
      distinct: ["assetId"],
      select: { assetId: true, logDate: true },
    });
    const lastLogMap = new Map<number, Date>(latestLogs.map((l: any) => [l.assetId, l.logDate]));

    // Assets that have no log at all or last log before cutoff
    const missingIds = trackedAssetIds.filter((id: number) => {
      const lastLog = lastLogMap.get(id);
      return !lastLog || lastLog < cutoff;
    });

    if (missingIds.length === 0) {
      res.json({ data: [], total: 0 });
      return;
    }

    const assets: any[] = await db.asset.findMany({
      where: { id: { in: missingIds } },
      select: {
        id: true, assetId: true, assetName: true,
        department: { select: { id: true, name: true } },
        assignments: {
          where: { status: "ACKNOWLEDGED" },
          select: { employee: { select: { id: true, name: true, employeeID: true } } },
          take: 1,
        },
      },
    });

    const today = todayMidnight();
    const result = assets.map((a: any) => {
      const lastLog = lastLogMap.get(a.id);
      const daysSinceLastLog = lastLog
        ? Math.floor((today.getTime() - new Date(lastLog).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const assignee = a.assignments?.[0]?.employee ?? null;
      return {
        assetDbId: a.id,
        assetId: a.assetId,
        assetName: a.assetName,
        department: a.department?.name ?? null,
        departmentId: a.department?.id ?? null,
        lastLogDate: lastLog ?? null,
        daysSinceLastLog,
        assignedTo: assignee
          ? { id: assignee.id, employeeID: assignee.employeeID, name: assignee.name }
          : null,
      };
    }).sort((a: any, b: any) => (b.daysSinceLastLog ?? 999) - (a.daysSinceLastLog ?? 999));

    res.json({ data: result, total: result.length });
  } catch (err: any) {
    console.error("getMissingLogs error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 12. GET /downtime-analysis/:assetId ────────────────────────────────────

export const getDowntimeAnalysis = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const rateCard: any = await db.assetRateCard.findUnique({ where: { assetId } });
    const ratePerUnit = rateCard ? toNum(rateCard.avgRevenuePerUnit) : 0;

    const from = daysAgo(30);
    const logs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId, logDate: { gte: from }, downtimeHours: { gt: 0 } },
      orderBy: { logDate: "asc" },
      select: { logDate: true, downtimeHours: true, downtimeType: true },
    });

    // Group by downtime type
    const byType = new Map<string, { totalHours: number; occurrences: number; dates: Date[] }>();
    logs.forEach((l: any) => {
      const type = l.downtimeType ?? "UNSPECIFIED";
      const entry = byType.get(type) || { totalHours: 0, occurrences: 0, dates: [] };
      entry.totalHours += toNum(l.downtimeHours);
      entry.occurrences += 1;
      entry.dates.push(l.logDate);
      byType.set(type, entry);
    });

    const breakdown = Array.from(byType.entries()).map(([type, v]) => ({
      type,
      totalHours: Math.round(v.totalHours * 100) / 100,
      occurrences: v.occurrences,
      revenueImpact: Math.round(v.totalHours * ratePerUnit * 100) / 100,
    })).sort((a, b) => b.totalHours - a.totalHours);

    const totalDowntime = logs.reduce((s: number, l: any) => s + toNum(l.downtimeHours), 0);
    const totalRevenueImpact = totalDowntime * ratePerUnit;

    // Trend: compare first 15 days vs last 15 days
    const midpoint = daysAgo(15);
    const firstHalf = logs.filter((l: any) => l.logDate < midpoint);
    const secondHalf = logs.filter((l: any) => l.logDate >= midpoint);
    const firstHalfHours = firstHalf.reduce((s: number, l: any) => s + toNum(l.downtimeHours), 0);
    const secondHalfHours = secondHalf.reduce((s: number, l: any) => s + toNum(l.downtimeHours), 0);

    let trend: string;
    if (secondHalfHours > firstHalfHours * 1.1) trend = "INCREASING";
    else if (secondHalfHours < firstHalfHours * 0.9) trend = "DECREASING";
    else trend = "STABLE";

    res.json({
      breakdown,
      totalDowntimeHours: Math.round(totalDowntime * 100) / 100,
      totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
      trend,
      trendDetail: {
        firstHalfHours: Math.round(firstHalfHours * 100) / 100,
        secondHalfHours: Math.round(secondHalfHours * 100) / 100,
      },
      daysWithDowntime: logs.length,
    });
  } catch (err: any) {
    console.error("getDowntimeAnalysis error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 13. GET /leaderboard ───────────────────────────────────────────────────

export const getLeaderboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const period = Math.min(90, Math.max(7, Number(req.query.period) || 30));
    const user = (req as any).user;
    let departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;

    // Department-based scoping for non-admin users
    if (user?.role !== "ADMIN" && user?.departmentId && !departmentId) {
      departmentId = Number(user.departmentId);
    }

    const from = daysAgo(period);
    const today = todayMidnight();

    // Fetch rate cards with asset info
    const assetsWithCards: any[] = await db.assetRateCard.findMany({
      include: {
        asset: {
          select: {
            id: true, assetId: true, assetName: true, departmentId: true,
            department: { select: { name: true } },
            assetCategory: { select: { name: true } },
          },
        },
      },
      ...(departmentId ? { where: { asset: { departmentId } } } : {}),
    });

    const assetIds: number[] = assetsWithCards.map((rc: any) => rc.assetId);

    const logs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId: { in: assetIds }, logDate: { gte: from, lte: today } },
      select: {
        assetId: true, hoursUsed: true, oeeScore: true,
        revenueGenerated: true, estimatedRevenue: true,
      },
    });

    // Aggregate per asset
    const aggMap = new Map<number, { hours: number; oeeSum: number; revenue: number; count: number }>();
    logs.forEach((l: any) => {
      const e = aggMap.get(l.assetId) || { hours: 0, oeeSum: 0, revenue: 0, count: 0 };
      e.hours += toNum(l.hoursUsed);
      e.oeeSum += toNum(l.oeeScore);
      e.revenue += toNum(l.revenueGenerated) + toNum(l.estimatedRevenue);
      e.count += 1;
      aggMap.set(l.assetId, e);
    });

    const leaderboard = assetsWithCards.map((rc: any) => {
      const agg = aggMap.get(rc.assetId);
      const avgOee = agg && agg.count > 0 ? agg.oeeSum / agg.count : 0;
      const avgHours = agg && agg.count > 0 ? agg.hours / agg.count : 0;
      const plannedHours = toNum(rc.plannedHoursPerDay);
      const utilizationPct = plannedHours > 0 ? (avgHours / plannedHours) * 100 : 0;

      return {
        assetDbId: rc.assetId,
        assetId: rc.asset.assetId,
        assetName: rc.asset.assetName,
        category: rc.asset.assetCategory?.name ?? null,
        department: rc.asset.department?.name ?? null,
        avgOee: Math.round(avgOee * 100) / 100,
        utilizationPct: Math.round(utilizationPct * 100) / 100,
        totalRevenue: Math.round((agg?.revenue ?? 0) * 100) / 100,
        totalHours: Math.round((agg?.hours ?? 0) * 100) / 100,
        daysLogged: agg?.count ?? 0,
      };
    })
    .sort((a: any, b: any) => b.avgOee - a.avgOee)
    .map((item: any, idx: number) => ({ rank: idx + 1, ...item }));

    res.json({ period, data: leaderboard, total: leaderboard.length });
  } catch (err: any) {
    console.error("getLeaderboard error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

// ─── 14. GET /shift-analysis/:assetId ───────────────────────────────────────

export const getShiftAnalysis = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) { res.status(400).json({ message: "Invalid assetId" }); return; }

    const from = daysAgo(30);
    const logs: any[] = await db.assetDailyUsageLog.findMany({
      where: { assetId, logDate: { gte: from } },
      orderBy: { logDate: "asc" },
      select: {
        logDate: true, shift1Hours: true, shift2Hours: true, shift3Hours: true,
        hoursUsed: true, revenueGenerated: true, estimatedRevenue: true,
      },
    });

    const count = logs.length;
    let totalShift1 = 0, totalShift2 = 0, totalShift3 = 0;
    let totalHours = 0, totalRevenue = 0;

    logs.forEach((l: any) => {
      totalShift1 += toNum(l.shift1Hours);
      totalShift2 += toNum(l.shift2Hours);
      totalShift3 += toNum(l.shift3Hours);
      totalHours += toNum(l.hoursUsed);
      totalRevenue += toNum(l.revenueGenerated) + toNum(l.estimatedRevenue);
    });

    const shiftTotalCombined = totalShift1 + totalShift2 + totalShift3;

    // Revenue distribution by shift (proportional to hours)
    const shift1RevenuePct = shiftTotalCombined > 0 ? (totalShift1 / shiftTotalCombined) * 100 : 0;
    const shift2RevenuePct = shiftTotalCombined > 0 ? (totalShift2 / shiftTotalCombined) * 100 : 0;
    const shift3RevenuePct = shiftTotalCombined > 0 ? (totalShift3 / shiftTotalCombined) * 100 : 0;

    const shifts = [
      { shift: "Shift 1 (Morning)", totalHours: Math.round(totalShift1 * 100) / 100, avgHoursPerDay: count > 0 ? Math.round((totalShift1 / count) * 100) / 100 : 0, revenuePct: Math.round(shift1RevenuePct * 100) / 100, estimatedRevenue: Math.round(totalRevenue * shift1RevenuePct / 100 * 100) / 100 },
      { shift: "Shift 2 (Afternoon)", totalHours: Math.round(totalShift2 * 100) / 100, avgHoursPerDay: count > 0 ? Math.round((totalShift2 / count) * 100) / 100 : 0, revenuePct: Math.round(shift2RevenuePct * 100) / 100, estimatedRevenue: Math.round(totalRevenue * shift2RevenuePct / 100 * 100) / 100 },
      { shift: "Shift 3 (Night)", totalHours: Math.round(totalShift3 * 100) / 100, avgHoursPerDay: count > 0 ? Math.round((totalShift3 / count) * 100) / 100 : 0, revenuePct: Math.round(shift3RevenuePct * 100) / 100, estimatedRevenue: Math.round(totalRevenue * shift3RevenuePct / 100 * 100) / 100 },
    ];

    // Identify highest and lowest utilized shifts
    const sortedShifts = [...shifts].sort((a, b) => b.totalHours - a.totalHours);
    const highestShift = sortedShifts[0].totalHours > 0 ? sortedShifts[0].shift : null;
    const lowestShift = sortedShifts[sortedShifts.length - 1].totalHours >= 0 ? sortedShifts[sortedShifts.length - 1].shift : null;

    // Daily breakdown for charting
    const dailyBreakdown = logs.map((l: any) => ({
      date: l.logDate,
      shift1: toNum(l.shift1Hours),
      shift2: toNum(l.shift2Hours),
      shift3: toNum(l.shift3Hours),
    }));

    res.json({
      shifts,
      highestUtilizedShift: highestShift,
      lowestUtilizedShift: lowestShift,
      dailyBreakdown,
      daysAnalyzed: count,
      totalHoursAllShifts: Math.round(shiftTotalCombined * 100) / 100,
      totalAssetHours: Math.round(totalHours * 100) / 100,
    });
  } catch (err: any) {
    console.error("getShiftAnalysis error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

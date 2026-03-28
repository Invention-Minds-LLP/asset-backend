import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

export const addDepreciation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
    //    res.status(403).json({ message: "Not allowed" });
    //    return;
    // }

    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    const {
      assetId,
      depreciationMethod,
      depreciationRate,
      expectedLifeYears,
      salvageValue,
      depreciationStart,
      depreciationFrequency,
    } = req.body;

    if (!assetId || !depreciationMethod || !expectedLifeYears || !depreciationStart) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return
    }

    const cost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
    if (!cost || cost <= 0) {
      res.status(400).json({ message: "Asset cost is missing (purchaseCost/estimatedValue)" });
      return;
    }

    const existing = await prisma.assetDepreciation.findUnique({
      where: { assetId: Number(assetId) }
    });
    if (existing) {
      res.status(400).json({ message: "Depreciation already exists for asset" });
      return;
    }

    const depreciation = await prisma.assetDepreciation.create({
      data: {
        assetId: Number(assetId),
        depreciationMethod,
        depreciationRate: depreciationRate != null ? String(depreciationRate) : "0",
        expectedLifeYears: Number(expectedLifeYears),
        salvageValue: salvageValue != null && salvageValue !== "" ? String(salvageValue) : null,
        depreciationStart: new Date(depreciationStart),

        depreciationFrequency: depreciationFrequency || "YEARLY",
        accumulatedDepreciation: "0",
        currentBookValue: String(cost),
        lastCalculatedAt: null,

        createdById: employeeId,
        updatedById: employeeId,
        isActive: true,
      }
    });

    res.status(201).json(depreciation);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add depreciation" });
  }
};
export const updateDepreciation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // if (req.user.role !== "superadmin") {
    //    res.status(403).json({ message: "Admins only" });
    //    return;
    // }

    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    const id = parseInt(req.params.id);
    const data = req.body;

    const updated = await prisma.assetDepreciation.update({
      where: { id },
      data: {
        depreciationMethod: data.depreciationMethod,
        depreciationRate: data.depreciationRate != null ? String(data.depreciationRate) : undefined,
        expectedLifeYears: data.expectedLifeYears != null ? Number(data.expectedLifeYears) : undefined,
        salvageValue: data.salvageValue != null && data.salvageValue !== "" ? String(data.salvageValue) : null,
        depreciationStart: data.depreciationStart ? new Date(data.depreciationStart) : undefined,
        depreciationFrequency: data.depreciationFrequency ?? undefined,
        isActive: data.isActive ?? undefined,
        updatedById: employeeId,
      }
    });

    res.json(updated);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed updating depreciation" });
  }
};
export const calculateDepreciation = async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const asset = await prisma.asset.findUnique({
      where: { id: parseInt(assetId) },
      include: { depreciation: true }
    });

    if (!asset || !asset.depreciation) {
      res.status(404).json({ message: "Depreciation not found" });
      return;
    }

    const dep = asset.depreciation;

    // ✅ Convert Decimal → number safely
    const cost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
    const salvage = Number(dep.salvageValue ?? 0);
    const life = dep.expectedLifeYears || 1; // avoid divide by 0
    const rate = Number(dep.depreciationRate ?? 0);
    const method = dep.depreciationMethod;

    const start = new Date(dep.depreciationStart);
    const today = new Date();

    const diffYears =
      (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365);

    let depreciationTillDate = 0;
    let bookValue = cost;

    // =========================
    // STRAIGHT LINE (SL)
    // =========================
    if (method === "SL") {
      const annual = (cost - salvage) / life;

      depreciationTillDate = Math.min(
        annual * diffYears,
        cost - salvage
      );

      bookValue = cost - depreciationTillDate;
    }

    // =========================
    // DECLINING BALANCE (DB)
    // =========================
    else if (method === "DB") {
      bookValue = cost * Math.pow((1 - rate / 100), diffYears);
      depreciationTillDate = cost - bookValue;
    }

    // =========================
    // SAFETY FIXES
    // =========================
    if (bookValue < salvage) {
      bookValue = salvage;
    }

    if (depreciationTillDate < 0) {
      depreciationTillDate = 0;
    }

    await prisma.assetDepreciation.update({
      where: { assetId: asset.id },
      data: {
        accumulatedDepreciation: depreciationTillDate,
        currentBookValue: bookValue,
        lastCalculatedAt: new Date()
      }
    });

    res.json({
      assetId,
      depreciationMethod: method,
      purchaseCost: cost,
      salvageValue: salvage,
      depreciationTillDate: Number(depreciationTillDate.toFixed(2)),
      bookValue: Number(bookValue.toFixed(2)),
      yearsUsed: Number(diffYears.toFixed(2))
    });

    return;

  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      message: "Error calculating depreciation",
      error: err.message
    });

    return;
  }
};

function monthsDiff(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export const runDepreciationForAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {

    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    const assetId = Number(req.params.assetId);

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      include: { depreciation: true },
    });
    if (!asset || !asset.depreciation) {
      res.status(404).json({ message: "Depreciation not found" });
      return;
    }

    const dep = asset.depreciation;
    if (!dep.isActive) {
      res.status(400).json({ message: "Depreciation is inactive" });
      return;
    }

    const cost = Number(asset.purchaseCost ?? asset.estimatedValue ?? 0);
    const salvage = Number(dep.salvageValue ?? 0);
    const lifeYears = dep.expectedLifeYears;
    const rate = Number(dep.depreciationRate ?? 0);
    const method = dep.depreciationMethod;

    const start = new Date(dep.depreciationStart);
    const today = new Date();

    // decide next periodStart
    const last = dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : start;

    let periodStart = last;
    let periodEnd: Date;

    if ((dep.depreciationFrequency || "YEARLY") === "MONTHLY") {
      periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd = new Date(periodStart);
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    // don’t run into future
    if (periodEnd > today) {
      res.status(400).json({ message: "Next depreciation period not reached yet" });
      return;
    }

    // current values
    const prevBook = Number(dep.currentBookValue ?? cost);
    const prevAccum = Number(dep.accumulatedDepreciation ?? 0);

    let depreciationAmount = 0;

    if (method === "SL") {
      const annual = (cost - salvage) / lifeYears;
      depreciationAmount = (dep.depreciationFrequency === "MONTHLY") ? annual / 12 : annual;
    } else if (method === "DB") {
      // simple declining balance per period
      const periodRate = (dep.depreciationFrequency === "MONTHLY") ? (rate / 100) / 12 : (rate / 100);
      depreciationAmount = prevBook * periodRate;
    } else {
      res.status(400).json({ message: "Unsupported depreciation method" });
      return;
    }

    // don’t depreciate below salvage
    const maxAllowed = Math.max(0, prevBook - salvage);
    depreciationAmount = Math.min(depreciationAmount, maxAllowed);

    const newBook = Number((prevBook - depreciationAmount).toFixed(2));
    const newAccum = Number((prevAccum + depreciationAmount).toFixed(2));

    const result = await prisma.$transaction(async (tx) => {
      const log = await tx.depreciationLog.create({
        data: {
          assetId,
          periodStart,
          periodEnd,
          depreciationAmount: String(depreciationAmount.toFixed(2)),
          bookValueAfter: String(newBook.toFixed(2)),
          doneById: employeeId,
          reason: "SYSTEM_RUN",
        }
      });

      const updated = await tx.assetDepreciation.update({
        where: { id: dep.id },
        data: {
          accumulatedDepreciation: String(newAccum.toFixed(2)),
          currentBookValue: String(newBook.toFixed(2)),
          lastCalculatedAt: periodEnd,
          updatedById: employeeId,
        }
      });

      return { log, updated };
    });

    res.json({ message: "Depreciation applied", ...result });
    return;

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to run depreciation" });
    return;
  }
};

// ─── Batch Depreciation Preview ──────────────────────────────────────────────
// Shows what would happen if batch depreciation runs, without applying changes
export const batchDepreciationPreview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const depreciations = await prisma.assetDepreciation.findMany({
      where: { isActive: true },
      include: { asset: { select: { id: true, assetId: true, assetName: true, purchaseCost: true, estimatedValue: true } } },
    });

    const today = new Date();
    const preview: any[] = [];

    for (const dep of depreciations) {
      const cost = Number(dep.asset.purchaseCost ?? dep.asset.estimatedValue ?? 0);
      const salvage = Number(dep.salvageValue ?? 0);
      const lifeYears = dep.expectedLifeYears;
      const rate = Number(dep.depreciationRate ?? 0);
      const method = dep.depreciationMethod;

      const last = dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : new Date(dep.depreciationStart);
      let periodEnd: Date;

      if ((dep.depreciationFrequency || "YEARLY") === "MONTHLY") {
        periodEnd = new Date(last);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      } else {
        periodEnd = new Date(last);
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      }

      // Skip if period not reached
      if (periodEnd > today) continue;

      const prevBook = Number(dep.currentBookValue ?? cost);
      let depreciationAmount = 0;

      if (method === "SL") {
        const annual = (cost - salvage) / lifeYears;
        depreciationAmount = dep.depreciationFrequency === "MONTHLY" ? annual / 12 : annual;
      } else if (method === "DB") {
        const periodRate = dep.depreciationFrequency === "MONTHLY" ? (rate / 100) / 12 : (rate / 100);
        depreciationAmount = prevBook * periodRate;
      }

      const maxAllowed = Math.max(0, prevBook - salvage);
      depreciationAmount = Math.min(depreciationAmount, maxAllowed);

      if (depreciationAmount <= 0) continue;

      const newBook = Number((prevBook - depreciationAmount).toFixed(2));

      preview.push({
        assetId: dep.asset.id,
        assetCode: dep.asset.assetId,
        assetName: dep.asset.assetName,
        method,
        frequency: dep.depreciationFrequency || "YEARLY",
        previousBookValue: prevBook,
        depreciationAmount: Number(depreciationAmount.toFixed(2)),
        newBookValue: newBook,
        salvageValue: salvage,
        periodStart: last,
        periodEnd,
      });
    }

    res.json({
      message: `${preview.length} assets eligible for depreciation`,
      totalDepreciation: Number(preview.reduce((sum, p) => sum + p.depreciationAmount, 0).toFixed(2)),
      preview,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate preview" });
  }
};

// ─── Batch Depreciation Run (all eligible assets) ────────────────────────────
export const runBatchDepreciation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    const depreciations = await prisma.assetDepreciation.findMany({
      where: { isActive: true },
      include: { asset: { select: { id: true, assetId: true, assetName: true, purchaseCost: true, estimatedValue: true } } },
    });

    const today = new Date();
    const results: any[] = [];
    const errors: any[] = [];

    for (const dep of depreciations) {
      try {
        const cost = Number(dep.asset.purchaseCost ?? dep.asset.estimatedValue ?? 0);
        const salvage = Number(dep.salvageValue ?? 0);
        const lifeYears = dep.expectedLifeYears;
        const rate = Number(dep.depreciationRate ?? 0);
        const method = dep.depreciationMethod;

        const last = dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : new Date(dep.depreciationStart);
        let periodEnd: Date;

        if ((dep.depreciationFrequency || "YEARLY") === "MONTHLY") {
          periodEnd = new Date(last);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        } else {
          periodEnd = new Date(last);
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        }

        if (periodEnd > today) continue;

        const prevBook = Number(dep.currentBookValue ?? cost);
        const prevAccum = Number(dep.accumulatedDepreciation ?? 0);
        let depreciationAmount = 0;

        if (method === "SL") {
          const annual = (cost - salvage) / lifeYears;
          depreciationAmount = dep.depreciationFrequency === "MONTHLY" ? annual / 12 : annual;
        } else if (method === "DB") {
          const periodRate = dep.depreciationFrequency === "MONTHLY" ? (rate / 100) / 12 : (rate / 100);
          depreciationAmount = prevBook * periodRate;
        } else {
          continue;
        }

        const maxAllowed = Math.max(0, prevBook - salvage);
        depreciationAmount = Math.min(depreciationAmount, maxAllowed);
        if (depreciationAmount <= 0) continue;

        const newBook = Number((prevBook - depreciationAmount).toFixed(2));
        const newAccum = Number((prevAccum + depreciationAmount).toFixed(2));

        await prisma.$transaction(async (tx) => {
          await tx.depreciationLog.create({
            data: {
              assetId: dep.asset.id,
              periodStart: last,
              periodEnd,
              depreciationAmount: String(depreciationAmount.toFixed(2)),
              bookValueAfter: String(newBook.toFixed(2)),
              doneById: employeeId,
              reason: "BATCH_RUN",
            },
          });

          await tx.assetDepreciation.update({
            where: { id: dep.id },
            data: {
              accumulatedDepreciation: String(newAccum.toFixed(2)),
              currentBookValue: String(newBook.toFixed(2)),
              lastCalculatedAt: periodEnd,
              updatedById: employeeId,
            },
          });
        });

        results.push({
          assetId: dep.asset.assetId,
          assetName: dep.asset.assetName,
          depreciationAmount: Number(depreciationAmount.toFixed(2)),
          newBookValue: newBook,
        });
      } catch (assetErr: any) {
        errors.push({ assetId: dep.asset.assetId, error: assetErr.message });
      }
    }

    res.json({
      message: `Batch depreciation completed. ${results.length} assets processed.`,
      totalDepreciation: Number(results.reduce((sum, r) => sum + r.depreciationAmount, 0).toFixed(2)),
      processed: results.length,
      errors: errors.length,
      results,
      errorDetails: errors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to run batch depreciation" });
  }
};

// ─── Get All Depreciations (standalone page) ─────────────────────────────────
export const getAllDepreciations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { method, frequency, page = "1", limit = "25", search, exportCsv } = req.query;

    const where: any = {};
    if (method) where.depreciationMethod = String(method);
    if (frequency) where.depreciationFrequency = String(frequency);
    if (search) {
      where.asset = {
        OR: [
          { assetId: { contains: String(search) } },
          { assetName: { contains: String(search) } },
        ],
      };
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, depreciations] = await Promise.all([
      prisma.assetDepreciation.count({ where }),
      prisma.assetDepreciation.findMany({
        where,
        include: {
          asset: { select: { id: true, assetId: true, assetName: true, purchaseCost: true, estimatedValue: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = depreciations.map((d: any) => ({
        AssetId: d.asset?.assetId || "",
        AssetName: d.asset?.assetName || "",
        Method: d.depreciationMethod,
        Rate: Number(d.depreciationRate),
        LifeYears: d.expectedLifeYears,
        SalvageValue: d.salvageValue ? Number(d.salvageValue) : "",
        AccumulatedDepreciation: d.accumulatedDepreciation ? Number(d.accumulatedDepreciation) : "",
        CurrentBookValue: d.currentBookValue ? Number(d.currentBookValue) : "",
        Frequency: d.depreciationFrequency || "",
        LastCalculated: d.lastCalculatedAt ? new Date(d.lastCalculatedAt).toISOString().split("T")[0] : "",
        IsActive: d.isActive ? "Yes" : "No",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=depreciations.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: depreciations, total, page: parseInt(String(page)), limit: take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch depreciations" });
  }
};

// ─── Get Depreciation Logs ───────────────────────────────────────────────────
export const getDepreciationLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assetId, page = "1", limit = "25" } = req.query;

    const where: any = {};
    if (assetId) where.assetId = Number(assetId);

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, logs] = await Promise.all([
      prisma.depreciationLog.count({ where }),
      prisma.depreciationLog.findMany({
        where,
        include: {
          asset: { select: { assetId: true, assetName: true } },
          doneBy: { select: { name: true, employeeID: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({ data: logs, total, page: parseInt(String(page)), limit: take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch depreciation logs" });
  }
};

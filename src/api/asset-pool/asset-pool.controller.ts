import { Request, Response } from "express";
import fs from "fs";
import XLSX from "xlsx";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { generateLegacyAssetId } from "../../utilis/assetIdGenerator";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generatePoolCode(financialYear: string, departmentId?: number | null): Promise<string> {
    let deptCode = "GEN";
    if (departmentId) {
        const dept = await prisma.department.findUnique({ where: { id: departmentId } });
        if ((dept as any)?.code) deptCode = (dept as any).code.toUpperCase();
        else if (dept?.name) deptCode = dept.name.slice(0, 6).toUpperCase().replace(/\s+/g, "");
    }
    const prefix = `POOL-${deptCode}-${financialYear}-`;
    const existing = await prisma.assetPool.findMany({
        where: { poolCode: { startsWith: prefix } },
        select: { poolCode: true },
    });
    let maxSeq = 0;
    for (const row of existing) {
        const seq = parseInt(row.poolCode.slice(prefix.length), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
    return `${prefix}${(maxSeq + 1).toString().padStart(3, "0")}`;
}

/** Fetch linked assets with depreciation for a pool — used in multiple endpoints */
async function getLinkedAssets(poolId: number) {
    return prisma.asset.findMany({
        where: { assetPoolId: poolId },
        select: {
            id: true, assetId: true, assetName: true, purchaseCost: true,
            status: true, financialYearAdded: true, createdAt: true,
            depreciation: { select: { accumulatedDepreciation: true } },
        },
    });
}

/** Latest depreciation schedule for a pool */
async function getLatestSchedule(poolId: number) {
    const schedules = await prisma.assetPoolDepreciationSchedule.findMany({
        where: { poolId },
        orderBy: { financialYearEnd: "desc" },
        take: 1,
    });
    return schedules[0] ?? null;
}

// ─── GET /asset-pool ──────────────────────────────────────────────────────────
export const listPools = async (_req: Request, res: Response): Promise<void> => {
    try {
        const pools = await prisma.assetPool.findMany({
            include: {
                category: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
                depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 },
            },
            orderBy: { createdAt: "desc" },
        });

        const result = await Promise.all(pools.map(async (pool) => {
            const linked = await getLinkedAssets(pool.id);
            const individualizedCount = linked.length;
            const allocatedCost = linked.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
            const totalPoolCost = Number(pool.totalPoolCost ?? 0);
            const latestSched = (pool as any).depreciationSchedules?.[0] ?? null;

            return {
                id: pool.id,
                poolCode: pool.poolCode,
                financialYear: pool.financialYear,
                category: pool.category?.name ?? null,
                categoryId: pool.categoryId,
                department: pool.department?.name ?? null,
                departmentId: pool.departmentId,
                description: pool.description,
                originalQuantity: pool.originalQuantity,
                individualizedCount,
                remainingQuantity: Math.max(0, pool.originalQuantity - individualizedCount),
                digitizationPct: pool.originalQuantity > 0
                    ? Math.round((individualizedCount / pool.originalQuantity) * 100)
                    : 0,
                totalPoolCost,
                allocatedCost,
                unallocatedCost: totalPoolCost - allocatedCost,
                latestNetBlock: latestSched ? Number(latestSched.closingNetBlock) : null,
                latestGrossBlock: latestSched ? Number(latestSched.closingGrossBlock) : null,
                latestFY: latestSched?.financialYear ?? null,
                status: pool.status,
                notes: pool.notes,
                createdAt: pool.createdAt,
                updatedAt: pool.updatedAt,
            };
        }));

        res.json(result);
    } catch (err) {
        console.error("listPools error:", err);
        res.status(500).json({ message: "Failed to fetch asset pools" });
    }
};

// ─── POST /asset-pool ─────────────────────────────────────────────────────────
export const createPool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const {
            financialYear, categoryId, categoryName, departmentId, departmentName,
            description, originalQuantity, totalPoolCost, notes,
        } = req.body;

        if (!financialYear) {
            res.status(400).json({ message: "financialYear is required" });
            return;
        }

        // Resolve category — by ID or by name (create if missing)
        let resolvedCategoryId: number | null = categoryId ? Number(categoryId) : null;
        if (!resolvedCategoryId && categoryName) {
            const trimmed = String(categoryName).trim();
            let cat = await prisma.assetCategory.findFirst({
                where: { name: trimmed },
            });
            if (!cat) cat = await prisma.assetCategory.create({ data: { name: trimmed } });
            resolvedCategoryId = cat.id;
        }

        // Resolve department — by ID or by name
        let resolvedDepartmentId: number | null = departmentId ? Number(departmentId) : null;
        if (!resolvedDepartmentId && departmentName) {
            const dept = await prisma.department.findFirst({
                where: { name: String(departmentName).trim() },
            });
            if (dept) resolvedDepartmentId = dept.id;
        }

        const poolCode = await generatePoolCode(String(financialYear).trim(), resolvedDepartmentId);

        const pool = await prisma.assetPool.create({
            data: {
                poolCode,
                financialYear: String(financialYear).trim(),
                categoryId: resolvedCategoryId,
                departmentId: resolvedDepartmentId,
                description: description ?? null,
                originalQuantity: Number(originalQuantity ?? 0),
                totalPoolCost: totalPoolCost != null ? totalPoolCost : null,
                status: "PENDING",
                notes: notes ?? null,
                createdById: (req.user as any)?.employeeDbId ?? null,
            } as any,
        });

        res.status(201).json(pool);
    } catch (err) {
        console.error("createPool error:", err);
        res.status(500).json({ message: "Failed to create asset pool" });
    }
};

// ─── GET /asset-pool/summary ──────────────────────────────────────────────────
export const getPoolSummary = async (_req: Request, res: Response): Promise<void> => {
    try {
        const pools = await prisma.assetPool.findMany({
            select: { id: true, status: true, originalQuantity: true, totalPoolCost: true },
        });

        let totalPools = pools.length, completePools = 0, partialPools = 0, pendingPools = 0;
        let totalUndigitizedAssets = 0, totalUnallocatedCost = 0;
        let totalPoolGrossBlock = 0, totalPoolNetBlock = 0;

        for (const pool of pools) {
            if (pool.status === "COMPLETE") completePools++;
            else if (pool.status === "PARTIAL") partialPools++;
            else pendingPools++;

            const linked = await prisma.asset.findMany({
                where: { assetPoolId: pool.id },
                select: { purchaseCost: true },
            });
            const linkedCount = linked.length;
            const allocatedCost = linked.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
            totalUndigitizedAssets += Math.max(0, pool.originalQuantity - linkedCount);
            totalUnallocatedCost += Math.max(0, Number(pool.totalPoolCost ?? 0) - allocatedCost);

            // Latest schedule for pool-level balance sheet totals
            const latestSched = await getLatestSchedule(pool.id);
            if (latestSched) {
                const remaining = pool.originalQuantity > 0
                    ? Math.max(0, pool.originalQuantity - linkedCount) / pool.originalQuantity
                    : 0;
                totalPoolGrossBlock += Number(latestSched.closingGrossBlock) * remaining;
                totalPoolNetBlock   += Number(latestSched.closingNetBlock) * remaining;
            }
        }

        const totalOriginal = pools.reduce((s, p) => s + p.originalQuantity, 0);
        const digitizationPct = totalOriginal > 0
            ? Math.round((1 - totalUndigitizedAssets / totalOriginal) * 100)
            : (totalPools > 0 ? 100 : 0);

        res.json({
            totalPools, completePools, partialPools, pendingPools,
            totalUndigitizedAssets, totalUnallocatedCost,
            totalPoolGrossBlock: Math.round(totalPoolGrossBlock),
            totalPoolNetBlock:   Math.round(totalPoolNetBlock),
            digitizationPct,
        });
    } catch (err) {
        console.error("getPoolSummary error:", err);
        res.status(500).json({ message: "Failed to fetch pool summary" });
    }
};

// ─── GET /asset-pool/:id ──────────────────────────────────────────────────────
export const getPool = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const pool = await prisma.assetPool.findUnique({
            where: { id },
            include: {
                category: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
                adjustments: { orderBy: { createdAt: "desc" } },
                depreciationSchedules: { orderBy: { financialYearEnd: "asc" } },
            },
        });

        if (!pool) { res.status(404).json({ message: "Asset pool not found" }); return; }

        const linkedAssets = await getLinkedAssets(id);
        const individualizedCount = linkedAssets.length;
        const allocatedCost = linkedAssets.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
        const allocatedAccDep = linkedAssets.reduce((s, a) => s + Number(a.depreciation?.accumulatedDepreciation ?? 0), 0);
        const totalPoolCost = Number(pool.totalPoolCost ?? 0);

        const latestSched = (pool as any).depreciationSchedules?.slice(-1)[0] ?? null;
        const remainingRatio = latestSched && Number(latestSched.closingGrossBlock) > 0
            ? Math.max(0, Number(latestSched.closingGrossBlock) - allocatedCost) / Number(latestSched.closingGrossBlock)
            : 0;

        res.json({
            id: pool.id,
            poolCode: pool.poolCode,
            financialYear: pool.financialYear,
            category: pool.category?.name ?? null,
            categoryId: pool.categoryId,
            department: pool.department?.name ?? null,
            departmentId: pool.departmentId,
            description: pool.description,
            originalQuantity: pool.originalQuantity,
            individualizedCount,
            remainingQuantity: Math.max(0, pool.originalQuantity - individualizedCount),
            digitizationPct: pool.originalQuantity > 0
                ? Math.round((individualizedCount / pool.originalQuantity) * 100) : 0,
            totalPoolCost,
            allocatedCost,
            allocatedAccDep,
            unallocatedCost: totalPoolCost - allocatedCost,
            // Remaining balance from latest FA schedule (auditor-certified)
            remainingGrossBlock: latestSched ? Math.max(0, Number(latestSched.closingGrossBlock) - allocatedCost) : null,
            remainingNetBlock:   latestSched ? Math.max(0, Number(latestSched.closingNetBlock) - (allocatedCost - allocatedAccDep)) : null,
            remainingAccDep:     latestSched ? Math.max(0, Number(latestSched.closingAccumulatedDep) * remainingRatio - allocatedAccDep) : null,
            status: pool.status,
            notes: pool.notes,
            createdAt: pool.createdAt,
            updatedAt: pool.updatedAt,
            adjustments: pool.adjustments,
            depreciationSchedules: (pool as any).depreciationSchedules,
            assets: linkedAssets,
        });
    } catch (err) {
        console.error("getPool error:", err);
        res.status(500).json({ message: "Failed to fetch asset pool" });
    }
};

// ─── PUT /asset-pool/:id ──────────────────────────────────────────────────────
export const updatePool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const { description, notes, status, totalPoolCost } = req.body;
        const pool = await prisma.assetPool.findUnique({ where: { id } });
        if (!pool) { res.status(404).json({ message: "Asset pool not found" }); return; }

        const updated = await prisma.assetPool.update({
            where: { id },
            data: {
                ...(description !== undefined && { description }),
                ...(notes !== undefined && { notes }),
                ...(status !== undefined && { status }),
                ...(totalPoolCost !== undefined && { totalPoolCost }),
            } as any,
        });

        res.json(updated);
    } catch (err) {
        console.error("updatePool error:", err);
        res.status(500).json({ message: "Failed to update asset pool" });
    }
};

// ─── POST /asset-pool/:id/adjustment ─────────────────────────────────────────
export const addAdjustment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const { adjustmentType, amount, financialYear, reason } = req.body;
        if (!adjustmentType || amount == null) {
            res.status(400).json({ message: "adjustmentType and amount are required" });
            return;
        }

        const validTypes = ["COST_RECONCILIATION", "WRITE_OFF", "DISTRIBUTE", "OTHER"];
        if (!validTypes.includes(adjustmentType)) {
            res.status(400).json({ message: `adjustmentType must be one of: ${validTypes.join(", ")}` });
            return;
        }

        const pool = await prisma.assetPool.findUnique({ where: { id: poolId } });
        if (!pool) { res.status(404).json({ message: "Asset pool not found" }); return; }

        const adjustment = await prisma.assetPoolAdjustment.create({
            data: {
                poolId, adjustmentType, amount,
                financialYear: financialYear ?? null,
                reason: reason ?? null,
                createdById: (req.user as any)?.employeeDbId ?? null,
            } as any,
        });

        // DISTRIBUTE — spread amount proportionally across all linked assets
        if (adjustmentType === "DISTRIBUTE") {
            const linked = await prisma.asset.findMany({
                where: { assetPoolId: poolId },
                select: { id: true, historicalOtherCost: true },
            });
            if (linked.length > 0) {
                const perAsset = Number(amount) / linked.length;
                await Promise.all(linked.map((a) =>
                    prisma.asset.update({
                        where: { id: a.id },
                        data: { historicalOtherCost: String(Number(a.historicalOtherCost ?? 0) + perAsset) } as any,
                    })
                ));
            }
        }

        res.status(201).json(adjustment);
    } catch (err) {
        console.error("addAdjustment error:", err);
        res.status(500).json({ message: "Failed to add adjustment" });
    }
};

// ─── POST /asset-pool/:id/depreciation-schedule ───────────────────────────────
// Upload one FY row from the audited FA register for this pool.
export const addDepreciationSchedule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const pool = await prisma.assetPool.findUnique({ where: { id: poolId } });
        if (!pool) { res.status(404).json({ message: "Asset pool not found" }); return; }

        const {
            financialYear, financialYearEnd,
            openingGrossBlock, additions, deletions, closingGrossBlock,
            openingAccumulatedDep, depreciationRate, depreciationForPeriod, closingAccumulatedDep,
            openingNetBlock, closingNetBlock,
        } = req.body;

        if (!financialYear || !financialYearEnd || closingGrossBlock == null || closingNetBlock == null) {
            res.status(400).json({ message: "financialYear, financialYearEnd, closingGrossBlock, closingNetBlock are required" });
            return;
        }

        // Upsert — one row per pool per FY
        const existing = await prisma.assetPoolDepreciationSchedule.findFirst({
            where: { poolId, financialYear: String(financialYear) },
        });

        const data = {
            poolId,
            financialYear: String(financialYear),
            financialYearEnd: new Date(financialYearEnd),
            openingGrossBlock: Number(openingGrossBlock ?? 0),
            additions: Number(additions ?? 0),
            deletions: Number(deletions ?? 0),
            closingGrossBlock: Number(closingGrossBlock),
            openingAccumulatedDep: Number(openingAccumulatedDep ?? 0),
            depreciationRate: Number(depreciationRate ?? 0),
            depreciationForPeriod: Number(depreciationForPeriod ?? 0),
            closingAccumulatedDep: Number(closingAccumulatedDep ?? 0),
            openingNetBlock: Number(openingNetBlock ?? 0),
            closingNetBlock: Number(closingNetBlock),
            createdById: (req.user as any)?.employeeDbId ?? null,
        };

        let schedule;
        if (existing) {
            schedule = await prisma.assetPoolDepreciationSchedule.update({
                where: { id: existing.id },
                data,
            });
        } else {
            schedule = await prisma.assetPoolDepreciationSchedule.create({ data });
        }

        // Auto-update pool totalPoolCost to match latest schedule closingGrossBlock if not set
        if (!pool.totalPoolCost) {
            await prisma.assetPool.update({
                where: { id: poolId },
                data: { totalPoolCost: Number(closingGrossBlock) } as any,
            });
        }

        res.status(201).json(schedule);
    } catch (err) {
        console.error("addDepreciationSchedule error:", err);
        res.status(500).json({ message: "Failed to add depreciation schedule" });
    }
};

// ─── GET /asset-pool/:id/depreciation-schedule ───────────────────────────────
export const listDepreciationSchedules = async (req: Request, res: Response): Promise<void> => {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const schedules = await prisma.assetPoolDepreciationSchedule.findMany({
            where: { poolId },
            orderBy: { financialYearEnd: "asc" },
        });

        res.json(schedules);
    } catch (err) {
        console.error("listDepreciationSchedules error:", err);
        res.status(500).json({ message: "Failed to fetch depreciation schedules" });
    }
};

// ─── GET /asset-pool/:id/proportional-dep ────────────────────────────────────
// Given an asset's purchase cost, calculate proportional opening accumulated
// depreciation from the pool's latest FA schedule.
// Query: ?assetCost=500000
export const getProportionalDep = async (req: Request, res: Response): Promise<void> => {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const assetCost = Number(req.query.assetCost);
        if (!assetCost || assetCost <= 0) {
            res.status(400).json({ message: "assetCost query param required and must be > 0" });
            return;
        }

        const latestSched = await getLatestSchedule(poolId);
        if (!latestSched) {
            res.json({
                openingAccumulatedDep: 0,
                openingBookValue: assetCost,
                note: "No FA schedule uploaded for this pool yet. Depreciation will start from zero.",
            });
            return;
        }

        const poolGrossBlock  = Number(latestSched.closingGrossBlock);
        const poolAccDep      = Number(latestSched.closingAccumulatedDep);
        const depRate         = Number(latestSched.depreciationRate);
        const financialYear   = latestSched.financialYear;

        if (poolGrossBlock <= 0) {
            res.json({ openingAccumulatedDep: 0, openingBookValue: assetCost, note: "Pool gross block is zero." });
            return;
        }

        // Asset's proportional share
        const shareRatio              = assetCost / poolGrossBlock;
        const openingAccumulatedDep   = Math.round(poolAccDep * shareRatio);
        const openingBookValue        = Math.max(0, assetCost - openingAccumulatedDep);

        res.json({
            assetCost,
            poolGrossBlock,
            poolAccDep,
            shareRatio:          +shareRatio.toFixed(6),
            openingAccumulatedDep,
            openingBookValue,
            depreciationRate:    depRate,
            basedOnFY:           financialYear,
            financialYearEnd:    latestSched.financialYearEnd,
        });
    } catch (err) {
        console.error("getProportionalDep error:", err);
        res.status(500).json({ message: "Failed to calculate proportional depreciation" });
    }
};

// ─── GET /asset-pool/:id/activity ────────────────────────────────────────────
// Chronological activity log: pool created, schedules uploaded,
// assets individualized, adjustments made.
export const getPoolActivity = async (req: Request, res: Response): Promise<void> => {
    try {
        const poolId = parseInt(req.params.id);
        if (isNaN(poolId)) { res.status(400).json({ message: "Invalid pool id" }); return; }

        const pool = await prisma.assetPool.findUnique({
            where: { id: poolId },
            select: { id: true, poolCode: true, financialYear: true, createdAt: true, originalQuantity: true },
        });
        if (!pool) { res.status(404).json({ message: "Asset pool not found" }); return; }

        const events: any[] = [];

        // 1. Pool created
        events.push({
            type: "POOL_CREATED",
            date: pool.createdAt,
            description: `Pool ${pool.poolCode} created for ${pool.financialYear} with ${pool.originalQuantity} assets`,
        });

        // 2. FA schedule uploads
        const schedules = await prisma.assetPoolDepreciationSchedule.findMany({
            where: { poolId },
            orderBy: { createdAt: "asc" },
        });
        for (const s of schedules) {
            events.push({
                type: "SCHEDULE_UPLOADED",
                date: s.createdAt,
                description: `FA schedule uploaded for ${s.financialYear} — Gross Block: ₹${Number(s.closingGrossBlock).toLocaleString("en-IN")}, Net Block: ₹${Number(s.closingNetBlock).toLocaleString("en-IN")}`,
                data: { financialYear: s.financialYear, closingGrossBlock: Number(s.closingGrossBlock), closingNetBlock: Number(s.closingNetBlock) },
            });
        }

        // 3. Individual assets extracted from this pool
        const assets = await prisma.asset.findMany({
            where: { assetPoolId: poolId },
            select: {
                assetId: true, assetName: true, purchaseCost: true,
                financialYearAdded: true, createdAt: true,
                depreciation: { select: { accumulatedDepreciation: true, currentBookValue: true } },
            },
            orderBy: { createdAt: "asc" },
        });
        for (const a of assets) {
            const dep = a.depreciation;
            events.push({
                type: "ASSET_INDIVIDUALIZED",
                date: a.createdAt,
                description: `${a.assetId} — ${a.assetName} individualized (Cost: ₹${Number(a.purchaseCost ?? 0).toLocaleString("en-IN")}${dep ? `, Opening Acc. Dep: ₹${Number(dep.accumulatedDepreciation).toLocaleString("en-IN")}, Book Value: ₹${Number(dep.currentBookValue).toLocaleString("en-IN")}` : ""})`,
                data: {
                    assetId: a.assetId, assetName: a.assetName,
                    purchaseCost: Number(a.purchaseCost ?? 0),
                    financialYearAdded: a.financialYearAdded,
                    openingAccDep: dep ? Number(dep.accumulatedDepreciation) : null,
                    openingBookValue: dep ? Number(dep.currentBookValue) : null,
                },
            });
        }

        // 4. Adjustments
        const adjustments = await prisma.assetPoolAdjustment.findMany({
            where: { poolId },
            orderBy: { createdAt: "asc" },
        });
        for (const adj of adjustments) {
            events.push({
                type: "ADJUSTMENT",
                date: adj.createdAt,
                description: `${adj.adjustmentType} adjustment of ₹${Number(adj.amount).toLocaleString("en-IN")}${adj.reason ? ` — ${adj.reason}` : ""}`,
                data: { adjustmentType: adj.adjustmentType, amount: Number(adj.amount), reason: adj.reason },
            });
        }

        // Sort all events chronologically
        events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Running balance summary at end
        const totalIndividualizedCost = assets.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
        const latestSched = schedules[schedules.length - 1];
        const remainingGrossBlock = latestSched
            ? Math.max(0, Number(latestSched.closingGrossBlock) - totalIndividualizedCost)
            : null;

        res.json({
            poolCode: pool.poolCode,
            events,
            summary: {
                totalEvents: events.length,
                assetsIndividualized: assets.length,
                totalIndividualizedCost,
                remainingGrossBlock,
                latestFY: latestSched?.financialYear ?? null,
            },
        });
    } catch (err) {
        console.error("getPoolActivity error:", err);
        res.status(500).json({ message: "Failed to fetch pool activity" });
    }
};

// ─── GET /asset-pool/fa-register-template ────────────────────────────────────
// Download blank Excel template matching the FA register format
export const downloadFaRegisterTemplate = async (_req: Request, res: Response): Promise<void> => {
    try {
        const wb = XLSX.utils.book_new();

        // Instructions sheet
        const instructions = [
            ["FA Register Import Template — Instructions"],
            [""],
            ["One row per category per financial year. Each row creates one Asset Pool + its Depreciation Schedule."],
            ["financialYear format: FY2022-23  (use the year the FA schedule ends, e.g. FY2023-24 for 31 March 2024)"],
            ["All monetary values in Indian Rupees (no commas). Leave 0 if not applicable."],
            ["originalQuantity: total count of assets in this category from the FA register (can be 0 if unknown)."],
            ["financialYearEnd: last date of the FY in YYYY-MM-DD format, e.g. 2023-03-31"],
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), "Instructions");

        // Data sheet — column headers matching FA register layout
        const headers = [
            "financialYear",           // e.g. FY2022-23
            "category",                // e.g. BUILDING, MACHINERY & EQUIPMENTS
            "department",              // optional
            "originalQuantity",        // total assets in this pool (0 if unknown)
            "financialYearEnd",        // e.g. 2023-03-31
            "openingGrossBlock",       // AS ON 01.04.XXXX
            "additions",               // Additions during FY
            "deletions",               // Deletions during FY
            "closingGrossBlock",       // UPTO 31.03.XXXX
            "openingAccumulatedDep",   // UP TO previous year
            "depreciationRate",        // RATE % (e.g. 15)
            "depreciationForPeriod",   // FOR THE PERIOD
            "closingAccumulatedDep",   // UPTO 31.03.XXXX (dep column)
            "closingNetBlock",         // NET BLOCK current year
            "previousYearNetBlock",    // NET BLOCK previous year (reference only)
            "notes",                   // optional remarks
        ];

        // ── JMRH FA Register data — FY2022-23, FY2023-24, FY2024-25 ──────────────
        // Verify figures against the original audited FA register before importing.
        // Each row: [financialYear, category, department, qty, fyEnd,
        //            openGB, additions, deletions, closeGB,
        //            openAccDep, rate%, depForPeriod, closeAccDep,
        //            closeNB, prevYearNB, notes]

        // ── FY2022-23 ────────────────────────────────────────────────────────────
        const rows: any[][] = [
            ["FY2022-23","BUILDING","",1,"2023-03-31",
                287185029, 0, 0, 287185029,
                0, 5, 7179626, 7179626,
                280005403, 287185029, ""],
            ["FY2022-23","FURNITURE & FIXTURES","",0,"2023-03-31",
                2020979, 0, 0, 2020979,
                0, 10, 101049, 101049,
                1919930, 2020979, ""],
            ["FY2022-23","VEHICLES","",0,"2023-03-31",
                4063159, 0, 0, 4063159,
                0, 15, 304737, 304737,
                3758422, 4063159, ""],
            ["FY2022-23","MACHINERY & EQUIPMENTS","",0,"2023-03-31",
                75091930, 0, 0, 75091930,
                0, 15, 5631895, 5631895,
                69460035, 75091930, ""],

            // ── FY2023-24 ──────────────────────────────────────────────────────
            ["FY2023-24","BUILDING","",1,"2024-03-31",
                287185029, 39908351, 0, 327093380,
                7179626, 5, 15903768, 23083394,
                304009986, 280005403, "Verify NB"],
            ["FY2023-24","FURNITURE & FIXTURES","",0,"2024-03-31",
                2020979, 8815498, 0, 10836477,
                101049, 10, 1083648, 1184697,
                9651780, 1919930, "Verify figures"],
            ["FY2023-24","VEHICLES","",0,"2024-03-31",
                4063159, 0, 196737, 3866422,
                304737, 15, 579963, 884700,
                2981722, 3758422, "Verify figures"],
            ["FY2023-24","MACHINERY & EQUIPMENTS","",0,"2024-03-31",
                75091930, 0, 3241751, 71850179,
                5631895, 15, 5000543, 10632438,
                61217741, 69460035, "Verify figures"],
            ["FY2023-24","MEDICAL EQUIPMENTS","",0,"2024-03-31",
                0, 42021343, 0, 42021343,
                0, 15, 6030801, 6030801,
                35990542, 0, "First year — verify rate"],
            ["FY2023-24","ELECTRICAL EQUIPMENTS","",0,"2024-03-31",
                0, 6254384, 0, 6254384,
                0, 10, 712505, 712505,
                5541879, 0, "First year — verify figures"],
            ["FY2023-24","OFFICE EQUIPMENTS","",0,"2024-03-31",
                0, 6549654, 0, 6549654,
                0, 15, 369003, 369003,
                6180651, 0, "First year — verify figures"],
            ["FY2023-24","COMPUTER","",0,"2024-03-31",
                0, 1414709, 0, 1414709,
                0, 15, 212206, 212206,
                1202503, 0, "First year — verify figures"],
            ["FY2023-24","SURGICAL EQUIPMENTS","",0,"2024-03-31",
                0, 2558700, 0, 2558700,
                0, 20, 511740, 511740,
                2046960, 0, "First year — verify figures"],

            // ── FY2024-25 ──────────────────────────────────────────────────────
            ["FY2024-25","BUILDING","",1,"2025-03-31",
                327093380, 6643134, 0, 333736514,
                23083394, 5, 16253274, 39336668,
                294399846, 304009986, "Verify NB"],
            ["FY2024-25","FURNITURE & FIXTURES","",0,"2025-03-31",
                10836477, 0, 0, 10836477,
                1184697, 10, 1083648, 2268345,
                8568132, 9651780, "Verify figures"],
            ["FY2024-25","VEHICLES","",0,"2025-03-31",
                3866422, 0, 0, 3866422,
                884700, 15, 579963, 1464663,
                2401759, 2981722, "Verify figures"],
            ["FY2024-25","MACHINERY & EQUIPMENTS","",0,"2025-03-31",
                71850179, 0, 0, 71850179,
                10632438, 15, 9182614, 19815052,
                52035127, 61217741, "Verify figures"],
            ["FY2024-25","MEDICAL EQUIPMENTS","",0,"2025-03-31",
                42021343, 0, 0, 42021343,
                6030801, 15, 6094030, 12124831,
                29896512, 35990542, "Verify figures"],
            ["FY2024-25","ELECTRICAL EQUIPMENTS","",0,"2025-03-31",
                6254384, 0, 0, 6254384,
                712505, 10, 554188, 1266693,
                4987691, 5541879, "Verify figures"],
            ["FY2024-25","OFFICE EQUIPMENTS","",0,"2025-03-31",
                6549654, 0, 0, 6549654,
                369003, 15, 927448, 1296451,
                5253203, 6180651, "Verify figures"],
            ["FY2024-25","COMPUTER","",0,"2025-03-31",
                1414709, 0, 0, 1414709,
                212206, 15, 180376, 392582,
                1022127, 1202503, "Verify figures"],
            ["FY2024-25","SURGICAL EQUIPMENTS","",0,"2025-03-31",
                2558700, 0, 0, 2558700,
                511740, 20, 409392, 921132,
                1637568, 2046960, "Verify figures"],
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

        // Column widths
        ws["!cols"] = [
            { wch: 14 }, { wch: 30 }, { wch: 20 }, { wch: 16 },
            { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
            { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 22 },
            { wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 20 },
        ];

        XLSX.utils.book_append_sheet(wb, ws, "FA Register");

        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Disposition", 'attachment; filename="FA_Register_Pool_Template.xlsx"');
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buf);
    } catch (err) {
        console.error("downloadFaRegisterTemplate error:", err);
        res.status(500).json({ message: "Failed to generate template" });
    }
};

// ─── POST /asset-pool/import-fa-register ─────────────────────────────────────
// Upload one FA register Excel sheet → creates pools + depreciation schedules
export const importFaRegister = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const filePath = (req as any).file?.path;
    try {
        if (!filePath) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }

        const wb = XLSX.readFile(filePath);
        const sheetName = wb.SheetNames.find(n => n.toLowerCase() !== "instructions") ?? wb.SheetNames[0];
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

        if (!rows.length) {
            res.status(400).json({ message: "Spreadsheet is empty" });
            return;
        }

        const createdById: number | null = (req.user as any)?.employeeDbId ?? null;
        const results: any[] = [];
        const errors: any[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // 1-indexed, row 1 = header

            const financialYear   = String(row.financialYear ?? "").trim();
            const categoryName    = String(row.category ?? "").trim();
            const departmentName  = String(row.department ?? "").trim();
            const fyEndRaw        = row.financialYearEnd;

            if (!financialYear || !categoryName) {
                errors.push({ row: rowNum, error: "financialYear and category are required" });
                continue;
            }

            // Parse financialYearEnd — Excel numeric date or ISO string
            let financialYearEnd: Date | null = null;
            if (fyEndRaw) {
                if (typeof fyEndRaw === "number") {
                    const epoch = new Date(Date.UTC(1899, 11, 30));
                    financialYearEnd = new Date(epoch.getTime() + fyEndRaw * 86400000);
                } else {
                    const d = new Date(fyEndRaw);
                    if (!isNaN(d.getTime())) financialYearEnd = d;
                }
            }
            // Fallback: derive from FY string e.g. FY2022-23 → 2023-03-31
            if (!financialYearEnd) {
                const m = String(financialYear).match(/(\d{4})-(\d{2,4})/);
                if (m) {
                    const endYear = m[2].length === 2 ? Number(m[1].slice(0, 2) + m[2]) : Number(m[2]);
                    financialYearEnd = new Date(`${endYear}-03-31`);
                }
            }
            if (!financialYearEnd) {
                errors.push({ row: rowNum, error: "Could not parse financialYearEnd. Use YYYY-MM-DD format." });
                continue;
            }

            const n = (v: any) => (v === "" || v == null ? 0 : Number(v));

            const openingGrossBlock     = n(row.openingGrossBlock);
            const additions             = n(row.additions);
            const deletions             = n(row.deletions);
            const closingGrossBlock     = n(row.closingGrossBlock) || openingGrossBlock + additions - deletions;
            const openingAccumulatedDep = n(row.openingAccumulatedDep);
            const depreciationRate      = n(row.depreciationRate);
            const depreciationForPeriod = n(row.depreciationForPeriod);
            const closingAccumulatedDep = n(row.closingAccumulatedDep) || openingAccumulatedDep + depreciationForPeriod;
            const openingNetBlock       = openingGrossBlock - openingAccumulatedDep;
            const closingNetBlock       = n(row.closingNetBlock) || closingGrossBlock - closingAccumulatedDep;
            const originalQuantity      = n(row.originalQuantity);

            try {
                // Resolve or create AssetCategory by name
                let category = await prisma.assetCategory.findFirst({
                    where: { name: categoryName },
                });
                if (!category) {
                    category = await prisma.assetCategory.create({ data: { name: categoryName } });
                }

                // Resolve department if provided
                let departmentId: number | null = null;
                if (departmentName) {
                    const dept = await prisma.department.findFirst({
                        where: { name: departmentName },
                    });
                    if (dept) departmentId = dept.id;
                }

                // Find existing pool for this category + FY, or create new one
                let pool = await prisma.assetPool.findFirst({
                    where: {
                        financialYear: financialYear,
                        categoryId: category.id,
                        ...(departmentId ? { departmentId } : {}),
                    },
                });

                if (!pool) {
                    const poolCode = await generatePoolCode(financialYear, departmentId);
                    pool = await prisma.assetPool.create({
                        data: {
                            poolCode,
                            financialYear,
                            categoryId: category.id,
                            departmentId,
                            originalQuantity,
                            totalPoolCost: closingGrossBlock || null,
                            status: "PENDING",
                            notes: String(row.notes ?? "").trim() || null,
                            createdById,
                        } as any,
                    });
                } else {
                    // Update quantity/cost if more data now available
                    await prisma.assetPool.update({
                        where: { id: pool.id },
                        data: {
                            ...(originalQuantity > 0 && { originalQuantity }),
                            ...(closingGrossBlock > 0 && !pool.totalPoolCost && { totalPoolCost: closingGrossBlock }),
                        } as any,
                    });
                }

                // Upsert the depreciation schedule for this FY
                const existingSched = await prisma.assetPoolDepreciationSchedule.findFirst({
                    where: { poolId: pool.id, financialYear },
                });

                const schedData = {
                    poolId: pool.id,
                    financialYear,
                    financialYearEnd,
                    openingGrossBlock,
                    additions,
                    deletions,
                    closingGrossBlock,
                    openingAccumulatedDep,
                    depreciationRate,
                    depreciationForPeriod,
                    closingAccumulatedDep,
                    openingNetBlock,
                    closingNetBlock,
                    createdById,
                };

                let schedule;
                if (existingSched) {
                    schedule = await prisma.assetPoolDepreciationSchedule.update({
                        where: { id: existingSched.id },
                        data: schedData,
                    });
                } else {
                    schedule = await prisma.assetPoolDepreciationSchedule.create({ data: schedData });
                }

                results.push({
                    row: rowNum,
                    poolCode: pool.poolCode,
                    poolId: pool.id,
                    category: categoryName,
                    financialYear,
                    action: existingSched ? "schedule_updated" : "pool_created",
                    closingGrossBlock,
                    closingNetBlock,
                });
            } catch (rowErr: any) {
                errors.push({ row: rowNum, category: categoryName, error: rowErr?.message ?? "Unknown error" });
            }
        }

        // Clean up uploaded file
        try { fs.unlinkSync(filePath); } catch {}

        res.json({
            imported: results.length,
            errorCount: errors.length,
            results,
            errors,
        });
    } catch (err) {
        try { if (filePath) fs.unlinkSync(filePath); } catch {}
        console.error("importFaRegister error:", err);
        res.status(500).json({ message: "Failed to import FA register" });
    }
};

// ─── DELETE /asset-pool/reset ─────────────────────────────────────────────────
// Delete ALL asset pools, their depreciation schedules and adjustments.
// Linked individual assets are UNLINKED (assetPoolId set to null) — not deleted.
// Requires header: x-confirm-reset: true
export const resetAllPools = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const confirm = req.headers["x-confirm-reset"];
        if (confirm !== "true") {
            res.status(400).json({
                message: "Send header 'x-confirm-reset: true' to confirm this destructive operation.",
            });
            return;
        }

        // 1. Unlink any individual assets from all pools
        const unlinkResult = await prisma.asset.updateMany({
            where: { assetPoolId: { not: null } },
            data: { assetPoolId: null, financialYearAdded: null } as any,
        });

        // 2. Delete all depreciation schedules
        const schedDel = await prisma.assetPoolDepreciationSchedule.deleteMany({});

        // 3. Delete all adjustments
        const adjDel = await prisma.assetPoolAdjustment.deleteMany({});

        // 4. Delete all pools
        const poolDel = await prisma.assetPool.deleteMany({});

        res.json({
            message: "All asset pools have been deleted. You can now re-import the FA register.",
            deletedPools: poolDel.count,
            deletedSchedules: schedDel.count,
            deletedAdjustments: adjDel.count,
            unlinkedAssets: unlinkResult.count,
        });
    } catch (err) {
        console.error("resetAllPools error:", err);
        res.status(500).json({ message: "Failed to reset asset pools" });
    }
};

// ─── GET /asset-pool/individual-assets-template ───────────────────────────────
// Download Excel template for importing individual assets linked to a pool
export const downloadIndividualAssetsTemplate = async (_req: Request, res: Response): Promise<void> => {
    try {
        const wb = XLSX.utils.book_new();

        // Instructions sheet
        const instructions = [
            ["Individual Asset Import Template — Instructions"],
            [""],
            ["One row per individual asset from the FA register."],
            ["poolRef: 'FY2024-25/MEDICAL EQUIPMENTS' — matches financialYear/categoryName of an existing pool."],
            ["serialNumber: leave blank to auto-generate (POOL-{poolCode}-{rowIndex})."],
            ["purchaseCost: cost of this specific asset in Indian Rupees (no commas)."],
            ["purchaseDate: YYYY-MM-DD format. Used to generate legacy asset ID. Defaults to pool FY end if blank."],
            ["department: optional — overrides the pool's department for this asset."],
            ["openingAccDep: optional — accumulated depreciation as on digitization date."],
            ["            Leave blank to auto-calculate proportionally from the pool's closing accumulated dep."],
            ["manufacturer, modelNumber: optional descriptive fields."],
            ["notes: optional remarks."],
            [""],
            ["All imported assets are flagged as Legacy Assets (isLegacyAsset = true)."],
            ["Asset IDs follow the format: AST-{HOSPITAL_CODE}-FY{YYYY}-{YY}-L-{NNNNN}"],
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), "Instructions");

        // Data sheet
        const headers = [
            "poolRef",          // FY2024-25/MEDICAL EQUIPMENTS
            "assetName",        // Asset name from FA register
            "serialNumber",     // Optional — auto-generated if blank
            "purchaseCost",     // Cost in INR
            "purchaseDate",     // YYYY-MM-DD (defaults to pool FY end)
            "department",       // Optional
            "openingAccDep",    // Optional — auto-calc if blank
            "manufacturer",     // Optional
            "modelNumber",      // Optional
            "notes",            // Optional
        ];

        // Sample rows — representative items from JMRH FA register
        const samples: any[][] = [
            // MEDICAL EQUIPMENTS — FY2024-25
            ["FY2024-25/MEDICAL EQUIPMENTS", "BX2000 Plus Wardcare Bedside Table", "", 1283451, "2024-04-01", "", "", "BX Medical", "BX2000", ""],
            ["FY2024-25/MEDICAL EQUIPMENTS", "ICU Ventilator - Draeger Evita 800", "", 3250000, "2024-06-15", "ICU", "", "Draeger", "Evita 800", ""],
            ["FY2024-25/MEDICAL EQUIPMENTS", "Digital X-Ray System", "", 4500000, "2024-09-01", "Radiology", "", "", "", ""],
            // BUILDING — FY2024-25
            ["FY2024-25/BUILDING", "OPD Block Extension", "", 6643134, "2025-03-31", "", "", "", "", "FY2024-25 addition"],
            // SURGICAL EQUIPMENTS — FY2024-25
            ["FY2024-25/SURGICAL EQUIPMENTS", "Laparoscopic Tower Set", "", 850000, "2024-07-20", "OT", "", "", "", ""],
            ["FY2024-25/SURGICAL EQUIPMENTS", "C-Arm Fluoroscopy Machine", "", 1708700, "2024-08-10", "OT", "", "", "", ""],
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, ...samples]);
        ws["!cols"] = [
            { wch: 36 }, { wch: 40 }, { wch: 28 }, { wch: 16 },
            { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 22 },
            { wch: 18 }, { wch: 30 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "Individual Assets");

        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Disposition", 'attachment; filename="Individual_Assets_Import_Template.xlsx"');
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buf);
    } catch (err) {
        console.error("downloadIndividualAssetsTemplate error:", err);
        res.status(500).json({ message: "Failed to generate template" });
    }
};

// ─── POST /asset-pool/import-individual-assets ────────────────────────────────
// Import individual asset line items from FA register.
// Each row creates one Asset record linked to an existing pool, flagged as legacy.
export const importIndividualAssets = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const filePath = (req as any).file?.path;
    try {
        if (!filePath) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }

        const wb = XLSX.readFile(filePath);
        const sheetName = wb.SheetNames.find(n =>
            n.toLowerCase().includes("individual") || n.toLowerCase().includes("asset")
        ) ?? wb.SheetNames[0];
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

        if (!rows.length) {
            res.status(400).json({ message: "Spreadsheet is empty" });
            return;
        }

        const createdById: number | null = (req.user as any)?.employeeDbId ?? null;
        const results: any[] = [];
        const errors: any[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;

            const poolRef      = String(row.poolRef ?? "").trim();
            const assetNameRaw = String(row.assetName ?? "").trim();

            if (!poolRef || !assetNameRaw) {
                errors.push({ row: rowNum, error: "poolRef and assetName are required" });
                continue;
            }

            // Parse poolRef: "FY2024-25/MEDICAL EQUIPMENTS"
            const slashIdx = poolRef.indexOf("/");
            if (slashIdx === -1) {
                errors.push({ row: rowNum, poolRef, error: "poolRef must be 'FY####-##/CATEGORY NAME'" });
                continue;
            }
            const poolFY       = poolRef.slice(0, slashIdx).trim();
            const poolCategory = poolRef.slice(slashIdx + 1).trim();

            const purchaseCostRaw = row.purchaseCost;
            const purchaseCost    = purchaseCostRaw === "" || purchaseCostRaw == null ? null : Number(purchaseCostRaw);
            if (purchaseCost === null || isNaN(purchaseCost) || purchaseCost <= 0) {
                errors.push({ row: rowNum, assetName: assetNameRaw, error: "purchaseCost must be a positive number" });
                continue;
            }

            // Parse purchaseDate
            let purchaseDate: Date | null = null;
            const purchaseDateRaw = row.purchaseDate;
            if (purchaseDateRaw) {
                if (typeof purchaseDateRaw === "number") {
                    const epoch = new Date(Date.UTC(1899, 11, 30));
                    purchaseDate = new Date(epoch.getTime() + purchaseDateRaw * 86400000);
                } else {
                    const d = new Date(purchaseDateRaw);
                    if (!isNaN(d.getTime())) purchaseDate = d;
                }
            }

            try {
                // 1. Resolve pool by FY + category name
                const category = await prisma.assetCategory.findFirst({
                    where: { name: poolCategory },
                });
                if (!category) {
                    errors.push({ row: rowNum, assetName: assetNameRaw, error: `Category not found: "${poolCategory}". Import the FA register first to create pools.` });
                    continue;
                }

                const pool = await prisma.assetPool.findFirst({
                    where: { financialYear: poolFY, categoryId: category.id },
                    include: {
                        depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 },
                    },
                });
                if (!pool) {
                    errors.push({ row: rowNum, assetName: assetNameRaw, error: `Pool not found for "${poolRef}". Import the FA register first.` });
                    continue;
                }

                // If purchaseDate is missing, default to pool FY end date
                if (!purchaseDate) {
                    const latestSched = (pool as any).depreciationSchedules?.[0];
                    purchaseDate = latestSched?.financialYearEnd
                        ? new Date(latestSched.financialYearEnd)
                        : new Date(`${poolFY.replace("FY", "").split("-")[0]}03-31`);
                }

                // 2. Resolve optional department
                let departmentId: number | null = pool.departmentId ?? null;
                const deptName = String(row.department ?? "").trim();
                if (deptName) {
                    const dept = await prisma.department.findFirst({ where: { name: deptName } });
                    if (dept) departmentId = dept.id;
                }

                // 3. Proportional accumulated depreciation
                const latestSched = (pool as any).depreciationSchedules?.[0] ?? null;
                const poolClosingAccDep    = latestSched ? Number(latestSched.closingAccumulatedDep) : 0;
                const poolClosingGrossBlock = latestSched ? Number(latestSched.closingGrossBlock) : Number(pool.totalPoolCost ?? 0);
                const depRate = latestSched ? Number(latestSched.depreciationRate) : 0;

                let openingAccDep: number;
                const openingAccDepRaw = row.openingAccDep;
                if (openingAccDepRaw !== "" && openingAccDepRaw != null && !isNaN(Number(openingAccDepRaw))) {
                    openingAccDep = Number(openingAccDepRaw);
                } else if (poolClosingGrossBlock > 0) {
                    const shareRatio = purchaseCost / poolClosingGrossBlock;
                    openingAccDep = Math.round(poolClosingAccDep * shareRatio);
                } else {
                    openingAccDep = 0;
                }
                const currentBookValue = Math.max(0, purchaseCost - openingAccDep);

                // 4. Serial number — auto-generate if blank
                const serialNumberRaw = String(row.serialNumber ?? "").trim();
                const serialNumber = serialNumberRaw || `POOL-${pool.poolCode}-${Date.now()}-${i}`;

                // 5. Generate legacy asset ID
                const assetId = await generateLegacyAssetId(purchaseDate);

                // 6. Create the Asset record
                const asset = await prisma.asset.create({
                    data: {
                        assetId,
                        assetName: assetNameRaw,
                        assetType: category.name,
                        assetCategoryId: category.id,
                        serialNumber,
                        purchaseCost,
                        purchaseDate,
                        modeOfProcurement: "PURCHASE",
                        status: "ACTIVE",
                        isLegacyAsset: true,
                        assetPoolId: pool.id,
                        financialYearAdded: poolFY,
                        manufacturer: String(row.manufacturer ?? "").trim() || null,
                        modelNumber: String(row.modelNumber ?? "").trim() || null,
                        remarks: String(row.notes ?? "").trim() || null,
                        departmentId,
                        createdById,
                    } as any,
                });

                // 7. Create AssetDepreciation record
                // lastCalculatedAt = pool FY end date → tells the batch engine that depreciation
                // is already captured up to this date via the proportional opening balance.
                // The next batch run (e.g. FY2025-26 year-end) will correctly start from here.
                if (depRate > 0 || openingAccDep > 0) {
                    const fyEndForDep = latestSched?.financialYearEnd
                        ? new Date(latestSched.financialYearEnd)
                        : null;
                    await prisma.assetDepreciation.create({
                        data: {
                            assetId: asset.id,
                            depreciationMethod: "DB",
                            depreciationRate: depRate,
                            expectedLifeYears: depRate > 0 ? Math.ceil(100 / depRate) : 0,
                            salvageValue: 0,
                            depreciationStart: purchaseDate,
                            accumulatedDepreciation: openingAccDep,
                            currentBookValue,
                            depreciationFrequency: "YEARLY",
                            lastCalculatedAt: fyEndForDep,
                            isActive: true,
                            createdById,
                        } as any,
                    });
                }

                // 8. Update pool status
                const linkedCount = await prisma.asset.count({ where: { assetPoolId: pool.id } });
                const newStatus = pool.originalQuantity > 0 && linkedCount >= pool.originalQuantity
                    ? "COMPLETE"
                    : "PARTIAL";
                await prisma.assetPool.update({
                    where: { id: pool.id },
                    data: { status: newStatus } as any,
                });

                results.push({
                    row: rowNum,
                    assetId,
                    assetName: assetNameRaw,
                    poolCode: pool.poolCode,
                    poolRef,
                    purchaseCost,
                    openingAccDep,
                    currentBookValue,
                    poolStatus: newStatus,
                });
            } catch (rowErr: any) {
                errors.push({ row: rowNum, assetName: assetNameRaw, error: rowErr?.message ?? "Unknown error" });
            }
        }

        try { fs.unlinkSync(filePath); } catch {}

        res.json({
            imported: results.length,
            errorCount: errors.length,
            results,
            errors,
        });
    } catch (err) {
        try { if (filePath) fs.unlinkSync(filePath); } catch {}
        console.error("importIndividualAssets error:", err);
        res.status(500).json({ message: "Failed to import individual assets" });
    }
};

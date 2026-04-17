/**
 * Reconciliation Module
 * ---------------------
 * Compares System-computed values vs Books (accounts module) vs Audit (FA register)
 * at FY-end (or any cut-off date) and surfaces variances for resolution.
 *
 *  - System  = sum from AssetDepreciation (currentBookValue, accumulatedDepreciation)
 *  - Books   = sum from accounts module (FinanceVoucher / ChartOfAccounts entries)
 *              [Note: requires accounts module integration; currently uses manual entry]
 *  - Audit   = sum from auditedBookValueAtMigration / latest AssetPoolDepreciationSchedule
 */
import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ── POST /reconciliation/run — generate snapshots for an as-of date ───────────
// Body: { asOfDate, scope: "ASSET"|"CATEGORY"|"POOL", scopeIds?: number[], booksData?: {...} }
export const runReconciliation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { asOfDate, scope = "CATEGORY", scopeIds, booksData } = req.body;
    if (!asOfDate) { res.status(400).json({ message: "asOfDate is required" }); return; }
    if (!["ASSET", "CATEGORY", "POOL"].includes(scope)) {
      res.status(400).json({ message: "scope must be ASSET, CATEGORY, or POOL" });
      return;
    }

    const asOf = new Date(asOfDate);
    const employeeId = req.user?.employeeDbId ?? null;
    const snapshots: any[] = [];

    if (scope === "CATEGORY") {
      const categories = scopeIds?.length
        ? await prisma.assetCategory.findMany({ where: { id: { in: scopeIds.map(Number) } } })
        : await prisma.assetCategory.findMany();

      for (const cat of categories) {
        const assets = await prisma.asset.findMany({
          where: { assetCategoryId: cat.id },
          include: { depreciation: true },
        });
        const sysGross = assets.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
        const sysAccDep = assets.reduce((s, a) => s + Number(a.depreciation?.accumulatedDepreciation ?? 0), 0);
        const sysNet = sysGross - sysAccDep;

        const audited = assets.reduce(
          (s, a) => s + Number((a as any).auditedBookValueAtMigration ?? 0), 0
        );

        const books = booksData?.[`category_${cat.id}`] ?? null;

        const snap = await persistSnapshot({
          asOfDate: asOf,
          scope: "CATEGORY",
          scopeId: cat.id,
          scopeLabel: cat.name,
          system: { gross: sysGross, accDep: sysAccDep, net: sysNet },
          audit:  { gross: null, accDep: null, net: audited > 0 ? audited : null },
          books:  books ? { gross: books.gross, accDep: books.accDep, net: books.net } : null,
          createdById: employeeId,
        });
        snapshots.push(snap);
      }
    }

    if (scope === "POOL") {
      const pools = scopeIds?.length
        ? await prisma.assetPool.findMany({
            where: { id: { in: scopeIds.map(Number) } },
            include: { depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 } },
          })
        : await prisma.assetPool.findMany({
            include: { depreciationSchedules: { orderBy: { financialYearEnd: "desc" }, take: 1 } },
          });

      for (const pool of pools) {
        const assets = await prisma.asset.findMany({
          where: { assetPoolId: pool.id },
          include: { depreciation: true },
        });
        const sysGross = assets.reduce((s, a) => s + Number(a.purchaseCost ?? 0), 0);
        const sysAccDep = assets.reduce((s, a) => s + Number(a.depreciation?.accumulatedDepreciation ?? 0), 0);
        const sysNet = sysGross - sysAccDep;

        const latest = (pool as any).depreciationSchedules?.[0] ?? null;
        const audit = latest ? {
          gross: Number(latest.closingGrossBlock),
          accDep: Number(latest.closingAccumulatedDep),
          net: Number(latest.closingNetBlock),
        } : null;

        const books = booksData?.[`pool_${pool.id}`] ?? null;

        const snap = await persistSnapshot({
          asOfDate: asOf,
          scope: "POOL",
          scopeId: pool.id,
          scopeLabel: `${pool.poolCode} (${pool.financialYear})`,
          system: { gross: sysGross, accDep: sysAccDep, net: sysNet },
          audit,
          books: books ? { gross: books.gross, accDep: books.accDep, net: books.net } : null,
          createdById: employeeId,
        });
        snapshots.push(snap);
      }
    }

    if (scope === "ASSET") {
      const assets = scopeIds?.length
        ? await prisma.asset.findMany({
            where: { id: { in: scopeIds.map(Number) } },
            include: { depreciation: true },
          })
        : await prisma.asset.findMany({ include: { depreciation: true } });

      for (const a of assets) {
        const sysGross = Number(a.purchaseCost ?? 0);
        const sysAccDep = Number(a.depreciation?.accumulatedDepreciation ?? 0);
        const sysNet = Number(a.depreciation?.currentBookValue ?? sysGross - sysAccDep);
        const auditedNB = Number((a as any).auditedBookValueAtMigration ?? 0);

        const snap = await persistSnapshot({
          asOfDate: asOf,
          scope: "ASSET",
          scopeId: a.id,
          scopeLabel: `${a.assetId} — ${a.assetName}`,
          system: { gross: sysGross, accDep: sysAccDep, net: sysNet },
          audit: auditedNB > 0 ? { gross: null, accDep: null, net: auditedNB } : null,
          books: null,
          createdById: employeeId,
        });
        snapshots.push(snap);
      }
    }

    const flagged = snapshots.filter(s => s.varianceFlagged).length;
    res.json({
      message: `Reconciliation snapshot generated for ${snapshots.length} ${scope.toLowerCase()}(s)`,
      total: snapshots.length,
      flagged,
      snapshots,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Reconciliation run failed", error: err.message });
  }
};

// ── GET /reconciliation — variance report ─────────────────────────────────────
export const getVarianceReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { asOf, scope, status, flaggedOnly, page = "1", limit = "50" } = req.query;
    const where: any = {};
    if (asOf)        where.asOfDate = new Date(String(asOf));
    if (scope)       where.scope = String(scope);
    if (status)      where.status = String(status);
    if (String(flaggedOnly) === "true") where.varianceFlagged = true;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));

    const [total, records] = await Promise.all([
      prisma.reconciliationSnapshot.count({ where }),
      prisma.reconciliationSnapshot.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: [{ varianceFlagged: "desc" }, { asOfDate: "desc" }],
        include: {
          createdBy:  { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
        } as any,
      }),
    ]);

    res.json({ data: records, pagination: { total, page: pageNum, limit: limitNum } });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Failed to load variance report", error: err.message });
  }
};

// ── GET /reconciliation/:id — drill-down detail ───────────────────────────────
export const getSnapshotDetail = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const snap = await prisma.reconciliationSnapshot.findUnique({
      where: { id },
      include: {
        createdBy:  { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
      } as any,
    });
    if (!snap) { res.status(404).json({ message: "Snapshot not found" }); return; }

    // Drill-down: fetch underlying assets for the scope
    let drilldown: any[] = [];
    if (snap.scope === "CATEGORY") {
      const assets = await prisma.asset.findMany({
        where: { assetCategoryId: snap.scopeId },
        select: {
          id: true, assetId: true, assetName: true,
          purchaseCost: true,
          depreciation: { select: { accumulatedDepreciation: true, currentBookValue: true } },
          auditedBookValueAtMigration: true,
        } as any,
      });
      drilldown = assets.map((a: any) => ({
        assetId: a.assetId, assetName: a.assetName,
        gross: Number(a.purchaseCost ?? 0),
        accDep: Number(a.depreciation?.accumulatedDepreciation ?? 0),
        net: Number(a.depreciation?.currentBookValue ?? 0),
        auditedNB: a.auditedBookValueAtMigration != null ? Number(a.auditedBookValueAtMigration) : null,
      }));
    } else if (snap.scope === "POOL") {
      const assets = await prisma.asset.findMany({
        where: { assetPoolId: snap.scopeId },
        select: {
          id: true, assetId: true, assetName: true, purchaseCost: true,
          depreciation: { select: { accumulatedDepreciation: true, currentBookValue: true } },
        },
      });
      drilldown = assets.map((a: any) => ({
        assetId: a.assetId, assetName: a.assetName,
        gross: Number(a.purchaseCost ?? 0),
        accDep: Number(a.depreciation?.accumulatedDepreciation ?? 0),
        net: Number(a.depreciation?.currentBookValue ?? 0),
      }));
    }

    res.json({ snapshot: snap, drilldown });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Failed to load snapshot detail", error: err.message });
  }
};

// ── PUT /reconciliation/:id/resolve — mark variance accepted/resolved ─────────
export const resolveSnapshot = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, resolutionNotes } = req.body;
    if (!["RESOLVED", "ACCEPTED"].includes(status)) {
      res.status(400).json({ message: "status must be RESOLVED or ACCEPTED" });
      return;
    }
    const updated = await prisma.reconciliationSnapshot.update({
      where: { id },
      data: {
        status,
        resolutionNotes: resolutionNotes || null,
        resolvedById: req.user?.employeeDbId ?? null,
        resolvedAt: new Date(),
      } as any,
    });
    res.json({ message: `Marked as ${status}`, snapshot: updated });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Failed to resolve snapshot", error: err.message });
  }
};

// ── GET /reconciliation/:id/export — Excel export for auditor sign-off ────────
// Lightweight CSV (Excel-openable) — no extra deps
export const exportSnapshot = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const snap = await prisma.reconciliationSnapshot.findUnique({ where: { id } });
    if (!snap) { res.status(404).json({ message: "Not found" }); return; }

    let assets: any[] = [];
    if (snap.scope === "CATEGORY") {
      assets = await prisma.asset.findMany({
        where: { assetCategoryId: snap.scopeId },
        include: { depreciation: true },
      });
    } else if (snap.scope === "POOL") {
      assets = await prisma.asset.findMany({
        where: { assetPoolId: snap.scopeId },
        include: { depreciation: true },
      });
    }

    const headers = [
      "Asset Code", "Asset Name", "Gross (System)", "Acc Dep (System)",
      "Net (System)", "Net (Audit)", "Variance",
    ].join(",");

    const rows = assets.map((a: any) => {
      const sysGross = Number(a.purchaseCost ?? 0);
      const sysAccDep = Number(a.depreciation?.accumulatedDepreciation ?? 0);
      const sysNet = Number(a.depreciation?.currentBookValue ?? sysGross - sysAccDep);
      const auditNB = Number((a as any).auditedBookValueAtMigration ?? 0);
      const variance = auditNB > 0 ? sysNet - auditNB : 0;
      return [
        a.assetId, `"${a.assetName.replace(/"/g, '""')}"`,
        sysGross.toFixed(2), sysAccDep.toFixed(2), sysNet.toFixed(2),
        auditNB > 0 ? auditNB.toFixed(2) : "", variance.toFixed(2),
      ].join(",");
    });

    const summary = [
      "", "TOTAL",
      Number(snap.systemGrossBlock ?? 0).toFixed(2),
      Number(snap.systemAccDep ?? 0).toFixed(2),
      Number(snap.systemNetBlock ?? 0).toFixed(2),
      snap.auditNetBlock != null ? Number(snap.auditNetBlock).toFixed(2) : "",
      Number(snap.varianceVsAudit).toFixed(2),
    ].join(",");

    const csv = [headers, ...rows, summary].join("\n");
    const filename = `reconciliation_${snap.scope}_${snap.scopeId}_${snap.asOfDate.toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Export failed", error: err.message });
  }
};

// ── Persistence helper ───────────────────────────────────────────────────────
async function persistSnapshot(params: {
  asOfDate: Date;
  scope: string;
  scopeId: number;
  scopeLabel: string;
  system: { gross: number; accDep: number; net: number };
  audit: { gross: number | null; accDep: number | null; net: number | null } | null;
  books: { gross: number | null; accDep: number | null; net: number | null } | null;
  createdById: number | null;
}) {
  const { asOfDate, scope, scopeId, scopeLabel, system, audit, books, createdById } = params;

  const auditNet = audit?.net ?? null;
  const booksNet = books?.net ?? null;

  const varVsBooks = booksNet != null ? Number((system.net - booksNet).toFixed(2)) : 0;
  const varVsAudit = auditNet != null ? Number((system.net - auditNet).toFixed(2)) : 0;
  const pctVsBooks = booksNet && booksNet !== 0 ? Number(((varVsBooks / booksNet) * 100).toFixed(2)) : null;
  const pctVsAudit = auditNet && auditNet !== 0 ? Number(((varVsAudit / auditNet) * 100).toFixed(2)) : null;

  // Flag if either variance exceeds ₹1 OR 0.5%
  const flagged = (Math.abs(varVsBooks) > 1 || Math.abs(varVsAudit) > 1) ||
                  (pctVsBooks != null && Math.abs(pctVsBooks) > 0.5) ||
                  (pctVsAudit != null && Math.abs(pctVsAudit) > 0.5);

  return prisma.reconciliationSnapshot.create({
    data: {
      asOfDate, scope, scopeId, scopeLabel,
      systemGrossBlock: system.gross.toFixed(2),
      systemAccDep:     system.accDep.toFixed(2),
      systemNetBlock:   system.net.toFixed(2),
      booksGrossBlock:  books?.gross != null ? books.gross.toFixed(2) : null,
      booksAccDep:      books?.accDep != null ? books.accDep.toFixed(2) : null,
      booksNetBlock:    books?.net != null ? books.net.toFixed(2) : null,
      auditGrossBlock:  audit?.gross != null ? audit.gross.toFixed(2) : null,
      auditAccDep:      audit?.accDep != null ? audit.accDep.toFixed(2) : null,
      auditNetBlock:    audit?.net != null ? audit.net.toFixed(2) : null,
      varianceVsBooks:  varVsBooks.toFixed(2),
      varianceVsAudit:  varVsAudit.toFixed(2),
      variancePctVsBooks: pctVsBooks != null ? pctVsBooks.toFixed(2) : null,
      variancePctVsAudit: pctVsAudit != null ? pctVsAudit.toFixed(2) : null,
      varianceFlagged: flagged,
      createdById,
    } as any,
  });
}

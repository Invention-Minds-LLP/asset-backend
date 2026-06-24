import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { ExternalAuditorRequest } from "../../middleware/externalAuditorMiddleware";
import { getFYLabel } from "../financial-dashboard/financial-dashboard.utils";

// DepreciationLog.fyLabel is stored as "FY2022-23"; getFYLabel(2022) → "2022-23".
function fyLabelFor(fiscalYear: number): string {
  return `FY${getFYLabel(fiscalYear)}`;
}

// Snapshot the depreciation booked for a financial year (keyed by fyLabel).
async function snapshotFY(fiscalYear: number) {
  const fyLabel = fyLabelFor(fiscalYear);
  const where = { fyLabel };

  const [sum, distinctAssets] = await Promise.all([
    prisma.depreciationLog.aggregate({ where, _sum: { depreciationAmount: true } }),
    prisma.depreciationLog.findMany({ where, distinct: ["assetId"], select: { assetId: true } }),
  ]);

  return {
    totalDepreciation: Number(sum._sum.depreciationAmount || 0),
    assetCount: distinctAssets.length,
  };
}

// Mark AUDITED once both CFO and CA have signed off.
function isFullyApproved(a: { cfoApprovedAt: Date | null; caApprovedAt: Date | null }) {
  return !!a.cfoApprovedAt && !!a.caApprovedAt;
}

// ─── List all audits ────────────────────────────────────────────────────────────
export const listAudits = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const audits = await prisma.depreciationAudit.findMany({
      orderBy: { fiscalYear: "desc" },
      include: {
        financeApprovedBy: { select: { name: true, employeeID: true } },
        cfoApprovedBy: { select: { name: true, employeeID: true } },
      },
    });
    res.json(audits.map((a) => ({ ...a, fyLabel: getFYLabel(a.fiscalYear) })));
  } catch (err: any) {
    console.error("listAudits error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Audit status for a single FY (used by the financial dashboard) ──────────────
// GET /status            → map of { [fiscalYear]: "AUDITED" | "PENDING" | "REJECTED" }
// GET /status?fy=2025    → the audit record for that FY (or { status: "UNAUDITED" })
export const getAuditStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.query.fy) {
      const fy = Number(req.query.fy);
      const audit = await prisma.depreciationAudit.findUnique({ where: { fiscalYear: fy } });
      res.json(audit ? { ...audit, fyLabel: getFYLabel(fy) } : { fiscalYear: fy, status: "UNAUDITED" });
      return;
    }
    const all = await prisma.depreciationAudit.findMany({ select: { fiscalYear: true, status: true } });
    const map: Record<number, string> = {};
    all.forEach((a) => (map[a.fiscalYear] = a.status));
    res.json({ statuses: map });
  } catch (err: any) {
    console.error("getAuditStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Financial years that have depreciation booked (candidates for audit) ────────
export const getAuditableYears = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await prisma.depreciationLog.findMany({
      where: { fyLabel: { not: null } },
      distinct: ["fyLabel"],
      select: { fyLabel: true },
    });
    const fySet = new Set<number>();
    for (const r of rows) {
      // "FY2022-23" → 2022
      const y = Number((r.fyLabel || "").replace("FY", "").split("-")[0]);
      if (y) fySet.add(y);
    }
    const years = [...fySet].sort((a, b) => b - a).map((y) => ({ fiscalYear: y, label: getFYLabel(y) }));
    res.json({ years });
  } catch (err: any) {
    console.error("getAuditableYears error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Preview an FY before initiating: assets + depreciation + per-asset breakdown ─
// GET /preview?fy=2022  — Finance reviews the position, then decides to initiate.
export const getPreview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const fiscalYear = Number(req.query.fy);
    if (!fiscalYear) { res.status(400).json({ message: "fy is required" }); return; }

    const fyLabel = fyLabelFor(fiscalYear);
    const snap = await snapshotFY(fiscalYear);

    // Per-asset depreciation detail for the year, so Finance can verify the
    // mechanics (rate, half/full-year rule, opening WDV, closing book value)
    // before initiating.
    const logs = await prisma.depreciationLog.findMany({
      where: { fyLabel },
      select: {
        assetId: true,
        depreciationAmount: true,
        bookValueAfter: true,
        openingWdv: true,
        depOnOpening: true,
        depOnAdditions: true,
        additionsAmount: true,
        effectiveRate: true,
        halfYearApplied: true,
        isFirstFY: true,
      },
    });

    const assetIds = [...new Set(logs.map((l) => l.assetId))];
    const [assets, deps] = await Promise.all([
      prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, assetId: true, assetName: true },
      }),
      prisma.assetDepreciation.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true, depreciationMethod: true, depreciationRate: true },
      }),
    ]);
    const amap = new Map(assets.map((a) => [a.id, a]));
    const dmap = new Map(deps.map((d) => [d.assetId, d]));

    const breakdown = logs
      .map((l) => ({
        id: l.assetId,
        assetCode: amap.get(l.assetId)?.assetId || "",
        assetName: amap.get(l.assetId)?.assetName || "",
        method: dmap.get(l.assetId)?.depreciationMethod || "",
        // Rate actually applied for the FY (after any half-year adjustment),
        // falling back to the configured base rate.
        rate: Number(l.effectiveRate ?? dmap.get(l.assetId)?.depreciationRate ?? 0),
        yearBasis: l.halfYearApplied ? "Half year" : "Full year",
        isFirstFY: !!l.isFirstFY,
        openingWdv: Number(l.openingWdv || 0),
        additionsAmount: Number(l.additionsAmount || 0),
        depreciation: Number(l.depreciationAmount || 0),
        closingBookValue: Number(l.bookValueAfter || 0),
      }))
      .sort((a, b) => b.depreciation - a.depreciation);

    const existing = await prisma.depreciationAudit.findUnique({ where: { fiscalYear } });

    res.json({
      fiscalYear,
      fyLabel,
      ...snap,
      breakdown,
      alreadyExists: !!existing && existing.status !== "REJECTED",
      status: existing?.status || "UNAUDITED",
    });
  } catch (err: any) {
    console.error("getPreview error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Finance HOD creates (and thereby approves) an FY audit ──────────────────────
export const createAudit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }
    if (req.user.role !== "FINANCE") {
      res.status(403).json({ message: "Only the FINANCE (Finance HOD) role can initiate a depreciation audit" });
      return;
    }
    const fiscalYear = Number(req.body.fiscalYear);
    const notes = req.body.notes ? String(req.body.notes) : null;
    if (!fiscalYear) {
      res.status(400).json({ message: "fiscalYear is required" });
      return;
    }

    const employeeId = req.user.employeeDbId;
    if (!employeeId) {
      res.status(400).json({ message: "No employee context on token" });
      return;
    }

    const snap = await snapshotFY(fiscalYear);
    const existing = await prisma.depreciationAudit.findUnique({ where: { fiscalYear } });

    // Re-submitting a previously rejected year resets the approval chain.
    if (existing && existing.status !== "REJECTED") {
      res.status(409).json({ message: `An audit for FY ${getFYLabel(fiscalYear)} already exists (status: ${existing.status})` });
      return;
    }

    const data = {
      fiscalYear,
      status: "PENDING",
      notes,
      ...snap,
      financeApprovedById: employeeId,
      financeApprovedAt: new Date(),
      cfoApprovedById: null,
      cfoApprovedAt: null,
      caApprovedByEmail: null,
      caApprovedByName: null,
      caApprovedAt: null,
      rejectedByRole: null,
      rejectedByName: null,
      rejectionReason: null,
      rejectedAt: null,
    };

    const audit = existing
      ? await prisma.depreciationAudit.update({ where: { id: existing.id }, data })
      : await prisma.depreciationAudit.create({ data });

    res.status(201).json({ ...audit, fyLabel: getFYLabel(fiscalYear) });
  } catch (err: any) {
    console.error("createAudit error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── CFO approval ────────────────────────────────────────────────────────────────
export const cfoApprove = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }
    if (req.user.role !== "CFO") {
      res.status(403).json({ message: "Only the CFO role can approve here" });
      return;
    }
    const id = Number(req.params.id);
    const audit = await prisma.depreciationAudit.findUnique({ where: { id } });
    if (!audit) { res.status(404).json({ message: "Audit not found" }); return; }
    if (audit.status === "REJECTED") { res.status(400).json({ message: "Audit was rejected; awaiting Finance resubmission" }); return; }
    if (audit.cfoApprovedAt) { res.status(400).json({ message: "CFO has already approved this audit" }); return; }

    const now = new Date();
    const fullyApproved = isFullyApproved({ cfoApprovedAt: now, caApprovedAt: audit.caApprovedAt });
    const updated = await prisma.depreciationAudit.update({
      where: { id },
      data: {
        cfoApprovedById: req.user.employeeDbId,
        cfoApprovedAt: now,
        status: fullyApproved ? "AUDITED" : "PENDING",
      },
    });
    res.json({ ...updated, fyLabel: getFYLabel(updated.fiscalYear) });
  } catch (err: any) {
    console.error("cfoApprove error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── CFO rejection ───────────────────────────────────────────────────────────────
export const cfoReject = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }
    if (req.user.role !== "CFO") {
      res.status(403).json({ message: "Only the CFO role can reject here" });
      return;
    }
    const id = Number(req.params.id);
    const reason = req.body.reason ? String(req.body.reason) : null;
    const audit = await prisma.depreciationAudit.findUnique({ where: { id } });
    if (!audit) { res.status(404).json({ message: "Audit not found" }); return; }
    if (audit.status === "AUDITED") { res.status(400).json({ message: "Audit is already finalized" }); return; }

    const updated = await prisma.depreciationAudit.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectedByRole: "CFO",
        rejectedByName: req.user.name || "CFO",
        rejectionReason: reason,
        rejectedAt: new Date(),
      },
    });
    res.json({ ...updated, fyLabel: getFYLabel(updated.fiscalYear) });
  } catch (err: any) {
    console.error("cfoReject error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── External CA: list depreciation audits awaiting / showing their sign-off ─────
export const listAuditsForCA = async (_req: ExternalAuditorRequest, res: Response) => {
  try {
    const audits = await prisma.depreciationAudit.findMany({
      orderBy: { fiscalYear: "desc" },
      include: {
        financeApprovedBy: { select: { name: true } },
        cfoApprovedBy: { select: { name: true } },
      },
    });
    res.json(audits.map((a) => ({ ...a, fyLabel: getFYLabel(a.fiscalYear) })));
  } catch (err: any) {
    console.error("listAuditsForCA error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── External CA approval ────────────────────────────────────────────────────────
export const caApprove = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const email = req.externalAuditor?.email;
    if (!email) { res.status(401).json({ message: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const audit = await prisma.depreciationAudit.findUnique({ where: { id } });
    if (!audit) { res.status(404).json({ message: "Audit not found" }); return; }
    if (audit.status === "REJECTED") { res.status(400).json({ message: "Audit was rejected; awaiting Finance resubmission" }); return; }
    if (audit.caApprovedAt) { res.status(400).json({ message: "The external CA has already approved this audit" }); return; }

    const auditor = await prisma.externalAuditor.findUnique({ where: { email }, select: { name: true } });

    const now = new Date();
    const fullyApproved = isFullyApproved({ cfoApprovedAt: audit.cfoApprovedAt, caApprovedAt: now });
    const updated = await prisma.depreciationAudit.update({
      where: { id },
      data: {
        caApprovedByEmail: email,
        caApprovedByName: auditor?.name || email,
        caApprovedAt: now,
        status: fullyApproved ? "AUDITED" : "PENDING",
      },
    });
    res.json({ ...updated, fyLabel: getFYLabel(updated.fiscalYear) });
  } catch (err: any) {
    console.error("caApprove error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── External CA rejection ───────────────────────────────────────────────────────
export const caReject = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const email = req.externalAuditor?.email;
    if (!email) { res.status(401).json({ message: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const reason = req.body.reason ? String(req.body.reason) : null;
    const audit = await prisma.depreciationAudit.findUnique({ where: { id } });
    if (!audit) { res.status(404).json({ message: "Audit not found" }); return; }
    if (audit.status === "AUDITED") { res.status(400).json({ message: "Audit is already finalized" }); return; }

    const auditor = await prisma.externalAuditor.findUnique({ where: { email }, select: { name: true } });

    const updated = await prisma.depreciationAudit.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectedByRole: "CA",
        rejectedByName: auditor?.name || email,
        rejectionReason: reason,
        rejectedAt: new Date(),
      },
    });
    res.json({ ...updated, fyLabel: getFYLabel(updated.fiscalYear) });
  } catch (err: any) {
    console.error("caReject error:", err);
    res.status(500).json({ message: err.message });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getAdminIds } from "../../utilis/notificationHelper";
import { buildAuditMap, computeNextItem, buildZoneProgress } from "../../utilis/auditMap";
import { buildGuidance } from "../../utilis/auditGuidance";
import { buildStartOptions, buildRun, RUN_MODES, RunMode } from "../../utilis/auditRunPlan";
import {
  buildChecklist,
  pendingRequiredItems,
  resolveSticker,
  applyStickerToAsset,
  applyLocationNote,
  buildLocationReadiness,
} from "../../utilis/auditChecklist";

// Accept categoryIds as number[], single value, or comma-separated string.
const normalizeIds = (raw: any): number[] => {
  if (raw == null || raw === "") return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(",");
  return [...new Set(arr.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
};

// Asset-level narrowing for a location-based scope, shared by every scope
// selector and by createAudit so the preview always matches what gets enrolled.
// Department and category MUST merge into one `asset` filter — assigning
// `where.asset` twice silently drops the first condition, which is how
// departmentId came to be ignored whenever a floor was also chosen.
const assetScopeFilter = (departmentId: any, catIds: number[]): any | null => {
  const f: any = {};
  if (catIds.length) f.assetCategoryId = { in: catIds };
  if (departmentId) f.departmentId = Number(departmentId);
  return Object.keys(f).length ? f : null;
};

type AuditorRow =
  | { type: "INTERNAL"; employeeId: number }
  | { type: "EXTERNAL"; name: string; email: string; organization: string | null; phone: string | null };

// Validate the auditor payload against the chosen auditorType and return rows
// ready for nested create. INTERNAL needs >=1 employee; EXTERNAL needs >=1
// auditor with name + email; BOTH needs at least one of each.
//
// EXTERNAL rows can either be inline ({ name, email, organization?, phone? })
// or a reference to the ExternalAuditor master table by id
// ({ externalAuditorId: 42 }). Master-ref rows are snapshotted from the DB —
// the resulting AssetAuditor row is intentionally denormalized so renames in
// the master don't rewrite history on past audits.
const buildAuditorRows = async (
  auditorType: any,
  auditors: any,
  addedById?: number
): Promise<{ rows: AuditorRow[]; touchedMasterIds: number[]; error?: string }> => {
  if (!auditorType) return { rows: [], touchedMasterIds: [] }; // optional — no auditor assigned
  if (!["INTERNAL", "EXTERNAL", "BOTH"].includes(auditorType)) {
    return { rows: [], touchedMasterIds: [], error: "auditorType must be INTERNAL, EXTERNAL or BOTH" };
  }
  const list: any[] = Array.isArray(auditors) ? auditors : [];

  const internals: AuditorRow[] = [];
  const externals: AuditorRow[] = [];
  const masterIdsToLookup: number[] = [];
  const inlineExternals: { name: string; email: string; organization: string | null; phone: string | null }[] = [];

  for (const a of list) {
    if (a?.type === "INTERNAL" && a.employeeId != null && Number(a.employeeId) > 0) {
      internals.push({ type: "INTERNAL", employeeId: Number(a.employeeId) });
    } else if (a?.type === "EXTERNAL") {
      // Master-ref path: defer the row build until after the DB lookup.
      if (a.externalAuditorId != null && Number(a.externalAuditorId) > 0) {
        masterIdsToLookup.push(Number(a.externalAuditorId));
        continue;
      }
      // Inline path: free-typed details. Email is lowercased so it matches the
      // ExternalAuditor master (which stores lowercase) — that's what the
      // external login + portal scope check compare against.
      const name = (a.name || "").trim();
      const email = (a.email || "").trim().toLowerCase();
      if (name && email) {
        inlineExternals.push({
          name,
          email,
          organization: (a.organization || "").trim() || null,
          phone: (a.phone || "").trim() || null,
        });
      }
    }
  }

  // Auto-provision an ExternalAuditor master record for each inline external
  // auditor so they can actually log in (the OTP login + portal require a
  // master row with status=ACTIVE). Existing records are reactivated and
  // touched; admin-curated name/org/phone are left intact.
  if (inlineExternals.length) {
    if (!addedById) {
      return { rows: [], touchedMasterIds: [], error: "Unauthorized: cannot register external auditor" };
    }
    for (const ext of inlineExternals) {
      const master = await prisma.externalAuditor.upsert({
        where: { email: ext.email },
        update: { status: "ACTIVE", lastUsedAt: new Date() },
        create: {
          email: ext.email,
          name: ext.name,
          organization: ext.organization,
          phone: ext.phone,
          status: "ACTIVE",
          addedById,
        },
      });
      externals.push({
        type: "EXTERNAL",
        name: master.name,
        email: master.email,
        organization: master.organization,
        phone: master.phone,
      });
    }
  }

  if (masterIdsToLookup.length) {
    const masters = await prisma.externalAuditor.findMany({
      where: { id: { in: masterIdsToLookup }, status: "ACTIVE" },
    });
    const byId = new Map(masters.map((m) => [m.id, m]));
    for (const id of masterIdsToLookup) {
      const m = byId.get(id);
      if (!m) {
        return {
          rows: [],
          touchedMasterIds: [],
          error: `External auditor ${id} not found or inactive`,
        };
      }
      externals.push({
        type: "EXTERNAL",
        name: m.name,
        email: m.email,
        organization: m.organization,
        phone: m.phone,
      });
    }
  }

  const needInternal = auditorType === "INTERNAL" || auditorType === "BOTH";
  const needExternal = auditorType === "EXTERNAL" || auditorType === "BOTH";
  if (needInternal && !internals.length) {
    return { rows: [], touchedMasterIds: [], error: "Select at least one internal (employee) auditor" };
  }
  if (needExternal && !externals.length) {
    return { rows: [], touchedMasterIds: [], error: "Add at least one external auditor with a name and email" };
  }

  // Only keep the rows relevant to the selected type.
  const rows: AuditorRow[] = [
    ...(needInternal ? internals : []),
    ...(needExternal ? externals : []),
  ];
  return { rows, touchedMasterIds: needExternal ? masterIdsToLookup : [] };
};

// Attach employee details (name/employeeID) to INTERNAL auditor rows.
const enrichAuditors = async (auditors: any[]): Promise<any[]> => {
  if (!auditors?.length) return auditors ?? [];
  const empIds = [...new Set(auditors.filter((a) => a.type === "INTERNAL" && a.employeeId).map((a) => a.employeeId))];
  const emps = empIds.length
    ? await prisma.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, name: true, employeeID: true, designation: true },
      })
    : [];
  const byId = new Map(emps.map((e) => [e.id, e]));
  return auditors.map((a) => (a.type === "INTERNAL" ? { ...a, employee: byId.get(a.employeeId) ?? null } : a));
};

// GET /asset-audits
export const getAllAudits = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { page = "1", limit = "10" } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const [audits, total] = await Promise.all([
      prisma.assetAudit.findMany({
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        include: { auditors: true },
      }),
      prisma.assetAudit.count(),
    ]);

    const data = await Promise.all(
      audits.map(async (a: any) => ({ ...a, auditors: await enrichAuditors(a.auditors) }))
    );

    res.json({
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Error fetching audits:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/my — audits assigned to the logged-in auditor.
// Matches internal auditors by employeeId, external auditors by email.
export const getMyAudits = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const empId = req.user?.employeeDbId;
    const emp = empId
      ? await prisma.employee.findUnique({ where: { id: empId }, select: { email: true } })
      : null;

    const or: any[] = [];
    if (empId) or.push({ employeeId: empId });
    if (emp?.email) or.push({ email: emp.email });

    if (!or.length) {
      res.json({ data: [] });
      return;
    }

    const audits = await prisma.assetAudit.findMany({
      where: { auditors: { some: { OR: or } } },
      include: { auditors: true },
      orderBy: { createdAt: "desc" },
    });

    const data = await Promise.all(
      audits.map(async (a: any) => ({ ...a, auditors: await enrichAuditors(a.auditors) }))
    );

    res.json({ data });
  } catch (error: any) {
    console.error("Error fetching my audits:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audits/:id
export const getAuditById = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
      where: { id: Number(id) },
      include: {
        items: {
          include: {
            asset: true,
          },
        },
        auditors: true,
      },
    });

    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    const data = { ...audit, auditors: await enrichAuditors((audit as any).auditors) };
    res.json({ data });
  } catch (error: any) {
    console.error("Error fetching audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audits/locations — distinct floor/block/room values from active approved locations
export const getAuditLocationOptions = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await prisma.assetLocation.findMany({
      where: { isActive: true, status: "APPROVED" },
      select: { floor: true, block: true, room: true },
      distinct: ["floor", "block", "room"],
      orderBy: [{ floor: "asc" }, { block: "asc" }, { room: "asc" }],
    });

    const floors = [...new Set(rows.map(r => r.floor).filter(Boolean))].sort();
    const blocks = [...new Set(rows.map(r => r.block).filter(Boolean))].sort();
    const rooms  = [...new Set(rows.map(r => r.room).filter(Boolean))].sort();

    res.json({ data: { floors, blocks, rooms, all: rows } });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// POST /asset-audits
export const createAudit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { auditName, auditDate, departmentId, branchId, floor, block, room, categoryIds, auditorType, auditors, groupBy } = req.body;

    if (!auditName || !auditDate) {
      res.status(400).json({ message: "auditName and auditDate are required" });
      return;
    }

    // Build/validate the auditor rows from the chosen type. Async because
    // master-ref external auditors trigger a DB lookup, and inline external
    // auditors are auto-provisioned into the ExternalAuditor master.
    const auditorRows = await buildAuditorRows(auditorType, auditors, req.user?.userId);
    if (auditorRows.error) {
      res.status(400).json({ message: auditorRows.error });
      return;
    }

    const catIds = normalizeIds(categoryIds);
    const useLocation = !!(floor || block || room);

    let assetIds: number[];

    if (useLocation) {
      // Location-based: assets whose current active approved location matches,
      // optionally narrowed to the chosen categories and/or department.
      const locationWhere: any = { isActive: true, status: "APPROVED" };
      if (branchId) locationWhere.branchId = Number(branchId);
      if (floor) locationWhere.floor = floor;
      if (block) locationWhere.block = block;
      if (room)  locationWhere.room  = room;
      const assetFilter = assetScopeFilter(departmentId, catIds);
      if (assetFilter) locationWhere.asset = assetFilter;

      const locations = await prisma.assetLocation.findMany({
        where: locationWhere,
        select: { assetId: true },
        distinct: ["assetId"],
      });
      assetIds = locations.map(l => l.assetId);
    } else {
      // Every asset in scope, whatever its lifecycle state. Disposed and
      // condemned ones are listed so the auditor can see the full picture; they
      // simply aren't required to be accounted for (see isRequired below).
      const assetWhere: any = {};
      if (departmentId) assetWhere.departmentId = Number(departmentId);
      // Asset has no branchId — the branch an asset currently sits at is the
      // denormalized currentBranchId kept in sync by lib/assetLocation.
      if (branchId) assetWhere.currentBranchId = Number(branchId);
      if (catIds.length) assetWhere.assetCategoryId = { in: catIds };
      const assets = await prisma.asset.findMany({ where: assetWhere, select: { id: true } });
      assetIds = assets.map(a => a.id);
    }

    // Snapshot each asset's lifecycle status now, so the audit still reads
    // correctly later, and decide which ones must be accounted for.
    const scopedAssets = assetIds.length
      ? await prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, status: true },
        })
      : [];
    const statusByAsset = new Map(scopedAssets.map((a) => [a.id, a.status]));

    // Resolve the floor plan captured in the location module (read-only consumer).
    let floorPlanId: number | null = null;
    if (useLocation && branchId && floor) {
      const planWhere: any = { isActive: true, branchId: Number(branchId), floor };
      if (block) planWhere.block = block;
      const plan = await (prisma as any).floorPlan.findFirst({
        where: planWhere,
        orderBy: { createdAt: "desc" },
      });
      floorPlanId = plan?.id ?? null;
    }

    // Snapshot the category scope (id + name) for display.
    let categoryScope: string | null = null;
    let categoryNames: string[] = [];
    if (catIds.length) {
      const cats = await prisma.assetCategory.findMany({
        where: { id: { in: catIds } },
        select: { id: true, name: true },
      });
      categoryNames = cats.map(c => c.name);
      categoryScope = JSON.stringify(cats);
    }

    const scopeParts: string[] = [];
    if (useLocation) scopeParts.push(`Location: ${[floor, block, room].filter(Boolean).join(" / ")}`);
    if (categoryNames.length) scopeParts.push(`Categories: ${categoryNames.join(", ")}`);
    const description = scopeParts.length ? scopeParts.join(" | ") : undefined;

    const audit = await prisma.assetAudit.create({
      data: {
        auditName,
        auditDate: new Date(auditDate),
        status: "PLANNED",
        departmentId: departmentId ? Number(departmentId) : null,
        branchId: branchId ? Number(branchId) : null,
        floor: floor || null,
        block: block || null,
        floorPlanId,
        categoryScope,
        auditorType: auditorType || null,
        groupBy: ["FLOOR", "DEPARTMENT", "ASSET"].includes(String(groupBy).toUpperCase())
          ? String(groupBy).toUpperCase()
          : "FLOOR",
        conductedById: req.user?.id ?? null,
        totalAssets: assetIds.length,
        ...(description ? { description } : {}),
        ...(auditorRows.rows.length ? { auditors: { create: auditorRows.rows } } : {}),
        items: {
          create: assetIds.map((id) => {
            const assetStatus = statusByAsset.get(id) ?? null;
            return {
              assetId: id,
              status: "PENDING",
              assetStatusAtAudit: assetStatus,
              // Only live assets have to be found before the audit can close.
              isRequired: assetStatus === "ACTIVE",
            };
          }),
        },
      },
      include: { items: true, auditors: true },
    });

    // Touch lastUsedAt on each ExternalAuditor master that was referenced.
    // Fire-and-forget so the audit response isn't delayed.
    if (auditorRows.touchedMasterIds.length) {
      prisma.externalAuditor
        .updateMany({
          where: { id: { in: auditorRows.touchedMasterIds } },
          data: { lastUsedAt: new Date() },
        })
        .catch((err) => console.error("Failed to touch ExternalAuditor.lastUsedAt:", err));
    }

    const enriched = { ...audit, auditors: await enrichAuditors((audit as any).auditors) };
    res.status(201).json({ data: enriched, message: "Audit created successfully" });
  } catch (error: any) {
    console.error("Error creating audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /asset-audits/:id/start
export const startAudit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
      where: { id: Number(id) },
    });

    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    if (audit.status !== "PLANNED") {
      res.status(400).json({ message: "Audit must be in PLANNED status to start" });
      return;
    }

    const updated = await prisma.assetAudit.update({
      where: { id: Number(id) },
      data: { status: "IN_PROGRESS" },
    });

    res.json({ data: updated, message: "Audit started" });
  } catch (error: any) {
    console.error("Error starting audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /asset-audits/items/:itemId/verify
export const verifyItem = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { itemId } = req.params;
    const {
      status,
      locationMatch,
      conditionMatch,
      actualLocation,
      actualCondition,
      remarks,
      stickerStatus,
      scanned,
      locationNote,
    } = req.body;

    if (!status || !["VERIFIED", "MISSING", "MISMATCH"].includes(status)) {
      res.status(400).json({ message: "status must be one of VERIFIED, MISSING, or MISMATCH" });
      return;
    }

    const item = await prisma.assetAuditItem.findUnique({
      where: { id: Number(itemId) },
    });

    if (!item) {
      res.status(404).json({ message: "Audit item not found" });
      return;
    }

    // A successful scan proves the sticker is on the asset and readable, so it
    // counts as PRESENT without asking. Shared with the external portal.
    const sticker = resolveSticker(stickerStatus, scanned);

    const updated = await prisma.assetAuditItem.update({
      where: { id: Number(itemId) },
      data: {
        status,
        scannedAt: new Date(),
        locationMatch: locationMatch != null ? locationMatch : null,
        conditionMatch: conditionMatch != null ? conditionMatch : null,
        actualLocation: actualLocation || null,
        actualCondition: actualCondition || null,
        remarks: remarks || null,
        verifiedById: req.user?.id ?? null,
        ...(sticker ? { stickerStatus: sticker, stickerCheckedAt: new Date() } : {}),
      },
    });

    // Push the observation onto the asset itself, so the stickering programme
    // is driven by what was actually seen on the floor.
    await applyStickerToAsset(sticker, item.assetId, item.auditId, req.user?.id ?? null);

    // The auditor is standing in front of the asset — the cheapest and most
    // accurate moment to capture a location note that was never filled in.
    // Writes onto the active location row so every later audit benefits.
    await applyLocationNote(locationNote, item.assetId);

    res.json({ data: updated, message: "Audit item verified" });
  } catch (error: any) {
    console.error("Error verifying audit item:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// PUT /asset-audits/:id/complete
export const completeAudit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
      where: { id: Number(id) },
    });

    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    if (audit.status !== "IN_PROGRESS") {
      res.status(400).json({ message: "Audit must be in IN_PROGRESS status to complete" });
      return;
    }

    // Every ACTIVE asset must be accounted for — verified, missing or mismatch.
    // Disposed/condemned ones are listed for context and never block closure.
    const blockers = await pendingRequiredItems(Number(id));
    if (blockers.length) {
      res.status(400).json({
        message:
          `${blockers.length} active asset${blockers.length === 1 ? "" : "s"} still unchecked. ` +
          `Mark each one verified, missing or mismatch before completing the audit.`,
        blockingCount: blockers.length,
        examples: blockers.slice(0, 10).map((b) => ({
          itemId: b.id,
          assetCode: b.asset?.assetId ?? null,
          assetName: b.asset?.assetName ?? null,
        })),
      });
      return;
    }

    const items = await prisma.assetAuditItem.findMany({
      where: { auditId: Number(id) },
    });

    const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
    const missingCount = items.filter((i) => i.status === "MISSING").length;
    const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;

    const updated = await prisma.assetAudit.update({
      where: { id: Number(id) },
      data: {
        status: "COMPLETED",
        verifiedCount,
        missingCount,
        mismatchCount,
        completedAt: new Date(),
      },
    });

    // Notify admins with audit results
    getAdminIds().then(adminIds =>
      notify({
        type: "OTHER",
        title: "Asset Audit Completed",
        message: `Audit "${audit.auditName}" completed: ${verifiedCount} verified, ${missingCount} missing, ${mismatchCount} mismatched out of ${items.length} assets`,
        recipientIds: adminIds,
        priority: missingCount > 0 || mismatchCount > 0 ? "HIGH" : "MEDIUM",
        createdById: req.user?.id ?? undefined,
      })
    ).catch(() => {});

    res.json({ data: updated, message: "Audit completed" });
  } catch (error: any) {
    console.error("Error completing audit:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audits/:id/summary
export const getAuditSummary = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const audit = await prisma.assetAudit.findUnique({
      where: { id: Number(id) },
    });

    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    const items = await prisma.assetAuditItem.findMany({
      where: { auditId: Number(id) },
      include: {
        asset: {
          select: { id: true, assetName: true, assetId: true },
        },
      },
    });

    const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
    const missingCount = items.filter((i) => i.status === "MISSING").length;
    const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;
    const pendingCount = items.filter((i) => i.status === "PENDING").length;

    const missingItems = items.filter((i) => i.status === "MISSING");
    const mismatchItems = items.filter((i) => i.status === "MISMATCH");

    res.json({
      data: {
        auditId: audit.id,
        auditName: audit.auditName,
        status: audit.status,
        totalAssets: audit.totalAssets,
        verifiedCount,
        missingCount,
        mismatchCount,
        pendingCount,
        missingItems,
        mismatchItems,
      },
    });
  } catch (error: any) {
    console.error("Error fetching audit summary:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Scope selectors — drive the create wizard (floor↔category, either order)
// ═══════════════════════════════════════════════════════════════════════════

// GET /asset-audit/scope/floors?branchId=&categoryIds=
// Distinct floors from active+approved locations, optionally filtered by category.
export const getScopeFloors = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, departmentId } = req.query as Record<string, string | undefined>;
    const catIds = normalizeIds(req.query.categoryIds);

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    const assetFilter = assetScopeFilter(departmentId, catIds);
    if (assetFilter) where.asset = assetFilter;

    const rows = await prisma.assetLocation.findMany({
      where,
      select: { floor: true },
      distinct: ["floor"],
      orderBy: { floor: "asc" },
    });

    const floors = [...new Set(rows.map((r) => r.floor).filter(Boolean))];
    res.json({ data: floors });
  } catch (error: any) {
    console.error("Error fetching scope floors:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/scope/blocks?branchId=&floor=
// Distinct blocks from active+approved locations, within the chosen branch/floor.
export const getScopeBlocks = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, floor, departmentId } = req.query as Record<string, string | undefined>;
    const catIds = normalizeIds(req.query.categoryIds);

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (floor) where.floor = floor;
    const assetFilter = assetScopeFilter(departmentId, catIds);
    if (assetFilter) where.asset = assetFilter;

    const rows = await prisma.assetLocation.findMany({
      where,
      select: { block: true },
      distinct: ["block"],
      orderBy: { block: "asc" },
    });

    const blocks = [...new Set(rows.map((r) => r.block).filter(Boolean))];
    res.json({ data: blocks });
  } catch (error: any) {
    console.error("Error fetching scope blocks:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/scope/rooms?branchId=&floor=&block=
// Distinct rooms from active+approved locations, within the chosen branch/floor/block.
export const getScopeRooms = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, floor, block, departmentId } = req.query as Record<string, string | undefined>;
    const catIds = normalizeIds(req.query.categoryIds);

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (floor) where.floor = floor;
    if (block) where.block = block;
    const assetFilter = assetScopeFilter(departmentId, catIds);
    if (assetFilter) where.asset = assetFilter;

    const rows = await prisma.assetLocation.findMany({
      where,
      select: { room: true },
      distinct: ["room"],
      orderBy: { room: "asc" },
    });

    const rooms = [...new Set(rows.map((r) => r.room).filter(Boolean))];
    res.json({ data: rooms });
  } catch (error: any) {
    console.error("Error fetching scope rooms:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/scope/categories?branchId=&floor=&block=&room=
// Categories present in the scope, each with a distinct-asset count.
export const getScopeCategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, floor, block, room, departmentId } = req.query as Record<string, string | undefined>;

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (floor) where.floor = floor;
    if (block) where.block = block;
    if (room) where.room = room;
    // Category deliberately not applied — this endpoint IS the category picker.
    const assetFilter = assetScopeFilter(departmentId, []);
    if (assetFilter) where.asset = assetFilter;

    const locations = await prisma.assetLocation.findMany({
      where,
      select: {
        assetId: true,
        asset: { select: { assetCategory: { select: { id: true, name: true } } } },
      },
      distinct: ["assetId"],
    });

    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const l of locations) {
      const c = l.asset?.assetCategory;
      if (!c) continue;
      const e = map.get(c.id) ?? { id: c.id, name: c.name, count: 0 };
      e.count++;
      map.set(c.id, e);
    }

    res.json({ data: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error: any) {
    console.error("Error fetching scope categories:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/scope/preview?branchId=&floor=&block=&room=&categoryIds=
// How many assets the audit would cover, with pinned/unpinned + per-category breakdown.
// Must mirror createAudit's location filter (branch/floor/block/room) exactly so
// the previewed count matches the assets actually enrolled.
export const getScopePreview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, floor, block, room, departmentId } = req.query as Record<string, string | undefined>;
    const catIds = normalizeIds(req.query.categoryIds);

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (floor) where.floor = floor;
    if (block) where.block = block;
    if (room) where.room = room;
    const assetFilter = assetScopeFilter(departmentId, catIds);
    if (assetFilter) where.asset = assetFilter;

    const locations = await prisma.assetLocation.findMany({
      where,
      select: {
        assetId: true,
        planX: true,
        floorPlanId: true,
        asset: { select: { assetCategory: { select: { id: true, name: true } } } },
      },
      distinct: ["assetId"],
    });

    const total = locations.length;
    const pinned = locations.filter((l) => l.floorPlanId != null && l.planX != null).length;

    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const l of locations) {
      const c = l.asset?.assetCategory;
      if (!c) continue;
      const e = map.get(c.id) ?? { id: c.id, name: c.name, count: 0 };
      e.count++;
      map.set(c.id, e);
    }

    res.json({
      data: {
        total,
        pinned,
        unpinned: total - pinned,
        byCategory: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
  } catch (error: any) {
    console.error("Error fetching scope preview:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Floor map + next-asset routing
// ═══════════════════════════════════════════════════════════════════════════

// GET /asset-audit/:id/floor-map
export const getFloorMap = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await buildAuditMap(Number(req.params.id));
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const { audit, plan, placed, unplaced } = result;
    res.json({
      data: {
        auditId: audit.id,
        auditName: audit.auditName,
        status: audit.status,
        floor: (audit as any).floor ?? null,
        block: (audit as any).block ?? null,
        plan,
        placed,
        unplaced,
      },
    });
  } catch (error: any) {
    console.error("Error building floor map:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/:id/zone-progress
// Room-level rollup of the audit onto the floor plan's traced zones: per-room
// verified/missing/pending counts, the room walking order, and the not-found
// list. Drives the progress heatmap on the audit map.
export const getZoneProgress = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await buildZoneProgress(Number(req.params.id));
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const { audit, plan, zones, walkingOrder, notFound, totals } = result;
    res.json({
      data: {
        auditId: audit.id,
        auditName: audit.auditName,
        status: audit.status,
        plan,
        zones,
        walkingOrder,
        notFound,
        totals,
      },
    });
  } catch (error: any) {
    console.error("Error building zone progress:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CHECKLIST — the primary way to work an audit.
//  A grouped, filterable list rather than a plan covered in pins. Every asset in
//  scope appears, whatever its lifecycle state, so the auditor can see that a
//  missing machine was actually disposed of last year.
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_MODES = ["FLOOR", "DEPARTMENT", "ASSET"];

/** Disposal requests that are still open — an asset in this state isn't "missing". */
const OPEN_DISPOSAL = ["REQUESTED", "COMMITTEE_REVIEW", "APPROVED"];

// GET /asset-audit/location-readiness?branchId=&departmentId=&floor=&block=&room=
// How much of a prospective scope the guided audit can actually direct someone
// to. Shown on the create-audit screen so gaps get fixed before audit day.
export const getLocationReadiness = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await buildLocationReadiness({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      departmentId: req.query.departmentId ? Number(req.query.departmentId) : null,
      floor: (req.query.floor as string) || null,
      block: (req.query.block as string) || null,
      room: (req.query.room as string) || null,
    });
    res.json({ data });
  } catch (error: any) {
    console.error("Error building location readiness:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/:id/checklist?groupBy=&assetStatus=&itemStatus=&q=
export const getChecklist = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await buildChecklist(Number(req.params.id), {
      groupBy: req.query.groupBy as string,
      assetStatus: req.query.assetStatus as string,
      itemStatus: req.query.itemStatus as string,
      sticker: req.query.sticker as string,
      q: req.query.q as string,
    });
    if (!data) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data });
  } catch (error: any) {
    console.error("Error building checklist:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/:id/completion-check
// Lets the UI explain why "Complete audit" is disabled before it is pressed.
export const getCompletionCheck = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const blockers = await pendingRequiredItems(auditId);
    res.json({
      data: {
        canComplete: blockers.length === 0 && audit.status === "IN_PROGRESS",
        auditStatus: audit.status,
        blockingCount: blockers.length,
        examples: blockers.slice(0, 10).map((b) => ({
          itemId: b.id,
          assetCode: b.asset?.assetId ?? null,
          assetName: b.asset?.assetName ?? null,
        })),
      },
    });
  } catch (error: any) {
    console.error("Error checking completion:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
//  RUN PLAN — "how do you want to start?" then work the assets
//  Built from AssetLocation text, so it works whether or not a floor plan or
//  traced rooms exist. See utilis/auditRunPlan.ts.
// ─────────────────────────────────────────────────────────────────────────────

const asRunMode = (v: any): RunMode => {
  const m = String(v ?? "").toUpperCase();
  return (RUN_MODES as string[]).includes(m) ? (m as RunMode) : ("FLOOR" as RunMode);
};

// GET /asset-audit/:id/start-options?mode=FLOOR|DEPARTMENT|ASSET
// The floors / departments this audit actually covers, with what is left in each.
export const getStartOptions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
    if (!audit) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const mode = req.query.mode ? asRunMode(req.query.mode) : (((audit as any).groupBy as RunMode) || "FLOOR");
    const result = await buildStartOptions(auditId, mode);
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data: result });
  } catch (error: any) {
    console.error("Error building start options:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/:id/run?mode=&group=&fromItemId=
// The ordered walk through one floor/department: where you are and what's next.
export const getRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const result = await buildRun(auditId, {
      mode: req.query.mode ? asRunMode(req.query.mode) : undefined,
      group: req.query.group != null ? String(req.query.group) : null,
      fromItemId: req.query.fromItemId ? Number(req.query.fromItemId) : null,
      placement: req.query.placement as any,
    });
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data: result });
  } catch (error: any) {
    console.error("Error building run plan:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/:id/guidance?roomId=&fromItemId=
// Guidance mode: one room at a time with ready-to-speak lines, instead of a plan
// covered in pins. Returns the room being worked, its assets in sweep order, the
// next room, and the remaining route.
export const getGuidance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const roomId = req.query.roomId ? Number(req.query.roomId) : null;
    const fromItemId = req.query.fromItemId ? Number(req.query.fromItemId) : null;
    const stopIndex = req.query.stopIndex != null ? Number(req.query.stopIndex) : null;
    const result = await buildGuidance(Number(req.params.id), { roomId, fromItemId, stopIndex });
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data: result });
  } catch (error: any) {
    console.error("Error building guidance:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// GET /asset-audit/:id/next-item?fromItemId=
// Greedy nearest-neighbour route over PENDING pinned items: finish the current
// room first, then step to the nearest real room; lobby/veranda/corridor are
// de-prioritised pass-through spaces. Returns the next item + the full route.
export const getNextItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await buildAuditMap(Number(req.params.id));
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const fromItemId = req.query.fromItemId ? Number(req.query.fromItemId) : null;
    res.json({ data: computeNextItem(result.plan, result.placed, fromItemId) });
  } catch (error: any) {
    console.error("Error computing next audit item:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

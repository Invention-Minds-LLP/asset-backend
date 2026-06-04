import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getAdminIds } from "../../utilis/notificationHelper";

// Accept categoryIds as number[], single value, or comma-separated string.
const normalizeIds = (raw: any): number[] => {
  if (raw == null || raw === "") return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(",");
  return [...new Set(arr.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
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
  auditors: any
): Promise<{ rows: AuditorRow[]; touchedMasterIds: number[]; error?: string }> => {
  if (!auditorType) return { rows: [], touchedMasterIds: [] }; // optional — no auditor assigned
  if (!["INTERNAL", "EXTERNAL", "BOTH"].includes(auditorType)) {
    return { rows: [], touchedMasterIds: [], error: "auditorType must be INTERNAL, EXTERNAL or BOTH" };
  }
  const list: any[] = Array.isArray(auditors) ? auditors : [];

  const internals: AuditorRow[] = [];
  const externals: AuditorRow[] = [];
  const masterIdsToLookup: number[] = [];

  for (const a of list) {
    if (a?.type === "INTERNAL" && a.employeeId != null && Number(a.employeeId) > 0) {
      internals.push({ type: "INTERNAL", employeeId: Number(a.employeeId) });
    } else if (a?.type === "EXTERNAL") {
      // Master-ref path: defer the row build until after the DB lookup.
      if (a.externalAuditorId != null && Number(a.externalAuditorId) > 0) {
        masterIdsToLookup.push(Number(a.externalAuditorId));
        continue;
      }
      // Inline path: existing shape, no master row created.
      const name = (a.name || "").trim();
      const email = (a.email || "").trim();
      if (name && email) {
        externals.push({
          type: "EXTERNAL",
          name,
          email,
          organization: (a.organization || "").trim() || null,
          phone: (a.phone || "").trim() || null,
        });
      }
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
    const { auditName, auditDate, departmentId, branchId, floor, block, room, categoryIds, auditorType, auditors } = req.body;

    if (!auditName || !auditDate) {
      res.status(400).json({ message: "auditName and auditDate are required" });
      return;
    }

    // Build/validate the auditor rows from the chosen type. Async because
    // master-ref external auditors trigger a DB lookup.
    const auditorRows = await buildAuditorRows(auditorType, auditors);
    if (auditorRows.error) {
      res.status(400).json({ message: auditorRows.error });
      return;
    }

    const catIds = normalizeIds(categoryIds);
    const useLocation = !!(floor || block || room);

    let assetIds: number[];

    if (useLocation) {
      // Location-based: assets whose current active approved location matches,
      // optionally narrowed to the chosen categories.
      const locationWhere: any = { isActive: true, status: "APPROVED" };
      if (branchId) locationWhere.branchId = Number(branchId);
      if (floor) locationWhere.floor = floor;
      if (block) locationWhere.block = block;
      if (room)  locationWhere.room  = room;
      if (catIds.length) locationWhere.asset = { assetCategoryId: { in: catIds } };

      const locations = await prisma.assetLocation.findMany({
        where: locationWhere,
        select: { assetId: true },
        distinct: ["assetId"],
      });
      assetIds = locations.map(l => l.assetId);
    } else {
      const assetWhere: any = { status: { not: "DISPOSED" } };
      if (departmentId) assetWhere.departmentId = Number(departmentId);
      if (branchId) assetWhere.branchId = Number(branchId);
      if (catIds.length) assetWhere.assetCategoryId = { in: catIds };
      const assets = await prisma.asset.findMany({ where: assetWhere, select: { id: true } });
      assetIds = assets.map(a => a.id);
    }

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
        conductedById: req.user?.id ?? null,
        totalAssets: assetIds.length,
        ...(description ? { description } : {}),
        ...(auditorRows.rows.length ? { auditors: { create: auditorRows.rows } } : {}),
        items: {
          create: assetIds.map((id) => ({
            assetId: id,
            status: "PENDING",
          })),
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
      },
    });

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
    const { branchId } = req.query as Record<string, string | undefined>;
    const catIds = normalizeIds(req.query.categoryIds);

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (catIds.length) where.asset = { assetCategoryId: { in: catIds } };

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

// GET /asset-audit/scope/categories?branchId=&floor=&block=
// Categories present in the scope, each with a distinct-asset count.
export const getScopeCategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, floor, block } = req.query as Record<string, string | undefined>;

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (floor) where.floor = floor;
    if (block) where.block = block;

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

// GET /asset-audit/scope/preview?branchId=&floor=&block=&categoryIds=
// How many assets the audit would cover, with pinned/unpinned + per-category breakdown.
export const getScopePreview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { branchId, floor, block } = req.query as Record<string, string | undefined>;
    const catIds = normalizeIds(req.query.categoryIds);

    const where: any = { isActive: true, status: "APPROVED" };
    if (branchId) where.branchId = Number(branchId);
    if (floor) where.floor = floor;
    if (block) where.block = block;
    if (catIds.length) where.asset = { assetCategoryId: { in: catIds } };

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

const CONNECTOR_RE = /lobby|veranda|verandah|corridor|passage|foyer|hallway|hall|walkway|reception/i;
const isConnector = (room?: string | null) => !!room && CONNECTOR_RE.test(room);

type MappedItem = {
  itemId: number;
  assetId: number;
  assetCode: string | null;
  assetName: string | null;
  category: string;
  status: string;
  scannedAt: Date | null;
  room: string | null;
  planX: number | null;
  planY: number | null;
};

// Shared loader: resolves the audit's floor plan and maps every item to its
// current pin coordinates (read from the location module's AssetLocation rows).
const buildAuditMap = async (auditId: number) => {
  const audit = await prisma.assetAudit.findUnique({ where: { id: auditId } });
  if (!audit) return null;

  const items = await prisma.assetAuditItem.findMany({
    where: { auditId },
    include: {
      asset: {
        select: {
          id: true,
          assetId: true,
          assetName: true,
          assetCategory: { select: { name: true } },
        },
      },
    },
  });

  const assetIds = items.map((i) => i.assetId);
  const locs = assetIds.length
    ? await prisma.assetLocation.findMany({
        where: { assetId: { in: assetIds }, isActive: true },
        select: {
          assetId: true,
          room: true,
          planX: true,
          planY: true,
          floorPlanId: true,
        },
        orderBy: { id: "desc" },
      })
    : [];

  // Latest active location per asset.
  const locByAsset = new Map<number, (typeof locs)[number]>();
  for (const l of locs) if (!locByAsset.has(l.assetId)) locByAsset.set(l.assetId, l);

  // Resolve the plan: prefer the audit's stored floorPlanId, else the modal
  // floorPlanId across the items' pins.
  let planId = (audit as any).floorPlanId ?? null;
  if (!planId) {
    const counts = new Map<number, number>();
    for (const l of locs) if (l.floorPlanId) counts.set(l.floorPlanId, (counts.get(l.floorPlanId) ?? 0) + 1);
    let best = 0;
    for (const [pid, n] of counts) if (n > best) { best = n; planId = pid; }
  }
  const plan = planId
    ? await (prisma as any).floorPlan.findUnique({ where: { id: planId } })
    : null;

  const placed: MappedItem[] = [];
  const unplaced: MappedItem[] = [];
  for (const it of items) {
    const l = locByAsset.get(it.assetId);
    const base: MappedItem = {
      itemId: it.id,
      assetId: it.assetId,
      assetCode: it.asset?.assetId ?? null,
      assetName: it.asset?.assetName ?? null,
      category: it.asset?.assetCategory?.name ?? "",
      status: it.status,
      scannedAt: it.scannedAt,
      room: l?.room ?? null,
      planX: null,
      planY: null,
    };
    const pinnedHere = l && l.planX != null && l.planY != null && (!plan || l.floorPlanId === plan.id);
    if (pinnedHere) {
      placed.push({ ...base, planX: l!.planX, planY: l!.planY });
    } else {
      unplaced.push(base);
    }
  }

  return { audit, plan, placed, unplaced };
};

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
    const { plan, placed } = result;

    const W = plan?.width || 100;
    const H = plan?.height || 100;
    const norm = (i: MappedItem) => ({ x: ((i.planX ?? 0) / 100) * W, y: ((i.planY ?? 0) / 100) * H });

    // Pending pinned items, decorated with normalized coords.
    const pending = placed
      .filter((i) => i.status === "PENDING")
      .map((i) => ({ ...i, _x: norm(i).x, _y: norm(i).y }));

    if (!pending.length) {
      res.json({ data: { next: null, route: [] } });
      return;
    }

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    type P = (typeof pending)[number];
    const nearest = (cur: { x: number; y: number }, arr: P[]): P =>
      arr.reduce<{ item: P; d: number }>(
        (best, i) => {
          const d = dist(cur, { x: i._x, y: i._y });
          return d < best.d ? { item: i, d } : best;
        },
        { item: arr[0], d: Infinity }
      ).item;
    const centroid = (arr: P[]) => ({
      x: arr.reduce((s, i) => s + i._x, 0) / arr.length,
      y: arr.reduce((s, i) => s + i._y, 0) / arr.length,
    });
    const groupByRoom = (arr: P[]) => {
      const m = new Map<string, P[]>();
      for (const i of arr) {
        const k = i.room || "__none__";
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(i);
      }
      return [...m.entries()].map(([room, items]) => ({
        room: room === "__none__" ? null : room,
        items,
      }));
    };

    const pickNext = (cur: { x: number; y: number; room: string | null }, remaining: P[]): P => {
      // 1. Finish the current (real) room first.
      if (cur.room && !isConnector(cur.room)) {
        const sameRoom = remaining.filter((i) => i.room === cur.room);
        if (sameRoom.length) return nearest(cur, sameRoom);
      }
      // 2. Choose the next room by centroid distance; connectors only if nothing else.
      const groups = groupByRoom(remaining);
      const real = groups.filter((g) => !isConnector(g.room));
      const pool = real.length ? real : groups;
      let bestGroup = pool[0];
      let bestD = Infinity;
      for (const g of pool) {
        const d = dist(cur, centroid(g.items));
        if (d < bestD) { bestD = d; bestGroup = g; }
      }
      return nearest(cur, bestGroup.items);
    };

    // Starting position.
    const fromItemId = req.query.fromItemId ? Number(req.query.fromItemId) : null;
    let cur: { x: number; y: number; room: string | null } | null = null;
    if (fromItemId) {
      const f = placed.find((i) => i.itemId === fromItemId);
      if (f) cur = { x: norm(f).x, y: norm(f).y, room: f.room };
    }
    if (!cur) {
      const scanned = placed
        .filter((i) => i.scannedAt)
        .sort((a, b) => (b.scannedAt!.getTime() - a.scannedAt!.getTime()));
      if (scanned[0]) cur = { x: norm(scanned[0]).x, y: norm(scanned[0]).y, room: scanned[0].room };
    }
    if (!cur) {
      // Nothing scanned yet: start from a connector (entrance) centroid if any,
      // else the pending pin closest to the image origin.
      const conn = pending.filter((i) => isConnector(i.room));
      if (conn.length) {
        cur = { ...centroid(conn), room: null };
      } else {
        const start = nearest({ x: 0, y: 0 }, pending);
        cur = { x: start._x, y: start._y, room: start.room };
      }
    }

    // Build the full ordered route.
    const route: P[] = [];
    let remaining = [...pending];
    let pos = cur;
    while (remaining.length) {
      const nxt = pickNext(pos, remaining);
      route.push(nxt);
      remaining = remaining.filter((i) => i.itemId !== nxt.itemId);
      pos = { x: nxt._x, y: nxt._y, room: nxt.room };
    }

    const strip = (i: P) => ({
      itemId: i.itemId,
      assetId: i.assetId,
      assetCode: i.assetCode,
      assetName: i.assetName,
      category: i.category,
      room: i.room,
      planX: i.planX,
      planY: i.planY,
    });

    res.json({ data: { next: strip(route[0]), route: route.map(strip) } });
  } catch (error: any) {
    console.error("Error computing next audit item:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

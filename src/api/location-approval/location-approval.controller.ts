import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";
import { syncCurrentBranch } from "../../lib/assetLocation";

// ─────────────────────────────────────────────────────────────────────────────
// Location Approval module (modeled on the asset-transfer flow).
//
// A location change is submitted as a PENDING AssetLocation row (status
// REQUESTED, isActive=false) that does NOT disturb the asset's current active
// location until it's approved. Approver tier is derived from the requester's
// role:
//   • SUPERVISOR (and any non-management role) → HOD of the asset's department
//   • HOD                                      → MANAGEMENT
//   • MANAGEMENT / ADMIN                        → auto-approved (applied at once)
// Fallback: a non-management requester whose department has no HOD → MANAGEMENT.
//
// The tier is recomputed deterministically wherever needed, so no extra state
// has to be trusted.
// ─────────────────────────────────────────────────────────────────────────────

const MGMT_ROLES = new Set(["ADMIN", "CEO", "COO", "CEO_COO", "CFO"]);
const isMgmtRole = (role?: string | null) => !!role && MGMT_ROLES.has(role.toUpperCase());

type Level = "HOD" | "MANAGEMENT" | null;

// Employee ids that can approve a MANAGEMENT-tier change: CEO_COO/CFO employees
// plus anyone whose User.role is ADMIN.
async function getManagementIds(): Promise<number[]> {
  const emps = await prisma.employee.findMany({
    where: { role: { in: ["CEO_COO", "CFO"] as any }, isActive: true },
    select: { id: true },
  });
  const admins = await getAdminIds();
  return [...new Set<number>([...emps.map((e) => e.id), ...admins])];
}

// The approver tier a change needs, given the requester's role + the asset's
// department. Null means "no approval required" (auto-approve).
async function resolveLevel(requesterRole: string | null | undefined, departmentId: number | null | undefined): Promise<Level> {
  if (isMgmtRole(requesterRole)) return null;
  if ((requesterRole || "").toUpperCase() === "HOD") return "MANAGEMENT";
  // SUPERVISOR + everyone else → HOD, unless the department has no HOD.
  const hods = await getDepartmentHODs(departmentId ?? null);
  return hods.length ? "HOD" : "MANAGEMENT";
}

// Pull the placement payload out of a request body (mirrors addAssetLocation).
function locationDataFrom(body: any) {
  return {
    branchId: body.branchId,
    block: body.block ?? null,
    floor: body.floor ?? null,
    room: body.room ?? null,
    departmentSnapshot: body.departmentSnapshot ?? null,
    employeeResponsibleId: body.employeeResponsibleId ?? null,
    placementProfile: body.placementProfile ?? null,
    placementType: body.placementType ?? null,
    placementLabel: body.placementLabel ?? null,
    mountType: body.mountType ?? null,
    rackCode: body.rackCode ?? null,
    rackUnit: body.rackUnit ?? null,
    portRef: body.portRef ?? null,
    coverageArea: body.coverageArea ?? null,
    latitude: body.latitude != null && body.latitude !== "" ? Number(body.latitude) : null,
    longitude: body.longitude != null && body.longitude !== "" ? Number(body.longitude) : null,
  };
}

// POST /api/location-approval/request
// Submit a location change. Auto-applies for management; otherwise creates a
// pending record routed to the right approver tier.
export const requestLocationChange = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assetId, branchId, rfid, requestReason } = req.body || {};
    const me = req.user?.employeeDbId ?? null;

    if (!assetId) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }
    if (!branchId) {
      res.status(400).json({ message: "branchId is required" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
      select: { id: true, departmentId: true, assetName: true, assetId: true },
    });
    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    // Requester's authoritative role comes from the Employee record (same as
    // the transfer flow); ADMIN is a User.role so also honour req.user.role.
    const meEmp = me ? await prisma.employee.findUnique({ where: { id: me }, select: { role: true } }) : null;
    const managerish = isMgmtRole(req.user?.role) || isMgmtRole(meEmp?.role);
    const level: Level = managerish ? null : await resolveLevel(meEmp?.role, asset.departmentId);

    const data = locationDataFrom({ ...req.body, branchId });

    // ── Auto-approve path (management/admin): apply immediately. ──
    if (level === null) {
      const result = await prisma.$transaction(async (tx) => {
        await tx.assetLocation.updateMany({ where: { assetId: asset.id, isActive: true }, data: { isActive: false } });
        const created = await (tx as any).assetLocation.create({
          data: {
            assetId: asset.id,
            ...data,
            status: "APPROVED",
            isActive: true,
            requestedById: me,
            approvedById: me,
            approvedAt: new Date(),
            requestReason: requestReason || null,
          },
        });
        if (rfid) await tx.asset.update({ where: { id: asset.id }, data: { rfidCode: rfid } });
        await syncCurrentBranch(tx, asset.id, Number(branchId) ?? null);
        return created;
      });

      logAction({ entityType: "OTHER", entityId: asset.id, action: "UPDATE", description: `Location updated (auto-approved) for asset #${asset.id}`, performedById: me ?? undefined });
      res.status(201).json({ pending: false, message: "Location updated.", location: result });
      return;
    }

    // ── Pending path: create a REQUESTED row without touching the live one. ──
    // Supersede any earlier still-pending request for this asset.
    await prisma.assetLocation.updateMany({
      where: { assetId: asset.id, status: "REQUESTED", isActive: false },
      data: { status: "REJECTED", rejectionReason: "Superseded by a newer request" },
    });

    const pending = await (prisma as any).assetLocation.create({
      data: {
        assetId: asset.id,
        ...data,
        status: "REQUESTED",
        isActive: false,
        requestedById: me,
        requestReason: requestReason || null,
      },
    });

    const approverIds = level === "HOD" ? await getDepartmentHODs(asset.departmentId) : await getManagementIds();
    if (approverIds.length) {
      notify({
        type: "OTHER",
        title: "Location change to approve",
        message: `A location change for ${asset.assetName || asset.assetId} needs your approval.`,
        recipientIds: approverIds,
        assetId: asset.id,
        createdById: me ?? undefined,
        channel: "BOTH",
      } as any);
    }
    logAction({ entityType: "OTHER", entityId: asset.id, action: "CREATE", description: `Location change requested for asset #${asset.id} (needs ${level} approval)`, performedById: me ?? undefined });

    res.status(201).json({ pending: true, level, message: "Location change submitted for approval.", location: pending });
  } catch (err) {
    console.error("requestLocationChange error:", err);
    res.status(500).json({ message: "Failed to submit location change" });
  }
};

// GET /api/location-approval/pending
// Location changes awaiting the current user's approval.
export const getPendingApprovals = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user?.employeeDbId ?? null;
    if (!me) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const meEmp = await prisma.employee.findUnique({ where: { id: me }, select: { role: true } });
    const iAmMgmt = isMgmtRole(req.user?.role) || isMgmtRole(meEmp?.role);
    const iAmHod = (meEmp?.role || "").toUpperCase() === "HOD";

    const rows = await prisma.assetLocation.findMany({
      where: { status: "REQUESTED", isActive: false },
      include: {
        asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
        branch: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { requestedAt: "desc" },
    });

    // Deterministically recompute each row's tier; memoize dept→HOD lookups.
    const hodCache = new Map<number, number[]>();
    const hodsFor = async (deptId: number | null | undefined): Promise<number[]> => {
      const key = deptId ?? -1;
      if (!hodCache.has(key)) hodCache.set(key, await getDepartmentHODs(deptId ?? null));
      return hodCache.get(key)!;
    };

    const out: any[] = [];
    for (const r of rows) {
      const reqRole = (r as any).requestedBy?.role;
      const deptId = (r as any).asset?.departmentId ?? null;
      const level = await resolveLevel(reqRole, deptId);
      if (level === null) continue; // shouldn't be pending, skip defensively

      let mine = false;
      if (level === "HOD" && iAmHod) {
        const hods = await hodsFor(deptId);
        mine = hods.includes(me);
      } else if (level === "MANAGEMENT" && iAmMgmt) {
        mine = true;
      }
      if (mine) out.push({ ...r, approvalLevel: level });
    }

    res.json({ data: out });
  } catch (err) {
    console.error("getPendingApprovals error:", err);
    res.status(500).json({ message: "Failed to load pending approvals" });
  }
};

// GET /api/location-approval/my-requests
export const getMyRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user?.employeeDbId ?? null;
    if (!me) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const rows = await prisma.assetLocation.findMany({
      where: { requestedById: me },
      include: {
        asset: { select: { id: true, assetId: true, assetName: true } },
        branch: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
    res.json({ data: rows });
  } catch (err) {
    console.error("getMyRequests error:", err);
    res.status(500).json({ message: "Failed to load your requests" });
  }
};

// Shared gate: can the current user act on this pending change's tier?
async function canActOn(req: AuthenticatedRequest, location: any): Promise<{ ok: boolean; level: Level }> {
  const me = req.user?.employeeDbId ?? null;
  const level = await resolveLevel(location.requestedBy?.role, location.asset?.departmentId ?? null);
  if (!me || level === null) return { ok: false, level };
  if (level === "HOD") {
    const hods = await getDepartmentHODs(location.asset?.departmentId ?? null);
    return { ok: hods.includes(me), level };
  }
  // MANAGEMENT
  const meEmp = await prisma.employee.findUnique({ where: { id: me }, select: { role: true } });
  return { ok: isMgmtRole(req.user?.role) || isMgmtRole(meEmp?.role), level };
}

// POST /api/location-approval/:id/approve
export const approveLocationChange = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const me = req.user?.employeeDbId ?? null;

    const location: any = await prisma.assetLocation.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, departmentId: true, assetName: true, assetId: true } },
        requestedBy: { select: { id: true, role: true } },
      },
    });
    if (!location || location.status !== "REQUESTED") {
      res.status(404).json({ message: "Pending location change not found" });
      return;
    }

    const { ok } = await canActOn(req, location);
    if (!ok) {
      res.status(403).json({ message: "You are not allowed to approve this location change" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.assetLocation.updateMany({ where: { assetId: location.assetId, isActive: true }, data: { isActive: false } });
      const u = await tx.assetLocation.update({
        where: { id },
        data: { status: "APPROVED", isActive: true, approvedById: me, approvedAt: new Date(), approvalReason: reason || null },
      });
      await syncCurrentBranch(tx, location.assetId, location.branchId ?? null);
      return u;
    });

    if (location.requestedById) {
      notify({ type: "OTHER", title: "Location change approved", message: `Your location change for ${location.asset?.assetName || location.asset?.assetId} was approved.`, recipientIds: [location.requestedById], assetId: location.assetId, createdById: me ?? undefined, channel: "BOTH" } as any);
    }
    logAction({ entityType: "OTHER", entityId: location.assetId, action: "APPROVE", description: `Location change #${id} approved for asset #${location.assetId}`, performedById: me ?? undefined });

    res.json({ message: "Location change approved.", location: updated });
  } catch (err) {
    console.error("approveLocationChange error:", err);
    res.status(500).json({ message: "Failed to approve location change" });
  }
};

// POST /api/location-approval/:id/reject
export const rejectLocationChange = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const me = req.user?.employeeDbId ?? null;

    const location: any = await prisma.assetLocation.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, departmentId: true, assetName: true, assetId: true } },
        requestedBy: { select: { id: true, role: true } },
      },
    });
    if (!location || location.status !== "REQUESTED") {
      res.status(404).json({ message: "Pending location change not found" });
      return;
    }

    const { ok } = await canActOn(req, location);
    if (!ok) {
      res.status(403).json({ message: "You are not allowed to reject this location change" });
      return;
    }

    const updated = await prisma.assetLocation.update({
      where: { id },
      data: { status: "REJECTED", isActive: false, rejectedById: me, rejectedAt: new Date(), rejectionReason: reason || null },
    });

    if (location.requestedById) {
      notify({ type: "OTHER", title: "Location change rejected", message: `Your location change for ${location.asset?.assetName || location.asset?.assetId} was rejected${reason ? `: ${reason}` : "."}`, recipientIds: [location.requestedById], assetId: location.assetId, createdById: me ?? undefined, channel: "BOTH" } as any);
    }
    logAction({ entityType: "OTHER", entityId: location.assetId, action: "STATUS_CHANGE", description: `Location change #${id} rejected`, performedById: me ?? undefined });

    res.json({ message: "Location change rejected.", location: updated });
  } catch (err) {
    console.error("rejectLocationChange error:", err);
    res.status(500).json({ message: "Failed to reject location change" });
  }
};

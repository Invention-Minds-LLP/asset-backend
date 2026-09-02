import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getDepartmentHODs, getSecurityTeam, getAdminIds, getEmployeeIdsByRole } from "../../utilis/notificationHelper";
import { streamGatePassPdf, streamGatePassLabel } from "../../utilis/gatePassPdf";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function generateGatePassNo(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.gatePass.count({
    where: { gatePassNo: { startsWith: `GP-${dateStr}` } },
  });
  return `GP-${dateStr}-${String(count + 1).padStart(4, "0")}`;
}

const FULL_INCLUDE = {
  items: { include: { asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true, departmentId: true } } } },
  requestedBy: { select: { id: true, name: true } },
  approvedByEmployee: { select: { id: true, name: true } },
  opsApprovedBy: { select: { id: true, name: true } },
  gatedOutBy: { select: { id: true, name: true } },
  gatedInBy: { select: { id: true, name: true } },
  labelPrintedBy: { select: { id: true, name: true } },
  securityClearedBy: { select: { id: true, name: true } },
  approverDepartment: { select: { id: true, name: true } },
  carriedByEmployee: { select: { id: true, name: true, employeeID: true } },
  processDepartment: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketId: true } },
  serviceVisit: { select: { id: true, visitDate: true, visitType: true } },
  transferHistory: { select: { id: true, transferType: true } },
} as const;

function userId(req: AuthenticatedRequest): number | null {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
}

/**
 * Origin to embed in the printed QR, taken from the request that asked for the
 * PDF. `trust proxy` is set to one hop in index.ts, so req.protocol/req.get(host)
 * reflect nginx's X-Forwarded-Proto and Host rather than the loopback upstream.
 *
 * Deliberately not an env var — see the note in gatePassPdf.ts scanUrl().
 * APP_PUBLIC_URL is honoured only if a deployment explicitly wants to pin a
 * canonical origin.
 */
function requestOrigin(req: Request): string {
  const configured = (process.env.APP_PUBLIC_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : "";
}

/**
 * Work out who approves this pass.
 *
 * The old version returned the first asset-linked item's department only, which
 * left two holes: a pass made entirely of non-asset items (spares / surgical
 * equipment) resolved to null and notified nobody, and a pass spanning two
 * departments only ever reached the first one's HOD. Both then compounded,
 * because the HOD inbox re-derived routing from items→asset→department and so
 * couldn't find those passes either.
 *
 * `primary` is stored on the pass so the inbox query and the notification agree
 * for good; `all` is the full notify set, so every involved department's HOD
 * plus the requester's own HOD hears about it.
 */
// ── Two-stage approval ──────────────────────────────────────────────────────

const STAGE_HOD = "PENDING_APPROVAL";
const STAGE_OPS = "PENDING_OPS_APPROVAL";
const CLEARED = "SECURITY_CLEARED";

/**
 * A walk-out has no vehicle and no courier, so "all three fields blank" would
 * otherwise be indistinguishable from "nobody has asked yet". HAND_CARRIED makes
 * a hand-carry a positive statement, which is what lets the label desk tell the
 * two apart and block only the second.
 */
const HAND_CARRIED = "HAND_CARRIED";

/**
 * Is the parcel's exit route on the record? Whoever clears the pass at the desk
 * — a security supervisor, or a department HOD standing in — often cannot know
 * which vehicle or courier will actually turn up, so these stay blank at
 * clearance and are filled in at the label desk instead.
 */
function hasTransport(gp: {
  vehicleNo?: string | null;
  vehicleType?: string | null;
  courierDetails?: string | null;
}): boolean {
  return Boolean(
    (gp.vehicleNo || "").trim() ||
    (gp.courierDetails || "").trim() ||
    (gp.vehicleType || "").trim().toUpperCase() === HAND_CARRIED
  );
}

/**
 * Who signs off stage two. Operations by default, CEO_COO when the deployment
 * has no Operations user — a pass nobody can approve is worse than one approved
 * a rung higher. Admins are the last resort so nothing is ever stranded.
 *
 * `excludeId` is the requester, removed at EVERY rung rather than only at the
 * end. Without that, a lone Operations person raising a pass resolves to a pool
 * of exactly themselves, the self-approval block rejects them, and the pass can
 * never be approved by anyone.
 */
async function getOpsApprovers(excludeId?: number | null): Promise<number[]> {
  const without = (ids: number[]) => ids.filter((id) => id !== excludeId);

  const ops = without(await getEmployeeIdsByRole(["OPERATIONS"]));
  if (ops.length) return ops;
  const ceo = without(await getEmployeeIdsByRole(["CEO_COO"]));
  if (ceo.length) return ceo;
  return without(await getAdminIds());
}


// ── Where is the asset? ─────────────────────────────────────────────────────
//
// Deliberately DERIVED rather than stored on Asset.status.
//
// Condition and whereabouts are two different facts and the standard practice
// in asset management (Maximo STATUS vs LOCATION, SAP equipment status vs
// functional location) is to keep them apart. Here the ticket module already
// owns condition — it writes UNDER_OBSERVATION on raise, IN_MAINTENANCE on
// progress, ACTIVE on close — and asset-scan owns on-site placement via
// currentLocation. If the gate pass also wrote a status, an asset sent to a
// vendor under a repair ticket would lose "under repair" at gate-out and then
// lose "off-site" again when the ticket progressed, with the ticket module
// winning last and marking it ACTIVE while it sat in the workshop.
//
// The open movement record is the honest source of truth, and it cannot be
// clobbered by another module.

/** Statuses in which a pass still has a claim on its assets. */
const LIVE_PASS_STATUSES = [
  "DRAFT", "PENDING_APPROVAL", "PENDING_OPS_APPROVAL",
  "APPROVED", "SECURITY_CLEARED", "ISSUED",
];

/**
 * Assets already committed to a live gate pass, mapped to the pass holding them.
 * `exceptGatePassId` lets a draft be re-saved without colliding with itself.
 */
async function assetsOnLivePasses(exceptGatePassId?: number | null): Promise<Map<number, string>> {
  const rows = await prisma.gatePassItem.findMany({
    where: {
      assetId: { not: null },
      returnedAt: null,
      gatePass: {
        status: { in: LIVE_PASS_STATUSES },
        ...(exceptGatePassId ? { id: { not: exceptGatePassId } } : {}),
      },
    },
    select: { assetId: true, gatePass: { select: { gatePassNo: true } } },
  });
  const held = new Map<number, string>();
  for (const r of rows) if (r.assetId != null && !held.has(r.assetId)) held.set(r.assetId, r.gatePass.gatePassNo);
  return held;
}

/**
 * One asset, one live pass. Without this the same item can be booked onto
 * several passes at once — which had already happened three times over in
 * production, because the picker filters on Asset.status and nothing ever
 * changed it.
 *
 * Returns an error message, or null when the selection is clean.
 */
async function findDoubleBooking(
  items: { assetId: number | null }[],
  exceptGatePassId?: number | null
): Promise<string | null> {
  const wanted = items.map((i) => i.assetId).filter((x): x is number => x != null);
  if (wanted.length === 0) return null;

  const held = await assetsOnLivePasses(exceptGatePassId);
  const clashes = wanted.filter((id) => held.has(id));
  if (clashes.length === 0) return null;

  const assets = await prisma.asset.findMany({
    where: { id: { in: clashes } },
    select: { id: true, assetId: true, assetName: true },
  });
  const described = assets.map((a) => `${a.assetId} (${a.assetName}) is on ${held.get(a.id)}`);
  return `Already on another open gate pass — ${described.join("; ")}. Close or cancel that pass first, or remove the item.`;
}

// ── Ownership / permission helpers ──────────────────────────────────────────

function isAdmin(req: AuthenticatedRequest): boolean {
  return String((req.user as any)?.role ?? "") === "ADMIN";
}

/**
 * Editing, cancelling, deleting and closing belong to the person who raised the
 * pass (plus admins). None of these were checked at all before — any logged-in
 * user could cancel or close anyone's pass straight through the API, so hiding
 * the buttons alone would have been cosmetic.
 *
 * Approvers are deliberately NOT included: their tool for stopping someone
 * else's pass is Reject, which records a reason on the pass. Cancel records
 * nothing, so an approver using it would erase the audit trail.
 */
function assertOwnerOrAdmin(
  req: AuthenticatedRequest,
  gp: { requestedById: number | null },
  action: string,
  res: Response
): boolean {
  if (isAdmin(req)) return true;
  const me = userId(req);
  if (me != null && gp.requestedById === me) return true;
  res.status(403).json({
    message: `Only the person who raised this gate pass can ${action} it. If you are reviewing it, use Reject instead.`,
  });
  return false;
}

/** Employee.role of whoever raised the pass — decides whether stage one applies. */
async function requesterRole(requestedById: number | null): Promise<string | null> {
  if (!requestedById) return null;
  const e = await prisma.employee.findUnique({ where: { id: requestedById }, select: { role: true } });
  return e?.role ?? null;
}

/**
 * Fill the printed snapshot from the linked employee / department.
 *
 * The pass stores carriedBy / employeeCode / employeeContact / processDept as
 * plain strings because that is what gets printed, and because an external
 * carrier (courier, vendor rep) has no employee record at all. When the caller
 * DOES pick an employee, those strings are derived here rather than trusted
 * from the client, so the snapshot can never disagree with the link.
 *
 * Anything not covered by a link is left as the caller sent it — that is the
 * external-carrier path.
 */
async function resolveCarrierSnapshot(data: any): Promise<void> {
  if (data.carriedByEmployeeId) {
    const emp = await prisma.employee.findUnique({
      where: { id: Number(data.carriedByEmployeeId) },
      select: { name: true, employeeID: true, phone: true, department: { select: { id: true, name: true } } },
    });
    if (emp) {
      data.carriedBy = emp.name;
      data.employeeCode = emp.employeeID;
      data.employeeContact = emp.phone ?? data.employeeContact ?? null;
      // Default the accountable department to the carrier's own, but only when
      // the caller hasn't chosen one — the movement often belongs elsewhere.
      if (!data.processDepartmentId && emp.department) {
        data.processDepartmentId = emp.department.id;
      }
    }
  }

  if (data.processDepartmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: Number(data.processDepartmentId) },
      select: { name: true },
    });
    if (dept) data.processDept = dept.name;
  }
}

async function resolveApprovers(
  items: { assetId: number | null }[],
  requestedById: number | null
): Promise<{ primary: number | null; all: number[] }> {
  const assetIds = items.map((it) => it.assetId).filter((id): id is number => id != null);

  const assets = assetIds.length
    ? await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, departmentId: true } })
    : [];

  // Preserve item order so `primary` stays the first asset-linked item's
  // department — the behaviour existing rows and users already expect.
  const byId = new Map(assets.map((a) => [a.id, a.departmentId]));
  const assetDepts = assetIds
    .map((id) => byId.get(id) ?? null)
    .filter((d): d is number => d != null);

  const requesterDept = requestedById
    ? (await prisma.employee.findUnique({ where: { id: requestedById }, select: { departmentId: true } }))?.departmentId ?? null
    : null;

  const all = Array.from(new Set([...assetDepts, ...(requesterDept != null ? [requesterDept] : [])]));

  return { primary: assetDepts[0] ?? requesterDept ?? null, all };
}

// ────────────────────────────────────────────────────────────────────────────
// CREATE — multi-asset, lands in DRAFT
// ────────────────────────────────────────────────────────────────────────────

export const createGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      type, issuedTo, purpose, expectedReturnDate,
      // employee / movement details (physical gate-pass form)
      carriedBy, employeeCode, employeeContact, processDept, toAddress,
      carriedByEmployeeId, processDepartmentId,
      reason, ticketId,
      // multi-asset payload
      items,
      // legacy single-asset (still accepted; auto-converted to one item)
      assetId, description, quantity,
    } = req.body;

    if (!type || !issuedTo || !purpose) {
      res.status(400).json({ message: "type, issuedTo and purpose are required" });
      return;
    }
    if (!["RETURNABLE", "NON_RETURNABLE"].includes(type)) {
      res.status(400).json({ message: "type must be RETURNABLE or NON_RETURNABLE" });
      return;
    }

    type ItemRow = {
      assetId: number | null;
      description: string | null;
      make: string | null;
      model: string | null;
      quantity: number;
      remarks: string | null;
    };
    const itemRows: ItemRow[] =
      Array.isArray(items) && items.length > 0
        ? items.map((it: any) => ({
            assetId: it.assetId ? Number(it.assetId) : null,
            description: it.description?.trim() || null,
            make: it.make?.trim() || null,
            model: it.model?.trim() || null,
            quantity: it.quantity ? Number(it.quantity) : 1,
            remarks: it.remarks ?? null,
          }))
        : assetId
        ? [{ assetId: Number(assetId), description: description?.trim() || null, make: null, model: null, quantity: quantity ? Number(quantity) : 1, remarks: description ?? null }]
        : [];

    if (itemRows.length === 0) {
      res.status(400).json({ message: "At least one item is required" });
      return;
    }
    // Each item must be identifiable: either a linked asset or a description.
    if (itemRows.some((it) => it.assetId == null && !it.description)) {
      res.status(400).json({ message: "Each item needs either an asset or an item description" });
      return;
    }

    const clash = await findDoubleBooking(itemRows);
    if (clash) { res.status(400).json({ message: clash }); return; }

    const gatePassNo = await generateGatePassNo();

    // Derive the printed carrier/department strings from the links before save.
    const snapshot: any = {
      carriedBy: carriedBy ?? null,
      employeeCode: employeeCode ?? null,
      employeeContact: employeeContact ?? null,
      processDept: processDept ?? null,
      carriedByEmployeeId: carriedByEmployeeId ? Number(carriedByEmployeeId) : null,
      processDepartmentId: processDepartmentId ? Number(processDepartmentId) : null,
    };
    await resolveCarrierSnapshot(snapshot);

    const created = await prisma.gatePass.create({
      data: {
        gatePassNo,
        type,
        status: "DRAFT",
        approvalStatus: "PENDING",
        issuedTo,
        purpose,
        expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
        // Vehicle and courier are captured by the security supervisor at
        // gate-out, not here: at request time the vehicle that will actually
        // turn up is unknown, so anything entered now is a guess printed onto
        // the pass as if it were fact.
        courierDetails: null,
        vehicleNo: null,
        vehicleType: null,
        carriedBy: snapshot.carriedBy,
        employeeCode: snapshot.employeeCode,
        employeeContact: snapshot.employeeContact,
        processDept: snapshot.processDept,
        carriedByEmployeeId: snapshot.carriedByEmployeeId,
        processDepartmentId: snapshot.processDepartmentId,
        toAddress: toAddress ?? null,
        reason: reason ?? null,
        ticketId: ticketId ? Number(ticketId) : null,
        requestedById: userId(req),
        requestedAt: new Date(),
        items: { create: itemRows },
      },
      include: FULL_INCLUDE,
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("createGatePass error:", error);
    res.status(500).json({ message: "Failed to create gate pass" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// LIST + filters (status, approvalStatus, type, assetId, ticketId)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scoped to what the caller has business seeing.
 *
 * This returned EVERY pass to EVERY authenticated user, so a requester's list
 * was filled with other departments' movements — and anyone could read who sent
 * what, where, and with whom.
 *
 * Requesters see their own. HODs also see their department's, because they are
 * accountable for that equipment. Operations, CEO_COO and admins see everything,
 * since they sign off stage two for the whole organisation. Security staff fall
 * into the default and see only their own — the gate work has its own console.
 */
export const getAllGatePasses = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, approvalStatus, type, assetId, ticketId } = req.query;

    const u = req.user as any;
    const userRole = String(u?.role ?? "");
    const empRole = String(u?.employeeRole ?? "");
    const departmentId = u?.departmentId ? Number(u.departmentId) : null;
    const me = userId(req);
    const isAny = (r: string) => userRole === r || empRole === r;

    const where: any = {};

    if (!(userRole === "ADMIN" || isAny("OPERATIONS") || isAny("CEO_COO"))) {
      if (isAny("HOD") && departmentId) {
        where.OR = [
          { requestedById: me ?? -1 },
          { approverDepartmentId: departmentId },
          { items: { some: { asset: { departmentId } } } },
        ];
      } else {
        where.requestedById = me ?? -1;
      }
    }
    if (status) where.status = String(status);
    if (approvalStatus) where.approvalStatus = String(approvalStatus);
    if (type) where.type = String(type);
    if (ticketId) where.ticketId = Number(ticketId);
    if (assetId) where.items = { some: { assetId: Number(assetId) } };

    const list = await prisma.gatePass.findMany({
      where,
      include: FULL_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json(list);
  } catch (error) {
    console.error("getAllGatePasses error:", error);
    res.status(500).json({ message: "Failed to fetch gate passes" });
  }
};

export const getGatePassById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    res.json(gp);
  } catch (error) {
    console.error("getGatePassById error:", error);
    res.status(500).json({ message: "Failed to fetch gate pass" });
  }
};

/**
 * Look a pass up by its printed number — what the QR deep link resolves to, and
 * what the scan screen's paste box uses for labels printed before the QR carried
 * a URL. Authenticated: a gate pass names people, destinations and contents, so
 * nothing here is public.
 *
 * Matching is case-insensitive and trims whitespace, because this value arrives
 * from someone retyping it off a sticker.
 */
export const getGatePassByNo = async (req: Request, res: Response) => {
  try {
    const raw = String(req.params.gatePassNo ?? "").trim();
    if (!raw) { res.status(400).json({ message: "Gate pass number is required" }); return; }

    // MySQL collations here are case-insensitive, so findFirst on the trimmed
    // value is enough; findUnique would miss a retyped lowercase number.
    const gp = await prisma.gatePass.findFirst({
      where: { gatePassNo: raw },
      include: FULL_INCLUDE,
    });

    if (!gp) {
      res.status(404).json({ message: `No gate pass found with number ${raw}` });
      return;
    }
    res.json(gp);
  } catch (error) {
    console.error("getGatePassByNo error:", error);
    res.status(500).json({ message: "Failed to look up gate pass" });
  }
};

/**
 * Assets currently committed to a live gate pass, so the picker can leave them
 * out instead of offering something that is already spoken for. Derived, not
 * read from Asset.status — see the note above assetsOnLivePasses().
 */
export const getAssetsOnGatePasses = async (_req: Request, res: Response) => {
  try {
    const held = await assetsOnLivePasses();
    res.json([...held.entries()].map(([assetId, gatePassNo]) => ({ assetId, gatePassNo })));
  } catch (error) {
    console.error("getAssetsOnGatePasses error:", error);
    res.status(500).json({ message: "Failed to fetch committed assets" });
  }
};

export const getGatePassesByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const list = await prisma.gatePass.findMany({
      where: { items: { some: { assetId } } },
      include: FULL_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json(list);
  } catch (error) {
    console.error("getGatePassesByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch gate passes" });
  }
};

export const getOverdueGatePasses = async (_req: Request, res: Response) => {
  try {
    const overdue = await prisma.gatePass.findMany({
      where: { type: "RETURNABLE", status: "ISSUED", expectedReturnDate: { lt: new Date() } },
      include: FULL_INCLUDE,
      orderBy: { expectedReturnDate: "asc" },
    });
    res.json(overdue);
  } catch (error) {
    console.error("getOverdueGatePasses error:", error);
    res.status(500).json({ message: "Failed to fetch overdue gate passes" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// EDIT (only while DRAFT) — replace items if provided
// ────────────────────────────────────────────────────────────────────────────

export const updateGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.gatePass.findUnique({ where: { id }, include: { items: true } });
    if (!existing) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (!assertOwnerOrAdmin(req, existing, "edit", res)) return;
    if (existing.status !== "DRAFT") {
      res.status(400).json({ message: "Only DRAFT gate passes can be edited" });
      return;
    }

    const { items, ...rest } = req.body;

    const data: any = { ...rest };
    if (data.expectedReturnDate) data.expectedReturnDate = new Date(data.expectedReturnDate);
    if (data.ticketId !== undefined) data.ticketId = data.ticketId ? Number(data.ticketId) : null;
    if (data.carriedByEmployeeId !== undefined) {
      data.carriedByEmployeeId = data.carriedByEmployeeId ? Number(data.carriedByEmployeeId) : null;
    }
    if (data.processDepartmentId !== undefined) {
      data.processDepartmentId = data.processDepartmentId ? Number(data.processDepartmentId) : null;
    }
    // Re-derive the printed strings, so changing the carrier on a draft doesn't
    // leave the previous person's name and number on the pass.
    await resolveCarrierSnapshot(data);
    // Strip fields managed by lifecycle endpoints
    delete data.status; delete data.approvalStatus; delete data.gatePassNo;
    delete data.requestedById; delete data.requestedAt;
    delete data.approvedById; delete data.approvedAt;
    delete data.gatedOutAt; delete data.gatedOutById;
    delete data.gatedInAt; delete data.gatedInById;
    // Security-owned fields — see createGatePass.
    delete data.vehicleNo; delete data.vehicleType; delete data.courierDetails;

    if (Array.isArray(items)) {
      // Its own items don't count against it — only other live passes do.
      const clash = await findDoubleBooking(
        items.map((it: any) => ({ assetId: it.assetId ? Number(it.assetId) : null })),
        id
      );
      if (clash) { res.status(400).json({ message: clash }); return; }

      // Replace items wholesale
      await prisma.gatePassItem.deleteMany({ where: { gatePassId: id } });
      data.items = {
        create: items.map((it: any) => ({
          assetId: it.assetId ? Number(it.assetId) : null,
          description: it.description?.trim() || null,
          make: it.make?.trim() || null,
          model: it.model?.trim() || null,
          quantity: it.quantity ? Number(it.quantity) : 1,
          remarks: it.remarks ?? null,
        })),
      };
    }

    const updated = await prisma.gatePass.update({ where: { id }, data, include: FULL_INCLUDE });
    res.json(updated);
  } catch (error) {
    console.error("updateGatePass error:", error);
    res.status(500).json({ message: "Failed to update gate pass" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// LIFECYCLE — submit → approve / reject → gate-out → gate-in → close
// ────────────────────────────────────────────────────────────────────────────

export const submitForApproval = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id }, include: { items: true } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== "DRAFT") {
      res.status(400).json({ message: `Cannot submit a gate pass in status ${gp.status}` });
      return;
    }
    if (gp.items.length === 0) {
      res.status(400).json({ message: "Gate pass must have at least one item before submission" });
      return;
    }

    // One department per pass.
    //
    // Approval routes to a single department, so a pass carrying IT and
    // Biomedical assets together would be cleared by one HOD on behalf of both —
    // the other department's equipment leaves without its owner ever seeing the
    // request. Splitting also avoids a half-approved pass that security can
    // neither release nor refuse when two HODs disagree.
    const assetItemIds = gp.items.map((it) => it.assetId).filter((x): x is number => x != null);
    if (assetItemIds.length > 0) {
      const assets = await prisma.asset.findMany({
        where: { id: { in: assetItemIds } },
        select: { departmentId: true, department: { select: { name: true } } },
      });
      const named = new Map<number, string>();
      for (const a of assets) {
        if (a.departmentId != null) named.set(a.departmentId, a.department?.name ?? `Department ${a.departmentId}`);
      }
      if (named.size > 1) {
        res.status(400).json({
          message: `This gate pass covers assets from ${[...named.values()].join(" and ")}. Raise a separate gate pass for each department, so each HOD approves their own equipment.`,
        });
        return;
      }
    }

    const submitClash = await findDoubleBooking(gp.items, id);
    if (submitClash) { res.status(400).json({ message: submitClash }); return; }

    const { primary, all } = await resolveApprovers(gp.items, gp.requestedById);

    // An HOD (or above) raising a pass has already endorsed it; keeping stage
    // one would only put the pass back in its author's own approval queue.
    const role = await requesterRole(gp.requestedById);
    const skipsHodStage = role === "HOD" || role === "CEO_COO";
    const stage = skipsHodStage ? STAGE_OPS : STAGE_HOD;

    const updated = await prisma.gatePass.update({
      where: { id },
      data: {
        status: stage,
        approvalStatus: "PENDING",
        requestedAt: new Date(),
        approverDepartmentId: primary,
        // Record the skipped stage against the requester, so the printed pass
        // shows who stood behind it rather than an unexplained blank line.
        ...(skipsHodStage
          ? { approvedById: gp.requestedById, approvedAt: new Date(), approvalRemarks: `Raised by ${role} — department approval not required` }
          : {}),
      },
      include: FULL_INCLUDE,
    });

    // Notify the HODs of every department involved — each asset's owning
    // department plus the requester's own. A pass of purely non-asset items has
    // neither, so it falls back to admins rather than sitting in the queue with
    // nobody told about it.
    (async () => {
      let recipientIds: number[];
      let title: string;

      if (stage === STAGE_OPS) {
        recipientIds = await getOpsApprovers(gp.requestedById);
        title = "Gate Pass — Operations Approval Required";
      } else {
        const hodSets = await Promise.all(all.map((deptId) => getDepartmentHODs(deptId)));
        recipientIds = Array.from(new Set(hodSets.flat()));
        if (recipientIds.length === 0) recipientIds = await getAdminIds();
        title = "Gate Pass Approval Required";
      }

      // Never ping the requester about their own pass.
      recipientIds = recipientIds.filter((rid) => rid !== gp.requestedById);
      if (recipientIds.length === 0) return;

      await notify({
        type: "OTHER",
        title,
        message: `Gate pass ${gp.gatePassNo} (${gp.type}, ${gp.items.length} item${gp.items.length > 1 ? "s" : ""}) needs your approval — Purpose: ${gp.purpose}`,
        recipientIds,
        gatePassId: gp.id,
        createdById: userId(req) ?? undefined,
      });
    })().catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("submitForApproval error:", error);
    res.status(500).json({ message: "Failed to submit gate pass for approval" });
  }
};

/**
 * One endpoint, two stages. Stage one (HOD) advances the pass to Operations;
 * stage two (Operations / CEO_COO) is what actually clears it for the gate.
 */
export const approveGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { remarks } = req.body;
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== STAGE_HOD && gp.status !== STAGE_OPS) {
      res.status(400).json({ message: `Cannot approve a gate pass in status ${gp.status}` });
      return;
    }

    // Backstop against self-approval at either stage, regardless of how the
    // pass was routed. A routing gap must never become a self-signed pass.
    const actor = userId(req);
    if (actor && gp.requestedById && actor === gp.requestedById) {
      res.status(403).json({ message: "You cannot approve a gate pass you raised yourself." });
      return;
    }

    // ── Stage one: department HOD → hand on to Operations ───────────────────
    if (gp.status === STAGE_HOD) {
      const updated = await prisma.gatePass.update({
        where: { id },
        data: {
          status: STAGE_OPS,
          approvalStatus: "PENDING", // still pending: stage two decides
          approvedById: actor,
          approvedAt: new Date(),
          approvalRemarks: remarks ?? null,
        },
        include: FULL_INCLUDE,
      });

      (async () => {
        const opsIds = await getOpsApprovers(gp.requestedById);
        if (opsIds.length) {
          await notify({
            type: "OTHER",
            title: "Gate Pass — Operations Approval Required",
            message: `${gp.gatePassNo} has cleared department approval and needs Operations sign-off — Purpose: ${gp.purpose}`,
            recipientIds: opsIds,
            gatePassId: gp.id,
            createdById: actor ?? undefined,
          });
        }
        if (updated.requestedById) {
          await notify({
            type: "OTHER",
            title: "Gate Pass — Department Approved",
            message: `Your gate pass ${gp.gatePassNo} was approved by the department. Awaiting Operations sign-off.`,
            recipientIds: [updated.requestedById],
            gatePassId: gp.id,
            createdById: actor ?? undefined,
          });
        }
      })().catch(() => {});

      res.json(updated);
      return;
    }

    // ── Stage two: Operations → cleared for the gate ────────────────────────
    const updated = await prisma.gatePass.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvalStatus: "APPROVED",
        opsApprovedById: actor,
        opsApprovedAt: new Date(),
        opsApprovalRemarks: remarks ?? null,
      },
      include: FULL_INCLUDE,
    });

    if (updated.requestedById) {
      notify({
        type: "OTHER",
        title: "Gate Pass Approved",
        message: `Your gate pass ${gp.gatePassNo} has been fully approved. Hand over to security for gate-out.`,
        recipientIds: [updated.requestedById],
        gatePassId: gp.id,
        createdById: actor ?? undefined,
      }).catch(() => {});
    }

    // Tell security a new pass is ready in their queue
    getSecurityTeam().then(secIds => {
      if (secIds.length === 0) return;
      notify({
        type: "OTHER",
        title: "Gate Pass Ready to Issue",
        message: `${gp.gatePassNo} (${gp.type}) is approved — issue to ${gp.issuedTo} when they arrive.`,
        recipientIds: secIds,
        gatePassId: gp.id,
        priority: "HIGH",
        createdById: actor ?? undefined,
      });
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("approveGatePass error:", error);
    res.status(500).json({ message: "Failed to approve gate pass" });
  }
};

export const rejectGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      res.status(400).json({ message: "rejection reason is required" });
      return;
    }
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    // Rejectable at either approval stage — Operations must be able to stop a
    // pass the department already waved through.
    if (gp.status !== STAGE_HOD && gp.status !== STAGE_OPS) {
      res.status(400).json({ message: `Cannot reject a gate pass in status ${gp.status}` });
      return;
    }
    const rejector = userId(req);
    if (rejector && gp.requestedById && rejector === gp.requestedById) {
      res.status(403).json({ message: "You cannot action a gate pass you raised yourself. Cancel it instead." });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvalStatus: "REJECTED",
        approvedById: userId(req),
        approvedAt: new Date(),
        rejectionReason: String(reason).trim(),
      },
      include: FULL_INCLUDE,
    });

    if (updated.requestedById) {
      notify({
        type: "OTHER",
        title: "Gate Pass Rejected",
        message: `Your gate pass ${gp.gatePassNo} was rejected. Reason: ${reason}`,
        recipientIds: [updated.requestedById],
        gatePassId: gp.id,
        createdById: userId(req) ?? undefined,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("rejectGatePass error:", error);
    res.status(500).json({ message: "Failed to reject gate pass" });
  }
};

// SECURITY — desk clearance. Items checked, transport recorded, parcel still
// on site. Deliberately NOT gate-out: the label is printed after this, and
// stamping a departure now would put a time on the pass that never happened.
export const securityClearGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { vehicleNo, vehicleType, courierDetails } = req.body ?? {};
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== "APPROVED") {
      res.status(400).json({ message: `Cannot clear a pass in status ${gp.status}. Only APPROVED passes can be cleared by security.` });
      return;
    }

    const trim = (v: any) => {
      const t = String(v ?? "").trim();
      return t ? t : null;
    };

    const updated = await prisma.gatePass.update({
      where: { id },
      data: {
        status: CLEARED,
        securityClearedAt: new Date(),
        securityClearedById: userId(req),
        vehicleNo: trim(vehicleNo),
        vehicleType: trim(vehicleType),
        courierDetails: trim(courierDetails),
      },
      include: FULL_INCLUDE,
    });

    // The label desk is the next pair of hands, so tell them there's work.
    getSecurityTeam().then(secIds => {
      const others = secIds.filter(sid => sid !== userId(req));
      if (others.length === 0) return;
      notify({
        type: "OTHER",
        title: "Gate Pass — Label Required",
        // Say which job is waiting. Whoever cleared this may not have known the
        // vehicle, and the label won't print until someone records it.
        message: hasTransport(updated)
          ? `${gp.gatePassNo} has been cleared by security. Print and fix the label before it leaves.`
          : `${gp.gatePassNo} has been cleared, but the vehicle/courier is not recorded. Add it on the label desk, then print the label.`,
        recipientIds: others,
        gatePassId: gp.id,
        createdById: userId(req) ?? undefined,
      });
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("securityClearGatePass error:", error);
    res.status(500).json({ message: "Failed to record security clearance" });
  }
};

// SECURITY EXECUTIVE — fill in the transport whoever cleared the pass could not.
// A supervisor, or a department HOD standing in at the desk, has no way of
// knowing which vehicle or courier will actually turn up, so those fields are
// optional at clearance and land here instead: the label desk is the last pair
// of hands before the parcel leaves, and the label itself carries the vehicle.
//
// Deliberately NOT behind requireSecuritySupervisor — the executive is precisely
// who this is for. The status check does the constraining instead: before
// clearance there is nothing to label, and after gate-out the parcel is gone and
// the record is history.
export const updateGatePassTransport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { vehicleNo, vehicleType, courierDetails } = req.body ?? {};
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== CLEARED) {
      res.status(400).json({ message: `Transport details can only be set on a security-cleared pass. This one is ${gp.status}.` });
      return;
    }

    const trim = (v: any) => {
      const t = String(v ?? "").trim();
      return t ? t : null;
    };

    const next = {
      vehicleNo: trim(vehicleNo),
      vehicleType: trim(vehicleType),
      courierDetails: trim(courierDetails),
    };

    // Saving all three blank would leave the pass exactly as stuck as it was, so
    // reject it here rather than let the label block be the first thing anyone
    // hears about it.
    if (!hasTransport(next)) {
      res.status(400).json({ message: "Record the vehicle number, the courier, or mark the parcel as hand carried." });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: next,
      include: FULL_INCLUDE,
    });

    res.json(updated);
  } catch (error) {
    console.error("updateGatePassTransport error:", error);
    res.status(500).json({ message: "Failed to update transport details" });
  }
};

// SECURITY — the parcel actually leaves. Stamps departure only; everything else
// was captured at clearance, so this is a single confirming action at the gate.
export const gateOutGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== CLEARED) {
      res.status(400).json({ message: `Cannot gate-out a pass in status ${gp.status}. It must be cleared by security first.` });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: { status: "ISSUED", gatedOutAt: new Date(), gatedOutById: userId(req) },
      include: FULL_INCLUDE,
    });

    if (updated.requestedById) {
      notify({
        type: "OTHER",
        title: "Gate Pass Issued",
        message: `Gate pass ${gp.gatePassNo} has left the premises.`,
        recipientIds: [updated.requestedById],
        gatePassId: gp.id,
        createdById: userId(req) ?? undefined,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("gateOutGatePass error:", error);
    res.status(500).json({ message: "Failed to gate-out" });
  }
};

// SECURITY — physical gate-in (asset returning). Body: { itemReturns: [{ itemId, condition, remarks }], returnCondition? }
export const gateInGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { itemReturns, returnCondition, returnedBy } = req.body;
    const gp = await prisma.gatePass.findUnique({ where: { id }, include: { items: true } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== "ISSUED") {
      res.status(400).json({ message: `Cannot gate-in a pass in status ${gp.status}` });
      return;
    }
    if (gp.type !== "RETURNABLE") {
      res.status(400).json({ message: "Only RETURNABLE gate passes can be returned" });
      return;
    }

    // Per-item return updates (optional)
    if (Array.isArray(itemReturns)) {
      for (const r of itemReturns) {
        if (!r.itemId) continue;
        await prisma.gatePassItem.update({
          where: { id: Number(r.itemId) },
          data: {
            returnedAt: new Date(),
            returnCondition: r.condition ?? "GOOD",
            returnRemarks: r.remarks ?? null,
          },
        });
      }
    } else {
      // Bulk-return all items as GOOD if caller didn't specify per-item data
      await prisma.gatePassItem.updateMany({
        where: { gatePassId: id, returnedAt: null },
        data: { returnedAt: new Date(), returnCondition: returnCondition ?? "GOOD" },
      });
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: {
        status: "RETURNED",
        gatedInAt: new Date(),
        gatedInById: userId(req),
        returnedAt: new Date(),
        returnedBy: returnedBy ?? null,
        returnCondition: returnCondition ?? null,
      },
      include: FULL_INCLUDE,
    });

    if (updated.requestedById) {
      notify({
        type: "OTHER",
        title: "Gate Pass Returned",
        message: `Gate pass ${gp.gatePassNo} marked as returned by security.`,
        recipientIds: [updated.requestedById],
        gatePassId: gp.id,
        createdById: userId(req) ?? undefined,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("gateInGatePass error:", error);
    res.status(500).json({ message: "Failed to gate-in" });
  }
};

// Generic state-change endpoint for CLOSE/CANCEL (back-compat with old callers)
export const updateGatePassStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status, reason } = req.body;
    const valid = ["CLOSED", "CANCELLED"];
    if (!status || !valid.includes(status)) {
      res.status(400).json({ message: `status must be one of: ${valid.join(", ")} (use lifecycle endpoints for approve/reject/gate-out/gate-in)` });
      return;
    }
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (!assertOwnerOrAdmin(req, gp, status === "CLOSED" ? "close" : "cancel", res)) return;
    if (status === "CANCELLED" && ["RETURNED", "CLOSED", "CANCELLED"].includes(gp.status)) {
      res.status(400).json({ message: `Cannot cancel a pass in status ${gp.status}` });
      return;
    }
    if (status === "CLOSED" && !["RETURNED", "ISSUED"].includes(gp.status) && gp.type === "RETURNABLE") {
      res.status(400).json({ message: "RETURNABLE pass must be RETURNED before closing" });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: { status, reason: reason ?? gp.reason },
      include: FULL_INCLUDE,
    });
    res.json(updated);
  } catch (error) {
    console.error("updateGatePassStatus error:", error);
    res.status(500).json({ message: "Failed to update gate pass status" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// INBOX queries
// ────────────────────────────────────────────────────────────────────────────

/**
 * Approval inbox, scoped to the stage the viewer can actually act on.
 *
 * Operations and CEO_COO see stage two; HODs see stage one for their own
 * department; admins see both. Passes the viewer raised are excluded outright —
 * that self-approval loop was the whole complaint.
 */
export const getPendingApproval = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const u = req.user as any;
    const departmentId = u?.departmentId ? Number(u.departmentId) : null;
    const userRole = String(u?.role ?? "");
    const empRole = String(u?.employeeRole ?? "");
    const isAdmin = userRole === "ADMIN";
    const isOps = userRole === "OPERATIONS" || empRole === "OPERATIONS"
      || userRole === "CEO_COO" || empRole === "CEO_COO";

    const where: any = { approvalStatus: "PENDING" };

    if (isAdmin) {
      where.status = { in: [STAGE_HOD, STAGE_OPS] };
    } else if (isOps) {
      where.status = STAGE_OPS;
    } else {
      where.status = STAGE_HOD;
      if (departmentId) {
        // Match the stored routing decision first. The items→asset→department
        // branch is kept so passes submitted before approverDepartmentId
        // existed (and any not yet backfilled) still surface for the owner.
        where.OR = [
          { approverDepartmentId: departmentId },
          { items: { some: { asset: { departmentId } } } },
        ];
      }
    }

    // Never show someone their own pass to approve.
    const me = userId(req);
    if (me) where.NOT = { requestedById: me };

    const list = await prisma.gatePass.findMany({
      where,
      include: FULL_INCLUDE,
      orderBy: { requestedAt: "desc" },
    });
    res.json(list);
  } catch (error) {
    console.error("getPendingApproval error:", error);
    res.status(500).json({ message: "Failed to fetch pending gate passes" });
  }
};

// Security inbox — APPROVED (ready to issue) + ISSUED (awaiting return).
//
// ISSUED is narrowed to RETURNABLE. A NON_RETURNABLE pass is never gated back
// in, so it has no Gate-In button and nobody at the gate can clear it — it used
// to sit in "Out — Awaiting Return" forever, waiting on a requester's Close that
// routinely never comes. Those passes reach the gate desk through the history
// endpoint below instead, which is where a permanently-gone item belongs.
export const getSecurityQueue = async (_req: Request, res: Response) => {
  try {
    const list = await prisma.gatePass.findMany({
      where: {
        OR: [
          { status: "APPROVED" },
          { status: CLEARED },
          { status: "ISSUED", type: "RETURNABLE" },
        ],
      },
      include: FULL_INCLUDE,
      orderBy: [{ status: "asc" }, { approvedAt: "desc" }],
    });
    res.json(list);
  } catch (error) {
    console.error("getSecurityQueue error:", error);
    res.status(500).json({ message: "Failed to fetch security queue" });
  }
};

// Security history — everything that physically crossed the gate.
//
// Keyed on gatedOutAt rather than a status list: it's the one condition that
// means "this actually went out", and it naturally excludes drafts, pending and
// rejected passes, which never reached the gate and are none of security's
// business. Without this, a pass vanished from the console the instant gate-in
// set it to RETURNED — so the officer who received the goods could never print
// the completed pass carrying their own signature.
//
// Paginated, unlike the queue: history grows without limit.
export const getSecurityHistory = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "10", search, from, to, type, status } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { gatedOutAt: { not: null } };
    if (type) where.type = String(type);
    if (status) where.status = String(status);
    if (search) {
      const q = String(search).trim();
      where.AND = [{
        OR: [
          { gatePassNo: { contains: q } },
          { issuedTo: { contains: q } },
          { vehicleNo: { contains: q } },
        ],
      }];
    }
    if (from || to) {
      where.gatedOutAt = {
        not: null,
        ...(from ? { gte: new Date(String(from)) } : {}),
        ...(to ? { lte: new Date(String(to)) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      prisma.gatePass.findMany({
        where,
        skip,
        take: limitNum,
        include: FULL_INCLUDE,
        orderBy: { gatedOutAt: "desc" },
      }),
      prisma.gatePass.count({ where }),
    ]);

    res.json({ data, total, page: pageNum, limit: limitNum });
  } catch (error) {
    console.error("getSecurityHistory error:", error);
    res.status(500).json({ message: "Failed to fetch gate pass history" });
  }
};

// Label queue — the security executive's screen. SECURITY_CLEARED.
//
// Labelling comes AFTER the supervisor records gate-out: they verify the items
// and capture the vehicle first, and only then is the parcel labelled and sent
// on its way. The parcel is still on site and in front of the executive; the
// pass only becomes ISSUED once it physically leaves.
//
// A useful consequence of that ordering: by this point the vehicle and courier
// are known, so the label can carry them.
//
// Returns both unprinted and printed passes; the client splits them, so an
// executive can confirm or reprint without a second request.
export const getLabelQueue = async (_req: Request, res: Response) => {
  try {
    const list = await prisma.gatePass.findMany({
      where: { status: CLEARED },
      include: FULL_INCLUDE,
      orderBy: [{ labelPrintedAt: "asc" }, { securityClearedAt: "desc" }],
    });
    res.json(list);
  } catch (error) {
    console.error("getLabelQueue error:", error);
    res.status(500).json({ message: "Failed to fetch label queue" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────

export const downloadGatePassPdf = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    await streamGatePassPdf(gp as any, res, requestOrigin(req));
  } catch (error) {
    console.error("downloadGatePassPdf error:", error);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};

// Compact stick-on label for the asset / parcel. The full A4 pass is a poor
// sticker — and it carries purpose, vehicle, approver remarks and GSTIN, which
// the executive printing it has no need to see. This variant is the QR, the
// number, the items and the destination, sized for a label printer.
export const downloadGatePassLabel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }

    // A label with the vehicle box empty is the exact failure this queue exists
    // to catch: the pass was cleared by someone who couldn't know the transport,
    // and nobody filled it in afterwards. Refuse rather than print a blank one —
    // the executive has the dialog to fix it in the same screen, and this route
    // is only ever reached from there.
    if (!hasTransport(gp)) {
      res.status(400).json({
        message: "Record the vehicle, courier, or hand-carry detail before printing this label.",
      });
      return;
    }

    // Stamp before streaming: once doc.end() runs the response is committed, so
    // a write after that point can't report a failure to the caller. Recorded
    // on first print only, so the stamp shows who actually produced the label
    // rather than whoever reprinted it last.
    if (!gp.labelPrintedAt) {
      await prisma.gatePass.update({
        where: { id },
        data: { labelPrintedAt: new Date(), labelPrintedById: userId(req) },
      });
    }

    await streamGatePassLabel(gp as any, res, requestOrigin(req));
  } catch (error) {
    console.error("downloadGatePassLabel error:", error);
    res.status(500).json({ message: "Failed to generate label" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE — only DRAFT
// ────────────────────────────────────────────────────────────────────────────

export const deleteGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (!assertOwnerOrAdmin(req, gp, "delete", res)) return;
    if (gp.status !== "DRAFT") {
      res.status(400).json({ message: "Only DRAFT gate passes can be deleted; use cancel for issued/approved passes" });
      return;
    }
    await prisma.gatePass.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteGatePass error:", error);
    res.status(500).json({ message: "Failed to delete gate pass" });
  }
};

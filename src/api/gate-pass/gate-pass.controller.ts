import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getDepartmentHODs, getSecurityTeam } from "../../utilis/notificationHelper";
import { streamGatePassPdf } from "../../utilis/gatePassPdf";

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
  gatedOutBy: { select: { id: true, name: true } },
  gatedInBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketId: true } },
  serviceVisit: { select: { id: true, visitDate: true, visitType: true } },
  transferHistory: { select: { id: true, transferType: true } },
} as const;

function userId(req: AuthenticatedRequest): number | null {
  const u = req.user as any;
  return u?.employeeDbId ?? u?.employeeId ?? u?.id ?? null;
}

async function resolveApproverDepartmentId(items: { assetId: number | null }[]): Promise<number | null> {
  // Route approval to the first asset-linked item's department. Non-asset items
  // (spares / surgical equipment) carry no department, so skip them here.
  const firstAssetId = items.find((it) => it.assetId != null)?.assetId;
  if (firstAssetId == null) return null;
  const a = await prisma.asset.findUnique({ where: { id: firstAssetId }, select: { departmentId: true } });
  return a?.departmentId ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// CREATE — multi-asset, lands in DRAFT
// ────────────────────────────────────────────────────────────────────────────

export const createGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      type, issuedTo, purpose, expectedReturnDate,
      courierDetails, vehicleNo, vehicleType,
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

    const gatePassNo = await generateGatePassNo();

    const created = await prisma.gatePass.create({
      data: {
        gatePassNo,
        type,
        status: "DRAFT",
        approvalStatus: "PENDING",
        issuedTo,
        purpose,
        expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
        courierDetails: courierDetails ?? null,
        vehicleNo: vehicleNo ?? null,
        vehicleType: vehicleType ?? null,
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

export const getAllGatePasses = async (req: Request, res: Response) => {
  try {
    const { status, approvalStatus, type, assetId, ticketId } = req.query;

    const where: any = {};
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
    if (existing.status !== "DRAFT") {
      res.status(400).json({ message: "Only DRAFT gate passes can be edited" });
      return;
    }

    const { items, ...rest } = req.body;

    const data: any = { ...rest };
    if (data.expectedReturnDate) data.expectedReturnDate = new Date(data.expectedReturnDate);
    if (data.ticketId !== undefined) data.ticketId = data.ticketId ? Number(data.ticketId) : null;
    // Strip fields managed by lifecycle endpoints
    delete data.status; delete data.approvalStatus; delete data.gatePassNo;
    delete data.requestedById; delete data.requestedAt;
    delete data.approvedById; delete data.approvedAt;
    delete data.gatedOutAt; delete data.gatedOutById;
    delete data.gatedInAt; delete data.gatedInById;

    if (Array.isArray(items)) {
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

    const updated = await prisma.gatePass.update({
      where: { id },
      data: { status: "PENDING_APPROVAL", approvalStatus: "PENDING", requestedAt: new Date() },
      include: FULL_INCLUDE,
    });

    // Notify HODs of the (first) asset's department
    const deptId = await resolveApproverDepartmentId(gp.items);
    if (deptId) {
      getDepartmentHODs(deptId).then(ids =>
        notify({
          type: "OTHER",
          title: "Gate Pass Approval Required",
          message: `Gate pass ${gp.gatePassNo} (${gp.type}, ${gp.items.length} item${gp.items.length > 1 ? "s" : ""}) needs your approval — Purpose: ${gp.purpose}`,
          recipientIds: ids,
          gatePassId: gp.id,
          createdById: userId(req) ?? undefined,
        })
      ).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("submitForApproval error:", error);
    res.status(500).json({ message: "Failed to submit gate pass for approval" });
  }
};

export const approveGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { remarks } = req.body;
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== "PENDING_APPROVAL") {
      res.status(400).json({ message: `Cannot approve a gate pass in status ${gp.status}` });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvalStatus: "APPROVED",
        approvedById: userId(req),
        approvedAt: new Date(),
        approvalRemarks: remarks ?? null,
      },
      include: FULL_INCLUDE,
    });

    if (updated.requestedById) {
      notify({
        type: "OTHER",
        title: "Gate Pass Approved",
        message: `Your gate pass ${gp.gatePassNo} has been approved. Hand over to security for gate-out.`,
        recipientIds: [updated.requestedById],
        gatePassId: gp.id,
        createdById: userId(req) ?? undefined,
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
        createdById: userId(req) ?? undefined,
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
    if (gp.status !== "PENDING_APPROVAL") {
      res.status(400).json({ message: `Cannot reject a gate pass in status ${gp.status}` });
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

// SECURITY — physical gate-out (asset leaving)
export const gateOutGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
    if (gp.status !== "APPROVED") {
      res.status(400).json({ message: `Cannot gate-out a pass in status ${gp.status}. Only APPROVED passes can be issued.` });
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
        message: `Gate pass ${gp.gatePassNo} has been issued by security. Asset(s) released.`,
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

// HOD inbox — passes awaiting approval whose first item's asset is in the user's department.
export const getPendingApproval = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const u = req.user as any;
    const departmentId = u?.departmentId ? Number(u.departmentId) : null;

    const where: any = { status: "PENDING_APPROVAL", approvalStatus: "PENDING" };
    if (departmentId) {
      where.items = { some: { asset: { departmentId } } };
    }

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
export const getSecurityQueue = async (_req: Request, res: Response) => {
  try {
    const list = await prisma.gatePass.findMany({
      where: { status: { in: ["APPROVED", "ISSUED"] } },
      include: FULL_INCLUDE,
      orderBy: [{ status: "asc" }, { approvedAt: "desc" }],
    });
    res.json(list);
  } catch (error) {
    console.error("getSecurityQueue error:", error);
    res.status(500).json({ message: "Failed to fetch security queue" });
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
    await streamGatePassPdf(gp as any, res);
  } catch (error) {
    console.error("downloadGatePassPdf error:", error);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE — only DRAFT
// ────────────────────────────────────────────────────────────────────────────

export const deleteGatePass = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gp = await prisma.gatePass.findUnique({ where: { id } });
    if (!gp) { res.status(404).json({ message: "Gate pass not found" }); return; }
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

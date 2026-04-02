import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

// Helper: get all OPERATIONS employee IDs
const getOperationsIds = async (): Promise<number[]> => {
  const ops = await prisma.employee.findMany({
    where: { role: "OPERATIONS", isActive: true },
    select: { id: true },
  });
  return ops.map((o) => o.id);
};

// ═══════════════════════════════════════════════════════════
// GET / — List material requests
// ═══════════════════════════════════════════════════════════
export const listMaterialRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { ticketId, status } = req.query;

    const where: any = {};
    if (ticketId) where.ticketId = Number(ticketId);
    if (status) where.status = String(status);

    // Department scoping for non-admin users
    if (user?.role !== "ADMIN" && user?.departmentId) {
      where.ticket = { departmentId: Number(user.departmentId) };
    }

    const requests = await prisma.materialRequest.findMany({
      where,
      include: {
        ticket: {
          select: { id: true, ticketId: true, assetId: true, departmentId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(requests);
  } catch (err: any) {
    console.error("listMaterialRequests error:", err);
    res.status(500).json({ error: "Failed to list material requests", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST / — Create material request
// ═══════════════════════════════════════════════════════════
export const createMaterialRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { ticketId, itemType, sparePartId, consumableId, description, quantity, estimatedCost } = req.body;

    if (!ticketId || !itemType || !description || !quantity) {
      res.status(400).json({ error: "ticketId, itemType, description, and quantity are required" });
      return;
    }

    // Verify ticket exists
    const ticket = await prisma.ticket.findUnique({
      where: { id: Number(ticketId) },
      select: { id: true, ticketId: true, departmentId: true },
    });
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const record = await prisma.materialRequest.create({
      data: {
        ticketId: Number(ticketId),
        itemType,
        sparePartId: sparePartId ? Number(sparePartId) : null,
        consumableId: consumableId ? Number(consumableId) : null,
        description,
        quantity,
        estimatedCost: estimatedCost ?? null,
        status: "PENDING",
        requestedById: user?.employeeDbId ?? null,
        requestedAt: new Date(),
      },
    });

    // Audit log
    await logAction({
      entityType: "MATERIAL_REQUEST",
      entityId: record.id,
      action: "CREATED",
      description: `Material request created for ticket ${ticket.ticketId}`,
      performedById: user?.employeeDbId,
    });

    // Notify operations team
    const opsIds = await getOperationsIds();
    const adminIds = await getAdminIds();
    const recipientIds = [...new Set([...opsIds, ...adminIds])];

    if (recipientIds.length > 0) {
      await notify({
        type: "MATERIAL_REQUEST",
        title: "New Material Request",
        message: `A material request has been raised for ticket ${ticket.ticketId} — ${itemType}: ${description}`,
        recipientIds,
        priority: "MEDIUM",
        ticketId: ticket.id,
        createdById: user?.employeeDbId,
      });
    }

    res.status(201).json(record);
  } catch (err: any) {
    console.error("createMaterialRequest error:", err);
    res.status(500).json({ error: "Failed to create material request", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PATCH /:id/approve — Operations approves
// ═══════════════════════════════════════════════════════════
export const approveMaterialRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;

    // Only OPERATIONS or ADMIN
    if (user?.role !== "OPERATIONS" && user?.role !== "ADMIN") {
      res.status(403).json({ error: "Only OPERATIONS or ADMIN can approve material requests" });
      return;
    }

    const id = Number(req.params.id);
    const { approvalRemarks, expectedDelivery } = req.body;

    const existing = await prisma.materialRequest.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Material request not found" });
      return;
    }
    if (existing.status !== "PENDING") {
      res.status(400).json({ error: `Cannot approve a request with status ${existing.status}` });
      return;
    }

    const updated = await prisma.materialRequest.update({
      where: { id },
      data: {
        status: "OPERATIONS_APPROVED",
        approvedById: user?.employeeDbId ?? null,
        approvedAt: new Date(),
        approvalRemarks: approvalRemarks ?? null,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
      },
    });

    await logAction({
      entityType: "MATERIAL_REQUEST",
      entityId: id,
      action: "APPROVED",
      description: `Material request #${id} approved by operations`,
      performedById: user?.employeeDbId,
    });

    // Notify requester
    if (existing.requestedById) {
      await notify({
        type: "MATERIAL_REQUEST",
        title: "Material Request Approved",
        message: `Your material request #${id} has been approved.${approvalRemarks ? ` Remarks: ${approvalRemarks}` : ""}`,
        recipientIds: [existing.requestedById],
        priority: "MEDIUM",
        ticketId: existing.ticketId,
        createdById: user?.employeeDbId,
      });
    }

    res.json(updated);
  } catch (err: any) {
    console.error("approveMaterialRequest error:", err);
    res.status(500).json({ error: "Failed to approve material request", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PATCH /:id/reject — Reject material request
// ═══════════════════════════════════════════════════════════
export const rejectMaterialRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;

    if (user?.role !== "OPERATIONS" && user?.role !== "ADMIN") {
      res.status(403).json({ error: "Only OPERATIONS or ADMIN can reject material requests" });
      return;
    }

    const id = Number(req.params.id);
    const { approvalRemarks } = req.body;

    const existing = await prisma.materialRequest.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Material request not found" });
      return;
    }
    if (existing.status !== "PENDING") {
      res.status(400).json({ error: `Cannot reject a request with status ${existing.status}` });
      return;
    }

    const updated = await prisma.materialRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedById: user?.employeeDbId ?? null,
        approvedAt: new Date(),
        approvalRemarks: approvalRemarks ?? null,
      },
    });

    await logAction({
      entityType: "MATERIAL_REQUEST",
      entityId: id,
      action: "REJECTED",
      description: `Material request #${id} rejected`,
      performedById: user?.employeeDbId,
    });

    // Notify requester
    if (existing.requestedById) {
      await notify({
        type: "MATERIAL_REQUEST",
        title: "Material Request Rejected",
        message: `Your material request #${id} has been rejected.${approvalRemarks ? ` Reason: ${approvalRemarks}` : ""}`,
        recipientIds: [existing.requestedById],
        priority: "MEDIUM",
        ticketId: existing.ticketId,
        createdById: user?.employeeDbId,
      });
    }

    res.json(updated);
  } catch (err: any) {
    console.error("rejectMaterialRequest error:", err);
    res.status(500).json({ error: "Failed to reject material request", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PATCH /:id/deliver — Mark as delivered
// ═══════════════════════════════════════════════════════════
export const deliverMaterialRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { deliveryRemarks } = req.body;

    const existing = await prisma.materialRequest.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Material request not found" });
      return;
    }
    if (existing.status !== "OPERATIONS_APPROVED") {
      res.status(400).json({ error: `Cannot mark as delivered — current status is ${existing.status}` });
      return;
    }

    const updated = await prisma.materialRequest.update({
      where: { id },
      data: {
        status: "DELIVERED",
        actualDelivery: new Date(),
        deliveryRemarks: deliveryRemarks ?? null,
      },
    });

    await logAction({
      entityType: "MATERIAL_REQUEST",
      entityId: id,
      action: "DELIVERED",
      description: `Material request #${id} marked as delivered`,
      performedById: user?.employeeDbId,
    });

    res.json(updated);
  } catch (err: any) {
    console.error("deliverMaterialRequest error:", err);
    res.status(500).json({ error: "Failed to mark material request as delivered", details: err.message });
  }
};

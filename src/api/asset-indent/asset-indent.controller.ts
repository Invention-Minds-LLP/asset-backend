import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

function mustUser(req: AuthenticatedRequest) {
  const u = (req as any).user;
  if (!u?.employeeDbId) throw new Error("Unauthorized");
  return u as { employeeDbId: number; employeeID: string; name?: string; role: string; departmentId?: number };
}

// FY-based indent number: IND-FY2526-001
async function generateIndentNumber(): Promise<string> {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEndYear = fyStartYear + 1;
  const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;

  const latest = await prisma.assetIndent.findFirst({
    where: { indentNumber: { startsWith: `IND-${fyString}` } },
    orderBy: { id: "desc" },
  });

  let seq = 1;
  if (latest) {
    const parts = latest.indentNumber.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `IND-${fyString}-${seq.toString().padStart(3, "0")}`;
}

// GET /api/asset-indent
export const getAllIndents = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const { status, departmentId, myDept } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (departmentId) where.departmentId = Number(departmentId);
    // Non-HOD/management see only their dept
    if (myDept === "true" && user.departmentId) {
      where.departmentId = user.departmentId;
    }

    const indents = await prisma.assetIndent.findMany({
      where,
      include: {
        raisedBy: { select: { id: true, name: true, employeeID: true } },
        department: { select: { id: true, name: true } },
        assetCategory: { select: { id: true, name: true } },
        hodApprovedBy: { select: { id: true, name: true } },
        fulfilledAsset: { select: { id: true, assetId: true, assetName: true } },
      },
      orderBy: { id: "desc" },
    });

    res.json(indents);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch indents" });
  }
};

// GET /api/asset-indent/:id
export const getIndentById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const indent = await prisma.assetIndent.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        raisedBy: { select: { id: true, name: true, employeeID: true, designation: true } },
        department: { select: { id: true, name: true } },
        assetCategory: { select: { id: true, name: true } },
        hodApprovedBy: { select: { id: true, name: true } },
        fulfilledAsset: { select: { id: true, assetId: true, assetName: true } },
      },
    });

    if (!indent) {
      res.status(404).json({ message: "Indent not found" });
      return;
    }
    res.json(indent);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch indent" });
  }
};

// POST /api/asset-indent
export const createIndent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const {
      assetCategoryId,
      assetName,
      quantity,
      justification,
      urgency,
      estimatedBudget,
      requiredByDate,
      specifications,
      departmentId,
    } = req.body;

    if (!assetName || !justification) {
      res.status(400).json({ message: "assetName and justification are required" });
      return;
    }

    const deptId = departmentId ? Number(departmentId) : user.departmentId;
    if (!deptId) {
      res.status(400).json({ message: "departmentId required" });
      return;
    }

    const indentNumber = await generateIndentNumber();

    const indent = await prisma.assetIndent.create({
      data: {
        indentNumber,
        raisedById: user.employeeDbId,
        departmentId: deptId,
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : null,
        assetName: String(assetName),
        quantity: quantity ? Number(quantity) : 1,
        justification: String(justification),
        urgency: urgency ?? "NORMAL",
        estimatedBudget: estimatedBudget ? Number(estimatedBudget) : null,
        requiredByDate: requiredByDate ? new Date(requiredByDate) : null,
        specifications: specifications ?? null,
        status: "SUBMITTED",
        hodApprovalStatus: "PENDING",
      },
    });

    // Fire-and-forget: notify department HODs about new indent
    getDepartmentHODs(deptId).then(hodIds =>
      notify({
        type: "OTHER",
        title: `New Asset Indent ${indentNumber}`,
        message: `Asset indent for "${assetName}" requires HOD approval`,
        recipientIds: hodIds,
        priority: urgency === "URGENT" ? "HIGH" : "MEDIUM",
        createdById: user.employeeDbId,
      })
    ).catch(() => {});

    // Notify department HOD
    const hod = await prisma.employee.findFirst({
      where: { departmentId: deptId, role: "HOD" },
      select: { id: true },
    });

    if (hod) {
      const notif = await prisma.notification.create({
        data: {
          type: "OTHER",
          title: `New Asset Indent ${indentNumber}`,
          message: `Asset indent for "${assetName}" requires your approval`,
          priority: urgency === "URGENT" ? "HIGH" : "MEDIUM",
          dedupeKey: `INDENT_NEW_${indent.id}`,
          createdById: user.employeeDbId,
        },
      });
      await prisma.notificationRecipient.create({
        data: { notificationId: notif.id, employeeId: hod.id },
      });
    }

    res.status(201).json(indent);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to create indent" });
  }
};

// PATCH /api/asset-indent/:id/hod-approval
export const hodApproveIndent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const indentId = Number(req.params.id);
    const { decision, remarks } = req.body; // APPROVED | REJECTED

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
      return;
    }

    const indent = await prisma.assetIndent.findUnique({ where: { id: indentId } });
    if (!indent) {
      res.status(404).json({ message: "Indent not found" });
      return;
    }
    if (indent.hodApprovalStatus !== "PENDING") {
      res.status(400).json({ message: "Indent already processed" });
      return;
    }

    const updated = await prisma.assetIndent.update({
      where: { id: indentId },
      data: {
        hodApprovalStatus: decision,
        hodApprovedById: user.employeeDbId,
        hodApprovedAt: new Date(),
        hodRemarks: remarks ?? null,
        status: decision === "APPROVED" ? "HOD_APPROVED" : "REJECTED",
        // If approved, forward to management (status change is enough; management polls HOD_APPROVED)
        managementApprovalStatus: decision === "APPROVED" ? "PENDING" : null,
      },
    });

    // Fire-and-forget: notify raiser about HOD decision
    notify({
      type: "OTHER",
      title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Approved" : "Rejected"} by HOD`,
      message: remarks || (decision === "APPROVED" ? "Indent forwarded for management review" : "Indent rejected"),
      recipientIds: [indent.raisedById],
      priority: "MEDIUM",
      createdById: user.employeeDbId,
      channel: "BOTH",
      templateCode: decision === "APPROVED" ? "INDENT_APPROVED" : "INDENT_REJECTED",
      templateData: { indentNumber: indent.indentNumber, assetName: indent.assetName || '', reason: remarks || '' },
    }).catch(() => {});

    // Fire-and-forget: if HOD approved, notify admins for management approval
    if (decision === "APPROVED") {
      getAdminIds().then(adminIds =>
        notify({
          type: "OTHER",
          title: `Indent ${indent.indentNumber} Awaiting Management Approval`,
          message: `Asset indent for "${indent.assetName}" approved by HOD, pending management approval`,
          recipientIds: adminIds,
          priority: "MEDIUM",
          createdById: user.employeeDbId,
        })
      ).catch(() => {});
    }

    // Notify raiser
    const notif = await prisma.notification.create({
      data: {
        type: "OTHER",
        title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Approved" : "Rejected"} by HOD`,
        message: remarks || (decision === "APPROVED" ? "Indent forwarded for management review" : "Indent rejected"),
        priority: "MEDIUM",
        dedupeKey: `INDENT_HOD_${indentId}_${decision}`,
        createdById: user.employeeDbId,
      },
    });
    await prisma.notificationRecipient.create({
      data: { notificationId: notif.id, employeeId: indent.raisedById },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to process HOD approval" });
  }
};

// PATCH /api/asset-indent/:id/management-approval
export const managementApproveIndent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const indentId = Number(req.params.id);
    const { decision, remarks } = req.body;

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
      return;
    }

    const indent = await prisma.assetIndent.findUnique({ where: { id: indentId } });
    if (!indent) {
      res.status(404).json({ message: "Indent not found" });
      return;
    }
    if (indent.managementApprovalStatus !== "PENDING") {
      res.status(400).json({ message: "Management approval not pending" });
      return;
    }

    const updated = await prisma.assetIndent.update({
      where: { id: indentId },
      data: {
        managementApprovalStatus: decision,
        status: decision === "APPROVED" ? "MANAGEMENT_APPROVED" : "REJECTED",
      },
    });

    // Fire-and-forget: notify raiser about management decision
    notify({
      type: "OTHER",
      title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Management Approved" : "Rejected"}`,
      message: remarks || `Management has ${decision === "APPROVED" ? "approved" : "rejected"} your indent`,
      recipientIds: [indent.raisedById],
      priority: "MEDIUM",
      createdById: user.employeeDbId,
      channel: "BOTH",
      templateCode: decision === "APPROVED" ? "INDENT_APPROVED" : "INDENT_REJECTED",
      templateData: { indentNumber: indent.indentNumber, assetName: indent.assetName || '', reason: remarks || '' },
    }).catch(() => {});

    // Notify raiser
    const notif = await prisma.notification.create({
      data: {
        type: "OTHER",
        title: `Indent ${indent.indentNumber} ${decision === "APPROVED" ? "Management Approved" : "Rejected"}`,
        message: remarks || `Management has ${decision === "APPROVED" ? "approved" : "rejected"} your indent`,
        priority: "MEDIUM",
        dedupeKey: `INDENT_MGMT_${indentId}_${decision}`,
        createdById: user.employeeDbId,
      },
    });
    await prisma.notificationRecipient.create({
      data: { notificationId: notif.id, employeeId: indent.raisedById },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to process management approval" });
  }
};

// PATCH /api/asset-indent/:id/fulfill
export const fulfillIndent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const indentId = Number(req.params.id);
    const { fulfilledAssetId } = req.body;

    const indent = await prisma.assetIndent.findUnique({ where: { id: indentId } });
    if (!indent) {
      res.status(404).json({ message: "Indent not found" });
      return;
    }
    if (!["MANAGEMENT_APPROVED", "HOD_APPROVED"].includes(indent.status)) {
      res.status(400).json({ message: "Indent must be approved before fulfillment" });
      return;
    }

    const updated = await prisma.assetIndent.update({
      where: { id: indentId },
      data: {
        status: "FULFILLED",
        fulfilledAt: new Date(),
        fulfilledAssetId: fulfilledAssetId ? Number(fulfilledAssetId) : null,
      },
    });

    // Notify raiser
    const notif = await prisma.notification.create({
      data: {
        type: "OTHER",
        title: `Indent ${indent.indentNumber} Fulfilled`,
        message: `Your asset indent has been fulfilled`,
        priority: "MEDIUM",
        dedupeKey: `INDENT_FULFILLED_${indentId}`,
        createdById: user.employeeDbId,
      },
    });
    await prisma.notificationRecipient.create({
      data: { notificationId: notif.id, employeeId: indent.raisedById },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to fulfill indent" });
  }
};

// DELETE /api/asset-indent/:id  (only DRAFT/SUBMITTED can be cancelled by raiser)
export const cancelIndent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const indentId = Number(req.params.id);

    const indent = await prisma.assetIndent.findUnique({ where: { id: indentId } });
    if (!indent) {
      res.status(404).json({ message: "Indent not found" });
      return;
    }
    if (indent.raisedById !== user.employeeDbId) {
      res.status(403).json({ message: "Only the raiser can cancel this indent" });
      return;
    }
    if (!["DRAFT", "SUBMITTED"].includes(indent.status)) {
      res.status(400).json({ message: "Only DRAFT or SUBMITTED indents can be cancelled" });
      return;
    }

    const updated = await prisma.assetIndent.update({
      where: { id: indentId },
      data: { status: "CANCELLED" },
    });

    // Notify HOD about cancellation
    if (indent.departmentId) {
      getDepartmentHODs(indent.departmentId).then(hodIds =>
        notify({
          type: "OTHER",
          title: `Indent ${indent.indentNumber} Cancelled`,
          message: `Asset indent for "${indent.assetName}" has been cancelled by the raiser`,
          recipientIds: hodIds,
          priority: "MEDIUM",
          createdById: user.employeeDbId,
        })
      ).catch(() => {});
    }

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to cancel indent" });
  }
};

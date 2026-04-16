import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import fs from "fs";
import path from "path";
import { Client } from "basic-ftp";
import { AcknowledgementPurpose } from "@prisma/client";
import { logAction } from "../audit-trail/audit-trail.controller";
import { notify, getDepartmentHODs } from "../../utilis/notificationHelper";


const FTP_CONFIG = {
    host: "srv680.main-hosting.eu",  // Your FTP hostname
    user: "u948610439",       // Your FTP username
    password: "Bsrenuk@1993",   // Your FTP password
    secure: false                    // Set to true if using FTPS
};

function toDateOrNull(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// POST /assets/transfer/request
export const requestAssetTransfer = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const {
      assetId,
      transferType,
      externalType,
      toBranchId,
      block,
      floor,
      room,
      destinationType,
      destinationName,
      destinationAddress,
      destinationContactPerson,
      destinationContactNumber,
      temporary,
      expiresAt,
      reason
    } = req.body;

    if (!assetId || !transferType) {
      res.status(400).json({ message: "assetId and transferType are required" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) }
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const currentLocation = await prisma.assetLocation.findFirst({
      where: { assetId: Number(assetId), isActive: true }
    });

    const transfer = await prisma.assetTransferHistory.create({
      data: {
        assetId: Number(assetId),
        transferType,
        externalType: externalType || null,
        fromBranchId: currentLocation?.branchId ?? null,
        toBranchId: toBranchId ? Number(toBranchId) : null,
        block: block || null,
        floor: floor || null,
        room: room || null,

        destinationType: destinationType || null,
        destinationName: destinationName || null,
        destinationAddress: destinationAddress || null,
        destinationContactPerson: destinationContactPerson || null,
        destinationContactNumber: destinationContactNumber || null,

        temporary: !!temporary,
        expiresAt: temporary ? toDateOrNull(expiresAt) : null,

        // Permanent transfers need management approval before HOD can approve
        managementApprovalStatus: (!temporary) ? "PENDING" : null,
        status: "REQUESTED",
        requestedById: req.user?.employeeDbId ?? null,
        reason: reason || null,
        transferDate: null
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true
      }
    });

    logAction({ entityType: "TRANSFER", entityId: transfer.id, action: "CREATE", description: `Transfer request for asset #${assetId} (${transferType})`, performedById: req.user?.employeeDbId });

    // Notify HODs about transfer request
    const hodIds = await getDepartmentHODs(asset.departmentId);
    notify({ type: "TRANSFER", title: "Transfer Request", message: `Asset transfer requested for ${asset.assetName || asset.assetId} (${transferType})`, recipientIds: hodIds, assetId: asset.id, createdById: req.user?.employeeDbId, channel: "BOTH", templateCode: "TRANSFER_REQUEST", templateData: { assetName: asset.assetName || asset.assetId, transferType } });

    res.status(201).json({
      message: "Transfer request submitted",
      transfer
    });
  } catch (err) {
    console.error("Request transfer error:", err);
    res.status(500).json({ message: "Failed to submit transfer request" });
  }
};

// POST /assets/transfer/:id/approve
export const approveAssetTransfer = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transferId = Number(req.params.id);
    const { approvalReason } = req.body;

    const transfer = await prisma.assetTransferHistory.findUnique({
      where: { id: transferId }
    });

    if (!transfer) {
      res.status(404).json({ message: "Transfer request not found" });
      return;
    }

    if (transfer.status !== "REQUESTED") {
      res.status(400).json({ message: "Only requested transfers can be approved" });
      return;
    }

    const { asset, hod } = await getAssetDepartmentHod(transfer.assetId);

    if (hod.id !== req.user?.employeeDbId) {
      res.status(403).json({ message: "Only asset department HOD can approve this transfer" });
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      const currentLocation = await tx.assetLocation.findFirst({
        where: { assetId: transfer.assetId, isActive: true }
      });

      const currentBranchId = currentLocation?.branchId ?? null;

      await tx.assetLocation.updateMany({
        where: { assetId: transfer.assetId, isActive: true },
        data: { isActive: false }
      });

      let newLocation = null;

      if (!(transfer.transferType === "EXTERNAL" && transfer.externalType === "DEAD")) {
        let targetBranchId: number | null = null;

        if (transfer.transferType === "INTERNAL") {
          targetBranchId = currentBranchId;
        } else if (transfer.transferType === "EXTERNAL" && transfer.externalType === "BRANCH") {
          targetBranchId = transfer.toBranchId ?? null;
        } else {
          // SERVICE / TEMP_USE / OTHER OUTSIDE
          targetBranchId = currentBranchId;
        }

        if (targetBranchId) {
          newLocation = await tx.assetLocation.create({
            data: {
              assetId: transfer.assetId,
              branchId: targetBranchId,
              block: transfer.transferType === "INTERNAL" ? transfer.block : null,
              floor: transfer.transferType === "INTERNAL" ? transfer.floor : null,
              room: transfer.transferType === "INTERNAL" ? transfer.room : null,
              isActive: true
            }
          });
        }
      }

      const updatedTransfer = await tx.assetTransferHistory.update({
        where: { id: transfer.id },
        data: {
          status: "APPROVED",
          approvedById: req.user?.employeeDbId ?? null,
          approvedAt: new Date(),
          approvalReason: approvalReason || null,
          transferDate: new Date(),
          fromBranchId: transfer.fromBranchId ?? currentBranchId
        },
        include: {
          asset: true,
          fromBranch: true,
          toBranch: true,
          requestedBy: true,
          approvedBy: true
        }
      });

      if (transfer.externalType === "DEAD") {
        await tx.asset.update({
          where: { id: transfer.assetId },
          data: { status: "DEAD" }
        });
      }

      // Auto-generate gate pass for external transfers (non-DEAD)
      let gatePass = null;
      if (transfer.transferType === "EXTERNAL" && transfer.externalType !== "DEAD") {
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
        const gpCount = await tx.gatePass.count({
          where: { gatePassNo: { startsWith: `GP-${dateStr}` } },
        });
        const gatePassNo = `GP-${dateStr}-${String(gpCount + 1).padStart(4, "0")}`;

        gatePass = await tx.gatePass.create({
          data: {
            gatePassNo,
            type: "OUTWARD",
            status: "ISSUED",
            assetId: transfer.assetId,
            issuedTo: transfer.destinationName ?? transfer.destinationContactPerson ?? "External",
            purpose: transfer.reason ?? `Transfer: ${transfer.externalType}`,
            approvedBy: String(req.user?.employeeDbId ?? "HOD"),
            transferHistoryId: transfer.id,
          } as any,
        });
      }

      return { updatedTransfer, newLocation, gatePass };
    });

    logAction({ entityType: "TRANSFER", entityId: transferId, action: "APPROVE", description: `Transfer #${transferId} approved for asset #${transfer.assetId}`, performedById: req.user?.employeeDbId });

    // Notify requester that transfer is approved
    if (transfer.requestedById) notify({ type: "TRANSFER", title: "Transfer Approved", message: `Transfer for asset ${asset.assetId} — ${asset.assetName} has been approved`, recipientIds: [transfer.requestedById], assetId: transfer.assetId });

    res.json({
      message: "Transfer approved successfully",
      ...result
    });
  } catch (err) {
    console.error("Approve transfer error:", err);
    res.status(500).json({ message: "Failed to approve transfer" });
  }
};

// POST /assets/transfer/:id/reject
export const rejectAssetTransfer = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transferId = Number(req.params.id);
    const { rejectionReason } = req.body;

    const transfer = await prisma.assetTransferHistory.findUnique({
      where: { id: transferId }
    });

    if (!transfer) {
      res.status(404).json({ message: "Transfer request not found" });
      return;
    }

    if (transfer.status !== "REQUESTED") {
      res.status(400).json({ message: "Only requested transfers can be rejected" });
      return;
    }
    const { asset, hod } = await getAssetDepartmentHod(transfer.assetId);

    if (hod.id !== req.user?.employeeDbId) {
      res.status(403).json({ message: "Only asset department HOD can reject this transfer" });
      return;
    }

    const updated = await prisma.assetTransferHistory.update({
      where: { id: transferId },
      data: {
        status: "REJECTED",
        approvedById: req.user?.employeeDbId ?? null,
        rejectedAt: new Date(),
        rejectionReason: rejectionReason || null
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true
      }
    });

    logAction({ entityType: "TRANSFER", entityId: transferId, action: "STATUS_CHANGE", description: `Transfer #${transferId} rejected`, performedById: req.user?.employeeDbId });

    // Notify requester that transfer is rejected
    if (transfer.requestedById) notify({ type: "TRANSFER", title: "Transfer Rejected", message: `Transfer for asset ${asset.assetId} — ${asset.assetName} has been rejected`, recipientIds: [transfer.requestedById], assetId: transfer.assetId });

    res.json({
      message: "Transfer rejected",
      transfer: updated
    });
  } catch (err) {
    console.error("Reject transfer error:", err);
    res.status(500).json({ message: "Failed to reject transfer" });
  }
};

// POST /assets/transfer/:id/return
export const returnTransferredAsset = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transferId = Number(req.params.id);
    const { returnReason } = req.body;

    const originalTransfer = await prisma.assetTransferHistory.findUnique({
      where: { id: transferId }
    });

    if (!originalTransfer) {
      res.status(404).json({ message: "Original transfer not found" });
      return;
    }

    if (originalTransfer.transferType === "RETURN") {
      res.status(400).json({ message: "Return entry cannot be returned again" });
      return;
    }

    if (originalTransfer.status !== "APPROVED") {
      res.status(400).json({ message: "Only approved transfers can be returned" });
      return;
    }

    if (!originalTransfer.temporary) {
      res.status(400).json({ message: "Only temporary transfers can be returned" });
      return;
    }

    if (!originalTransfer.fromBranchId) {
      res.status(400).json({ message: "Original branch not found for return" });
      return;
    }

    const existingReturn = await prisma.assetTransferHistory.findFirst({
      where: {
        parentTransferId: originalTransfer.id,
        transferType: "RETURN"
      }
    });

    if (existingReturn) {
      res.status(400).json({ message: "This transfer has already been returned" });
      return;
    }

    const { hod } = await getAssetDepartmentHod(originalTransfer.assetId);

    const me = req.user?.employeeDbId ?? null;
    const canReturn = me === originalTransfer.requestedById || me === hod.id;

    if (!canReturn) {
      res.status(403).json({ message: "You are not allowed to return this asset" });
      return;
    }

    const currentLocation = await prisma.assetLocation.findFirst({
      where: { assetId: originalTransfer.assetId, isActive: true }
    });

    const currentBranchId = currentLocation?.branchId ?? null;

    await prisma.assetLocation.updateMany({
      where: { assetId: originalTransfer.assetId, isActive: true },
      data: { isActive: false }
    });

    const newLocation = await prisma.assetLocation.create({
      data: {
        assetId: originalTransfer.assetId,
        branchId: originalTransfer.fromBranchId,
        isActive: true
      }
    });

    const returnEntry = await prisma.assetTransferHistory.create({
      data: {
        assetId: originalTransfer.assetId,
        transferType: "RETURN",
        externalType: null,
        fromBranchId: currentBranchId,
        toBranchId: originalTransfer.fromBranchId,
        destinationType: null,
        destinationName: null,
        destinationAddress: null,
        destinationContactPerson: null,
        destinationContactNumber: null,
        temporary: false,
        status: "RETURNED",
        requestedById: me,
        approvedById: me,
        requestedAt: new Date(),
        approvedAt: new Date(),
        returnedAt: new Date(),
        transferDate: new Date(),
        reason: returnReason || "Asset returned",
        returnReason: returnReason || null,
        parentTransferId: originalTransfer.id
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true,
        parentTransfer: true
      }
    });

    const updatedOriginalTransfer = await prisma.assetTransferHistory.update({
      where: { id: originalTransfer.id },
      data: {
        status: "RETURNED",
        returnedAt: new Date()
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true
      }
    });

    // Notify HOD of asset's department about the return
    const { asset: retAsset } = await getAssetDepartmentHod(originalTransfer.assetId);
    const retHodIds = await getDepartmentHODs(retAsset.departmentId);
    if (retHodIds.length > 0) {
      notify({ type: "OTHER", title: "Asset Returned", message: `Asset ${retAsset.assetId} — ${retAsset.assetName} has been returned${returnReason ? `. Reason: ${returnReason}` : ""}`, recipientIds: retHodIds, assetId: originalTransfer.assetId, createdById: req.user?.employeeDbId });
    }

    res.json({
      message: "Asset returned successfully",
      returnEntry,
      updatedOriginalTransfer,
      newLocation
    });
  } catch (err: any) {
    console.error("Return transfer error:", err);
    res.status(500).json({ message: "Failed to return asset" });
  }
};
// POST /assets/transfer/:id/return
export const requestTransferredAssetReturn = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transferId = Number(req.params.id);
    const { returnReason } = req.body;

    const originalTransfer = await prisma.assetTransferHistory.findUnique({
      where: { id: transferId }
    });

    if (!originalTransfer) {
      res.status(404).json({ message: "Original transfer not found" });
      return;
    }

    if (originalTransfer.transferType === "RETURN") {
      res.status(400).json({ message: "Return request cannot be created from a return row" });
      return;
    }

    if (originalTransfer.status !== "APPROVED") {
      res.status(400).json({ message: "Only approved transfers can be returned" });
      return;
    }

    if (!originalTransfer.temporary) {
      res.status(400).json({ message: "Only temporary transfers can be returned" });
      return;
    }

    if (!originalTransfer.fromBranchId) {
      res.status(400).json({ message: "Original branch not found for return" });
      return;
    }

    const me = req.user?.employeeDbId ?? null;

    const existingReturnRequest = await prisma.assetTransferHistory.findFirst({
      where: {
        parentTransferId: originalTransfer.id,
        transferType: "RETURN",
        status: {
          in: ["REQUESTED", "RETURNED"]
        }
      }
    });

    if (existingReturnRequest) {
      res.status(400).json({ message: "Return request already exists for this transfer" });
      return;
    }

    const currentLocation = await prisma.assetLocation.findFirst({
      where: { assetId: originalTransfer.assetId, isActive: true }
    });

    const returnRequest = await prisma.assetTransferHistory.create({
      data: {
        assetId: originalTransfer.assetId,
        transferType: "RETURN",
        externalType: null,
        fromBranchId: currentLocation?.branchId ?? null,
        toBranchId: originalTransfer.fromBranchId,
        destinationType: null,
        destinationName: null,
        destinationAddress: null,
        destinationContactPerson: null,
        destinationContactNumber: null,
        temporary: false,
        status: "REQUESTED",
        requestedById: me,
        approvedById: null,
        requestedAt: new Date(),
        approvedAt: null,
        returnedAt: null,
        transferDate: null,
        reason: returnReason || "Return requested",
        returnReason: returnReason || null,
        parentTransferId: originalTransfer.id
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true,
        parentTransfer: true
      }
    });

    res.status(201).json({
      message: "Return request submitted successfully",
      returnRequest
    });
  } catch (err) {
    console.error("Request return error:", err);
    res.status(500).json({ message: "Failed to request return" });
  }
};

// POST /assets/transfer/:id/approve-return
export const approveTransferredAssetReturn = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const returnTransferId = Number(req.params.id);
    const { approvalReason } = req.body;

    const returnRequest = await prisma.assetTransferHistory.findUnique({
      where: { id: returnTransferId },
      include: {
        parentTransfer: true
      }
    });

    if (!returnRequest) {
      res.status(404).json({ message: "Return request not found" });
      return;
    }

    if (returnRequest.transferType !== "RETURN") {
      res.status(400).json({ message: "Only return requests can be approved here" });
      return;
    }

    if (returnRequest.status !== "REQUESTED") {
      res.status(400).json({ message: "Only requested return entries can be approved" });
      return;
    }

    if (!returnRequest.parentTransfer) {
      res.status(400).json({ message: "Parent transfer not found for return request" });
      return;
    }

    const { hod } = await getAssetDepartmentHod(returnRequest.assetId);

    if (hod.id !== req.user?.employeeDbId) {
      res.status(403).json({ message: "Only asset department HOD can approve this return" });
      return;
    }

    const approvedReturn = await prisma.assetTransferHistory.update({
      where: { id: returnRequest.id },
      data: {
        status: "APPROVED",
        approvedById: req.user?.employeeDbId ?? null,
        approvedAt: new Date(),
        approvalReason: approvalReason || null
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true,
        parentTransfer: true
      }
    });

    res.json({
      message: "Return request approved. Awaiting physical return checklist submission.",
      approvedReturn
    });
  } catch (err) {
    console.error("Approve return error:", err);
    res.status(500).json({ message: "Failed to approve return" });
  }
};
// GET /assets/:assetId/transfer-history
export const getTransferHistory = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const assetId = Number(req.params.assetId);

    const history = await prisma.assetTransferHistory.findMany({
      where: { assetId },
      include: {
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true,
        parentTransfer: true
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(history);
  } catch (err) {
    console.error("Transfer history error:", err);
    res.status(500).json({ message: "Failed to fetch transfer history" });
  }
};

// GET /assets/transfer/pending
export const getPendingTransferRequests = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const rows = await prisma.assetTransferHistory.findMany({
      where: { status: "REQUESTED" },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true
      },
      orderBy: { requestedAt: "desc" }
    });

    res.json(rows);
  } catch (err) {
    console.error("Pending transfer requests error:", err);
    res.status(500).json({ message: "Failed to fetch pending requests" });
  }
};

export const getMyPendingTransferApprovals = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const employeeId = req.user?.employeeDbId;

    const me = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, role: true, departmentId: true }
    });

    if (!me || me.role !== "HOD") {
      res.status(403).json({ message: "Only HOD can access pending transfer approvals" });
      return;
    }

    const rows = await prisma.assetTransferHistory.findMany({
      where: {
        status: "REQUESTED",
        asset: {
          departmentId: me.departmentId
        }
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        parentTransfer: {
          include: {
            fromBranch: true,
            toBranch: true
          }
        }
      },
      orderBy: {
        requestedAt: "desc"
      }
    });

    res.json(rows);
  } catch (err) {
    console.error("Pending transfer approvals error:", err);
    res.status(500).json({ message: "Failed to fetch pending approvals" });
  }
};

async function getAssetDepartmentHod(assetId: number) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, departmentId: true, assetId: true, assetName: true }
  });

  if (!asset) {
    throw new Error("Asset not found");
  }

  if (!asset.departmentId) {
    throw new Error("Asset has no department assigned");
  }

  const hod = await prisma.employee.findFirst({
    where: {
      departmentId: asset.departmentId,
      role: "HOD"
    }
  });

  if (!hod) {
    throw new Error("No HOD found for asset department");
  }

  return { asset, hod };
}
export const completeTransferredAssetReturn = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const returnTransferId = Number(req.params.id);
    const returnNote = req.body.returnNote;
    const digitalSignature = req.body.digitalSignature;

    let checklist: any[] = [];
    try {
      checklist = req.body.checklist ? JSON.parse(req.body.checklist) : [];
      if (!Array.isArray(checklist)) {
        res.status(400).json({ message: "Checklist must be an array" });
        return;
      }
    } catch {
      res.status(400).json({ message: "Invalid checklist format" });
      return;
    }

    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;

    const returnRequest = await prisma.assetTransferHistory.findUnique({
      where: { id: returnTransferId },
      include: {
        asset: {
          select: {
            id: true,
            assetCategoryId: true
          }
        },
        parentTransfer: true,
        requestedBy: true,
        approvedBy: true
      }
    });

    if (!returnRequest) {
      res.status(404).json({ message: "Return request not found" });
      return;
    }

    if (returnRequest.transferType !== "RETURN") {
      res.status(400).json({ message: "Only return request rows can be completed here" });
      return;
    }

    if (returnRequest.status !== "APPROVED") {
      res.status(400).json({ message: "Return request must be approved first" });
      return;
    }

    if (!returnRequest.parentTransferId || !returnRequest.parentTransfer) {
      res.status(400).json({ message: "Parent transfer not found" });
      return;
    }

    if (!returnRequest.toBranchId) {
      res.status(400).json({ message: "Return destination branch missing" });
      return;
    }

    // requester completes the physical return after approval
    if (returnRequest.requestedById !== employeeId) {
      res.status(403).json({
        message: "Only the requester can complete the return checklist"
      });
      return;
    }

    const templateWhere: any = {
      isActive: true,
      purpose: AcknowledgementPurpose.TRANSFER_RETURN,
      OR: [{ assetId: returnRequest.assetId }]
    };

    if (returnRequest.asset.assetCategoryId) {
      templateWhere.OR.push({
        assetCategoryId: returnRequest.asset.assetCategoryId
      });
    }

    const template = await prisma.assetAcknowledgementTemplate.findFirst({
      where: templateWhere,
      include: {
        items: {
          orderBy: { sortOrder: "asc" }
        }
      },
      orderBy: [{ assetId: "desc" }, { id: "desc" }]
    });

    if (template) {
      const validItemIds = new Set(template.items.map((item) => item.id));

      const invalidItems = checklist.filter(
        (row: any) => !validItemIds.has(Number(row.itemId))
      );

      if (invalidItems.length > 0) {
        res.status(400).json({ message: "Checklist contains invalid items" });
        return;
      }

      const submittedMap = new Map<number, { checked: boolean; remarks?: string }>();

      for (const row of checklist) {
        submittedMap.set(Number(row.itemId), {
          checked: !!row.checked,
          remarks: row.remarks ?? null
        });
      }

      const missingRequired = template.items.filter(
        (item) => item.isRequired && !submittedMap.get(item.id)?.checked
      );

      if (missingRequired.length > 0) {
        res.status(400).json({
          message: "Please complete all required return checklist items",
          missingItems: missingRequired.map((x) => ({
            itemId: x.id,
            title: x.title
          }))
        });
        return;
      }
    }

    let photoUrl: string | null = null;

    if (req.file?.path) {
      const original =
        req.file.originalname || `transfer-return-${returnTransferId}-${Date.now()}.jpg`;
      const remotePath = `/public_html/smartassets/return_photos/${Date.now()}-${original}`;
      photoUrl = await uploadToFTP(req.file.path, remotePath);
      fs.unlinkSync(req.file.path);
    }

    const currentLocation = await prisma.assetLocation.findFirst({
      where: { assetId: returnRequest.assetId, isActive: true }
    });

    const completedReturn = await prisma.assetTransferHistory.update({
      where: { id: returnTransferId },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        transferDate: new Date(),
        reason: returnNote || returnRequest.reason || "Asset returned with checklist"
      },
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
        approvedBy: true,
        parentTransfer: true
      }
    });

    const updatedOriginalTransfer = await prisma.assetTransferHistory.update({
      where: { id: returnRequest.parentTransferId },
      data: {
        status: "RETURNED",
        returnedAt: new Date()
      }
    });

    await prisma.assetLocation.updateMany({
      where: { assetId: returnRequest.assetId, isActive: true },
      data: { isActive: false }
    });

    const newLocation = await prisma.assetLocation.create({
      data: {
        assetId: returnRequest.assetId,
        branchId: returnRequest.toBranchId,
        isActive: true
      }
    });

    let acknowledgementRun = null;

    if (template) {
      acknowledgementRun = await prisma.assetAcknowledgementRun.create({
        data: {
          transferHistoryId: returnRequest.id,
          assetId: returnRequest.assetId,
          templateId: template.id,
          assignedToId: employeeId,
          acknowledgedAt: new Date(),
          acknowledgedBy: req.user.employeeID ?? String(employeeId),
          remarks: returnNote ?? null,
          digitalSignature: digitalSignature ?? null,
          photoProof: photoUrl ?? null,
          rows: {
            create: checklist.map((row: any) => ({
              itemId: Number(row.itemId),
              checked: !!row.checked,
              remarks: row.remarks ?? null
            }))
          }
        }
      });
    }

    logAction({ entityType: "TRANSFER", entityId: returnTransferId, action: "STATUS_CHANGE", description: `Transfer return #${returnTransferId} completed for asset #${returnRequest.assetId}`, performedById: req.user?.employeeDbId });

    res.json({
      message: "Asset return completed with checklist",
      completedReturn,
      updatedOriginalTransfer,
      newLocation,
      acknowledgementRun,
      previousLocation: currentLocation
    });
  } catch (err: any) {
    console.error("Complete transfer return error:", err);
    res.status(500).json({
      message: "Failed to complete asset return",
      error: err.message
    });
  }
};

const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) {
    fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}
async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
    const client = new Client();
    client.ftp.verbose = true;

    try {
        await client.access(FTP_CONFIG);

        console.log("Connected to FTP server for asset image upload");

        const remoteDir = path.dirname(remoteFilePath);
        await client.ensureDir(remoteDir);

        await client.uploadFrom(localFilePath, remoteFilePath);
        console.log(`Uploaded asset image to: ${remoteFilePath}`);

        await client.close();

        const fileName = path.basename(remoteFilePath);
        return `https://smartassets.inventionminds.com/assets_images/${fileName}`;
    } catch (error) {
        console.error("FTP upload error:", error);
        throw new Error("FTP upload failed");
    }
}

export const getTransferredAssetReturnChecklist = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const returnTransferId = Number(req.params.id);

    const returnRequest = await prisma.assetTransferHistory.findUnique({
      where: { id: returnTransferId },
      include: {
        asset: {
          select: {
            id: true,
            assetCategoryId: true,
            assetName: true,
            referenceCode: true
          }
        },
        parentTransfer: {
          include: {
            fromBranch: true,
            toBranch: true
          }
        },
        fromBranch: true,
        toBranch: true
      }
    });

    if (!returnRequest) {
      res.status(404).json({ message: "Return request not found" });
      return;
    }

    if (returnRequest.transferType !== "RETURN") {
      res.status(400).json({ message: "This row is not a return request" });
      return;
    }

    const templateWhere: any = {
      isActive: true,
      purpose: AcknowledgementPurpose.TRANSFER_RETURN,
      OR: [{ assetId: returnRequest.assetId }]
    };

    if (returnRequest.asset.assetCategoryId) {
      templateWhere.OR.push({
        assetCategoryId: returnRequest.asset.assetCategoryId
      });
    }

    const template = await prisma.assetAcknowledgementTemplate.findFirst({
      where: templateWhere,
      include: {
        items: {
          orderBy: { sortOrder: "asc" }
        }
      },
      orderBy: [{ assetId: "desc" }, { id: "desc" }]
    });

    res.json({
      transferId: returnRequest.id,
      assetId: returnRequest.assetId,
      asset: returnRequest.asset,
      status: returnRequest.status,
      template: template ?? null,
      items: template?.items ?? [],
      fromBranch: returnRequest.fromBranch,
      toBranch: returnRequest.toBranch,
      parentTransfer: returnRequest.parentTransfer
    });
  } catch (err: any) {
    console.error("Get transfer return checklist error:", err);
    res.status(500).json({
      message: "Failed to fetch transfer return checklist",
      error: err.message
    });
  }
};

// POST /api/transfers/assets/transfer/:id/management-approve
// Management approves or rejects a permanent transfer before HOD approval
export const getPendingMgmtApprovals = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const rows = await prisma.assetTransferHistory.findMany({
      where: { managementApprovalStatus: "PENDING" } as any,
      include: {
        asset: true,
        fromBranch: true,
        toBranch: true,
        requestedBy: true,
      },
      orderBy: { requestedAt: "desc" },
    });
    res.json(rows);
  } catch (err) {
    console.error("getPendingMgmtApprovals error:", err);
    res.status(500).json({ message: "Failed to fetch pending management approvals" });
  }
};

export const managementApproveTransfer = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transferId = Number(req.params.id);
    const { decision, remarks } = req.body; // APPROVED | REJECTED

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
      return;
    }

    const transfer = await prisma.assetTransferHistory.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      res.status(404).json({ message: "Transfer not found" });
      return;
    }
    if ((transfer as any).managementApprovalStatus !== "PENDING") {
      res.status(400).json({ message: "Management approval not pending for this transfer" });
      return;
    }

    const updated = await prisma.assetTransferHistory.update({
      where: { id: transferId },
      data: {
        managementApprovalStatus: decision,
        managementApprovedById: req.user?.employeeDbId ?? null,
        managementApprovedAt: new Date(),
        managementRemarks: remarks ?? null,
        // If rejected, close the transfer
        status: decision === "REJECTED" ? "REJECTED" : "REQUESTED",
      } as any,
    });

    res.json({ message: `Transfer ${decision.toLowerCase()} by management`, transfer: updated });
  } catch (err: any) {
    console.error("managementApproveTransfer error:", err);
    res.status(500).json({ message: "Failed to process management approval" });
  }
};
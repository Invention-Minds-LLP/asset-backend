// backend/controllers/assetAssignments.controller.ts
import { Response } from "express";
import prisma from "../../prismaClient";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { saveAndGetUrl } from "../../lib/fileStorage";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { AssignmentAction, AssignmentStage, AssignmentStatus, AcknowledgementPurpose } from "@prisma/client";
import { generateAssetId } from "../../utilis/assetIdGenerator";
import { generateTransferNumber } from "../store-transfer/store-transfer.controller";




// -----------------------------
// Helpers
// -----------------------------
async function createNotificationToEmployees(params: {
    type: string;
    title: string;
    message: string;
    assetId?: number;
    createdByEmployeeId?: number | null;
    recipientEmployeeIds: number[];
    dedupeKey?: string;
}) {
    return prisma.notification.create({
        data: {
            type: params.type,
            title: params.title,
            message: params.message,
            assetId: params.assetId ?? null,
            createdById: params.createdByEmployeeId ?? null,
            dedupeKey: params.dedupeKey ?? null,
            recipients: {
                createMany: {
                    data: params.recipientEmployeeIds.map((eid) => ({
                        employeeId: eid,
                        isRead: false,
                    })),
                },
            },
        },
        include: { recipients: true },
    });
}

async function getDepartmentHodEmployeeId(departmentId: number) {
    const hod = await prisma.employee.findFirst({
        where: { departmentId, role: "HOD" },
        select: { id: true },
    });
    if (!hod) throw new Error(`No HOD found for departmentId=${departmentId}. Assign Employee.role=HOD.`);
    return hod.id;
}

async function deactivateOtherActiveAssignments(assetId: number) {
    await prisma.assetAssignment.updateMany({
        where: { assetId, isActive: true },
        data: { isActive: false },
    });
}

async function createAssignment(params: {
    assetId: number;
    stage: AssignmentStage;
    assignedToId: number;
    assignedById?: number | null;
    note?: string;
    conditionAtHandover?: string | null;
}) {
    return prisma.assetAssignment.create({
        data: {
            assetId: params.assetId,
            stage: params.stage,
            assignedToId: params.assignedToId,
            assignedById: params.assignedById ?? null,
            status: AssignmentStatus.PENDING,
            isActive: true,
            conditionAtHandover: params.conditionAtHandover ?? null,
            assetAssignmentHistories: {
                create: {
                    action: AssignmentAction.CREATED,
                    performedById: params.assignedById ?? null,
                    notes: params.note ?? null,
                },
            },
        },
    });
}

async function getLatestActiveAssignment(assetId: number) {
    return prisma.assetAssignment.findFirst({
        where: { assetId, isActive: true },
        orderBy: { assignedAt: "desc" },
    });
}

function stageToPendingRole(stage: AssignmentStage) {
    if (stage === AssignmentStage.HOD_SOURCE) return "HOD_SOURCE";
    if (stage === AssignmentStage.SUPERVISOR) return "SUPERVISOR";
    if (stage === AssignmentStage.HOD_TARGET) return "HOD_TARGET";
    if (stage === AssignmentStage.END_USER) return "END_USER";
    return null;
}

// -----------------------------
// 1) INIT: Source Department -> HOD ack
// POST /assets/:assetId/initiate-hod-ack
// -----------------------------
export const initiateDepartmentAcknowledgement = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);
        const { departmentId, conditionAtHandover } = req.body as {
            departmentId: number;
            conditionAtHandover?: string;
        };

        if (!assetId || !departmentId) {
            res.status(400).json({ message: "assetId and departmentId are required" });
            return;
        }

        // set initial (source) department
        const updatedAsset = await prisma.asset.update({
            where: { id: assetId },
            data: { departmentId: Number(departmentId) },
            select: { assetId: true, assetName: true },
        });

        const hodId = await getDepartmentHodEmployeeId(Number(departmentId));

        await deactivateOtherActiveAssignments(assetId);

        const assignment = await createAssignment({
            assetId,
            stage: AssignmentStage.HOD_SOURCE,
            assignedToId: hodId,
            assignedById: req.user?.employeeDbId ?? null,
            conditionAtHandover: conditionAtHandover?.trim() ?? null,
            note: "Asset assigned to Source Department HOD for acknowledgement",
        });

        await createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset requires acknowledgement (Source HOD)",
            message: `Asset ${updatedAsset.assetId} — ${updatedAsset.assetName} has been assigned to your department. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user?.employeeDbId ?? null,
            recipientEmployeeIds: [hodId],
            dedupeKey: `asset:${assetId}:hod_source_ack_${Date.now()}`,
        });

        res.json({ message: "Source HOD acknowledgement initiated", assignmentId: assignment.id });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to initiate HOD acknowledgement", error: e.message });
        return;
    }
};

// -----------------------------
// 2) My pending acknowledgements
// GET /assignments/my/pending
// -----------------------------
export const getMyPendingAcknowledgements = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;

        const assignments = await prisma.assetAssignment.findMany({
            where: {
                assignedToId: employeeId,
                isActive: true,
                status: AssignmentStatus.PENDING,
            },
            orderBy: { assignedAt: "desc" },
            select: {
                id: true,
                status: true,
                stage: true,
                assignedAt: true,

                // ✅ Send ONLY what UI needs
                assignedBy: { select: { id: true, name: true, employeeID: true } },
                assignedTo: { select: { id: true, name: true, employeeID: true } },

                asset: {
                    select: {
                        id: true,
                        assetId: true,
                        assetName: true,
                        status: true,
                        department: { select: { id: true, name: true } }, // if you show dept anywhere
                    },
                },
            },
        });

        res.json(assignments);
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to fetch pending acknowledgements", error: e.message });
    }
};
// -----------------------------
// 3) ACKNOWLEDGE
// POST /assignments/:assignmentId/acknowledge
// -----------------------------
// export const acknowledgeAssignment = async (req: AuthenticatedRequest, res: Response) => {
//     try {
//         const assignmentId = Number(req.params.assignmentId);

//         const acknowledgementNote = req.body.acknowledgementNote;
//         const digitalSignature = req.body.digitalSignature; // base64
//         const photo = req.file?.path; // uploaded file path

//         console.log(req.user)
//         if (!req.user) {
//             res.status(401).json({ message: "Unauthorized" });
//             return;
//         }

//         const employeeId = req.user.employeeDbId;

//         const assignment = await prisma.assetAssignment.findUnique({
//             where: { id: assignmentId },
//             include: { asset: true },
//         });

//         if (!assignment) {
//             res.status(404).json({ message: "Assignment not found" });
//             return;
//         }

//         if (assignment.assignedToId !== employeeId) {
//             res.status(403).json({ message: "Not allowed" });
//             return;
//         }

//         if (assignment.status !== "PENDING") {
//             res.status(400).json({ message: "Not pending" });
//             return;
//         }

//         let photoUrl: string | null = null;
//         if (req.file?.path) {
//             const original = req.file.originalname || `ack-${assignmentId}-${Date.now()}.jpg`;
//             const remotePath = `assignment_photos/${Date.now()}-${original}`;

//             photoUrl = await uploadToFTP(req.file.path, remotePath);

//             // remove local temp file
//             fs.unlinkSync(req.file.path);
//         }


//         const updated = await prisma.assetAssignment.update({
//             where: { id: assignmentId },
//             data: {
//                 status: "ACKNOWLEDGED",
//                 acknowledgedAt: new Date(),
//                 acknowledgementNote: acknowledgementNote ?? null,
//                 digitalSignature: digitalSignature ?? null,
//                 photoProof: photoUrl ?? null,
//             },
//         });

//         res.json({ message: "Acknowledged", assignment: updated });

//     } catch (e: any) {
//         res.status(500).json({ message: "Failed", error: e.message });
//     }
// };
export const acknowledgeAssignment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    const acknowledgementNote = req.body.acknowledgementNote;
    const digitalSignature = req.body.digitalSignature;
    // Sub-store the HOD parks the asset into when acknowledging (Main Store → Sub Store)
    const storeId = req.body.storeId;

    const checklist = req.body.checklist ? JSON.parse(req.body.checklist) : [];

    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const employeeId = req.user.employeeDbId;

    const assignment = await prisma.assetAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        asset: {
          select: {
            id: true,
            assetCategoryId: true,
          },
        },
      },
    });

    if (!assignment) {
      res.status(404).json({ message: "Assignment not found" });
      return;
    }

    if (assignment.assignedToId !== employeeId) {
      res.status(403).json({ message: "Not allowed" });
      return;
    }

    if (assignment.status !== AssignmentStatus.PENDING) {
      res.status(400).json({ message: "Assignment is not pending" });
      return;
    }

    const template = await prisma.assetAcknowledgementTemplate.findFirst({
      where: {
        isActive: true,
        purpose: AcknowledgementPurpose.ASSIGNMENT,
        OR: [
          { assetId: assignment.assetId },
          { assetCategoryId: assignment.asset.assetCategoryId ?? undefined },
        ],
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ assetId: "desc" }, { id: "desc" }],
    });

    // validate required checklist items
    if (template) {
      const submittedMap = new Map<number, { checked: boolean; remarks?: string }>();

      for (const row of checklist) {
        submittedMap.set(Number(row.itemId), {
          checked: !!row.checked,
          remarks: row.remarks ?? null,
        });
      }

      const missingRequired = template.items.filter(
        (item) => item.isRequired && !submittedMap.get(item.id)?.checked
      );

      if (missingRequired.length > 0) {
        res.status(400).json({
          message: "Please complete all required checklist items before acknowledging",
          missingItems: missingRequired.map((x) => ({
            itemId: x.id,
            title: x.title,
          })),
        });
        return;
      }
    }

    let photoUrl: string | null = null;

    if (req.file?.path) {
      const original = req.file.originalname || `ack-${assignmentId}-${Date.now()}.jpg`;
      const remotePath = `assignment_photos/${Date.now()}-${original}`;
      // saveLocal() unlinks the staged file once it is stored — deleting it
      // again here threw ENOENT after every successful upload.
      photoUrl = await uploadToFTP(req.file.path, remotePath);
    }

    // 1. update assignment
    const updatedAssignment = await prisma.assetAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgementNote: acknowledgementNote ?? null,
        digitalSignature: digitalSignature ?? null,
        photoProof: photoUrl ?? null,
        stage: assignment.stage,
        assetAssignmentHistories: {
          create: {
            action: AssignmentAction.ACKNOWLEDGED,
            performedById: employeeId,
            notes: acknowledgementNote ?? "Acknowledged with checklist",
          },
        },
      },
    });

    // 2. create checklist run
    let acknowledgementRun = null;

    if (template) {
      acknowledgementRun = await prisma.assetAcknowledgementRun.create({
        data: {
          assignmentId: updatedAssignment.id,
          assetId: assignment.assetId,
          templateId: template.id,
          assignedToId: employeeId,
          acknowledgedAt: new Date(),
          acknowledgedBy: req.user.employeeID ?? String(employeeId),
          remarks: acknowledgementNote ?? null,
          digitalSignature: digitalSignature ?? null,
          photoProof: photoUrl ?? null,
          rows: {
            create: checklist.map((row: any) => ({
              itemId: Number(row.itemId),
              checked: !!row.checked,
              remarks: row.remarks ?? null,
            })),
          },
        },
      });
    }

    // 3. If this is the HOD of the asset's department acknowledging, issue the real Asset ID
    let issuedAssetId: string | null = null;

    const currentAsset = await prisma.asset.findUnique({
      where: { id: assignment.assetId },
      select: { assetId: true, departmentId: true, modeOfProcurement: true, assetCategoryId: true, currentStoreId: true },
    });

    if (currentAsset?.assetId.startsWith("TEMP-") && currentAsset.departmentId) {
      const acknowledger = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { role: true, departmentId: true },
      });

      if (acknowledger?.role === "HOD" && acknowledger.departmentId === currentAsset.departmentId) {
        issuedAssetId = await generateAssetId((currentAsset as any).modeOfProcurement || "PURCHASE", undefined, { categoryId: (currentAsset as any).assetCategoryId });

        await prisma.asset.update({
          where: { id: assignment.assetId },
          data: {
            assetId: issuedAssetId,
            // Park into the HOD's chosen sub-store at the same time as ID issuance.
            ...(storeId ? { currentStoreId: Number(storeId), currentStoreSince: new Date() } : {}),
          } as any,
        });

        // Auto-log the Main Store → Sub Store move as a received StoreTransfer,
        // so the move has a transfer number and shows up in the Transfers tab.
        // Best-effort: a logging failure must not fail the acknowledgement itself.
        const fromStoreId = currentAsset.currentStoreId;
        const toStoreId = storeId ? Number(storeId) : null;
        if (toStoreId && fromStoreId && fromStoreId !== toStoreId) {
          try {
            const transferNumber = await generateTransferNumber();
            await prisma.storeTransfer.create({
              data: {
                transferNumber,
                fromStoreId,
                toStoreId,
                transferType: "STORE_TO_STORE",
                status: "RECEIVED",
                requestedById: employeeId,
                approvedById: employeeId,
                receivedById: employeeId,
                requestedAt: new Date(),
                approvedAt: new Date(),
                receivedAt: new Date(),
                remarks: `Auto-logged on HOD acknowledgement of asset ${issuedAssetId}`,
                items: {
                  create: [
                    {
                      itemType: "ASSET",
                      assetId: assignment.assetId,
                      quantity: 1,
                      receivedQty: 1,
                    },
                  ],
                },
              },
            });
          } catch (txErr: any) {
            console.error("Auto-log StoreTransfer on acknowledge failed:", txErr?.message);
          }
        }
      }
    }

    // End-user acknowledgement puts the asset into service → ACTIVE.
    // (HOD / supervisor / target-HOD stages leave it IN_STORE.)
    let closedIndents: any[] = [];
    if (assignment.stage === AssignmentStage.END_USER) {
      const a = await prisma.asset.findUnique({
        where: { id: assignment.assetId },
        select: { installedAt: true },
      });
      const installedAt = a?.installedAt ?? new Date();

      await prisma.asset.update({
        where: { id: assignment.assetId },
        data: {
          status: "ACTIVE",
          // Stamp the in-service date if it wasn't already set.
          ...(a?.installedAt ? {} : { installedAt }),
        },
      });

      // Closing the indent behind the asset, and stamping the in-service date
      // onto its commissioning sign-off, both belong here — but both need
      // procurement schema (AssetIndent.closedAt, CommissioningSignoff) that is
      // not deployed yet. They were non-blocking bookkeeping either way, so
      // they are left out until the schema ships rather than breaking the build.
      // `closedIndents` stays empty, keeping the response shape unchanged.
    }

    res.json({
      message: "Acknowledged with checklist",
      assignment: updatedAssignment,
      acknowledgementRun,
      ...(issuedAssetId ? { issuedAssetId } : {}),
      ...(closedIndents.length ? { closedIndents } : {}),
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({
      message: "Failed to acknowledge",
      error: e.message,
    });
  }
};

// -----------------------------
// 4) REJECT
// POST /assignments/:assignmentId/reject
// -----------------------------
export const rejectAssignment = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assignmentId = Number(req.params.assignmentId);
        const { rejectionReason } = req.body as { rejectionReason?: string };
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        const employeeId = req.user.employeeDbId;

        const assignment = await prisma.assetAssignment.findUnique({ where: { id: assignmentId } });

        if (!assignment) {
            res.status(404).json({ message: "Assignment not found" });
            return;
        }
        if (assignment.assignedToId !== employeeId) {
            res.status(403).json({ message: "Not allowed to reject this assignment" });
            return;
        }
        if (assignment.status !== AssignmentStatus.PENDING || !assignment.isActive) {
            res.status(400).json({ message: "Assignment is not pending/active" });
            return;
        }

        const updated = await prisma.assetAssignment.update({
            where: { id: assignmentId },
            data: {
                status: AssignmentStatus.REJECTED,
                rejectedAt: new Date(),
                rejectionReason: rejectionReason ?? "Rejected",
                isActive: false,
                assetAssignmentHistories: {
                    create: {
                        action: AssignmentAction.REJECTED,
                        performedById: employeeId,
                        notes: rejectionReason ?? "Rejected",
                    },
                },
            },
        });

        res.json({ message: "Rejected", assignment: updated });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to reject", error: e.message });
        return;
    }
};

// -----------------------------
// 5) Source HOD assigns Source Supervisor (Supervisor ack)
// POST /assets/:assetId/assign/supervisor
// Requires active = HOD_SOURCE ACKNOWLEDGED
// -----------------------------
export const hodAssignSupervisor = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);
        const { supervisorId, conditionAtHandover } = req.body as {
            supervisorId: number;
            conditionAtHandover?: string;
        };

        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        if (!assetId || !supervisorId) {
            res.status(400).json({ message: "assetId and supervisorId required" });
            return
        }

        const latest = await getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found. Initiate flow first." });
            return;
        }
        if (latest.stage !== AssignmentStage.HOD_SOURCE) {
            res.status(400).json({ message: "Current stage is not Source HOD stage." });
            return;
        }
        if (latest.status !== AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Source HOD has not acknowledged yet." });
            return;
        }

        const updatedAsset = await prisma.asset.update({
            where: { id: assetId },
            data: { supervisorId: Number(supervisorId) },
            select: { assetId: true, assetName: true },
        });

        await deactivateOtherActiveAssignments(assetId);

        const assignment = await createAssignment({
            assetId,
            stage: AssignmentStage.SUPERVISOR,
            assignedToId: Number(supervisorId),
            assignedById: req.user.employeeDbId,
            conditionAtHandover: conditionAtHandover?.trim() ?? null,
            note: "Assigned to Source Supervisor for acknowledgement",
        });

        await createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset assigned to you (Supervisor acknowledgement)",
            message: `Asset ${updatedAsset.assetId} — ${updatedAsset.assetName} has been assigned to you. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [Number(supervisorId)],
            dedupeKey: `asset:${assetId}:supervisor_ack`,
        });

        res.json({ message: "Supervisor assignment created", assignmentId: assignment.id });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign supervisor", error: e.message });
        return;
    }
};

// -----------------------------
// 6) Source Supervisor assigns Target Department (Target HOD ack)
// POST /assets/:assetId/assign/target-department
// Body: { targetDepartmentId, conditionAtHandover? }
// Requires active = SUPERVISOR ACKNOWLEDGED
// -----------------------------
export const supervisorAssignTargetDepartment = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);
        const { targetDepartmentId, conditionAtHandover } = req.body as {
            targetDepartmentId: number;
            conditionAtHandover?: string;
        };

        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        if (!assetId || !targetDepartmentId) {
            res.status(400).json({ message: "assetId and targetDepartmentId required" });
            return;
        }

        const latest = await getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found." });
            return;
        }
        if (latest.stage !== AssignmentStage.SUPERVISOR) {
            res.status(400).json({ message: "Current stage is not Supervisor stage." });
            return;
        }
        if (latest.status !== AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Supervisor has not acknowledged yet." });
            return;
        }

        const targetHodId = await getDepartmentHodEmployeeId(Number(targetDepartmentId));

        // Move asset ownership to target department (this is the “handover”)
        // Also clear supervisorId/allottedToId because new dept will decide
        const updatedAsset = await prisma.asset.update({
            where: { id: assetId },
            data: {
                targetDepartmentId: targetDepartmentId
            },
            select: { assetId: true, assetName: true },
        });

        await deactivateOtherActiveAssignments(assetId);

        const assignment = await createAssignment({
            assetId,
            stage: AssignmentStage.HOD_TARGET,
            assignedToId: targetHodId,
            assignedById: req.user.employeeDbId,
            conditionAtHandover: conditionAtHandover?.trim() ?? null,
            note: "Assigned to Target Department HOD for acknowledgement",
        });

        await createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset requires acknowledgement (Target HOD)",
            message: `Asset ${updatedAsset.assetId} — ${updatedAsset.assetName} is being transferred to your department. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [targetHodId],
            dedupeKey: `asset:${assetId}:hod_target_ack`,
        });

        res.json({ message: "Target HOD acknowledgement created", assignmentId: assignment.id });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign target department", error: e.message });
        return;
    }
};

// -----------------------------
// 7) Target HOD assigns Target End User (End-user ack) OR close if no end user
// POST /assets/:assetId/assign/target-end-user
// Body: { allottedToId?: number, skipEndUser?: boolean, conditionAtHandover?: string }
// Requires active = HOD_TARGET ACKNOWLEDGED
// -----------------------------
export const targetHodAssignEndUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);
        const { allottedToId, skipEndUser, conditionAtHandover } = req.body as {
            allottedToId?: number;
            skipEndUser?: boolean;
            conditionAtHandover?: string;
        };

        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        if (!assetId) {
            res.status(400).json({ message: "assetId required" });
            return
        }

        const latest = await getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found." });
            return;
        }
        if (latest.stage !== AssignmentStage.HOD_TARGET) {
            res.status(400).json({ message: "Current stage is not Target HOD stage." });
            return;
        }
        if (latest.status !== AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Target HOD has not acknowledged yet." });
            return;

        }

        // End user not available -> close flow
        if (skipEndUser || !allottedToId) {
            await prisma.asset.update({
                where: { id: assetId },
                data: { allottedToId: null },
            });
            await deactivateOtherActiveAssignments(assetId);
            res.json({ message: "Flow closed (Target End User not assigned).", closed: true });
            return;
        }

        const updatedAsset = await prisma.asset.update({
            where: { id: assetId },
            data: { allottedToId: Number(allottedToId) },
            select: { assetId: true, assetName: true },
        });

        await deactivateOtherActiveAssignments(assetId);

        const assignment = await createAssignment({
            assetId,
            stage: AssignmentStage.END_USER,
            assignedToId: Number(allottedToId),
            assignedById: req.user.employeeDbId,
            conditionAtHandover: conditionAtHandover?.trim() ?? null,
            note: "Assigned to Target End User for acknowledgement",
        });

        await createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset allocated to you (End User acknowledgement)",
            message: `Asset ${updatedAsset.assetId} — ${updatedAsset.assetName} has been allocated to you. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [Number(allottedToId)],
            dedupeKey: `asset:${assetId}:enduser_ack`,
        });

        res.json({ message: "End user assignment created", assignmentId: assignment.id });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign target end user", error: e.message });
        return;
    }
};

// -----------------------------
// 8) (Optional) If NO target department flow: Supervisor assigns End User directly OR close
// POST /assets/:assetId/assign/end-user
// Requires active = SUPERVISOR ACKNOWLEDGED
// -----------------------------
export const supervisorAssignEndUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);
        const { allottedToId, skipEndUser, conditionAtHandover } = req.body as {
            allottedToId?: number;
            skipEndUser?: boolean;
            conditionAtHandover?: string;
        };

        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        if (!assetId) {
            res.status(400).json({ message: "assetId required" });
            return;
        }

        const latest = await getLatestActiveAssignment(assetId);
        if (!latest) {
            res.status(400).json({ message: "No active assignment found." });
            return;
        }
        if (latest.stage !== AssignmentStage.SUPERVISOR) {
            res.status(400).json({ message: "Current stage is not Supervisor stage." });
            return;
        }
        if (latest.status !== AssignmentStatus.ACKNOWLEDGED) {
            res.status(400).json({ message: "Supervisor has not acknowledged yet." });
            return;
        }

        if (skipEndUser || !allottedToId) {
            await prisma.asset.update({ where: { id: assetId }, data: { allottedToId: null } });
            await deactivateOtherActiveAssignments(assetId);
            res.json({ message: "Flow closed (End User not assigned).", closed: true });
            return;
        }

        const updatedAsset = await prisma.asset.update({
            where: { id: assetId },
            data: { allottedToId: Number(allottedToId) },
            select: { assetId: true, assetName: true },
        });

        await deactivateOtherActiveAssignments(assetId);

        const assignment = await createAssignment({
            assetId,
            stage: AssignmentStage.END_USER,
            assignedToId: Number(allottedToId),
            assignedById: req.user.employeeDbId,
            conditionAtHandover: conditionAtHandover?.trim() ?? null,
            note: "Assigned to End User for acknowledgement",
        });

        await createNotificationToEmployees({
            type: "ASSET_ASSIGNMENT",
            title: "Asset allocated to you (End User acknowledgement)",
            message: `Asset ${updatedAsset.assetId} — ${updatedAsset.assetName} has been allocated to you. Please acknowledge.`,
            assetId,
            createdByEmployeeId: req.user.employeeDbId,
            recipientEmployeeIds: [Number(allottedToId)],
            dedupeKey: `asset:${assetId}:enduser_ack`,
        });

        res.json({ message: "End user assignment created", assignmentId: assignment.id });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to assign end user", error: e.message });
        return;
    }
};

// -----------------------------
// 9) History
// GET /assets/:assetId/assignments/history
// -----------------------------
export const getAssetAssignmentHistory = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);

        const history = await prisma.assetAssignment.findMany({
            where: { assetId },
            include: {
                assignedTo: true,
                assignedBy: true,
                assetAssignmentHistories: {
                    include: { performedBy: true },
                    orderBy: { createdAt: "asc" },
                },
            },
            orderBy: { assignedAt: "asc" },
        });

        res.json(history);
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to fetch assignment history", error: e.message });
        return;
    }
};

// -----------------------------
// 10) State for UI
// GET /assets/:assetId/assignments/state
// Returns:
// { sourceHodStatus, supervisorStatus, targetHodStatus, endUserStatus, currentPendingRole }
// -----------------------------
export const getAssetAssignmentState = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assetId = Number(req.params.assetId);

        const assignments = await prisma.assetAssignment.findMany({
            where: { assetId },
            orderBy: { assignedAt: "asc" },
            select: { stage: true, status: true, isActive: true, assignedAt: true },
        });

        const latestByStage = (stage: AssignmentStage) => {
            const list = assignments.filter((a) => a.stage === stage);
            return list.length ? list[list.length - 1] : null;
        };

        const sourceHod = latestByStage(AssignmentStage.HOD_SOURCE);
        const supervisor = latestByStage(AssignmentStage.SUPERVISOR);
        const targetHod = latestByStage(AssignmentStage.HOD_TARGET);
        const endUser = latestByStage(AssignmentStage.END_USER);

        const activePending = assignments.find((a) => a.isActive && a.status === AssignmentStatus.PENDING);

        res.json({
            sourceHodStatus: sourceHod?.status ?? "NONE",
            supervisorStatus: supervisor?.status ?? "NONE",
            targetHodStatus: targetHod?.status ?? "NONE",
            endUserStatus: endUser?.status ?? "NONE",
            currentPendingRole: activePending ? stageToPendingRole(activePending.stage) : null,
        });
        return;
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ message: "Failed to fetch state", error: e.message });
        return;
    }

};
// -----------------------------
// Direct assignment for imported / already-assigned assets (no HOD→Supervisor→
// End-User chain). Sets the fields immediately, and for each assignee that
// CHANGED, sends that person a standalone acknowledgement request + notification.
// Bulk import stays silent (it never calls this); only deliberate per-asset
// changes via the form do.
// PATCH /assignments/:assetId/direct-assign
// -----------------------------
export const directAssignWithAck = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return; }
        const assetId = Number(req.params.assetId);
        const { departmentId, supervisorId, allottedToId, targetDepartmentId } = req.body;

        const asset = await prisma.asset.findUnique({
            where: { id: assetId },
            select: {
                id: true, assetId: true, assetName: true,
                supervisorId: true, allottedToId: true, departmentId: true, targetDepartmentId: true,
            },
        });
        if (!asset) { res.status(404).json({ message: "Asset not found" }); return; }

        const num = (v: any) => (v !== undefined && v !== null && v !== "" ? Number(v) : undefined);
        const updateData: any = {};
        if (num(departmentId) !== undefined) updateData.departmentId = num(departmentId);
        if (num(supervisorId) !== undefined) updateData.supervisorId = num(supervisorId);
        if (num(allottedToId) !== undefined) updateData.allottedToId = num(allottedToId);
        if (num(targetDepartmentId) !== undefined) updateData.targetDepartmentId = num(targetDepartmentId);

        await prisma.asset.update({ where: { id: assetId }, data: updateData });

        // Keep the multi-supervisor set's primary in sync when the primary changes.
        if (updateData.supervisorId && updateData.supervisorId !== asset.supervisorId) {
            await prisma.assetSupervisor.updateMany({ where: { assetId }, data: { isPrimary: false } });
            await prisma.assetSupervisor.upsert({
                where: { assetId_employeeId: { assetId, employeeId: updateData.supervisorId } },
                update: { isPrimary: true, isActive: true },
                create: { assetId, employeeId: updateData.supervisorId, isPrimary: true, isActive: true, createdById: req.user.employeeDbId },
            });
        }

        const by = req.user.employeeDbId;
        const requested: { role: string; employeeId: number }[] = [];

        // Current assignee for a field: the value being set now, else what's stored.
        const current = (field: "supervisorId" | "allottedToId" | "targetDepartmentId") =>
            updateData[field] !== undefined ? updateData[field] : (asset as any)[field];

        // Request acknowledgement from `employeeId` for `stage` unless they ALREADY
        // have an active pending/acknowledged request for it. This is keyed on the
        // person actually assigned (not on whether the field changed in THIS save),
        // so an assignee set via the plain Save still gets asked, while re-saving
        // doesn't spam a person who already has a request.
        const requestAckIfNeeded = async (stage: AssignmentStage, employeeId: number, title: string, roleLabel: string) => {
            if (!employeeId) return;
            const already = await prisma.assetAssignment.findFirst({
                where: { assetId, stage, assignedToId: employeeId, isActive: true, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACKNOWLEDGED] } },
                select: { id: true },
            });
            if (already) return;
            // Retire any active request at this stage for a DIFFERENT person.
            await prisma.assetAssignment.updateMany({ where: { assetId, stage, isActive: true }, data: { isActive: false } });
            await createAssignment({ assetId, stage, assignedToId: employeeId, assignedById: by, note: `Direct assignment — ${roleLabel} acknowledgement requested` });
            await createNotificationToEmployees({
                type: "ASSET_ASSIGNMENT",
                title,
                message: `Asset ${asset.assetId} — ${asset.assetName} assigned to you. Please acknowledge.`,
                assetId,
                createdByEmployeeId: by,
                recipientEmployeeIds: [employeeId],
                dedupeKey: `asset:${assetId}:${stage}:${employeeId}`,
            });
            requested.push({ role: roleLabel, employeeId });
        };

        await requestAckIfNeeded(AssignmentStage.SUPERVISOR, current("supervisorId"), "Asset assigned to you (Supervisor)", "supervisor");
        await requestAckIfNeeded(AssignmentStage.END_USER, current("allottedToId"), "Asset allotted to you", "end user");
        const targetDept = current("targetDepartmentId");
        if (targetDept) {
            const targetHod = await prisma.employee.findFirst({ where: { departmentId: targetDept, role: "HOD" }, select: { id: true } });
            if (targetHod) {
                await requestAckIfNeeded(AssignmentStage.HOD_TARGET, targetHod.id, "Asset incoming to your department", "target HOD");
            }
        }

        res.json({ message: "Assignment updated", acknowledgementRequested: requested });
    } catch (e: any) {
        console.error("directAssignWithAck error:", e);
        res.status(500).json({ message: e.message || "Failed to update assignment" });
    }
};

const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) {
    fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}
// Stored on the server's disk now (src/lib/fileStorage.ts), served from /uploads.
// The old version returned an assets_images URL regardless of where the file
// actually went, so these photos never loaded; the URL now follows the path.
async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
    return saveAndGetUrl(localFilePath, remoteFilePath);
}

export const resendAcknowledgement = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        const assetId = Number(req.params.assetId);

        const latest = await prisma.assetAssignment.findFirst({
            where: { assetId },
            orderBy: { assignedAt: "desc" },
        });

        if (!latest) {
            res.status(400).json({ message: "No assignment found" });
            return;
        }

        if (latest.status !== AssignmentStatus.REJECTED) {
             res.status(400).json({ message: "Only rejected requests can be resent" });
             return;
        }

        // deactivate any active
        await prisma.assetAssignment.updateMany({
            where: { assetId, isActive: true },
            data: { isActive: false },
        });

        const newReq = await prisma.assetAssignment.create({
            data: {
                assetId,
                stage: latest.stage,
                assignedToId: latest.assignedToId,
                assignedById: req.user.employeeDbId,
                status: AssignmentStatus.PENDING,
                isActive: true,
                conditionAtHandover: latest.conditionAtHandover,
                assetAssignmentHistories: {
                    create: {
                        action: AssignmentAction.CREATED,
                        performedById: req.user.employeeDbId,
                        notes: "Resent after rejection",
                    },
                },
            },
        });

         res.json({ message: "Resent", assignmentId: newReq.id });
         return;
    } catch (e: any) {
         res.status(500).json({ message: "Failed", error: e.message });
         return;
    }
};

export const getAssignmentChecklist = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assignmentId = Number(req.params.assignmentId);

    const assignment = await prisma.assetAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        asset: {
          select: {
            id: true,
            assetCategoryId: true,
          },
        },
      },
    });

    if (!assignment) {
      res.status(404).json({ message: "Assignment not found" });
      return;
    }

    const template =
      await prisma.assetAcknowledgementTemplate.findFirst({
        where: {
          isActive: true,
          purpose: AcknowledgementPurpose.ASSIGNMENT,
          OR: [
            { assetId: assignment.assetId },
            { assetCategoryId: assignment.asset.assetCategoryId ?? undefined },
          ],
        },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: [
          { assetId: "desc" }, // asset-specific first
          { id: "desc" },
        ],
      });

    res.json({
      assignmentId: assignment.id,
      assetId: assignment.assetId,
      template: template ?? null,
      items: template?.items ?? [],
    });
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch checklist", error: e.message });
  }
};
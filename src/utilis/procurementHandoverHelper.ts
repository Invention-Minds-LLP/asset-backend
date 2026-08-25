import prisma from "../prismaClient";
import { AssignmentAction, AssignmentStage, AssignmentStatus } from "@prisma/client";

/**
 * Hands assets created by a goods receipt to the department that asked for
 * them, without waiting for someone to remember.
 *
 * Before this, acceptance created the asset records and left them sitting in
 * store until a store user manually started an assignment — the most common
 * place a delivered asset went quiet.
 */

/** Mirrors the assignment module's own HOD lookup, but never throws. */
async function findDepartmentHodId(departmentId: number): Promise<number | null> {
  const hod = await prisma.employee.findFirst({
    where: { departmentId, role: "HOD" },
    select: { id: true },
  });
  return hod?.id ?? null;
}

/**
 * Open the acknowledgement chain for one asset at its receiving department.
 * Returns the assignment id, or null with a reason when it could not start —
 * a missing HOD must not fail the goods receipt.
 */
export async function startHandover(params: {
  assetId: number;
  departmentId: number;
  assignedById?: number | null;
  note?: string;
}): Promise<{ assignmentId: number } | { skipped: string }> {
  const { assetId, departmentId, assignedById, note } = params;

  const hodId = await findDepartmentHodId(departmentId);
  if (!hodId) return { skipped: `no HOD on department ${departmentId}` };

  // Don't stack a second chain on an asset that already has a live one.
  const live = await prisma.assetAssignment.findFirst({
    where: { assetId, isActive: true },
    select: { id: true },
  });
  if (live) return { skipped: "an assignment is already active on this asset" };

  const [, assignment] = await prisma.$transaction([
    prisma.asset.update({
      where: { id: assetId },
      data: { departmentId },
    }),
    prisma.assetAssignment.create({
      data: {
        assetId,
        stage: AssignmentStage.HOD_SOURCE,
        assignedToId: hodId,
        assignedById: assignedById ?? null,
        status: AssignmentStatus.PENDING,
        isActive: true,
        assetAssignmentHistories: {
          create: {
            action: AssignmentAction.CREATED,
            performedById: assignedById ?? null,
            notes: note ?? "Auto-assigned on goods receipt acceptance",
          },
        },
      },
    }),
  ]);

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { assetId: true, assetName: true },
  });

  await prisma.notification.create({
    data: {
      type: "ASSET_ASSIGNMENT",
      title: "Asset delivered — acknowledgement required",
      message:
        `${asset?.assetId ?? "A new asset"} — ${asset?.assetName ?? ""} has arrived for your department. ` +
        `Please acknowledge receipt to continue the handover.`,
      assetId,
      createdById: assignedById ?? null,
      dedupeKey: `asset:${assetId}:gra_handover`,
      recipients: { create: { employeeId: hodId, isRead: false } },
    },
  }).catch(() => {});

  return { assignmentId: assignment.id };
}

/**
 * Close any indent this asset was delivered against. Called when the end user
 * acknowledges — the request is only genuinely met when the person who raised
 * it has the thing in their hands, not when stores booked it in.
 */
export async function closeIndentsForAsset(assetId: number, closedById?: number | null) {
  const indents = await prisma.assetIndent.findMany({
    where: {
      fulfilledAssetId: assetId,
      status: { in: ["DELIVERED", "PROCUREMENT", "FULFILLED"] },
    },
    select: { id: true, indentNumber: true, raisedById: true },
  });
  if (indents.length === 0) return [];

  await prisma.assetIndent.updateMany({
    where: { id: { in: indents.map((i) => i.id) } },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: closedById ?? null,
    },
  });

  for (const indent of indents) {
    await prisma.notification.create({
      data: {
        type: "OTHER",
        title: `Indent ${indent.indentNumber} Closed`,
        message: "The asset you requested has been received and acknowledged. This indent is now closed.",
        createdById: closedById ?? null,
        dedupeKey: `INDENT_CLOSED_${indent.id}`,
        recipients: { create: { employeeId: indent.raisedById, isRead: false } },
      },
    }).catch(() => {});
  }

  return indents;
}

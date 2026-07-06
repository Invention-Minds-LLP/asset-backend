import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { notify, getDepartmentHODs, getAdminIds, getSecurityTeam } from "../../utilis/notificationHelper";

const dayStr = (d: Date) => d.toISOString().split("T")[0];

// Compose a human-readable label for AssetScanLog.location from the structured
// area. Gate cameras read as "Gate: <cameraId>"; room cameras as the path.
function composeLabel(p: {
  isGate?: boolean;
  cameraId?: string | null;
  block?: string | null;
  floor?: string | null;
  room?: string | null;
}): string {
  if (p.isGate) return `Gate${p.cameraId ? `: ${p.cameraId}` : ""}`;
  const parts = [p.block, p.floor, p.room].filter(Boolean);
  return parts.length ? parts.join(" / ") : p.cameraId || "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/asset-scan/ingest   (machine-to-machine, API-key auth)
//  Called by the CCTV marker reader when it decodes a fiducial marker.
//  Body: { markerId, cameraId?, block?, floor?, room?, isGate?, notes?, scannedAt? }
// ─────────────────────────────────────────────────────────────────────────────
export const ingestScan = async (req: Request, res: Response) => {
  try {
    const { markerId, cameraId, block, floor, room, isGate, notes, scannedAt } = req.body ?? {};

    const markerIdNum = Number(markerId);
    if (!markerId || Number.isNaN(markerIdNum)) {
      res.status(400).json({ message: "markerId (number) is required" });
      return;
    }

    // Resolve the fiducial marker back to an asset. Only assets that were given a
    // marker exist here, so an unknown marker is a genuine 404 (mislabelled tag).
    const asset = await prisma.asset.findFirst({
      where: { markerId: markerIdNum },
      select: { id: true, assetId: true, assetName: true, departmentId: true, locationTracked: true },
    });
    if (!asset) {
      res.status(404).json({ message: `No asset registered for markerId ${markerIdNum}` });
      return;
    }

    const label = composeLabel({ isGate, cameraId, block, floor, room });
    const when = scannedAt ? new Date(scannedAt) : new Date();

    const scan = await prisma.assetScanLog.create({
      data: {
        assetId: asset.id,
        scanType: "MARKER",
        location: label,
        cameraId: cameraId ?? null,
        block: block ?? null,
        floor: floor ?? null,
        room: room ?? null,
        isGate: Boolean(isGate),
        notes: notes ?? null,
        scannedAt: when,
        // scannedById stays null — this is an automated camera scan, not a person.
      },
    });

    // Display-only: reflect the last-seen spot on the asset card. We deliberately
    // do NOT touch AssetLocation — the authoritative location only changes via the
    // location approval workflow.
    await prisma.asset.update({
      where: { id: asset.id },
      data: { currentLocation: label },
    });

    // Gate camera → enforce the gate-pass rule at the moment of exit.
    let unauthorizedExit = false;
    if (isGate) {
      unauthorizedExit = await handleGateExit(asset, when);
    }

    res.status(201).json({ id: scan.id, assetId: asset.assetId, location: label, unauthorizedExit });
  } catch (err) {
    console.error("ingestScan error:", err);
    res.status(500).json({ message: "Failed to record scan" });
  }
};

// When a tracked asset is seen at the gate, it is only allowed out if it has an
// active gate pass (APPROVED = cleared to leave, or ISSUED = already gated out).
// Anything else is an unauthorised exit → alert security + HOD/admin immediately.
async function handleGateExit(
  asset: { id: number; assetId: string; assetName: string; departmentId: number | null },
  when: Date,
): Promise<boolean> {
  const activePass = await prisma.gatePass.findFirst({
    where: {
      approvalStatus: "APPROVED",
      status: { in: ["APPROVED", "ISSUED"] },
      OR: [
        { assetId: asset.id }, // legacy single-asset field
        { items: { some: { assetId: asset.id } } }, // multi-asset junction
      ],
    },
    select: { id: true },
  });

  if (activePass) return false; // authorised — nothing to do

  const recipients = new Set<number>();
  (await getSecurityTeam()).forEach(id => recipients.add(id));
  const hods = await getDepartmentHODs(asset.departmentId);
  (hods.length ? hods : await getAdminIds()).forEach(id => recipients.add(id));
  if (recipients.size === 0) return true;

  await notify({
    type: "UNAUTHORIZED_EXIT",
    title: "Unauthorised Asset Exit",
    message: `${asset.assetName} (${asset.assetId}) was detected leaving at the gate without an approved gate pass.`,
    recipientIds: Array.from(recipients),
    priority: "CRITICAL",
    channel: "BOTH",
    assetId: asset.id,
    // Per-day dedupe so a lingering asset in the gate camera's view doesn't spam.
    dedupeKey: `unauthorized-exit-${asset.id}-${dayStr(when)}`,
    emailSubject: `Unauthorised Asset Exit: ${asset.assetId}`,
    emailHtml: `<p><strong>${asset.assetName}</strong> (${asset.assetId}) was detected at the gate camera without an approved gate pass.</p><p>Detected at: ${when.toLocaleString("en-IN")}</p>`,
  });

  return true;
}

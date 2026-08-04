import { Response } from "express";
import prisma from "../../prismaClient";
import { ExternalAuditorRequest } from "../../middleware/externalAuditorMiddleware";
import { buildAuditMap, computeNextItem } from "../../utilis/auditMap";
import {
  buildChecklist,
  pendingRequiredItems,
  resolveSticker,
  applyStickerToAsset,
  applyLocationNote,
} from "../../utilis/auditChecklist";
import { buildStartOptions, buildRun, RUN_MODES, RunMode } from "../../utilis/auditRunPlan";

// External auditor's scoped view onto audits. Every endpoint must funnel
// through requireAuditAccess() before reading/writing audit data — that's
// the one place to audit for scope leaks.
//
// Scope: an external auditor sees an audit iff their email appears on an
// AssetAuditor row (type=EXTERNAL) for that audit. AssetAuditor stores the
// email as a denormalized snapshot taken at audit-creation time, so a later
// rename in the ExternalAuditor master doesn't widen or narrow access.

// Returns null if the auditor has no access to the audit; otherwise returns
// the audit. Centralized here so every scoped endpoint shares one rule.
async function requireAuditAccess(
  req: ExternalAuditorRequest,
  auditId: number
) {
  if (!Number.isFinite(auditId) || auditId <= 0) return null;
  const email = req.externalAuditor?.email;
  if (!email) return null;

  const audit = await prisma.assetAudit.findFirst({
    where: {
      id: auditId,
      auditors: { some: { type: "EXTERNAL", email } },
    },
  });
  return audit;
}

// GET /api/mobile/external/audits
// Lists audits where this external auditor is assigned.
export const listMyAudits = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const email = req.externalAuditor?.email;
    if (!email) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const audits = await prisma.assetAudit.findMany({
      where: {
        auditors: { some: { type: "EXTERNAL", email } },
      },
      include: { auditors: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ data: audits });
  } catch (error: any) {
    console.error("external listMyAudits error:", error);
    res.status(500).json({ message: "Failed to load audits" });
  }
};

// GET /api/mobile/external/audits/:id
// Returns one audit + its items (asset detail joined) — only if assigned.
export const getMyAuditById = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    const audit = await prisma.assetAudit.findUnique({
      where: { id: auditId },
      include: {
        items: { include: { asset: true } },
        auditors: true,
      },
    });

    res.json({ data: audit });
  } catch (error: any) {
    console.error("external getMyAuditById error:", error);
    res.status(500).json({ message: "Failed to load audit" });
  }
};

// GET /api/external-audit/audits/:id/floor-map — only if assigned.
export const getMyAuditFloorMap = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    const result = await buildAuditMap(auditId);
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
    console.error("external getMyAuditFloorMap error:", error);
    res.status(500).json({ message: "Failed to load floor map" });
  }
};

// GET /api/external-audit/audits/:id/next-item?fromItemId= — only if assigned.
export const getMyAuditNextItem = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    const result = await buildAuditMap(auditId);
    if (!result) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const fromItemId = req.query.fromItemId ? Number(req.query.fromItemId) : null;
    res.json({ data: computeNextItem(result.plan, result.placed, fromItemId) });
  } catch (error: any) {
    console.error("external getMyAuditNextItem error:", error);
    res.status(500).json({ message: "Failed to compute next item" });
  }
};

// PUT /api/mobile/external/audits/:id/start
export const startMyAudit = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    if (access.status !== "PLANNED") {
      res.status(400).json({ message: "Audit must be in PLANNED status to start" });
      return;
    }

    const updated = await prisma.assetAudit.update({
      where: { id: auditId },
      data: { status: "IN_PROGRESS" },
    });

    res.json({ data: updated, message: "Audit started" });
  } catch (error: any) {
    console.error("external startMyAudit error:", error);
    res.status(500).json({ message: "Failed to start audit" });
  }
};

// PUT /api/mobile/external/audit-items/:itemId/verify
// External auditors verify items in audits they're assigned to. Same body /
// status semantics as the internal verifyItem. verifiedById stays null on
// these rows — there's no schema column today for verifiedByExternalAuditorId
// (worth a future schema add for full audit trail).
export const verifyMyAuditItem = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      res.status(400).json({ message: "Invalid item id" });
      return;
    }

    const {
      status,
      locationMatch,
      conditionMatch,
      actualLocation,
      actualCondition,
      remarks,
      stickerStatus,
      scanned,
      locationNote,
    } = req.body || {};

    if (!status || !["VERIFIED", "MISSING", "MISMATCH"].includes(status)) {
      res.status(400).json({ message: "status must be one of VERIFIED, MISSING, or MISMATCH" });
      return;
    }

    const item = await prisma.assetAuditItem.findUnique({
      where: { id: itemId },
      select: { id: true, auditId: true, assetId: true },
    });

    if (!item) {
      res.status(404).json({ message: "Audit item not found" });
      return;
    }

    // Scope-gate: the item's audit must be one this auditor is assigned to.
    const access = await requireAuditAccess(req, item.auditId);
    if (!access) {
      res.status(404).json({ message: "Audit item not found" });
      return;
    }

    // A successful scan proves the sticker is present and readable.
    const sticker = resolveSticker(stickerStatus, scanned);

    const updated = await prisma.assetAuditItem.update({
      where: { id: itemId },
      data: {
        status,
        scannedAt: new Date(),
        locationMatch: locationMatch != null ? locationMatch : null,
        conditionMatch: conditionMatch != null ? conditionMatch : null,
        actualLocation: actualLocation || null,
        actualCondition: actualCondition || null,
        remarks: remarks || null,
        // verifiedById stays null — external auditors aren't Users.
        // verifiedByExternalAuditorId carries the attribution instead.
        verifiedByExternalAuditorId: req.externalAuditor?.id ?? null,
        ...(sticker ? { stickerStatus: sticker, stickerCheckedAt: new Date() } : {}),
      },
    });

    // qrStickeredById stays null — external auditors aren't Employees — but the
    // observation still drives Asset.qrStickered and the audit item keeps the
    // attribution via verifiedByExternalAuditorId.
    await applyStickerToAsset(sticker, item.assetId, item.auditId, null);
    await applyLocationNote(locationNote, item.assetId);

    res.json({ data: updated, message: "Audit item verified" });
  } catch (error: any) {
    console.error("external verifyMyAuditItem error:", error);
    res.status(500).json({ message: "Failed to verify item" });
  }
};

// PUT /api/mobile/external/audits/:id/complete
export const completeMyAudit = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }

    if (access.status !== "IN_PROGRESS") {
      res.status(400).json({ message: "Audit must be in IN_PROGRESS status to complete" });
      return;
    }

    // Same rule as the internal flow: every ACTIVE asset must be accounted for.
    // An external audit is the one that most needs this guarantee, so it is not
    // a softer check here.
    const blockers = await pendingRequiredItems(auditId);
    if (blockers.length) {
      res.status(400).json({
        message:
          `${blockers.length} active asset${blockers.length === 1 ? "" : "s"} still unchecked. ` +
          `Mark each one verified, missing or mismatch before completing the audit.`,
        blockingCount: blockers.length,
        examples: blockers.slice(0, 10).map((b) => ({
          itemId: b.id,
          assetCode: b.asset?.assetId ?? null,
          assetName: b.asset?.assetName ?? null,
        })),
      });
      return;
    }

    const items = await prisma.assetAuditItem.findMany({
      where: { auditId },
    });

    const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
    const missingCount = items.filter((i) => i.status === "MISSING").length;
    const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;

    const updated = await prisma.assetAudit.update({
      where: { id: auditId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        verifiedCount,
        missingCount,
        mismatchCount,
      },
    });

    res.json({ data: updated, message: "Audit completed" });
  } catch (error: any) {
    console.error("external completeMyAudit error:", error);
    res.status(500).json({ message: "Failed to complete audit" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  Parity with the internal auditor screens.
//  Same shared builders, same shapes — only the scope gate differs, so the two
//  flows cannot drift apart again.
// ─────────────────────────────────────────────────────────────────────────────

const asRunMode = (v: any): RunMode => {
  const m = String(v ?? "").toUpperCase();
  return (RUN_MODES as string[]).includes(m) ? (m as RunMode) : ("FLOOR" as RunMode);
};

// GET /external-audit/audits/:id/checklist
export const getMyAuditChecklist = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    if (!(await requireAuditAccess(req, auditId))) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const data = await buildChecklist(auditId, {
      groupBy: req.query.groupBy as string,
      assetStatus: req.query.assetStatus as string,
      itemStatus: req.query.itemStatus as string,
      sticker: req.query.sticker as string,
      q: req.query.q as string,
    });
    if (!data) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data });
  } catch (error: any) {
    console.error("external getMyAuditChecklist error:", error);
    res.status(500).json({ message: "Failed to load checklist" });
  }
};

// GET /external-audit/audits/:id/start-options?mode=
export const getMyAuditStartOptions = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const mode = req.query.mode ? asRunMode(req.query.mode) : (((access as any).groupBy as RunMode) || "FLOOR");
    const data = await buildStartOptions(auditId, mode);
    if (!data) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data });
  } catch (error: any) {
    console.error("external getMyAuditStartOptions error:", error);
    res.status(500).json({ message: "Failed to load start options" });
  }
};

// GET /external-audit/audits/:id/run?mode=&group=&fromItemId=
export const getMyAuditRun = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    if (!(await requireAuditAccess(req, auditId))) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const data = await buildRun(auditId, {
      mode: req.query.mode ? asRunMode(req.query.mode) : undefined,
      group: req.query.group != null ? String(req.query.group) : null,
      fromItemId: req.query.fromItemId ? Number(req.query.fromItemId) : null,
      placement: req.query.placement as any,
    });
    if (!data) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    res.json({ data });
  } catch (error: any) {
    console.error("external getMyAuditRun error:", error);
    res.status(500).json({ message: "Failed to load run plan" });
  }
};

// GET /external-audit/audits/:id/completion-check
export const getMyAuditCompletionCheck = async (req: ExternalAuditorRequest, res: Response) => {
  try {
    const auditId = Number(req.params.id);
    const access = await requireAuditAccess(req, auditId);
    if (!access) {
      res.status(404).json({ message: "Audit not found" });
      return;
    }
    const blockers = await pendingRequiredItems(auditId);
    res.json({
      data: {
        canComplete: blockers.length === 0 && access.status === "IN_PROGRESS",
        auditStatus: access.status,
        blockingCount: blockers.length,
        examples: blockers.slice(0, 10).map((b) => ({
          itemId: b.id,
          assetCode: b.asset?.assetId ?? null,
          assetName: b.asset?.assetName ?? null,
        })),
      },
    });
  } catch (error: any) {
    console.error("external getMyAuditCompletionCheck error:", error);
    res.status(500).json({ message: "Failed to check completion" });
  }
};

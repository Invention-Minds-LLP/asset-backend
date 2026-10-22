/**
 * Financial-year finalization (books closed).
 *
 *   FINANCE  POST /:fy/submit   OPEN | REJECTED → PENDING_CFO   (year locks now)
 *   CFO      POST /:fy/approve  PENDING_CFO → FINALIZED          (snapshot frozen)
 *   CFO      POST /:fy/reject   PENDING_CFO → REJECTED           (lock lifts)
 *   CFO      POST /:fy/undo     FINALIZED → REJECTED             (within 24 h only)
 *
 * The year stays locked through the undo window, so what gets frozen is always
 * what the CFO approved. Once the 24 hours pass the year cannot be unlocked
 * from the application.
 *
 * Separate from the Depreciation Audit (CFO + external CA sign-off of the
 * depreciation figures), which stays as it is.
 */
import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getCfoIds, getFinanceApproverIds } from "../../utilis/notificationHelper";
import {
  scheduleFyBounds,
  buildScheduleLines,
  aggregateScheduleLines,
  finalizedScheduleLines,
  snapshotRowsFromLines,
} from "../../utilis/fixedAssetsSchedule";
import { fyLabelOf } from "../../utilis/fyLock";
import { logAction } from "../audit-trail/audit-trail.controller";

const actorId = (req: AuthenticatedRequest) => (req.user as any)?.employeeDbId ?? null;

/** How long after finalizing the CFO may still undo it. */
export const UNDO_WINDOW_HOURS = 24;

function undoDeadline(approvedAt: Date | null | undefined): Date | null {
  return approvedAt ? new Date(new Date(approvedAt).getTime() + UNDO_WINDOW_HOURS * 3600_000) : null;
}

/**
 * Things already built on this finalization. Undoing while any of them exist
 * would leave them resting on figures that are no longer frozen:
 *   • the next year submitted or finalized — it closed on top of this one;
 *   • a reclassification approved since — allowed only because this year was
 *     frozen; unfrozen, the year would regroup under the new category;
 *   • next year's depreciation drafted/booked since, opened from this year's
 *     frozen closing (FINALIZED_YEAR).
 */
async function undoBlockers(close: { id: number; fiscalYear: number; approvedAt: Date | null }): Promise<string[]> {
  const blockers: string[] = [];
  const since = close.approvedAt ?? new Date(0);

  const next = await prisma.financialYearClose.findUnique({
    where: { fiscalYear: close.fiscalYear + 1 },
    select: { status: true },
  });
  if (next && (next.status === "PENDING_CFO" || next.status === "FINALIZED")) {
    blockers.push(`${fyLabelOf(close.fiscalYear + 1)} is already ${next.status === "FINALIZED" ? "finalized" : "submitted"} on top of this year.`);
  }

  const reclass = await prisma.assetReclassRequest.findMany({
    where: { status: "APPROVED", approvedAt: { gte: since } },
    select: { requestNo: true },
    take: 5,
  });
  if (reclass.length) {
    blockers.push(`Reclassification ${reclass.map((r) => r.requestNo).join(", ")} was approved after this year was finalized.`);
  }

  const { fyStart: nextStart, fyEnd: nextEnd } = scheduleFyBounds(close.fiscalYear + 1);
  const deps = await prisma.depreciationLog.findMany({
    where: {
      openingWdvSource: "FINALIZED_YEAR",
      status: { in: ["DRAFT", "APPROVED"] },
      createdAt: { gte: since },
      periodEnd: { gte: nextStart, lte: nextEnd },
    },
    select: { status: true, batchRun: { select: { runNumber: true } } },
  });
  if (deps.length) {
    const runs = [...new Set(deps.map((d) => d.batchRun?.runNumber).filter(Boolean))];
    const approved = deps.some((d) => d.status === "APPROVED");
    blockers.push(
      `${fyLabelOf(close.fiscalYear + 1)} depreciation opened from this year's frozen figures` +
      (runs.length ? ` (run ${runs.join(", ")})` : "") +
      (approved ? " and has been approved." : " — reject that draft run first.")
    );
  }
  return blockers;
}
const roleOf = (req: AuthenticatedRequest) => String((req.user as any)?.role ?? "");

function parseFy(req: AuthenticatedRequest): number | null {
  const fy = Number(req.params.fiscalYear);
  return Number.isInteger(fy) && fy > 1990 && fy < 2200 ? fy : null;
}

/**
 * The first year the books have anything in: the earliest acquisition among
 * top-level assets, or the earliest pool schedule. Years before it have nothing
 * to close, so they don't gate finalization of later years.
 */
async function earliestFiscalYear(): Promise<number | null> {
  const agg = await prisma.asset.aggregate({
    where: { parentAssetId: null },
    _min: { purchaseDate: true, donationDate: true },
  });
  const candidates: number[] = [];
  for (const d of [agg._min.purchaseDate, agg._min.donationDate]) {
    if (d) {
      const dt = new Date(d);
      candidates.push(dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1);
    }
  }
  const pools = await prisma.assetPoolDepreciationSchedule.findMany({
    select: { financialYear: true },
    distinct: ["financialYear"],
  });
  for (const p of pools) {
    const m = String(p.financialYear || "").match(/FY(\d{4})/);
    if (m) candidates.push(Number(m[1]));
  }
  return candidates.length ? Math.min(...candidates) : null;
}

/** Draft (unapproved) depreciation rows dated in the year. */
async function draftRowsIn(fiscalYear: number): Promise<number> {
  const { fyStart, fyEnd } = scheduleFyBounds(fiscalYear);
  return prisma.depreciationLog.count({
    where: { status: "DRAFT", periodEnd: { gte: fyStart, lte: fyEnd } },
  });
}

/** Reasons the year can't be submitted yet; empty = ready. */
async function readinessIssues(fiscalYear: number): Promise<string[]> {
  const issues: string[] = [];
  const { fyEnd } = scheduleFyBounds(fiscalYear);
  if (fyEnd >= new Date()) issues.push(`${fyLabelOf(fiscalYear)} has not ended yet.`);

  // Close in order: a year can't be closed while an earlier year with assets is open.
  const earliest = await earliestFiscalYear();
  if (earliest != null && fiscalYear > earliest) {
    const prev = await prisma.financialYearClose.findUnique({ where: { fiscalYear: fiscalYear - 1 } });
    if (prev?.status !== "FINALIZED") {
      issues.push(`${fyLabelOf(fiscalYear - 1)} must be finalized first — years close in order.`);
    }
  }

  const drafts = await draftRowsIn(fiscalYear);
  if (drafts > 0) {
    issues.push(`${drafts} depreciation row(s) for this year are in draft batch runs awaiting approval. Approve or reject them first.`);
  }
  return issues;
}

// ─── GET / — every year from the first one with assets up to the current one ─
export const listYears = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    const currentFy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const earliest = (await earliestFiscalYear()) ?? currentFy;

    const rows = await prisma.financialYearClose.findMany({
      include: {
        submittedBy: { select: { name: true, employeeID: true } },
        approvedBy: { select: { name: true, employeeID: true } },
        rejectedBy: { select: { name: true, employeeID: true } },
        undoneBy: { select: { name: true, employeeID: true } },
      },
    });
    const byFy = new Map(rows.map((r) => [r.fiscalYear, r]));

    // Draft counts per year in one query.
    const drafts = await prisma.depreciationLog.findMany({
      where: { status: "DRAFT" },
      select: { periodEnd: true },
    });
    const draftsByFy = new Map<number, number>();
    for (const d of drafts) {
      const e = new Date(d.periodEnd);
      const fy = e.getMonth() >= 3 ? e.getFullYear() : e.getFullYear() - 1;
      draftsByFy.set(fy, (draftsByFy.get(fy) ?? 0) + 1);
    }

    const years: any[] = [];
    for (let fy = currentFy; fy >= earliest; fy--) {
      const r = byFy.get(fy);
      const { fyStart, fyEnd } = scheduleFyBounds(fy);
      years.push({
        fiscalYear: fy,
        fyLabel: fyLabelOf(fy),
        fyStart,
        fyEnd,
        ended: fyEnd < now,
        status: r?.status ?? "OPEN",
        pendingDrafts: draftsByFy.get(fy) ?? 0,
        submittedBy: r?.submittedBy ?? null,
        submittedAt: r?.submittedAt ?? null,
        submitNotes: r?.submitNotes ?? null,
        approvedBy: r?.approvedBy ?? null,
        approvedAt: r?.approvedAt ?? null,
        approvalNotes: r?.approvalNotes ?? null,
        rejectedBy: r?.rejectedBy ?? null,
        rejectedAt: r?.rejectedAt ?? null,
        rejectionReason: r?.rejectionReason ?? null,
        // Undo window: only while finalized and the 24 hours haven't passed.
        undoUntil: r?.status === "FINALIZED" && undoDeadline(r.approvedAt)! > now ? undoDeadline(r.approvedAt) : null,
        undoneBy: r?.undoneBy ?? null,
        undoneAt: r?.undoneAt ?? null,
        undoReason: r?.undoReason ?? null,
        totals: r?.status === "FINALIZED" ? {
          totalLines: r.totalLines,
          grossBlockOpening: r.grossBlockOpening,
          grossBlockClosing: r.grossBlockClosing,
          depForYear: r.depForYear,
          accDepClosing: r.accDepClosing,
          netBlockClosing: r.netBlockClosing,
        } : null,
      });
    }
    res.json({ currentFiscalYear: currentFy, years });
  } catch (err: any) {
    console.error("fy-close listYears error:", err);
    res.status(500).json({ message: "Failed to load financial years" });
  }
};

// ─── GET /:fy/preview — the figures that will be frozen, plus readiness ──────
export const previewYear = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const fiscalYear = parseFy(req);
    if (!fiscalYear) { res.status(400).json({ message: "Invalid financial year" }); return; }

    const close = await prisma.financialYearClose.findUnique({ where: { fiscalYear } });
    const frozen = await finalizedScheduleLines(fiscalYear);
    const lines = frozen ? frozen.lines : await buildScheduleLines(fiscalYear);
    const { rows, grandTotal } = aggregateScheduleLines(lines);

    // How much of the year's depreciation is booked vs estimated on the fly.
    // COMPUTED means no approved batch row exists for that asset and year, so
    // the figure that gets frozen is the schedule's estimate.
    const depSourceCounts: Record<string, number> = { LOG: 0, COMPUTED: 0, NONE: 0, POOL: 0 };
    for (const l of lines) depSourceCounts[l.depSource] = (depSourceCounts[l.depSource] ?? 0) + 1;

    const status = close?.status ?? "OPEN";
    res.json({
      fiscalYear,
      fyLabel: fyLabelOf(fiscalYear),
      status,
      frozen: !!frozen,
      issues: status === "FINALIZED" ? [] : await readinessIssues(fiscalYear),
      depSourceCounts,
      rows,
      grandTotal,
    });
  } catch (err: any) {
    console.error("fy-close previewYear error:", err);
    res.status(500).json({ message: "Failed to build the year preview" });
  }
};

// ─── POST /:fy/submit — FINANCE ──────────────────────────────────────────────
export const submitYear = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (roleOf(req) !== "FINANCE") {
      res.status(403).json({ message: "Only the Finance role can submit a financial year for finalization." });
      return;
    }
    const fiscalYear = parseFy(req);
    if (!fiscalYear) { res.status(400).json({ message: "Invalid financial year" }); return; }

    const existing = await prisma.financialYearClose.findUnique({ where: { fiscalYear } });
    const status = existing?.status ?? "OPEN";
    if (status !== "OPEN" && status !== "REJECTED") {
      res.status(400).json({
        message: status === "FINALIZED"
          ? `${fyLabelOf(fiscalYear)} is already finalized.`
          : `${fyLabelOf(fiscalYear)} is already awaiting CFO approval.`,
      });
      return;
    }

    const issues = await readinessIssues(fiscalYear);
    if (issues.length) {
      res.status(400).json({ message: issues.join(" "), issues });
      return;
    }

    const me = actorId(req);

    // Submitting locks the year, and only a CFO can finalize or reject it —
    // with no reopen. Without a CFO who can act, the year would be locked
    // with nobody able to release it. Refuse up front instead.
    const cfoUsers = await prisma.user.findMany({
      where: { role: "CFO" },
      select: { employee: { select: { id: true } } },
    });
    const cfoWhoCanApprove = cfoUsers.filter((u) => u.employee?.id !== me);
    if (!cfoWhoCanApprove.length) {
      res.status(400).json({
        message: "No CFO user is set up to approve this. Submitting would lock the year with nobody able to finalize or reject it — ask an administrator to create a CFO login first.",
      });
      return;
    }

    const { fyStart, fyEnd } = scheduleFyBounds(fiscalYear);
    const notes = String(req.body?.notes ?? "").trim() || null;

    const updated = await prisma.financialYearClose.upsert({
      where: { fiscalYear },
      create: {
        fiscalYear, fyLabel: fyLabelOf(fiscalYear), fyStart, fyEnd,
        status: "PENDING_CFO", submittedById: me, submittedAt: new Date(), submitNotes: notes,
      },
      update: {
        status: "PENDING_CFO", submittedById: me, submittedAt: new Date(), submitNotes: notes,
      },
    });

    getCfoIds().then((cfoIds) => notify({
      type: "OTHER",
      title: "Financial Year — Finalization Approval Required",
      message: `${fyLabelOf(fiscalYear)} has been submitted for finalization by Finance. ` +
        `Asset and depreciation entries for the year are locked until you approve or reject it.`,
      recipientIds: cfoIds.filter((id) => id !== me),
      priority: "HIGH",
      createdById: me ?? undefined,
    })).catch(() => {});

    res.json({ message: `${fyLabelOf(fiscalYear)} submitted for CFO approval. The year is now locked.`, year: updated });
  } catch (err: any) {
    console.error("fy-close submitYear error:", err);
    res.status(500).json({ message: "Failed to submit the financial year" });
  }
};

// ─── POST /:fy/approve — CFO. Freezes the snapshot and finalizes. ────────────
export const approveYear = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (roleOf(req) !== "CFO") {
      res.status(403).json({ message: "Only the CFO can finalize a financial year." });
      return;
    }
    const fiscalYear = parseFy(req);
    if (!fiscalYear) { res.status(400).json({ message: "Invalid financial year" }); return; }

    const close = await prisma.financialYearClose.findUnique({ where: { fiscalYear } });
    if (!close || close.status !== "PENDING_CFO") {
      res.status(400).json({ message: `${fyLabelOf(fiscalYear)} is not awaiting CFO approval.` });
      return;
    }
    const me = actorId(req);
    if (me != null && close.submittedById === me) {
      res.status(403).json({ message: "You submitted this year for finalization, so you can't also approve it." });
      return;
    }
    // Defensive: the year has been locked since submission, so no draft should
    // have appeared — but a snapshot taken over a pending draft would be wrong.
    const drafts = await draftRowsIn(fiscalYear);
    if (drafts > 0) {
      res.status(409).json({ message: `${drafts} draft depreciation row(s) exist for this year. Reject the submission and resolve them first.` });
      return;
    }

    // The year has been locked since submission, so these are exactly the
    // figures Finance submitted and the CFO previewed.
    const lines = await buildScheduleLines(fiscalYear);
    const { grandTotal } = aggregateScheduleLines(lines);
    const data = snapshotRowsFromLines(lines, close.id, fiscalYear);

    await prisma.$transaction(async (tx) => {
      await tx.fyAssetSnapshot.deleteMany({ where: { financialYearCloseId: close.id } });
      const CHUNK = 500;
      for (let i = 0; i < data.length; i += CHUNK) {
        await tx.fyAssetSnapshot.createMany({ data: data.slice(i, i + CHUNK) as any });
      }
      await tx.financialYearClose.update({
        where: { id: close.id },
        data: {
          status: "FINALIZED",
          approvedById: me,
          approvedAt: new Date(),
          approvalNotes: String(req.body?.notes ?? "").trim() || null,
          totalLines: lines.length,
          grossBlockOpening: String(grandTotal.openingGross),
          grossBlockClosing: String(grandTotal.closingGross),
          depForYear: String(grandTotal.periodDep),
          accDepClosing: String(grandTotal.closingDep),
          netBlockClosing: String(grandTotal.netCurrent),
        },
      });
    }, { timeout: 180_000, maxWait: 10_000 });

    const recipients = new Set<number>(await getFinanceApproverIds());
    if (close.submittedById) recipients.add(close.submittedById);
    recipients.delete(me as number);
    notify({
      type: "OTHER",
      title: "Financial Year Finalized",
      message: `${fyLabelOf(fiscalYear)} has been finalized by the CFO. Its figures are frozen and no further entries can be dated into it. ` +
        `The CFO can undo this within ${UNDO_WINDOW_HOURS} hours if an amendment is needed; after that it is permanent.`,
      recipientIds: [...recipients],
      createdById: me ?? undefined,
    }).catch(() => {});

    res.json({
      message: `${fyLabelOf(fiscalYear)} finalized. ${lines.length} line(s) frozen. ` +
        `You can undo this within ${UNDO_WINDOW_HOURS} hours; after that it is permanent.`,
      grandTotal,
      undoUntil: undoDeadline(new Date()),
    });
  } catch (err: any) {
    console.error("fy-close approveYear error:", err);
    res.status(500).json({ message: "Failed to finalize the financial year" });
  }
};

// ─── POST /:fy/reject — CFO. Lock lifts; Finance can fix and resubmit. ───────
export const rejectYear = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (roleOf(req) !== "CFO") {
      res.status(403).json({ message: "Only the CFO can reject a finalization." });
      return;
    }
    const fiscalYear = parseFy(req);
    if (!fiscalYear) { res.status(400).json({ message: "Invalid financial year" }); return; }

    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) { res.status(400).json({ message: "A rejection reason is required." }); return; }

    const close = await prisma.financialYearClose.findUnique({ where: { fiscalYear } });
    if (!close || close.status !== "PENDING_CFO") {
      res.status(400).json({ message: `${fyLabelOf(fiscalYear)} is not awaiting CFO approval.` });
      return;
    }

    const me = actorId(req);
    await prisma.financialYearClose.update({
      where: { id: close.id },
      data: { status: "REJECTED", rejectedById: me, rejectedAt: new Date(), rejectionReason: reason },
    });

    const recipients = new Set<number>(await getFinanceApproverIds());
    if (close.submittedById) recipients.add(close.submittedById);
    recipients.delete(me as number);
    notify({
      type: "OTHER",
      title: "Financial Year Finalization Rejected",
      message: `The CFO rejected finalization of ${fyLabelOf(fiscalYear)}. Reason: ${reason}. The year is open again.`,
      recipientIds: [...recipients],
      createdById: me ?? undefined,
    }).catch(() => {});

    res.json({ message: `${fyLabelOf(fiscalYear)} finalization rejected. The year is open again.` });
  } catch (err: any) {
    console.error("fy-close rejectYear error:", err);
    res.status(500).json({ message: "Failed to reject the finalization" });
  }
};

// ─── POST /:fy/undo — CFO, within 24 h of finalizing ─────────────────────────
// Sends the year back to Finance to amend and resubmit; the CFO then approves
// again. The frozen snapshot is dropped (a new one is taken on re-approval).
// After the window, or once anything has been built on this finalization, the
// year stays closed.
export const undoYear = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (roleOf(req) !== "CFO") {
      res.status(403).json({ message: "Only the CFO can undo a finalization." });
      return;
    }
    const fiscalYear = parseFy(req);
    if (!fiscalYear) { res.status(400).json({ message: "Invalid financial year" }); return; }

    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) { res.status(400).json({ message: "Give the reason for undoing — it is kept on the record and sent to Finance." }); return; }

    const close = await prisma.financialYearClose.findUnique({ where: { fiscalYear } });
    if (!close || close.status !== "FINALIZED") {
      res.status(400).json({ message: `${fyLabelOf(fiscalYear)} is not finalized.` });
      return;
    }

    const deadline = undoDeadline(close.approvedAt);
    if (!deadline || deadline <= new Date()) {
      res.status(409).json({
        code: "UNDO_WINDOW_CLOSED",
        message: `The ${UNDO_WINDOW_HOURS}-hour window to undo ${fyLabelOf(fiscalYear)} closed at ` +
          `${deadline ? deadline.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}. The year is permanently finalized.`,
      });
      return;
    }

    const blockers = await undoBlockers(close);
    if (blockers.length) {
      res.status(409).json({
        code: "UNDO_BLOCKED",
        message: `${fyLabelOf(fiscalYear)} can't be undone: ${blockers.join(" ")}`,
        blockers,
      });
      return;
    }

    const me = actorId(req);
    await prisma.$transaction(async (tx) => {
      await tx.fyAssetSnapshot.deleteMany({ where: { financialYearCloseId: close.id } });
      await tx.financialYearClose.update({
        where: { id: close.id },
        data: {
          status: "REJECTED",
          rejectedById: me,
          rejectedAt: new Date(),
          rejectionReason: `Finalization undone by CFO: ${reason}`,
          undoneById: me,
          undoneAt: new Date(),
          undoReason: reason,
          // Frozen totals no longer describe a closed year.
          totalLines: null,
          grossBlockOpening: null,
          grossBlockClosing: null,
          depForYear: null,
          accDepClosing: null,
          netBlockClosing: null,
        },
      });
    }, { timeout: 60_000, maxWait: 10_000 });

    logAction({
      entityType: "FY_CLOSE",
      entityId: close.id,
      action: "UNDO_FINALIZATION",
      description: `${fyLabelOf(fiscalYear)} finalization undone within the ${UNDO_WINDOW_HOURS}-hour window`,
      oldValue: JSON.stringify({ status: "FINALIZED", approvedAt: close.approvedAt, netBlockClosing: close.netBlockClosing }),
      newValue: JSON.stringify({ status: "REJECTED", reason }),
      performedById: me ?? undefined,
    }).catch(() => {});

    const recipients = new Set<number>(await getFinanceApproverIds());
    if (close.submittedById) recipients.add(close.submittedById);
    recipients.delete(me as number);
    notify({
      type: "OTHER",
      title: "Financial Year Finalization Undone",
      message: `The CFO undid the finalization of ${fyLabelOf(fiscalYear)}. Reason: ${reason}. The year is open again — amend it and resubmit.`,
      recipientIds: [...recipients],
      priority: "HIGH",
      createdById: me ?? undefined,
    }).catch(() => {});

    res.json({ message: `${fyLabelOf(fiscalYear)} finalization undone. The year is open again for Finance to amend and resubmit.` });
  } catch (err: any) {
    console.error("fy-close undoYear error:", err);
    res.status(500).json({ message: "Failed to undo the finalization" });
  }
};

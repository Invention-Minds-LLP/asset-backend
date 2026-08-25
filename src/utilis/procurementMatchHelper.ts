import prisma from "../prismaClient";

/**
 * THREE-WAY MATCH — purchase order vs goods received vs tax invoice.
 *
 * Runs automatically whenever a goods receipt is saved or accepted. When the
 * vendor bills more than the order was approved for, the match holds every
 * balance payment on that order until the CFO explicitly accepts the variance.
 * The block lives here (and in the payment voucher path) rather than in the UI,
 * so it cannot be walked around through the API.
 */

export type MatchStatus =
  | "MATCHED"          // invoice equals the approved value
  | "WITHIN_TOLERANCE" // over by a rounding/freight-sized amount
  | "FAVOURABLE"       // vendor billed less than approved
  | "QTY_VARIANCE"     // short supply — pay for what arrived, order stays open
  | "OVER_BILLED"      // billed for more than has arrived — payment blocked
  | "VARIANCE_HOLD"    // over-billed beyond tolerance — payment blocked
  | "CFO_APPROVED"     // variance accepted, block lifted
  | "REJECTED"         // variance refused
  | "NO_BASELINE";     // nothing approved to match the invoice against

/** Defaults when the tenant hasn't configured tolerances. */
const DEFAULT_TOLERANCE_PCT = 2;
const DEFAULT_TOLERANCE_ABS = 5000;

export interface MatchTolerance {
  percent: number;
  absolute: number;
  /** External PO mode: an invoice with no recorded approved value is itself a finding. */
  externalPoMode: boolean;
}

export async function getMatchTolerance(): Promise<MatchTolerance> {
  const rows = await prisma.tenantConfig.findMany({
    where: {
      key: {
        in: ["INVOICE_VARIANCE_TOLERANCE_PCT", "INVOICE_VARIANCE_TOLERANCE_ABS", "EXTERNAL_PO_MODE"],
      },
    },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;

  const pct = Number(get("INVOICE_VARIANCE_TOLERANCE_PCT"));
  const abs = Number(get("INVOICE_VARIANCE_TOLERANCE_ABS"));

  return {
    percent: isNaN(pct) || pct < 0 ? DEFAULT_TOLERANCE_PCT : pct,
    absolute: isNaN(abs) || abs < 0 ? DEFAULT_TOLERANCE_ABS : abs,
    externalPoMode: get("EXTERNAL_PO_MODE") === "true",
  };
}

/**
 * The allowed overspend. Deliberately the LOWER of the two limits — a
 * percentage alone lets a large order absorb a big absolute overspend, and an
 * absolute alone is punitive on small ones.
 */
export function allowedVariance(approvedAmount: number, tol: MatchTolerance): number {
  return Math.min((approvedAmount * tol.percent) / 100, tol.absolute);
}

const money = (v: any) => Number(v ?? 0);

/**
 * Recompute (and upsert) the match for one goods receipt.
 * Safe to call repeatedly — it is the single source of truth for the hold.
 * Returns null when the receipt carries no invoice value yet, since there is
 * nothing to match.
 */
export async function computeProcurementMatch(goodsReceiptId: number) {
  const gra = await prisma.goodsReceipt.findUnique({
    where: { id: goodsReceiptId },
    include: {
      lines: true,
      purchaseOrder: { include: { lines: true } },
      externalPo: true,
    },
  });
  if (!gra) return null;

  const invoiceAmount = money(gra.invoiceValue ?? gra.totalValue);
  if (invoiceAmount <= 0) return null; // no invoice recorded — nothing to match

  const tol = await getMatchTolerance();

  // ── Baseline: what was approved ─────────────────────────────────────
  const approvedAmount = gra.purchaseOrder
    ? money(gra.purchaseOrder.totalAmount) // already reflects approved amendments
    : gra.externalPo
      ? money(gra.externalPo.approvedAmount)
      : 0;

  // ── What actually arrived, valued at the ordered rate ────────────────
  let receivedAmount = 0;
  for (const line of gra.lines) {
    const qty = line.acceptedQty > 0 ? line.acceptedQty : line.receivedQty;
    const poLine = gra.purchaseOrder?.lines?.find((pl) => pl.id === line.poLineId);
    const rate = poLine ? money(poLine.unitPrice) : money(line.unitPrice);
    receivedAmount += qty * rate;
  }

  // ── Everything billed on this order so far, this receipt included ────
  // Rejected receipts don't count; a rejected delivery isn't payable.
  const siblings =
    gra.purchaseOrderId || gra.externalPoId
      ? await prisma.goodsReceipt.findMany({
          where: {
            status: { not: "REJECTED" },
            id: { not: goodsReceiptId },
            ...(gra.purchaseOrderId
              ? { purchaseOrderId: gra.purchaseOrderId }
              : { externalPoId: gra.externalPoId }),
          },
          select: { invoiceValue: true, totalValue: true, lines: true },
        })
      : []; // standalone receipt — nothing to aggregate
  const cumulativeInvoiced =
    invoiceAmount + siblings.reduce((s, g) => s + money(g.invoiceValue ?? g.totalValue), 0);

  // The third leg of the match: what has actually arrived across the whole
  // order, valued at the ordered rate. Compared cumulatively rather than per
  // receipt so an invoice that runs ahead of one delivery is not flagged when a
  // later delivery catches it up.
  const valueOfLines = (lines: any[]) =>
    lines.reduce((s, l) => {
      const qty = l.acceptedQty > 0 ? l.acceptedQty : l.receivedQty;
      const poLine = gra.purchaseOrder?.lines?.find((pl) => pl.id === l.poLineId);
      const rate = poLine ? money(poLine.unitPrice) : money(l.unitPrice);
      return s + qty * rate;
    }, 0);
  const cumulativeReceived =
    receivedAmount + siblings.reduce((s, g) => s + valueOfLines(g.lines ?? []), 0);

  // Does the received leg exist at all? A client whose own system booked the
  // goods records the invoice here and nothing else, so there are no lines to
  // value. Without them "received" is 0, and comparing an invoice against 0
  // would report every such receipt as billed for goods that never arrived.
  //
  // Judged across the whole order, not this receipt alone: a part-lined order
  // understates cumulativeReceived just as badly, and a false hold is worse
  // than a missing one here — over-billing beyond the approved value is still
  // caught below by the value comparison, which needs no line detail.
  const lineCount = gra.lines.length + siblings.reduce((s, g) => s + (g.lines?.length ?? 0), 0);
  const hasReceivedLeg = lineCount > 0;
  const matchType: "THREE_WAY" | "TWO_WAY" = hasReceivedLeg ? "THREE_WAY" : "TWO_WAY";

  // ── Verdict ─────────────────────────────────────────────────────────
  const varianceAmount = cumulativeInvoiced - approvedAmount;
  // Clamped to what Decimal(8,2) can hold — a pathological ratio should not
  // throw and lose the hold.
  const rawPercent = approvedAmount > 0 ? (varianceAmount / approvedAmount) * 100 : 0;
  const variancePercent = Math.max(-999999, Math.min(999999, rawPercent));

  // Short supply is tracked separately from price: you pay for what arrived,
  // and the order stays open for the balance.
  const shortSupplied = gra.purchaseOrder
    ? gra.purchaseOrder.lines.some((pl) => (pl.receivedQty ?? 0) < pl.quantity)
    : false;

  let status: MatchStatus;
  let paymentBlocked = false;
  let blockReason: string | null = null;

  if (approvedAmount <= 0) {
    status = "NO_BASELINE";
    // Only a finding for tenants that are supposed to record an external PO.
    // Elsewhere a standalone receipt without an order is normal.
    if (tol.externalPoMode) {
      paymentBlocked = true;
      blockReason =
        `Invoice ${gra.invoiceNumber ?? ""} of ${cumulativeInvoiced.toFixed(2)} has no approved purchase order value to match against. ` +
        `Record the external PO number and its approved amount before releasing payment.`;
    }
  } else if (
    hasReceivedLeg &&
    cumulativeInvoiced - cumulativeReceived > allowedVariance(approvedAmount, tol)
  ) {
    // Billed for more than has arrived. Checked before the value comparison,
    // because an invoice can sit perfectly inside the approved order value and
    // still be for goods nobody has received — which is the loss a three-way
    // match exists to prevent.
    status = "OVER_BILLED";
    paymentBlocked = true;
    blockReason =
      `Invoiced ${cumulativeInvoiced.toFixed(2)} against ${cumulativeReceived.toFixed(2)} of goods actually received ` +
      `on this order — billed for ${(cumulativeInvoiced - cumulativeReceived).toFixed(2)} more than has arrived. ` +
      `Payment is held until the balance is delivered, or the CFO accepts it.`;
  } else if (varianceAmount < 0) {
    status = "FAVOURABLE";
  } else if (varianceAmount === 0) {
    status = shortSupplied ? "QTY_VARIANCE" : "MATCHED";
  } else if (varianceAmount <= allowedVariance(approvedAmount, tol)) {
    status = shortSupplied ? "QTY_VARIANCE" : "WITHIN_TOLERANCE";
  } else {
    status = "VARIANCE_HOLD";
    paymentBlocked = true;
    const splitNote =
      siblings.length > 0
        ? ` (across ${siblings.length + 1} invoices on this order)`
        : "";
    blockReason =
      `Invoiced ${cumulativeInvoiced.toFixed(2)}${splitNote} against an approved value of ${approvedAmount.toFixed(2)} — ` +
      `over by ${varianceAmount.toFixed(2)} (${variancePercent.toFixed(2)}%). ` +
      `Payment is held until the CFO accepts the variance.`;
  }

  const data = {
    purchaseOrderId: gra.purchaseOrderId ?? null,
    externalPoId: gra.externalPoId ?? null,
    approvedAmount,
    receivedAmount,
    invoiceAmount,
    cumulativeInvoiced,
    varianceAmount,
    variancePercent,
    status,
    paymentBlocked,
    blockReason,
    matchType,
  };

  // A CFO decision already taken on this receipt is not undone by a
  // recompute — only a NEW finding re-opens the hold. Both blocking statuses
  // count: a release given for a price variance should not also cover goods
  // that later turn out not to have arrived.
  const blockingNow = status === "VARIANCE_HOLD" || status === "OVER_BILLED";
  const existing = await prisma.procurementMatch.findUnique({ where: { goodsReceiptId } });
  if (existing && existing.status === "CFO_APPROVED" && !blockingNow) {
    return prisma.procurementMatch.update({
      where: { goodsReceiptId },
      data: { ...data, status: "CFO_APPROVED", paymentBlocked: false, blockReason: null },
    });
  }
  if (existing && existing.status === "CFO_APPROVED" && Number(existing.cumulativeInvoiced) >= cumulativeInvoiced) {
    // Nothing new was billed since the CFO signed — keep the release.
    return prisma.procurementMatch.update({
      where: { goodsReceiptId },
      data: { ...data, status: "CFO_APPROVED", paymentBlocked: false, blockReason: null },
    });
  }

  return prisma.procurementMatch.upsert({
    where: { goodsReceiptId },
    create: { goodsReceiptId, ...data },
    update: data,
  });
}

/**
 * Is any payment on this order currently held? Used by the payment voucher
 * path — a single blocked receipt holds the whole order, because the money
 * goes to one vendor against one commitment.
 */
export async function getActiveHold(opts: {
  purchaseOrderId?: number | null;
  externalPoId?: number | null;
}) {
  const { purchaseOrderId, externalPoId } = opts;
  if (!purchaseOrderId && !externalPoId) return null;

  return prisma.procurementMatch.findFirst({
    where: {
      paymentBlocked: true,
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
      ...(externalPoId ? { externalPoId } : {}),
    },
    include: {
      goodsReceipt: { select: { id: true, grnNumber: true, invoiceNumber: true } },
    },
    orderBy: { id: "desc" },
  });
}

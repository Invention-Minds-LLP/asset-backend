/**
 * Financial-year lock — the one check every write that dates something into a
 * year goes through.
 *
 * A year is LOCKED while its FinancialYearClose is PENDING_CFO (Finance has
 * submitted it, so what the CFO approves must not move underneath them) or
 * FINALIZED (books closed — permanently; there is no reopen in the app).
 *
 * FY convention: `fiscalYear` is the start year (2023 = FY2023-24, 1 Apr 2023 –
 * 31 Mar 2024), derived with the same local-time rule the depreciation engine
 * and FA Schedule use, so a date is judged to be in the same year everywhere.
 *
 * Usage in a handler:
 *   if (!(await assertFyOpen(res, [{ label: "purchase date", date: body.purchaseDate }]))) return;
 */
import type { Response } from "express";
import prisma from "../prismaClient";
import { getFYContext } from "./depreciationEngine";

export const LOCKING_STATUSES = ["PENDING_CFO", "FINALIZED"] as const;

/** FY start year for a date (2023 for any date in FY2023-24). */
export function fiscalYearOf(date: Date | string): number {
  return getFYContext(new Date(date)).fyStart.getFullYear();
}

export function fyLabelOf(fiscalYear: number): string {
  return `FY${fiscalYear}-${String(fiscalYear + 1).slice(-2)}`;
}

/**
 * All locked years, fetched once. There are only ever a handful of rows, so
 * loops (imports, batch runs) should call this once and use isLocked() rather
 * than hitting the database per row.
 */
export async function getLockedYears(): Promise<Map<number, string>> {
  const rows = await prisma.financialYearClose.findMany({
    where: { status: { in: [...LOCKING_STATUSES] } },
    select: { fiscalYear: true, status: true },
  });
  return new Map(rows.map((r) => [r.fiscalYear, r.status]));
}

export function isLocked(locked: Map<number, string>, date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  return locked.has(fiscalYearOf(d));
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Human message for one locked date, or null if its year is open. */
export function lockMessageFor(
  locked: Map<number, string>,
  label: string,
  date: Date | string | null | undefined,
): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const fy = fiscalYearOf(d);
  const status = locked.get(fy);
  if (!status) return null;
  const state = status === "FINALIZED" ? "finalized (books closed)" : "submitted for CFO finalization";
  return `${fyLabelOf(fy)} is ${state}. The ${label} ${fmt(d)} falls in that year, so this change can't be made. ` +
    `Use a date in an open financial year.`;
}

/** First lock message among several dates, or null if all are in open years. */
export async function fyLockMessage(
  dates: { label: string; date: Date | string | null | undefined }[],
  locked?: Map<number, string>,
): Promise<string | null> {
  const present = dates.filter((d) => d.date);
  if (!present.length) return null;
  const years = locked ?? (await getLockedYears());
  for (const d of present) {
    const msg = lockMessageFor(years, d.label, d.date);
    if (msg) return msg;
  }
  return null;
}

/** Sends 409 and returns false if any date is in a locked year. */
export async function assertFyOpen(
  res: Response,
  dates: { label: string; date: Date | string | null | undefined }[],
  locked?: Map<number, string>,
): Promise<boolean> {
  const msg = await fyLockMessage(dates, locked);
  if (msg) {
    res.status(409).json({ message: msg, code: "FY_LOCKED" });
    return false;
  }
  return true;
}

/**
 * For records keyed by financial year rather than a date (capex budgets).
 * Returns a message if that year is locked, else null.
 */
export async function yearLockMessage(fiscalYear: number, what: string): Promise<string | null> {
  if (!Number.isInteger(fiscalYear)) return null;
  const status = (await getLockedYears()).get(fiscalYear);
  if (!status) return null;
  const state = status === "FINALIZED" ? "finalized (books closed)" : "submitted for CFO finalization";
  return `${fyLabelOf(fiscalYear)} is ${state}, so its ${what} can't be changed.`;
}

/**
 * The date an asset enters the books — what the FA Schedule uses to place it
 * in a year as an addition. Kept here so the lock and the schedule can't drift.
 */
export function acquisitionDateOf(a: { purchaseDate?: any; donationDate?: any }): Date | null {
  const d = a.purchaseDate ?? a.donationDate;
  return d ? new Date(d) : null;
}

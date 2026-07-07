import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { computeBranchDashboard } from "./branch-dashboard.controller";

// Head Office dashboard: branch health (shared aggregates) + the Expiry Radar —
// everything lapsing soon (or already lapsed), per type and per branch, with
// the underlying asset rows so every number is clickable in the UI.
const MANAGEMENT_ROLES = ["ADMIN", "CEO_COO", "CFO", "FINANCE", "OPERATIONS"];

// Look 90 days ahead; report overdue items up to a year back so the list stays bounded.
const AHEAD_DAYS = 90;
const OVERDUE_CAP_DAYS = 365;

type ExpiryType =
  | "WARRANTY" | "AMC_CMC" | "INSURANCE" | "CALIBRATION" | "PM_DUE" | "LEASE_END" | "RENTAL_END";

interface ExpiryItem {
  type: ExpiryType;
  assetDbId: number;
  assetId: string | null;
  assetName: string;
  branchId: number | null;
  branchName: string;
  dueDate: Date;
  reference: string | null; // policy no / contract no / provider etc.
}

const ASSET_SELECT = {
  select: {
    id: true,
    assetId: true,
    assetName: true,
    currentBranchId: true,
    currentBranch: { select: { name: true } },
  },
} as const;

function toItem(type: ExpiryType, asset: any, dueDate: Date, reference: string | null): ExpiryItem {
  return {
    type,
    assetDbId: asset?.id ?? 0,
    assetId: asset?.assetId ?? null,
    assetName: asset?.assetName ?? "Unknown",
    branchId: asset?.currentBranchId ?? null,
    branchName: asset?.currentBranch?.name ?? "Unassigned",
    dueDate,
    reference,
  };
}

export const getHeadOfficeDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    if (!MANAGEMENT_ROLES.includes(user?.role)) {
      res.status(403).json({ message: "Head Office dashboard is restricted to management roles" });
      return;
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + AHEAD_DAYS * 86400_000);
    const overdueFloor = new Date(now.getTime() - OVERDUE_CAP_DAYS * 86400_000);
    const window = { gte: overdueFloor, lte: horizon };

    const [health, warranties, contracts, insurance, calibrations, pms, leases, rentals] =
      await Promise.all([
        computeBranchDashboard(),
        prisma.warranty.findMany({
          where: { isActive: true, warrantyEnd: window },
          select: { warrantyEnd: true, warrantyProvider: true, asset: ASSET_SELECT },
        }),
        prisma.serviceContract.findMany({
          where: { status: { not: "CANCELLED" }, endDate: window },
          select: { endDate: true, contractType: true, contractNumber: true, asset: ASSET_SELECT },
        }),
        prisma.assetInsurance.findMany({
          where: { isActive: true, endDate: window },
          select: { endDate: true, policyNumber: true, provider: true, asset: ASSET_SELECT },
        }),
        prisma.calibrationSchedule.findMany({
          where: { isActive: true, nextDueAt: window },
          select: { nextDueAt: true, asset: ASSET_SELECT },
        }),
        prisma.maintenanceSchedule.findMany({
          where: { isActive: true, nextDueAt: window },
          select: { nextDueAt: true, description: true, asset: ASSET_SELECT },
        }),
        prisma.asset.findMany({
          where: { modeOfProcurement: "LEASE", leaseEndDate: window },
          select: { ...ASSET_SELECT.select, leaseEndDate: true },
        }),
        prisma.asset.findMany({
          where: { modeOfProcurement: "RENTAL", rentalEndDate: window },
          select: { ...ASSET_SELECT.select, rentalEndDate: true },
        }),
      ]);

    const items: ExpiryItem[] = [
      ...warranties.filter(w => w.warrantyEnd).map(w =>
        toItem("WARRANTY", w.asset, w.warrantyEnd as Date, w.warrantyProvider ?? null)),
      ...contracts.filter(c => c.endDate).map(c =>
        toItem("AMC_CMC", c.asset, c.endDate as Date, c.contractNumber || c.contractType || null)),
      ...insurance.filter(i => i.endDate).map(i =>
        toItem("INSURANCE", i.asset, i.endDate as Date, i.policyNumber || i.provider || null)),
      ...calibrations.filter(c => c.nextDueAt).map(c =>
        toItem("CALIBRATION", c.asset, c.nextDueAt as Date, null)),
      ...pms.filter(p => p.nextDueAt).map(p =>
        toItem("PM_DUE", p.asset, p.nextDueAt as Date, p.description ?? null)),
      ...leases.filter(a => a.leaseEndDate).map(a =>
        toItem("LEASE_END", a, a.leaseEndDate as Date, null)),
      ...rentals.filter(a => a.rentalEndDate).map(a =>
        toItem("RENTAL_END", a, a.rentalEndDate as Date, null)),
    ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    res.json({
      health,
      expiry: {
        aheadDays: AHEAD_DAYS,
        overdueCapDays: OVERDUE_CAP_DAYS,
        items,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("getHeadOfficeDashboard error:", err);
    res.status(500).json({ message: "Failed to load head office dashboard", error: err?.message });
  }
};

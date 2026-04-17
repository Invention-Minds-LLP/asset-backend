/**
 * DELETE /api/master/reset-assets
 * Deletes ALL asset records and all dependent child records,
 * then resets the auto-increment counters.
 *
 * WARNING: This is irreversible. Use only in dev/staging or during fresh client setup.
 */
import { Request, Response } from "express";
import prisma from "../../prismaClient";

// Every table to wipe (order doesn't matter — we disable FK checks)
const TABLES_TO_WIPE = [
  // Acknowledgement
  "assetacknowledgementresult", "assetacknowledgementitem", "assetacknowledgementrun",
  // Audit
  "assetaudititem", "assetaudit", "auditlog",
  // Scan / Usage
  "assetscanlog", "qrscanlog", "assetdailyusagelog",
  // Cost / Revenue / GL
  "assetcostallocation", "assetratecard", "assetrevenueentry", "assetglmapping",
  // Depreciation
  "depreciationlog", "batchdepreciationrun", "assetdepreciation",
  // Reconciliation
  "reconciliationsnapshot",
  // Disposal / E-Waste
  "ewasterecord", "assetdisposal",
  // Insurance
  "insuranceclaim", "assetinsurance",
  // Calibration
  "calibrationhistory", "calibrationchecklistitem", "calibrationchecklisttemplate", "calibrationschedule",
  // Maintenance
  "maintenancehistory", "maintenanceschedule",
  // PM Checklists
  "pmchecklistresult", "pmchecklistrun", "pmchecklistitem", "pmchecklisttemplate",
  "preventivechecklistresult", "preventivechecklistrun", "preventivechecklistitem", "preventivechecklisttemplate",
  // Spare Parts Usage
  "sparepartusage",
  // Tickets + children
  "tickettransferhistory", "ticketstatushistory", "ticketassignmenthistory",
  "TicketEscalation",
  // RCA
  "rcafivewhy", "rcasixmitem", "rootcauseanalysis",
  // Work Orders
  "materialissue", "workcompletioncertificate", "workorder",
  // Material Requests
  "materialrequest",
  // Tickets (after all children)
  "ticket",
  // Service
  "servicevisit", "serviceinvoice", "servicecontract",
  // Warranty
  "warranty",
  // Transfers / Location / Gate Pass
  "assettransferhistory", "assetlocation", "gatepass",
  // Sub-assets / Inventory
  "subassetreplacement", "inventorytransaction",
  // Documents / Notifications
  "document",
  "notificationrecipient", "notification",
  // Finance vouchers
  "journalentryline", "journalentry",
  "financevoucherline", "financevoucher",
  "paymentvoucher", "purchasevoucher",
  // GRN / PO
  "goodsreceiptline", "goodsreceipt",
  "purchaseorderamendment", "purchaseorderline", "purchaseorder",
  // Export
  "exportbatchitem", "exportbatch",
  // Store transfers
  "storetransferitem", "storetransfer", "storestockposition",
  // Employee Exit Assets
  "employeeexitasset",
  // Decision Engine
  "decision_engine_log",
  // Asset Indent / SLA / Support
  "assetindent", "assetslamatrix", "assetsupportmatrix",
  // Asset Assignment
  "AssetAssignmentHistory", "AssetAssignment",
  // Asset Specification
  "AssetSpecification",
  // CAPEX Budget
  "capexbudget",
  // Asset Pools
  "assetpooladjustment", "assetpooldepreciationschedule", "assetpool",
  // ASSETS (main table — last)
  "asset",
];

export const resetAllAssets = async (_req: Request, res: Response) => {
  try {
    // Disable FK checks so order doesn't matter
    await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 0`);

    let cleared = 0;
    const skipped: string[] = [];

    for (const table of TABLES_TO_WIPE) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
        cleared++;
      } catch {
        // Table might not exist — skip
        skipped.push(table);
      }
    }

    // Re-enable FK checks
    await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1`);

    res.json({
      message: "All asset data deleted and auto-increment counters reset",
      tablesCleared: cleared,
      tablesSkipped: skipped.length,
      skipped,
      preserved: "Categories, departments, vendors, employees, branches, spare parts, stores, users, config tables",
    });
  } catch (err: any) {
    // Re-enable FK checks even on error
    try { await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1`); } catch {}
    console.error("resetAllAssets error:", err);
    res.status(500).json({ message: "Reset failed", error: err.message });
  }
};

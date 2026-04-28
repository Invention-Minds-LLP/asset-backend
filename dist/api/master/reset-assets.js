"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAllAssets = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
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
const resetAllAssets = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Disable FK checks so order doesn't matter
        yield prismaClient_1.default.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 0`);
        let cleared = 0;
        const skipped = [];
        for (const table of TABLES_TO_WIPE) {
            try {
                yield prismaClient_1.default.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
                cleared++;
            }
            catch (_a) {
                // Table might not exist — skip
                skipped.push(table);
            }
        }
        // Re-enable FK checks
        yield prismaClient_1.default.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1`);
        res.json({
            message: "All asset data deleted and auto-increment counters reset",
            tablesCleared: cleared,
            tablesSkipped: skipped.length,
            skipped,
            preserved: "Categories, departments, vendors, employees, branches, spare parts, stores, users, config tables",
        });
    }
    catch (err) {
        // Re-enable FK checks even on error
        try {
            yield prismaClient_1.default.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1`);
        }
        catch (_b) { }
        console.error("resetAllAssets error:", err);
        res.status(500).json({ message: "Reset failed", error: err.message });
    }
});
exports.resetAllAssets = resetAllAssets;

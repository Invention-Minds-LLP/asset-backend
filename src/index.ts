import "dotenv/config";          // load .env before anything else evaluates
import "./config/validateEnv";   // fail fast if a critical secret is missing
import express from "express";
import cookieParser from "cookie-parser";
import assetRoutes from "./api/assets/assets.routes";
import warrantyRoutes from "./api/warranty/warranty.routes";
import ticketRoutes from "./api/tickets/tickets.routes";
import assetCategoryRoutes from "./api/assetCategory/assetCategory.routes";
import assetSubTypeRoutes from "./api/asset-subtype/asset-subtype.routes";
import subTypeSupportRoutes from "./api/subtype-support/subtype-support.routes";
import departmentColumnRoutes from "./api/department-columns/department-columns.routes";
// import departmentDashboardRoutes from "./api/department-dashboard/department-dashboard.routes";
import hodDashboardRoutes from "./api/hod-dashboard/hod-dashboard.routes";
import departmentRoutes from "./api/department/department.routes";
import employeeRoutes from "./api/employee/employee.routes";
import vendorRoutes from "./api/vendor/vendor.routes";
import maintenanceHistoryRoutes from "./api/maintenanceHistory/maintenanceHistory.routes";
import userRoutes from "./api/user/user.routes";
import loginHistoryRoutes from "./api/loginHistory/loginHistory.routes";
import emailRoutes from "./api/email/email.routes";
import locationRoutes from "./api/location/location.routes";
import transferRoutes from "./api/transfer/transfer.routes";
import insuranceRoutes from "./api/insurance/insurance.routes";
import depreciationRoutes from "./api/depreciation/depreciation.routes";
import branchRoutes from "./api/branches/branches.routes";
import assetAssignRoutes from "./api/assetAssignment/assetAssignment.routes";
import subAssetRoutes from "./api/subAssets/subAssets.routes";
import serviceContractRoutes from "./api/serviceContract/serviceContract.routes";
import assetImportRoutes from "./api/asset-import/asset-import.routes";
import assetSlaRoutes from "./api/asset-sla/asset-sla.routes";
import assetInventory from "./api/inventory/inventory.routes";
import masterRoutes from "./api/master/master.routes";
import gatePassRoutes from "./api/gate-pass/gate-pass.routes";
import documentRoutes from "./api/documents/documents.routes";
import notificationRoutes from "./api/notifications/notifications.routes";
import calibrationRoutes from "./api/calibration/calibration.routes";
import supportMatrixRoutes from "./api/support-matrix/support-matrix.routes";
import escalationRoutes from "./api/escalation/escalation.routes";
import acknowledgementRoutes from "./api/acknowledgement/acknowledgement.routes";
import moduleAccessRoutes from "./api/module-access/module-access.routes";
import financialDashboardRoutes from "./api/financial-dashboard/financial-dashboard.routes";
import depreciationAuditRoutes from "./api/depreciation-audit/depreciation-audit.routes";
import depreciationAuditExternalRoutes from "./api/depreciation-audit/depreciation-audit.external.routes";
import auditTrailRoutes from "./api/audit-trail/audit-trail.routes";
import reportRoutes from "./api/reports/reports.routes";
import disposalRoutes from "./api/disposal/disposal.routes";
import eWasteRoutes from "./api/e-waste/e-waste.routes";
import assetAuditRoutes from "./api/asset-audit/asset-audit.routes";
import directorySyncRoutes from "./api/directory-sync/directory-sync.routes";
import externalAuditorRoutes from "./api/external-auditor/external-auditor.routes";
import externalAuditRoutes from "./api/external-audit/external-audit.routes";
import locationApprovalRoutes from "./api/location-approval/location-approval.routes";
import preventiveMaintenanceRoutes from "./api/preventive-maintenance/preventive-maintenance.routes";
import pmChecklistRoutes from "./api/pm-checklist/pm-checklist.routes";
import vendorPerformanceRoutes from "./api/vendor-performance/vendor-performance.routes";
import costAnalysisRoutes from "./api/cost-analysis/cost-analysis.routes";
import knowledgeBaseRoutes from "./api/knowledge-base/knowledge-base.routes";
import globalSearchRoutes from "./api/global-search/global-search.routes";
import quickActionRoutes from "./api/quick-actions/quick-actions.routes";
import cronJobRoutes from "./api/cron-jobs/cron-jobs.routes";
import assetIndentRoutes from "./api/asset-indent/asset-indent.routes";
import assetPoolRoutes from "./api/asset-pool/asset-pool.routes";
import employeeExitRoutes from "./api/employee-exit/employee-exit.routes";
import decisionEngineRoutes from "./api/decision-engine/decision-engine.routes";
import tenantConfigRoutes from "./api/tenant-config/tenant-config.routes";
import storeRoutes from "./api/store/store.routes";
import rcaRoutes from "./api/rca/rca.routes";
import purchaseOrderRoutes from "./api/purchase-order/purchase-order.routes";
import goodsReceiptRoutes from "./api/goods-receipt/goods-receipt.routes";
import workOrderRoutes from "./api/work-order/work-order.routes";
import storeTransferRoutes from "./api/store-transfer/store-transfer.routes";
import storeStockRoutes from "./api/store-stock/store-stock.routes";
import analyticsRoutes from "./api/analytics/analytics.routes";
import revenueLogRoutes from "./api/revenue-log/revenue-log.routes";
import hierarchyConfigRoutes from "./api/hierarchy-config/hierarchy-config.routes";
import materialRequestRoutes from "./api/material-request/material-request.routes";
import approvalConfigRoutes from "./api/approval-config/approval-config.routes";
import mobileAuthRoutes from "./api/mobile-auth/mobile-auth.routes";
import chartOfAccountsRoutes from "./api/accounts/chart-of-accounts/chart-of-accounts.routes";
import purchaseVouchersRoutes from "./api/accounts/purchase-vouchers/purchase-vouchers.routes";
import paymentVouchersRoutes from "./api/accounts/payment-vouchers/payment-vouchers.routes";
import journalEntriesRoutes from "./api/accounts/journal-entries/journal-entries.routes";
import accountsSummaryRoutes from "./api/accounts/accounts-summary/accounts-summary.routes";
import financeRoutes from "./api/finance/finance.routes";
import serviceInvoiceRoutes from "./api/service-invoices/service-invoices.routes";
import legacyMigrationRoutes from "./api/legacy-migration/legacy-migration.routes";
import reconciliationRoutes from "./api/reconciliation/reconciliation.routes";
import exportRoutes from "./api/export/export.routes";
import floorPlanRoutes from "./api/floor-plan/floor-plan.routes";
import assetScanRoutes from "./api/asset-scan/asset-scan.routes";
// ── Admin / Security registers (ported from physical register formats) ────────
import vehicleRegisterRoutes from "./api/vehicle-register/vehicle-register.routes";
import rentalAssetRegisterRoutes from "./api/rental-asset-register/rental-asset-register.routes";
import keyRegisterRoutes from "./api/key-register/key-register.routes";
import idCardRegisterRoutes from "./api/id-card-register/id-card-register.routes";
import gensetLogRoutes from "./api/genset-log/genset-log.routes";
import electricityLogRoutes from "./api/electricity-log/electricity-log.routes";
import materialInwardRegisterRoutes from "./api/material-inward-register/material-inward-register.routes";

import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { startScheduler } from "./scheduler";
import trialRoutes from "./api/trial/trial.routes";
import { trialGuard } from "./middleware/trialGuard";
import { softAuth, accessLogger } from "./middleware/accessLog";
import { UPLOADS_DIR } from "./lib/fileStorage";

const app = express();
// Honour X-Forwarded-Proto from the TLS-terminating reverse proxy so req.secure is
// correct for public HTTPS (auth cookies key their Secure/SameSite flags off it,
// which lets one backend serve both http://LAN and https://public clients).
//
// Trust exactly ONE hop — never `true`. `true` trusts any X-Forwarded-For, which
// lets a client spoof its IP and bypass the login rate limiter
// (express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY).
// Override with TRUST_PROXY (hop count like "1", or "loopback"/subnet) if the
// deployment has a different proxy depth.
const trustProxyEnv = process.env.TRUST_PROXY;
app.set(
  "trust proxy",
  trustProxyEnv === undefined ? 1 : (/^\d+$/.test(trustProxyEnv) ? Number(trustProxyEnv) : trustProxyEnv)
);
const port = 3001;

// Security headers (HSTS, X-Content-Type-Options, frameguard, etc.).
// crossOriginResourcePolicy is relaxed so the separate-origin SPA can still
// load image/document assets served from /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Middleware to parse JSON bodies
app.use(express.json());

// Parse cookies (refresh token + CSRF) for the web auth flow.
app.use(cookieParser());

// API access logging + suspicious-request detection. softAuth decodes a token if
// present (without rejecting) so the logger knows if a call was authenticated;
// accessLogger records each /api request to the apiaccesslog table on response
// finish and feeds flagged requests to the batched email alerter. Both no-op when
// ACCESS_LOG_ENABLED=false. Best-effort — never blocks or slows a request.
app.use(softAuth);
app.use(accessLogger);

// Serve uploaded files from the server's own disk. Everything written by
// src/lib/fileStorage.ts lands under UPLOADS_DIR and is exposed at
// /uploads/<folder>/<file>. In production nginx serves /uploads directly; this
// route is the in-process fallback (and what's used without nginx).
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d' }));

app.use(cors({
  origin: ["http://localhost:4200", "https://sademo.inventionminds.com", "http://192.168.14.36:4200", "https://smartassetsjmrh.imapps.in", 'http://localhost:8100', 'http://localhost',          // Capacitor Android
    'https://localhost',
    'capacitor://localhost',     // Capacitor iOS
  ], // Allow your Angular app
  credentials: true               // Optional: if you plan to send cookies
}));

// Throttle login attempts to slow brute-force / credential-stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts from this IP. Please try again in 15 minutes." },
});
app.use("/api/users/login", loginLimiter);

// Liveness probe. Deliberately mounted above the trial guard (and excluded from
// it) so the Cloud Scheduler keep-warm ping keeps succeeding on an expired demo —
// otherwise an ended trial would look like an outage.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Demo/trial control API — reachable even when the trial has lapsed, since this
// is how we extend or revoke it. Guarded by TRIAL_ADMIN_KEY, not the client's JWT.
app.use("/api/trial", trialRoutes);

// ── Demo trial checkpoint ────────────────────────────────────────────────────
// Sits in front of every remaining /api route so an expired or revoked demo
// freezes the entire application in one place. No-op unless TRIAL_ENABLED=true,
// so production and dev instances are completely unaffected.
app.use(trialGuard);

// NOTE: Module access is enforced on the FRONTEND only (sidebar + route guards).
// It governs UI navigation — which screens/menus a user can open. It must NOT gate
// the API, because screens legitimately reuse other modules' endpoints (e.g. the
// Store screen reads /api/assets), which made a URL-prefix→module guard produce
// false 403s. API authorization is per-route: authenticateToken + role/ownership
// scoping inside each controller. The old global `moduleAccessGuard` was removed
// for this reason. (The middleware file is retained should selective, per-route
// gating ever be wanted.)

// Mount routers
app.use("/api/assets", assetRoutes);
app.use("/api/warranties", warrantyRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/categories", assetCategoryRoutes);
app.use("/api/asset-subtypes", assetSubTypeRoutes);
app.use("/api/subtype-support", subTypeSupportRoutes);
app.use("/api/department-columns", departmentColumnRoutes);
// app.use("/api/department-dashboard", departmentDashboardRoutes);
app.use("/api/hod-dashboard", hodDashboardRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/maintenance-history", maintenanceHistoryRoutes);
app.use("/api/users", userRoutes);
app.use("/api/login-history", loginHistoryRoutes);
app.use("/api/email", emailRoutes);

app.use("/api/branches", branchRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/insurance", insuranceRoutes);
app.use("/api/depreciation", depreciationRoutes);
app.use("/api/assignments", assetAssignRoutes);
app.use("/api/sub-assets", subAssetRoutes);
app.use("/api/service-contracts", serviceContractRoutes);
app.use("/api/import", assetImportRoutes);
app.use("/api/sla", assetSlaRoutes);
app.use("/api/inventory", assetInventory);
app.use("/api/master", masterRoutes);
app.use("/api/gate-pass", gatePassRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/calibration", calibrationRoutes);
app.use("/api/support-matrix", supportMatrixRoutes);
app.use("/api/escalation", escalationRoutes);
app.use("/api/acknowledgement", acknowledgementRoutes);
app.use("/api/module-access", moduleAccessRoutes);
app.use("/api/financial-dashboard", financialDashboardRoutes);
app.use("/api/depreciation-audit", depreciationAuditRoutes);
app.use("/api/external/depreciation-audits", depreciationAuditExternalRoutes);
app.use("/api/audit-trail", auditTrailRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/disposal", disposalRoutes);
app.use("/api/e-waste", eWasteRoutes);
app.use("/api/asset-audit", assetAuditRoutes);
app.use("/api/directory-sync", directorySyncRoutes);
app.use("/api/external-auditors", externalAuditorRoutes);
app.use("/api/external-audit", externalAuditRoutes);
app.use("/api/location-approval", locationApprovalRoutes);
app.use("/api/preventive-maintenance", preventiveMaintenanceRoutes);
app.use("/api/pm-checklist", pmChecklistRoutes);
app.use("/api/vendor-performance", vendorPerformanceRoutes);
app.use("/api/cost-analysis", costAnalysisRoutes);
app.use("/api/knowledge-base", knowledgeBaseRoutes);
app.use("/api/global-search", globalSearchRoutes);
app.use("/api/quick-actions", quickActionRoutes);
app.use("/api/cron-jobs", cronJobRoutes);
app.use("/api/asset-indent", assetIndentRoutes);
app.use("/api/employee-exit", employeeExitRoutes);
app.use("/api/decision-engine", decisionEngineRoutes);
app.use("/api/tenant-config", tenantConfigRoutes);
app.use("/api/store", storeRoutes);
app.use("/api/rca", rcaRoutes);
app.use("/api/purchase-order", purchaseOrderRoutes);
app.use("/api/goods-receipt", goodsReceiptRoutes);
app.use("/api/work-order", workOrderRoutes);
app.use("/api/store-transfer", storeTransferRoutes);
app.use("/api/store-stock", storeStockRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/revenue-log", revenueLogRoutes);
app.use("/api/hierarchy-config", hierarchyConfigRoutes);
app.use("/api/material-request", materialRequestRoutes);
app.use("/api/approval-config", approvalConfigRoutes);
app.use("/api/mobile", mobileAuthRoutes);
app.use("/api/asset-pool", assetPoolRoutes);

// ── Accounts Module ─────────────────────────────────────────────────────────
app.use("/api/accounts/chart-of-accounts", chartOfAccountsRoutes);
app.use("/api/accounts/purchase-vouchers", purchaseVouchersRoutes);
app.use("/api/accounts/payment-vouchers", paymentVouchersRoutes);
app.use("/api/accounts/journal-entries", journalEntriesRoutes);
app.use("/api/accounts/summary", accountsSummaryRoutes);

// ── Finance Engine ───────────────────────────────────────────────────────────
app.use("/api/finance", financeRoutes);

// ── Service Invoices ─────────────────────────────────────────────────────────
app.use("/api/service-invoices", serviceInvoiceRoutes);

// ── Legacy Asset Migration ───────────────────────────────────────────────────
app.use("/api/legacy-migration", legacyMigrationRoutes);

// ── Reconciliation (Books vs Audit vs System) ────────────────────────────────
app.use("/api/reconciliation", reconciliationRoutes);

// ── Data Export Centre (Excel) ───────────────────────────────────────────────
app.use("/api/export", exportRoutes);

// ── Floor Plans (asset location pin map) ─────────────────────────────────────
app.use("/api/floor-plan", floorPlanRoutes);

// ── CCTV marker scan ingest (machine-to-machine, API-key auth) ───────────────
app.use("/api/asset-scan", assetScanRoutes);

// ── Admin / Security registers ───────────────────────────────────────────────
app.use("/api/vehicle-register", vehicleRegisterRoutes);
app.use("/api/rental-asset-register", rentalAssetRegisterRoutes);
app.use("/api/key-register", keyRegisterRoutes);
app.use("/api/id-card-register", idCardRegisterRoutes);
app.use("/api/genset-log", gensetLogRoutes);
app.use("/api/electricity-log", electricityLogRoutes);
app.use("/api/material-inward-register", materialInwardRegisterRoutes);

// Default route
app.get("/", (req, res) => {
  res.send("Asset Management API is running!");
});

// Error handler middleware (optional, but good practice)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);

  // A rejected upload is the caller's mistake, not a server fault, and the
  // reason has to reach them — "Internal Server Error" leaves someone retrying
  // the same .docx forever. Multer surfaces its own limits the same way.
  if (err?.status === 400 || err?.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ message: err.message, error: err.message });
    return;
  }

  res.status(500).json({ error: "Internal Server Error" });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
  // Kick off the in-process daily alert scheduler.
  startScheduler();
});

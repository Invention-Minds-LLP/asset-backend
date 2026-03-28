import express from "express";
import assetRoutes from "./api/assets/assets.routes";
import warrantyRoutes from "./api/warranty/warranty.routes";
import ticketRoutes from "./api/tickets/tickets.routes";
import assetCategoryRoutes from "./api/assetCategory/assetCategory.routes";
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
import auditTrailRoutes from "./api/audit-trail/audit-trail.routes";
import reportRoutes from "./api/reports/reports.routes";
import disposalRoutes from "./api/disposal/disposal.routes";
import assetAuditRoutes from "./api/asset-audit/asset-audit.routes";
import preventiveMaintenanceRoutes from "./api/preventive-maintenance/preventive-maintenance.routes";
import vendorPerformanceRoutes from "./api/vendor-performance/vendor-performance.routes";
import knowledgeBaseRoutes from "./api/knowledge-base/knowledge-base.routes";
import globalSearchRoutes from "./api/global-search/global-search.routes";
import quickActionRoutes from "./api/quick-actions/quick-actions.routes";
import cronJobRoutes from "./api/cron-jobs/cron-jobs.routes";

import cors from "cors";

const app = express();
const port = 3001;

// Middleware to parse JSON bodies
app.use(express.json());

app.use(cors({
  origin: ["http://localhost:4200", "https://sademo.inventionminds.com"], // Allow your Angular app
  credentials: true               // Optional: if you plan to send cookies
}));

// Mount routers
app.use("/api/assets", assetRoutes);
app.use("/api/warranties", warrantyRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/categories", assetCategoryRoutes);
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
app.use("/api/audit-trail", auditTrailRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/disposal", disposalRoutes);
app.use("/api/asset-audit", assetAuditRoutes);
app.use("/api/preventive-maintenance", preventiveMaintenanceRoutes);
app.use("/api/vendor-performance", vendorPerformanceRoutes);
app.use("/api/knowledge-base", knowledgeBaseRoutes);
app.use("/api/global-search", globalSearchRoutes);
app.use("/api/quick-actions", quickActionRoutes);
app.use("/api/cron-jobs", cronJobRoutes);

// Default route
app.get("/", (req, res) => {
  res.send("Asset Management API is running!");
});

// Error handler middleware (optional, but good practice)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

// Start the server
app.listen(port, '0.0.0.0',() => {
  console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
});

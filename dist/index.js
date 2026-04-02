"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const assets_routes_1 = __importDefault(require("./api/assets/assets.routes"));
const warranty_routes_1 = __importDefault(require("./api/warranty/warranty.routes"));
const tickets_routes_1 = __importDefault(require("./api/tickets/tickets.routes"));
const assetCategory_routes_1 = __importDefault(require("./api/assetCategory/assetCategory.routes"));
const department_routes_1 = __importDefault(require("./api/department/department.routes"));
const employee_routes_1 = __importDefault(require("./api/employee/employee.routes"));
const vendor_routes_1 = __importDefault(require("./api/vendor/vendor.routes"));
const maintenanceHistory_routes_1 = __importDefault(require("./api/maintenanceHistory/maintenanceHistory.routes"));
const user_routes_1 = __importDefault(require("./api/user/user.routes"));
const loginHistory_routes_1 = __importDefault(require("./api/loginHistory/loginHistory.routes"));
const email_routes_1 = __importDefault(require("./api/email/email.routes"));
const location_routes_1 = __importDefault(require("./api/location/location.routes"));
const transfer_routes_1 = __importDefault(require("./api/transfer/transfer.routes"));
const insurance_routes_1 = __importDefault(require("./api/insurance/insurance.routes"));
const depreciation_routes_1 = __importDefault(require("./api/depreciation/depreciation.routes"));
const branches_routes_1 = __importDefault(require("./api/branches/branches.routes"));
const assetAssignment_routes_1 = __importDefault(require("./api/assetAssignment/assetAssignment.routes"));
const subAssets_routes_1 = __importDefault(require("./api/subAssets/subAssets.routes"));
const serviceContract_routes_1 = __importDefault(require("./api/serviceContract/serviceContract.routes"));
const asset_import_routes_1 = __importDefault(require("./api/asset-import/asset-import.routes"));
const asset_sla_routes_1 = __importDefault(require("./api/asset-sla/asset-sla.routes"));
const inventory_routes_1 = __importDefault(require("./api/inventory/inventory.routes"));
const master_routes_1 = __importDefault(require("./api/master/master.routes"));
const gate_pass_routes_1 = __importDefault(require("./api/gate-pass/gate-pass.routes"));
const documents_routes_1 = __importDefault(require("./api/documents/documents.routes"));
const notifications_routes_1 = __importDefault(require("./api/notifications/notifications.routes"));
const calibration_routes_1 = __importDefault(require("./api/calibration/calibration.routes"));
const support_matrix_routes_1 = __importDefault(require("./api/support-matrix/support-matrix.routes"));
const escalation_routes_1 = __importDefault(require("./api/escalation/escalation.routes"));
const acknowledgement_routes_1 = __importDefault(require("./api/acknowledgement/acknowledgement.routes"));
const module_access_routes_1 = __importDefault(require("./api/module-access/module-access.routes"));
const financial_dashboard_routes_1 = __importDefault(require("./api/financial-dashboard/financial-dashboard.routes"));
const audit_trail_routes_1 = __importDefault(require("./api/audit-trail/audit-trail.routes"));
const reports_routes_1 = __importDefault(require("./api/reports/reports.routes"));
const disposal_routes_1 = __importDefault(require("./api/disposal/disposal.routes"));
const asset_audit_routes_1 = __importDefault(require("./api/asset-audit/asset-audit.routes"));
const preventive_maintenance_routes_1 = __importDefault(require("./api/preventive-maintenance/preventive-maintenance.routes"));
const vendor_performance_routes_1 = __importDefault(require("./api/vendor-performance/vendor-performance.routes"));
const cost_analysis_routes_1 = __importDefault(require("./api/cost-analysis/cost-analysis.routes"));
const knowledge_base_routes_1 = __importDefault(require("./api/knowledge-base/knowledge-base.routes"));
const global_search_routes_1 = __importDefault(require("./api/global-search/global-search.routes"));
const quick_actions_routes_1 = __importDefault(require("./api/quick-actions/quick-actions.routes"));
const cron_jobs_routes_1 = __importDefault(require("./api/cron-jobs/cron-jobs.routes"));
const asset_indent_routes_1 = __importDefault(require("./api/asset-indent/asset-indent.routes"));
const employee_exit_routes_1 = __importDefault(require("./api/employee-exit/employee-exit.routes"));
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
const port = 3001;
// Middleware to parse JSON bodies
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: ["http://localhost:4200", "https://sademo.inventionminds.com"], // Allow your Angular app
    credentials: true // Optional: if you plan to send cookies
}));
// Mount routers
app.use("/api/assets", assets_routes_1.default);
app.use("/api/warranties", warranty_routes_1.default);
app.use("/api/tickets", tickets_routes_1.default);
app.use("/api/categories", assetCategory_routes_1.default);
app.use("/api/departments", department_routes_1.default);
app.use("/api/employees", employee_routes_1.default);
app.use("/api/vendors", vendor_routes_1.default);
app.use("/api/maintenance-history", maintenanceHistory_routes_1.default);
app.use("/api/users", user_routes_1.default);
app.use("/api/login-history", loginHistory_routes_1.default);
app.use("/api/email", email_routes_1.default);
app.use("/api/branches", branches_routes_1.default);
app.use("/api/location", location_routes_1.default);
app.use("/api/transfers", transfer_routes_1.default);
app.use("/api/insurance", insurance_routes_1.default);
app.use("/api/depreciation", depreciation_routes_1.default);
app.use("/api/assignments", assetAssignment_routes_1.default);
app.use("/api/sub-assets", subAssets_routes_1.default);
app.use("/api/service-contracts", serviceContract_routes_1.default);
app.use("/api/import", asset_import_routes_1.default);
app.use("/api/sla", asset_sla_routes_1.default);
app.use("/api/inventory", inventory_routes_1.default);
app.use("/api/master", master_routes_1.default);
app.use("/api/gate-pass", gate_pass_routes_1.default);
app.use("/api/documents", documents_routes_1.default);
app.use("/api/notifications", notifications_routes_1.default);
app.use("/api/calibration", calibration_routes_1.default);
app.use("/api/support-matrix", support_matrix_routes_1.default);
app.use("/api/escalation", escalation_routes_1.default);
app.use("/api/acknowledgement", acknowledgement_routes_1.default);
app.use("/api/module-access", module_access_routes_1.default);
app.use("/api/financial-dashboard", financial_dashboard_routes_1.default);
app.use("/api/audit-trail", audit_trail_routes_1.default);
app.use("/api/reports", reports_routes_1.default);
app.use("/api/disposal", disposal_routes_1.default);
app.use("/api/asset-audit", asset_audit_routes_1.default);
app.use("/api/preventive-maintenance", preventive_maintenance_routes_1.default);
app.use("/api/vendor-performance", vendor_performance_routes_1.default);
app.use("/api/cost-analysis", cost_analysis_routes_1.default);
app.use("/api/knowledge-base", knowledge_base_routes_1.default);
app.use("/api/global-search", global_search_routes_1.default);
app.use("/api/quick-actions", quick_actions_routes_1.default);
app.use("/api/cron-jobs", cron_jobs_routes_1.default);
app.use("/api/asset-indent", asset_indent_routes_1.default);
app.use("/api/employee-exit", employee_exit_routes_1.default);
// Default route
app.get("/", (req, res) => {
    res.send("Asset Management API is running!");
});
// Error handler middleware (optional, but good practice)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error" });
});
// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
});

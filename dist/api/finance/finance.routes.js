"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const finance_config_controller_1 = require("./finance-config.controller");
const gl_mapping_controller_1 = require("./gl-mapping.controller");
const finance_voucher_controller_1 = require("./finance-voucher.controller");
const trial_balance_controller_1 = require("./trial-balance.controller");
const capex_budget_controller_1 = require("./capex-budget.controller");
const export_centre_controller_1 = require("./export-centre.controller");
const manual_ledger_controller_1 = require("./manual-ledger.controller");
const router = (0, express_1.Router)();
// Finance Config
router.get("/config", authMiddleware_1.authenticateToken, finance_config_controller_1.getFinanceConfig);
router.put("/config", authMiddleware_1.authenticateToken, finance_config_controller_1.updateFinanceConfig);
// GL Mappings
router.get("/gl-mappings", authMiddleware_1.authenticateToken, gl_mapping_controller_1.getGLMappings);
router.get("/gl-mappings/:categoryId", authMiddleware_1.authenticateToken, gl_mapping_controller_1.getGLMappingByCategory);
router.put("/gl-mappings/:categoryId", authMiddleware_1.authenticateToken, gl_mapping_controller_1.upsertGLMapping);
// Finance Vouchers
router.get("/vouchers", authMiddleware_1.authenticateToken, finance_voucher_controller_1.listVouchers);
router.get("/vouchers/:id", authMiddleware_1.authenticateToken, finance_voucher_controller_1.getVoucher);
router.post("/vouchers", authMiddleware_1.authenticateToken, finance_voucher_controller_1.createVoucher);
router.post("/vouchers/:id/approve", authMiddleware_1.authenticateToken, finance_voucher_controller_1.approveVoucher);
router.post("/vouchers/:id/reject", authMiddleware_1.authenticateToken, finance_voucher_controller_1.rejectVoucher);
router.post("/vouchers/:id/void", authMiddleware_1.authenticateToken, finance_voucher_controller_1.voidVoucher);
// Ledger / Reporting
router.get("/trial-balance", authMiddleware_1.authenticateToken, trial_balance_controller_1.getTrialBalance);
router.get("/asset-cost-ledger/:assetId", authMiddleware_1.authenticateToken, trial_balance_controller_1.getAssetCostLedger);
router.get("/department-cost-summary", authMiddleware_1.authenticateToken, trial_balance_controller_1.getDepartmentCostSummary);
// Capex Budgets
router.get("/capex-budgets", authMiddleware_1.authenticateToken, capex_budget_controller_1.listCapexBudgets);
router.post("/capex-budgets", authMiddleware_1.authenticateToken, capex_budget_controller_1.createCapexBudget);
router.put("/capex-budgets/:id", authMiddleware_1.authenticateToken, capex_budget_controller_1.updateCapexBudget);
router.post("/capex-budgets/refresh-actuals", authMiddleware_1.authenticateToken, capex_budget_controller_1.refreshCapexActuals);
// Export Centre
router.get("/export-batches", authMiddleware_1.authenticateToken, export_centre_controller_1.listExportBatches);
router.post("/export-batches", authMiddleware_1.authenticateToken, export_centre_controller_1.createExportBatch);
router.get("/export-batches/:id/download", authMiddleware_1.authenticateToken, export_centre_controller_1.downloadExportBatch);
// Chart of Accounts (for dropdowns + external code mapping)
router.get("/chart-of-accounts", authMiddleware_1.authenticateToken, export_centre_controller_1.getChartOfAccounts);
router.put("/chart-of-accounts/:id/external-codes", authMiddleware_1.authenticateToken, export_centre_controller_1.updateExternalCodes);
// Manual Ledger
router.get("/manual-ledger", authMiddleware_1.authenticateToken, manual_ledger_controller_1.listManualLedger);
router.post("/manual-ledger", authMiddleware_1.authenticateToken, manual_ledger_controller_1.createManualLedger);
router.delete("/manual-ledger/:id", authMiddleware_1.authenticateToken, manual_ledger_controller_1.deleteManualLedger);
exports.default = router;

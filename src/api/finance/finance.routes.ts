import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { getFinanceConfig, updateFinanceConfig } from "./finance-config.controller";
import { getGLMappings, getGLMappingByCategory, upsertGLMapping } from "./gl-mapping.controller";
import { listVouchers, getVoucher, createVoucher, approveVoucher, rejectVoucher, voidVoucher } from "./finance-voucher.controller";
import { getTrialBalance, getAssetCostLedger, getDepartmentCostSummary } from "./trial-balance.controller";
import { listCapexBudgets, createCapexBudget, updateCapexBudget, refreshCapexActuals } from "./capex-budget.controller";
import { listExportBatches, createExportBatch, downloadExportBatch, getChartOfAccounts, updateExternalCodes } from "./export-centre.controller";
import { listManualLedger, createManualLedger, deleteManualLedger } from "./manual-ledger.controller";

const router = Router();

// Finance Config
router.get("/config", authenticateToken, getFinanceConfig as any);
router.put("/config", authenticateToken, updateFinanceConfig as any);

// GL Mappings
router.get("/gl-mappings", authenticateToken, getGLMappings as any);
router.get("/gl-mappings/:categoryId", authenticateToken, getGLMappingByCategory as any);
router.put("/gl-mappings/:categoryId", authenticateToken, upsertGLMapping as any);

// Finance Vouchers
router.get("/vouchers", authenticateToken, listVouchers as any);
router.get("/vouchers/:id", authenticateToken, getVoucher as any);
router.post("/vouchers", authenticateToken, createVoucher as any);
router.post("/vouchers/:id/approve", authenticateToken, approveVoucher as any);
router.post("/vouchers/:id/reject", authenticateToken, rejectVoucher as any);
router.post("/vouchers/:id/void", authenticateToken, voidVoucher as any);

// Ledger / Reporting
router.get("/trial-balance", authenticateToken, getTrialBalance as any);
router.get("/asset-cost-ledger/:assetId", authenticateToken, getAssetCostLedger as any);
router.get("/department-cost-summary", authenticateToken, getDepartmentCostSummary as any);

// Capex Budgets
router.get("/capex-budgets", authenticateToken, listCapexBudgets as any);
router.post("/capex-budgets", authenticateToken, createCapexBudget as any);
router.put("/capex-budgets/:id", authenticateToken, updateCapexBudget as any);
router.post("/capex-budgets/refresh-actuals", authenticateToken, refreshCapexActuals as any);

// Export Centre
router.get("/export-batches", authenticateToken, listExportBatches as any);
router.post("/export-batches", authenticateToken, createExportBatch as any);
router.get("/export-batches/:id/download", authenticateToken, downloadExportBatch as any);

// Chart of Accounts (for dropdowns + external code mapping)
router.get("/chart-of-accounts", authenticateToken, getChartOfAccounts as any);
router.put("/chart-of-accounts/:id/external-codes", authenticateToken, updateExternalCodes as any);

// Manual Ledger
router.get("/manual-ledger", authenticateToken, listManualLedger as any);
router.post("/manual-ledger", authenticateToken, createManualLedger as any);
router.delete("/manual-ledger/:id", authenticateToken, deleteManualLedger as any);

export default router;

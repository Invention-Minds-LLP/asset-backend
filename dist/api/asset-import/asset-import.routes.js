"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const asset_import_controller_1 = require("./asset-import.controller");
const sub_asset_import_controller_1 = require("./sub-asset-import.controller");
const location_import_controller_1 = require("./location-import.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const excelImportHelpers_1 = require("../../utilis/excelImportHelpers");
const router = (0, express_1.Router)();
router.post('/import-excel', excelImportHelpers_1.excelUpload.single('file'), excelImportHelpers_1.handleUploadError, asset_import_controller_1.importAssetsExcel);
router.post('/checklists/import-workbook', excelImportHelpers_1.excelUpload.single('file'), excelImportHelpers_1.handleUploadError, asset_import_controller_1.importChecklistWorkbook);
router.get('/legacy-template', authMiddleware_1.authenticateToken, asset_import_controller_1.downloadLegacyTemplate);
router.get('/checklists/template', authMiddleware_1.authenticateToken, asset_import_controller_1.downloadChecklistTemplate);
// ── Sub-asset bulk import ──
router.get('/sub-assets-template', authMiddleware_1.authenticateToken, sub_asset_import_controller_1.downloadSubAssetTemplate);
router.post('/sub-assets-excel', excelImportHelpers_1.excelUpload.single('file'), excelImportHelpers_1.handleUploadError, sub_asset_import_controller_1.importSubAssetsExcel);
// ── Asset location bulk import (asset-wise) ──
router.get('/locations-template', authMiddleware_1.authenticateToken, location_import_controller_1.downloadLocationTemplate);
router.post('/locations-excel', excelImportHelpers_1.excelUpload.single('file'), excelImportHelpers_1.handleUploadError, location_import_controller_1.importLocationsExcel);
exports.default = router;

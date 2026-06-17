import { Router } from 'express';
import { importAssetsExcel, importChecklistWorkbook, downloadLegacyTemplate, downloadChecklistTemplate } from "./asset-import.controller";
import { downloadSubAssetTemplate, importSubAssetsExcel } from "./sub-asset-import.controller";
import { downloadLocationTemplate, importLocationsExcel } from "./location-import.controller";
import { downloadDepartmentTemplate, importDepartmentsExcel } from "./department-import.controller";
import { authenticateToken } from '../../middleware/authMiddleware';
import { excelUpload, handleUploadError } from "../../utilis/excelImportHelpers";

const router = Router();

router.post('/import-excel', excelUpload.single('file'), handleUploadError, importAssetsExcel);
router.post('/checklists/import-workbook', excelUpload.single('file'), handleUploadError, importChecklistWorkbook);
router.get('/legacy-template', authenticateToken, downloadLegacyTemplate);
router.get('/checklists/template', authenticateToken, downloadChecklistTemplate);

// ── Sub-asset bulk import ──
router.get('/sub-assets-template', authenticateToken, downloadSubAssetTemplate);
router.post('/sub-assets-excel', excelUpload.single('file'), handleUploadError, importSubAssetsExcel);

// ── Asset location bulk import (asset-wise) ──
router.get('/locations-template', authenticateToken, downloadLocationTemplate);
router.post('/locations-excel', excelUpload.single('file'), handleUploadError, importLocationsExcel);

// ── Asset department & assignment bulk import (asset-wise) ──
router.get('/departments-template', authenticateToken, downloadDepartmentTemplate);
router.post('/departments-excel', excelUpload.single('file'), handleUploadError, importDepartmentsExcel);

export default router;
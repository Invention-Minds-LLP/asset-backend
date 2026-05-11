import { Router } from 'express';
import { importAssetsExcel, importChecklistWorkbook, downloadLegacyTemplate, downloadChecklistTemplate } from "./asset-import.controller";
import { authenticateToken } from '../../middleware/authMiddleware';
import { excelUpload, handleUploadError } from "../../utilis/excelImportHelpers";

const router = Router();

router.post('/import-excel', excelUpload.single('file'), handleUploadError, importAssetsExcel);
router.post('/checklists/import-workbook', excelUpload.single('file'), handleUploadError, importChecklistWorkbook);
router.get('/legacy-template', authenticateToken, downloadLegacyTemplate);
router.get('/checklists/template', authenticateToken, downloadChecklistTemplate);

export default router;
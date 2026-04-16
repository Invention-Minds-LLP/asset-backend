import { Router } from 'express';
import multer from 'multer';
import { importAssetsExcel, importChecklistWorkbook, downloadLegacyTemplate } from "./asset-import.controller";
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/import-excel', upload.single('file'), importAssetsExcel);
router.post('/checklists/import-workbook', upload.single('file'), importChecklistWorkbook);
router.get('/legacy-template', authenticateToken, downloadLegacyTemplate);

export default router;
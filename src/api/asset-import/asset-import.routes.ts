import { Router } from 'express';
import multer from 'multer';
import { importAssetsExcel, importChecklistWorkbook } from "./asset-import.controller";

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/import-excel', upload.single('file'), importAssetsExcel);
router.post('/checklists/import-workbook', upload.single('file'), importChecklistWorkbook);

export default router;
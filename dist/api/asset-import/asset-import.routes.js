"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const asset_import_controller_1 = require("./asset-import.controller");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: 'uploads/' });
router.post('/import-excel', upload.single('file'), asset_import_controller_1.importAssetsExcel);
router.post('/checklists/import-workbook', upload.single('file'), asset_import_controller_1.importChecklistWorkbook);
exports.default = router;

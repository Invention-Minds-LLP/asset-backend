"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadLegacyTemplate = void 0;
exports.importAssetsExcel = importAssetsExcel;
exports.importChecklistWorkbook = importChecklistWorkbook;
const fs_1 = __importDefault(require("fs"));
const xlsx_1 = __importDefault(require("xlsx"));
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const assetIdGenerator_1 = require("../../utilis/assetIdGenerator");
const depreciationEngine_1 = require("../../utilis/depreciationEngine");
function parseDate(value) {
    if (value === null || value === undefined || value === '')
        return null;
    if (value instanceof Date)
        return value;
    if (typeof value === 'number') {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(excelEpoch.getTime() + value * 86400000);
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
function toBool(value) {
    if (value === true || value === false)
        return value;
    if (value == null || value === '')
        return null;
    const v = String(value).trim().toLowerCase();
    if (['yes', 'true', '1', 'y'].includes(v))
        return true;
    if (['no', 'false', '0', 'n'].includes(v))
        return false;
    return null;
}
function toNumber(value) {
    if (value == null || value === '')
        return null;
    const n = Number(value);
    return isNaN(n) ? null : n;
}
function toStringOrNull(value) {
    if (value == null || value === '')
        return null;
    return String(value).trim();
}
function getFinancialYearParts(date = new Date()) {
    const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    const nextYear = year + 1;
    const fyStart = String(year).slice(-2);
    const fyEnd = String(nextYear).slice(-2);
    return { fyStart, fyEnd };
}
function createAssetWithGeneratedId(assetData) {
    return __awaiter(this, void 0, void 0, function* () {
        const assetId = assetData.isLegacyAsset
            ? yield (0, assetIdGenerator_1.generateLegacyAssetId)(assetData.purchaseDate, undefined, assetData.assetCategoryId)
            : yield (0, assetIdGenerator_1.generateAssetId)(assetData.modeOfProcurement || "PURCHASE", undefined, { categoryId: assetData.assetCategoryId, purchaseDate: assetData.purchaseDate });
        return yield prismaClient_1.default.asset.create({ data: Object.assign({ assetId }, assetData) });
    });
}
function getOrCreateVendor(row) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!row.vendorName)
            return null;
        const vendor = yield prismaClient_1.default.vendor.upsert({
            where: { name: String(row.vendorName).trim() },
            update: {
                contact: String(row.vendorContact || ''),
                email: toStringOrNull(row.vendorEmail),
                contactPerson: toStringOrNull(row.contactPerson),
                alternatePhone: toStringOrNull(row.alternatePhone),
                notes: toStringOrNull(row.vendorNotes),
            },
            create: {
                name: String(row.vendorName).trim(),
                contact: String(row.vendorContact || ''),
                email: toStringOrNull(row.vendorEmail),
                contactPerson: toStringOrNull(row.contactPerson),
                alternatePhone: toStringOrNull(row.alternatePhone),
                notes: toStringOrNull(row.vendorNotes),
            }
        });
        return vendor.id;
    });
}
function getOrCreateDepartment(name) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!name)
            return null;
        const dept = yield prismaClient_1.default.department.upsert({
            where: { name: String(name).trim() },
            update: {},
            create: { name: String(name).trim() }
        });
        return dept.id;
    });
}
function getOrCreateBranch(name) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!name)
            return null;
        const branch = yield prismaClient_1.default.branch.upsert({
            where: { name: String(name).trim() },
            update: {},
            create: { name: String(name).trim() }
        });
        return branch.id;
    });
}
function getEmployeeIdByCode(employeeCode) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!employeeCode)
            return null;
        const emp = yield prismaClient_1.default.employee.findUnique({
            where: { employeeID: String(employeeCode).trim() }
        });
        return (_a = emp === null || emp === void 0 ? void 0 : emp.id) !== null && _a !== void 0 ? _a : null;
    });
}
function findAssetByReferenceCode(referenceCode) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!referenceCode)
            return null;
        return prismaClient_1.default.asset.findUnique({
            where: { referenceCode: String(referenceCode).trim() }
        });
    });
}
function findAssetByReferenceOrSerial(referenceCode, serialNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        let asset = null;
        if (referenceCode) {
            asset = yield prismaClient_1.default.asset.findUnique({
                where: { referenceCode: String(referenceCode).trim() }
            });
        }
        if (!asset && serialNumber) {
            asset = yield prismaClient_1.default.asset.findUnique({
                where: { serialNumber: String(serialNumber).trim() }
            });
        }
        return asset;
    });
}
function importAssetsExcel(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: 'Excel file is required' });
            return;
        }
        const summary = {
            // assetCategoriesUpserted: 0,
            // vendorsUpserted: 0,
            // departmentsUpserted: 0,
            // branchesUpserted: 0,
            employeesUpserted: 0,
            assetsCreated: 0,
            assetsUpdated: 0,
            specificationsCreated: 0,
            specificationsUpdated: 0,
            warrantiesUpserted: 0,
            contractsCreated: 0,
            locationsCreated: 0,
            subAssetsCreated: 0,
            subAssetsUpdated: 0,
            maintenanceSchedulesCreated: 0,
            calibrationSchedulesCreated: 0,
            errors: [],
        };
        try {
            const workbook = xlsx_1.default.readFile(file.path);
            const readSheet = (name) => workbook.Sheets[name]
                ? xlsx_1.default.utils.sheet_to_json(workbook.Sheets[name], { defval: '' })
                : [];
            // const categoryRows = readSheet('asset_categories');
            // const vendorRows = readSheet('vendors');
            // const departmentRows = readSheet('departments');
            // const branchRows = readSheet('branch');
            const employeeRows = readSheet('employee');
            const assetsRows = readSheet('Assets');
            const specsRows = readSheet('Specifications');
            const warrantyRows = readSheet('Warranty');
            const contractsRows = readSheet('ServiceContracts');
            const locationsRows = readSheet('Locations');
            const subAssetsRows = readSheet('SubAssets');
            const maintenanceRows = readSheet('MaintenanceSchedules');
            const calibrationRows = readSheet('CalibrationSchedules');
            // ---------------------------
            // 0.1 ASSET CATEGORIES
            // ---------------------------
            // for (let i = 0; i < categoryRows.length; i++) {
            //     const row = categoryRows[i];
            //     try {
            //         if (!row.name) continue;
            //         await prisma.assetCategory.upsert({
            //             where: { name: String(row.name).trim() },
            //             update: {},
            //             create: {
            //                 name: String(row.name).trim()
            //             }
            //         });
            //         summary.assetCategoriesUpserted++;
            //     } catch (err: any) {
            //         summary.errors.push({
            //             sheet: 'asset_categories',
            //             row: i + 2,
            //             message: err.message
            //         });
            //     }
            // }
            // // ---------------------------
            // // 0.2 VENDORS
            // // ---------------------------
            // for (let i = 0; i < vendorRows.length; i++) {
            //     const row = vendorRows[i];
            //     try {
            //         if (!row.name) continue;
            //         await prisma.vendor.upsert({
            //             where: { name: String(row.name).trim() },
            //             update: {
            //                 contact: String(row.contact || ''),
            //                 email: toStringOrNull(row.email),
            //                 contactPerson: toStringOrNull(row.contactPerson),
            //                 alternatePhone: toStringOrNull(row.alternatePhone),
            //                 notes: toStringOrNull(row.notes),
            //             },
            //             create: {
            //                 name: String(row.name).trim(),
            //                 contact: String(row.contact || ''),
            //                 email: toStringOrNull(row.email),
            //                 contactPerson: toStringOrNull(row.contactPerson),
            //                 alternatePhone: toStringOrNull(row.alternatePhone),
            //                 notes: toStringOrNull(row.notes),
            //             }
            //         });
            //         summary.vendorsUpserted++;
            //     } catch (err: any) {
            //         summary.errors.push({
            //             sheet: 'vendors',
            //             row: i + 2,
            //             message: err.message
            //         });
            //     }
            // }
            // // ---------------------------
            // // 0.3 DEPARTMENTS
            // // ---------------------------
            // for (let i = 0; i < departmentRows.length; i++) {
            //     const row = departmentRows[i];
            //     try {
            //         if (!row.name) continue;
            //         await prisma.department.upsert({
            //             where: { name: String(row.name).trim() },
            //             update: {},
            //             create: {
            //                 name: String(row.name).trim()
            //             }
            //         });
            //         summary.departmentsUpserted++;
            //     } catch (err: any) {
            //         summary.errors.push({
            //             sheet: 'departments',
            //             row: i + 2,
            //             message: err.message
            //         });
            //     }
            // }
            // // ---------------------------
            // // 0.4 BRANCH
            // // ---------------------------
            // for (let i = 0; i < branchRows.length; i++) {
            //     const row = branchRows[i];
            //     try {
            //         if (!row.name) continue;
            //         await prisma.branch.upsert({
            //             where: { name: String(row.name).trim() },
            //             update: {},
            //             create: {
            //                 name: String(row.name).trim()
            //             }
            //         });
            //         summary.branchesUpserted++;
            //     } catch (err: any) {
            //         summary.errors.push({
            //             sheet: 'branch',
            //             row: i + 2,
            //             message: err.message
            //         });
            //     }
            // }
            // ---------------------------
            // 0.5 EMPLOYEE
            // ---------------------------
            for (let i = 0; i < employeeRows.length; i++) {
                const row = employeeRows[i];
                try {
                    if (!row.employeeID || !row.name)
                        continue;
                    let departmentId = null;
                    if (row.departmentName) {
                        const dept = yield prismaClient_1.default.department.upsert({
                            where: { name: String(row.departmentName).trim() },
                            update: {},
                            create: { name: String(row.departmentName).trim() }
                        });
                        departmentId = dept.id;
                    }
                    const role = toStringOrNull(row.role) || 'EXECUTIVE';
                    yield prismaClient_1.default.employee.upsert({
                        where: { employeeID: String(row.employeeID).trim() },
                        update: {
                            name: String(row.name).trim(),
                            departmentId,
                            role: role
                        },
                        create: {
                            employeeID: String(row.employeeID).trim(),
                            name: String(row.name).trim(),
                            departmentId,
                            role: role
                        }
                    });
                    summary.employeesUpserted++;
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'employee',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 1. ASSETS
            // ---------------------------
            // for (let i = 0; i < assetsRows.length; i++) {
            //     const row = assetsRows[i];
            //     try {
            //         if (!row.referenceCode || !row.assetName || !row.assetType || !row.assetCategory) {
            //             summary.errors.push({
            //                 sheet: 'Assets',
            //                 row: i + 2,
            //                 message: 'referenceCode, assetName, assetType, assetCategory are required'
            //             });
            //             continue;
            //         }
            //         const category = await prisma.assetCategory.upsert({
            //             where: { name: String(row.assetCategory).trim() },
            //             update: {},
            //             create: { name: String(row.assetCategory).trim() }
            //         });
            //         const vendorId = await getOrCreateVendor(row);
            //         const departmentId = await getOrCreateDepartment(row.department);
            //         const targetDepartmentId = await getOrCreateDepartment(row.targetDepartment);
            //         const allottedToId = await getEmployeeIdByCode(row.endUserEmployeeCode);
            //         const supervisorId = await getEmployeeIdByCode(row.supervisorEmployeeCode);
            //         const existing = await findAssetByReferenceOrSerial(row.referenceCode, row.serialNumber);
            //         const assetData = {
            //             assetName: String(row.assetName).trim(),
            //             assetType: String(row.assetType).trim(),
            //             assetCategoryId: category.id,
            //             serialNumber: String(row.serialNumber || row.referenceCode).trim(),
            //             referenceCode: String(row.referenceCode).trim(),
            //             purchaseDate: parseDate(row.purchaseDate),
            //             modeOfProcurement: String(row.modeOfProcurement || 'PURCHASE'),
            //             referenceCodeClient: undefined,
            //             isBranded: toBool(row.isBranded) ?? false,
            //             isAssembled: toBool(row.isAssembled) ?? false,
            //             isCustomized: toBool(row.isCustomized) ?? false,
            //             customDetails: toStringOrNull(row.customDetails),
            //             hasSpecifications: toBool(row.hasSpecifications) ?? false,
            //             installedAt: parseDate(row.installedAt),
            //             invoiceNumber: toStringOrNull(row.invoiceNumber),
            //             purchaseOrderNo: toStringOrNull(row.purchaseOrderNo),
            //             purchaseOrderDate: parseDate(row.purchaseOrderDate),
            //             deliveryDate: parseDate(row.deliveryDate),
            //             purchaseCost: row.purchaseCost ? String(row.purchaseCost) : null,
            //             donorName: toStringOrNull(row.donorName),
            //             donationDate: parseDate(row.donationDate),
            //             assetCondition: toStringOrNull(row.assetCondition),
            //             estimatedValue: row.estimatedValue ? String(row.estimatedValue) : null,
            //             donationDocument: toStringOrNull(row.donationDocument),
            //             leaseStartDate: parseDate(row.leaseStartDate),
            //             leaseEndDate: parseDate(row.leaseEndDate),
            //             leaseAmount: row.leaseAmount ? String(row.leaseAmount) : null,
            //             leaseRenewalDate: parseDate(row.leaseRenewalDate),
            //             leaseContractDoc: toStringOrNull(row.leaseContractDoc),
            //             rentalStartDate: parseDate(row.rentalStartDate),
            //             rentalEndDate: parseDate(row.rentalEndDate),
            //             rentalAmount: row.rentalAmount ? String(row.rentalAmount) : null,
            //             rentalAgreementDoc: toStringOrNull(row.rentalAgreementDoc),
            //             vendorId,
            //             departmentId,
            //             targetDepartmentId,
            //             supervisorId,
            //             allottedToId,
            //             currentLocation: toStringOrNull(row.currentLocation),
            //             fromLocation: toStringOrNull(row.fromLocation),
            //             toLocation: toStringOrNull(row.toLocation),
            //             status: String(row.status || 'ACTIVE'),
            //             assetPhoto: toStringOrNull(row.assetPhoto),
            //             criticalityLevel: toStringOrNull(row.criticalityLevel),
            //             riskClass: toStringOrNull(row.riskClass),
            //             workingCondition: toStringOrNull(row.workingCondition),
            //             healthScore: toNumber(row.healthScore),
            //             lastInspectionDate: parseDate(row.lastInspectionDate),
            //             slaExpectedValue: toNumber(row.slaExpectedValue),
            //             slaExpectedUnit: toStringOrNull(row.slaExpectedUnit),
            //             slaNextDueAt: parseDate(row.slaNextDueAt),
            //             slaBreached: toBool(row.slaBreached),
            //             lastSlaServiceDate: parseDate(row.lastSlaServiceDate),
            //             retiredDate: parseDate(row.retiredDate),
            //             retiredReason: toStringOrNull(row.retiredReason),
            //             expectedLifetime: toNumber(row.expectedLifetime),
            //             expectedLifetimeUnit: toStringOrNull(row.expectedLifetimeUnit),
            //             retiredBy: toStringOrNull(row.retiredBy),
            //             grnNumber: toStringOrNull(row.grnNumber),
            //             grnDate: parseDate(row.grnDate),
            //             grnValue: row.grnValue ? String(row.grnValue) : null,
            //             inspectionStatus: toStringOrNull(row.inspectionStatus),
            //             inspectionRemarks: toStringOrNull(row.inspectionRemarks),
            //             rfidCode: toStringOrNull(row.rfidCode),
            //             qrCode: toStringOrNull(row.qrCode),
            //             specificationSummary: toStringOrNull(row.specificationSummary),
            //             organogramNotes: toStringOrNull(row.organogramNotes),
            //             ticketHierarchyNotes: toStringOrNull(row.ticketHierarchyNotes),
            //             pmFormatNotes: toStringOrNull(row.pmFormatNotes),
            //         };
            //         delete (assetData as any).referenceCodeClient;
            //         if (existing) {
            //             await prisma.asset.update({
            //                 where: { id: existing.id },
            //                 data: assetData
            //             });
            //             summary.assetsUpdated++;
            //         } else {
            //             await createAssetWithGeneratedId(assetData);
            //             summary.assetsCreated++;
            //         }
            //     } catch (err: any) {
            //         summary.errors.push({
            //             sheet: 'Assets',
            //             row: i + 2,
            //             message: err.message
            //         });
            //     }
            // }
            // ---------------------------
            // 1. ASSETS
            // ---------------------------
            for (let i = 0; i < assetsRows.length; i++) {
                const row = assetsRows[i];
                try {
                    // referenceCode is OPTIONAL — auto-generated serial used if both serial+ref are blank
                    if (!row.assetName || !row.assetType || !row.assetCategory) {
                        summary.errors.push({
                            sheet: 'Assets',
                            row: i + 2,
                            message: 'assetName, assetType, assetCategory are required'
                        });
                        continue;
                    }
                    const isLegacy = String(row.isLegacyAsset || '').trim().toLowerCase() === 'true' || String(row.isLegacyAsset || '') === '1';
                    const modeOfProcurement = String(row.modeOfProcurement || 'PURCHASE')
                        .trim()
                        .toUpperCase();
                    if (!['PURCHASE', 'DONATION', 'LEASE', 'RENTAL'].includes(modeOfProcurement)) {
                        summary.errors.push({
                            sheet: 'Assets',
                            row: i + 2,
                            message: `Invalid modeOfProcurement: ${row.modeOfProcurement}. Allowed values: PURCHASE, DONATION, LEASE, RENTAL`
                        });
                        continue;
                    }
                    // Mode-based validation — relaxed for legacy assets
                    if (!isLegacy) {
                        if (modeOfProcurement === 'PURCHASE') {
                            if (!row.vendorName || !row.purchaseCost) {
                                summary.errors.push({ sheet: 'Assets', row: i + 2, message: 'For PURCHASE, vendorName and purchaseCost are required' });
                                continue;
                            }
                        }
                        if (modeOfProcurement === 'DONATION') {
                            if (!row.donorName || !row.donationDate) {
                                summary.errors.push({ sheet: 'Assets', row: i + 2, message: 'For DONATION, donorName and donationDate are required' });
                                continue;
                            }
                        }
                        if (modeOfProcurement === 'LEASE') {
                            if (!row.vendorName || !row.leaseStartDate || !row.leaseEndDate || !row.leaseAmount) {
                                summary.errors.push({ sheet: 'Assets', row: i + 2, message: 'For LEASE, vendorName, leaseStartDate, leaseEndDate, and leaseAmount are required' });
                                continue;
                            }
                        }
                        if (modeOfProcurement === 'RENTAL') {
                            if (!row.vendorName || !row.rentalStartDate || !row.rentalEndDate || !row.rentalAmount) {
                                summary.errors.push({ sheet: 'Assets', row: i + 2, message: 'For RENTAL, vendorName, rentalStartDate, rentalEndDate, and rentalAmount are required' });
                                continue;
                            }
                        }
                    }
                    const category = yield prismaClient_1.default.assetCategory.upsert({
                        where: { name: String(row.assetCategory).trim() },
                        update: {},
                        create: { name: String(row.assetCategory).trim() }
                    });
                    const vendorId = yield getOrCreateVendor(row);
                    const departmentId = yield getOrCreateDepartment(row.department);
                    const targetDepartmentId = yield getOrCreateDepartment(row.targetDepartment);
                    const allottedToId = yield getEmployeeIdByCode(row.endUserEmployeeCode);
                    const supervisorId = yield getEmployeeIdByCode(row.supervisorEmployeeCode);
                    const existing = yield findAssetByReferenceOrSerial(row.referenceCode, row.serialNumber);
                    // Serial number / reference code — both optional. Auto-generate serial if missing.
                    const cleanSerial = toStringOrNull(row.serialNumber);
                    const cleanRefCode = toStringOrNull(row.referenceCode);
                    const finalSerial = cleanSerial || cleanRefCode || `SN-${Date.now()}-${i}`;
                    const assetData = {
                        assetName: String(row.assetName).trim(),
                        assetType: String(row.assetType).trim(),
                        assetCategoryId: category.id,
                        serialNumber: finalSerial,
                        referenceCode: cleanRefCode,
                        purchaseDate: parseDate(row.purchaseDate),
                        modeOfProcurement,
                        isBranded: (_a = toBool(row.isBranded)) !== null && _a !== void 0 ? _a : false,
                        isAssembled: (_b = toBool(row.isAssembled)) !== null && _b !== void 0 ? _b : false,
                        isCustomized: (_c = toBool(row.isCustomized)) !== null && _c !== void 0 ? _c : false,
                        customDetails: toStringOrNull(row.customDetails),
                        hasSpecifications: (_d = toBool(row.hasSpecifications)) !== null && _d !== void 0 ? _d : false,
                        installedAt: parseDate(row.installedAt),
                        // PURCHASE
                        invoiceNumber: modeOfProcurement === 'PURCHASE' ? toStringOrNull(row.invoiceNumber) : null,
                        purchaseOrderNo: modeOfProcurement === 'PURCHASE' ? toStringOrNull(row.purchaseOrderNo) : null,
                        purchaseOrderDate: modeOfProcurement === 'PURCHASE' ? parseDate(row.purchaseOrderDate) : null,
                        deliveryDate: modeOfProcurement === 'PURCHASE' ? parseDate(row.deliveryDate) : null,
                        purchaseCost: modeOfProcurement === 'PURCHASE' ? toNumber(row.purchaseCost) : null,
                        // DONATION
                        donorName: modeOfProcurement === 'DONATION' ? toStringOrNull(row.donorName) : null,
                        donationDate: modeOfProcurement === 'DONATION' ? parseDate(row.donationDate) : null,
                        assetCondition: modeOfProcurement === 'DONATION' ? toStringOrNull(row.assetCondition) : null,
                        estimatedValue: modeOfProcurement === 'DONATION' ? toNumber(row.estimatedValue) : null,
                        donationDocument: modeOfProcurement === 'DONATION' ? toStringOrNull(row.donationDocument) : null,
                        // LEASE
                        leaseStartDate: modeOfProcurement === 'LEASE' ? parseDate(row.leaseStartDate) : null,
                        leaseEndDate: modeOfProcurement === 'LEASE' ? parseDate(row.leaseEndDate) : null,
                        leaseAmount: modeOfProcurement === 'LEASE' ? toNumber(row.leaseAmount) : null,
                        leaseRenewalDate: modeOfProcurement === 'LEASE' ? parseDate(row.leaseRenewalDate) : null,
                        leaseContractDoc: modeOfProcurement === 'LEASE' ? toStringOrNull(row.leaseContractDoc) : null,
                        // RENTAL
                        rentalStartDate: modeOfProcurement === 'RENTAL' ? parseDate(row.rentalStartDate) : null,
                        rentalEndDate: modeOfProcurement === 'RENTAL' ? parseDate(row.rentalEndDate) : null,
                        rentalAmount: modeOfProcurement === 'RENTAL' ? toNumber(row.rentalAmount) : null,
                        rentalAgreementDoc: modeOfProcurement === 'RENTAL' ? toStringOrNull(row.rentalAgreementDoc) : null,
                        vendorId,
                        departmentId,
                        targetDepartmentId,
                        supervisorId,
                        allottedToId,
                        status: String(row.status || 'ACTIVE').trim(),
                        workingCondition: toStringOrNull(row.workingCondition),
                        healthScore: toNumber(row.healthScore),
                        lastInspectionDate: parseDate(row.lastInspectionDate),
                        retiredDate: parseDate(row.retiredDate),
                        retiredReason: toStringOrNull(row.retiredReason),
                        expectedLifetime: toNumber(row.expectedLifetime),
                        expectedLifetimeUnit: toStringOrNull(row.expectedLifetimeUnit),
                        retiredBy: toStringOrNull(row.retiredBy),
                        grnNumber: toStringOrNull(row.grnNumber),
                        grnDate: parseDate(row.grnDate),
                        grnValue: toNumber(row.grnValue),
                        inspectionStatus: toStringOrNull(row.inspectionStatus),
                        inspectionRemarks: toStringOrNull(row.inspectionRemarks),
                        // Legacy onboarding fields
                        isLegacyAsset: isLegacy,
                        dataAvailableSince: parseDate(row.dataAvailableSince),
                        historicalMaintenanceCost: toNumber(row.historicalMaintenanceCost),
                        historicalSparePartsCost: toNumber(row.historicalSparePartsCost),
                        historicalOtherCost: toNumber(row.historicalOtherCost),
                        historicalCostAsOf: parseDate(row.historicalCostAsOf),
                        historicalCostNote: toStringOrNull(row.historicalCostNote),
                        // Asset Pool linkage
                        financialYearAdded: toStringOrNull(row.financialYearAdded),
                        // assetPoolId resolved below after pool lookup
                        //     rfidCode: toStringOrNull(row.rfidCode),
                        //     qrCode: toStringOrNull(row.qrCode),
                        //     specificationSummary: toStringOrNull(row.specificationSummary),
                        //     organogramNotes: toStringOrNull(row.organogramNotes),
                        //     ticketHierarchyNotes: toStringOrNull(row.ticketHierarchyNotes),
                        //     pmFormatNotes: toStringOrNull(row.pmFormatNotes),
                    };
                    // Resolve poolReferenceCode → assetPoolId
                    let resolvedPoolId = null;
                    if (row.poolReferenceCode) {
                        const pool = yield prismaClient_1.default.assetPool.findUnique({
                            where: { poolCode: String(row.poolReferenceCode).trim() }
                        });
                        if (pool) {
                            resolvedPoolId = pool.id;
                            assetData.assetPoolId = pool.id;
                        }
                    }
                    let savedAssetId;
                    if (existing) {
                        yield prismaClient_1.default.asset.update({
                            where: { id: existing.id },
                            data: assetData
                        });
                        savedAssetId = existing.id;
                        summary.assetsUpdated++;
                    }
                    else {
                        const created = yield createAssetWithGeneratedId(assetData);
                        savedAssetId = created.id;
                        summary.assetsCreated++;
                    }
                    // Update pool status/remainingQuantity after linking an asset
                    if (resolvedPoolId) {
                        const pool = yield prismaClient_1.default.assetPool.findUnique({ where: { id: resolvedPoolId } });
                        if (pool) {
                            const linkedCount = yield prismaClient_1.default.asset.count({ where: { assetPoolId: resolvedPoolId } });
                            const remaining = Math.max(0, pool.originalQuantity - linkedCount);
                            yield prismaClient_1.default.assetPool.update({
                                where: { id: resolvedPoolId },
                                data: {
                                    status: remaining === 0 ? 'COMPLETE' : 'PARTIAL',
                                }
                            });
                        }
                    }
                    // ── Auto-create depreciation with category fallback ─────────────
                    // Priority for each field: row → category default → safe fallback
                    // depreciationStart priority: row → installedAt → purchaseDate
                    const rawDepMethod = (_e = toStringOrNull(row.depreciationMethod)) === null || _e === void 0 ? void 0 : _e.toUpperCase();
                    let depMethod = rawDepMethod === 'SLM' ? 'SL' : rawDepMethod === 'WDV' ? 'DB' : (rawDepMethod !== null && rawDepMethod !== void 0 ? rawDepMethod : null);
                    let depRate = toNumber(row.depreciationRate);
                    let depLife = toNumber(row.expectedLifeYears);
                    // Fall back to category defaults
                    const catWithDefaults = yield prismaClient_1.default.assetCategory.findUnique({
                        where: { id: category.id },
                        select: {
                            defaultDepreciationMethod: true,
                            defaultDepreciationRate: true,
                            defaultLifeYears: true,
                        },
                    });
                    if (!depMethod && (catWithDefaults === null || catWithDefaults === void 0 ? void 0 : catWithDefaults.defaultDepreciationMethod)) {
                        depMethod = catWithDefaults.defaultDepreciationMethod;
                    }
                    if (depRate == null && (catWithDefaults === null || catWithDefaults === void 0 ? void 0 : catWithDefaults.defaultDepreciationRate) != null) {
                        depRate = Number(catWithDefaults.defaultDepreciationRate);
                    }
                    if (depLife == null && (catWithDefaults === null || catWithDefaults === void 0 ? void 0 : catWithDefaults.defaultLifeYears) != null) {
                        depLife = Number(catWithDefaults.defaultLifeYears);
                    }
                    // For DB method, life is not strictly needed — auto-derive from rate
                    if (depMethod === 'DB' && depLife == null && depRate && depRate > 0) {
                        depLife = Math.ceil(100 / depRate);
                    }
                    // Default SL life if still missing
                    if (depMethod === 'SL' && depLife == null)
                        depLife = 10;
                    // depreciationStart priority: row → installedAt → purchaseDate
                    const depStart = parseDate(row.depreciationStart)
                        || parseDate(row.installedAt)
                        || parseDate(row.purchaseDate);
                    if (depMethod && depRate != null && depLife != null && depStart) {
                        const existingDep = yield prismaClient_1.default.assetDepreciation.findUnique({ where: { assetId: savedAssetId } });
                        if (!existingDep) {
                            const asset = yield prismaClient_1.default.asset.findUnique({ where: { id: savedAssetId } });
                            const cost = Number((_g = (_f = asset === null || asset === void 0 ? void 0 : asset.purchaseCost) !== null && _f !== void 0 ? _f : asset === null || asset === void 0 ? void 0 : asset.estimatedValue) !== null && _g !== void 0 ? _g : 0);
                            const openingDep = (_h = toNumber(row.openingAccumulatedDepreciation)) !== null && _h !== void 0 ? _h : 0;
                            const newDep = yield prismaClient_1.default.assetDepreciation.create({
                                data: {
                                    assetId: savedAssetId,
                                    depreciationMethod: depMethod,
                                    depreciationRate: String(depRate),
                                    expectedLifeYears: depLife,
                                    depreciationStart: depStart,
                                    depreciationFrequency: 'YEARLY',
                                    salvageValue: null,
                                    accumulatedDepreciation: String(openingDep),
                                    currentBookValue: String(Math.max(0, cost - openingDep)),
                                    lastCalculatedAt: null,
                                    roundOff: false,
                                    decimalPlaces: 2,
                                    isActive: true,
                                },
                            });
                            // ── Backfill historical FY logs ─────────────────────────
                            // Generate one DepreciationLog per completed FY from
                            // depreciationStart (or financialYearAdded for pool assets)
                            // up to today, so FA Schedule shows correct historical values.
                            try {
                                const assetForBackfill = {
                                    id: savedAssetId,
                                    assetId: (_j = asset === null || asset === void 0 ? void 0 : asset.assetId) !== null && _j !== void 0 ? _j : '',
                                    purchaseCost: cost,
                                    estimatedValue: Number((_k = asset === null || asset === void 0 ? void 0 : asset.estimatedValue) !== null && _k !== void 0 ? _k : 0),
                                    purchaseDate: (_l = asset === null || asset === void 0 ? void 0 : asset.purchaseDate) !== null && _l !== void 0 ? _l : null,
                                    installedAt: (_m = asset === null || asset === void 0 ? void 0 : asset.installedAt) !== null && _m !== void 0 ? _m : null,
                                    isLegacyAsset: (_o = asset === null || asset === void 0 ? void 0 : asset.isLegacyAsset) !== null && _o !== void 0 ? _o : false,
                                    migrationMode: (_p = asset === null || asset === void 0 ? void 0 : asset.migrationMode) !== null && _p !== void 0 ? _p : null,
                                    migrationDate: (_q = asset === null || asset === void 0 ? void 0 : asset.migrationDate) !== null && _q !== void 0 ? _q : null,
                                    originalPurchaseDate: (_r = asset === null || asset === void 0 ? void 0 : asset.originalPurchaseDate) !== null && _r !== void 0 ? _r : null,
                                    originalCost: (_s = asset === null || asset === void 0 ? void 0 : asset.originalCost) !== null && _s !== void 0 ? _s : null,
                                    accDepAtMigration: (_t = asset === null || asset === void 0 ? void 0 : asset.accDepAtMigration) !== null && _t !== void 0 ? _t : null,
                                    openingWdvAtMigration: (_u = asset === null || asset === void 0 ? void 0 : asset.openingWdvAtMigration) !== null && _u !== void 0 ? _u : null,
                                    financialYearAdded: (_v = asset === null || asset === void 0 ? void 0 : asset.financialYearAdded) !== null && _v !== void 0 ? _v : null,
                                    assetPoolId: (_w = asset === null || asset === void 0 ? void 0 : asset.assetPoolId) !== null && _w !== void 0 ? _w : null,
                                };
                                const cfgForBackfill = {
                                    method: depMethod,
                                    rate: depRate,
                                    lifeYears: depLife,
                                    salvage: 0,
                                    depreciationStart: depStart,
                                    frequency: 'YEARLY',
                                    roundOff: false,
                                    decimalPlaces: 2,
                                };
                                yield (0, depreciationEngine_1.backfillHistoricalDepreciation)(savedAssetId, newDep.id, assetForBackfill, cfgForBackfill, null);
                            }
                            catch (bfErr) {
                                console.warn(`Backfill failed for asset ${savedAssetId}:`, bfErr.message);
                            }
                        }
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'Assets',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 2. SPECIFICATIONS
            // ---------------------------
            for (let i = 0; i < specsRows.length; i++) {
                const row = specsRows[i];
                try {
                    if (!row.referenceCode || !row.key || row.value === '') {
                        summary.errors.push({
                            sheet: 'Specifications',
                            row: i + 2,
                            message: 'referenceCode, key, value are required'
                        });
                        continue;
                    }
                    const asset = yield findAssetByReferenceCode(row.referenceCode);
                    if (!asset) {
                        summary.errors.push({
                            sheet: 'Specifications',
                            row: i + 2,
                            message: `Asset not found for referenceCode: ${row.referenceCode}`
                        });
                        continue;
                    }
                    const existingSpec = yield prismaClient_1.default.assetSpecification.findFirst({
                        where: {
                            assetId: asset.id,
                            key: String(row.key).trim(),
                            specificationGroup: toStringOrNull(row.specificationGroup),
                        }
                    });
                    const specData = {
                        assetId: asset.id,
                        key: String(row.key).trim(),
                        value: String(row.value).trim(),
                        specificationGroup: toStringOrNull(row.specificationGroup),
                        valueType: toStringOrNull(row.valueType),
                        unit: toStringOrNull(row.unit),
                        sortOrder: (_x = toNumber(row.sortOrder)) !== null && _x !== void 0 ? _x : 0,
                        isMandatory: (_y = toBool(row.isMandatory)) !== null && _y !== void 0 ? _y : false,
                        source: toStringOrNull(row.source),
                        remarks: toStringOrNull(row.remarks),
                    };
                    if (existingSpec) {
                        yield prismaClient_1.default.assetSpecification.update({
                            where: { id: existingSpec.id },
                            data: specData
                        });
                        summary.specificationsUpdated++;
                    }
                    else {
                        yield prismaClient_1.default.assetSpecification.create({
                            data: specData
                        });
                        summary.specificationsCreated++;
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'Specifications',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 3. WARRANTY
            // ---------------------------
            for (let i = 0; i < warrantyRows.length; i++) {
                const row = warrantyRows[i];
                try {
                    if (!row.referenceCode)
                        continue;
                    const asset = yield findAssetByReferenceCode(row.referenceCode);
                    if (!asset) {
                        summary.errors.push({
                            sheet: 'Warranty',
                            row: i + 2,
                            message: `Asset not found for referenceCode: ${row.referenceCode}`
                        });
                        continue;
                    }
                    const vendorId = yield getOrCreateVendor(row);
                    const isUnderWarranty = (_z = toBool(row.isUnderWarranty)) !== null && _z !== void 0 ? _z : false;
                    const warrantyStart = parseDate(row.warrantyStart);
                    const warrantyEnd = parseDate(row.warrantyEnd);
                    if (isUnderWarranty && (!warrantyStart || !warrantyEnd)) {
                        summary.errors.push({
                            sheet: 'Warranty',
                            row: i + 2,
                            message: 'warrantyStart and warrantyEnd required when isUnderWarranty = true'
                        });
                        continue;
                    }
                    // await prisma.warranty.upsert({
                    //     where: {
                    //         assetId: asset.id,
                    //         isActive: true,
                    //     },
                    //     update: {
                    //         isUnderWarranty,
                    //         warrantyStart: warrantyStart || new Date(),
                    //         warrantyEnd: warrantyEnd || new Date(),
                    //         warrantyType: toStringOrNull(row.warrantyType),
                    //         warrantyProvider: toStringOrNull(row.warrantyProvider),
                    //         vendorId,
                    //         warrantyReference: toStringOrNull(row.warrantyReference),
                    //         coverageDetails: toStringOrNull(row.coverageDetails),
                    //         exclusions: toStringOrNull(row.exclusions),
                    //         supportContact: toStringOrNull(row.supportContact),
                    //         supportEmail: toStringOrNull(row.supportEmail),
                    //         termsUrl: toStringOrNull(row.termsUrl),
                    //         remarks: toStringOrNull(row.remarks),
                    //     },
                    //     create: {
                    //         assetId: asset.id,
                    //         isUnderWarranty,
                    //         warrantyStart: warrantyStart || new Date(),
                    //         warrantyEnd: warrantyEnd || new Date(),
                    //         warrantyType: toStringOrNull(row.warrantyType),
                    //         warrantyProvider: toStringOrNull(row.warrantyProvider),
                    //         vendorId,
                    //         warrantyReference: toStringOrNull(row.warrantyReference),
                    //         coverageDetails: toStringOrNull(row.coverageDetails),
                    //         exclusions: toStringOrNull(row.exclusions),
                    //         supportContact: toStringOrNull(row.supportContact),
                    //         supportEmail: toStringOrNull(row.supportEmail),
                    //         termsUrl: toStringOrNull(row.termsUrl),
                    //         remarks: toStringOrNull(row.remarks),
                    //     }
                    // });
                    const payload = {
                        isUnderWarranty,
                        warrantyStart: warrantyStart || new Date(),
                        warrantyEnd: warrantyEnd || new Date(),
                        warrantyType: toStringOrNull(row.warrantyType),
                        warrantyProvider: toStringOrNull(row.warrantyProvider),
                        vendorId,
                        warrantyReference: toStringOrNull(row.warrantyReference),
                        coverageDetails: toStringOrNull(row.coverageDetails),
                        exclusions: toStringOrNull(row.exclusions),
                        supportContact: toStringOrNull(row.supportContact),
                        supportEmail: toStringOrNull(row.supportEmail),
                        termsUrl: toStringOrNull(row.termsUrl),
                        remarks: toStringOrNull(row.remarks),
                    };
                    const existingActive = yield prismaClient_1.default.warranty.findFirst({
                        where: {
                            assetId: asset.id,
                            isActive: true,
                        },
                        orderBy: {
                            createdAt: 'desc',
                        },
                    });
                    if (existingActive) {
                        yield prismaClient_1.default.warranty.update({
                            where: { id: existingActive.id },
                            data: payload,
                        });
                    }
                    else {
                        yield prismaClient_1.default.warranty.create({
                            data: Object.assign({ assetId: asset.id, isActive: true }, payload),
                        });
                    }
                    summary.warrantiesUpserted++;
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'Warranty',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 4. SERVICE CONTRACTS
            // ---------------------------
            for (let i = 0; i < contractsRows.length; i++) {
                const row = contractsRows[i];
                try {
                    if (!row.referenceCode || !row.contractType || !row.startDate || !row.endDate) {
                        summary.errors.push({
                            sheet: 'ServiceContracts',
                            row: i + 2,
                            message: 'referenceCode, contractType, startDate, endDate are required'
                        });
                        continue;
                    }
                    const asset = yield findAssetByReferenceCode(row.referenceCode);
                    if (!asset) {
                        summary.errors.push({
                            sheet: 'ServiceContracts',
                            row: i + 2,
                            message: `Asset not found for referenceCode: ${row.referenceCode}`
                        });
                        continue;
                    }
                    const vendorId = yield getOrCreateVendor(row);
                    yield prismaClient_1.default.serviceContract.create({
                        data: {
                            assetId: asset.id,
                            vendorId,
                            contractType: String(row.contractType).trim(),
                            contractNumber: toStringOrNull(row.contractNumber),
                            startDate: parseDate(row.startDate),
                            endDate: parseDate(row.endDate),
                            includesParts: toBool(row.includesParts),
                            includesLabor: toBool(row.includesLabor),
                            visitsPerYear: toNumber(row.visitsPerYear),
                            cost: row.cost ? String(row.cost) : null,
                            currency: toStringOrNull(row.currency),
                            document: toStringOrNull(row.document),
                            terms: toStringOrNull(row.terms),
                            status: toStringOrNull(row.status) || 'ACTIVE',
                            createdBy: toStringOrNull(row.createdBy),
                            reason: toStringOrNull(row.reason),
                        }
                    });
                    summary.contractsCreated++;
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'ServiceContracts',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 5. LOCATIONS
            // ---------------------------
            for (let i = 0; i < locationsRows.length; i++) {
                const row = locationsRows[i];
                try {
                    if (!row.referenceCode || !row.branchName) {
                        summary.errors.push({
                            sheet: 'Locations',
                            row: i + 2,
                            message: 'referenceCode and branchName are required'
                        });
                        continue;
                    }
                    const asset = yield findAssetByReferenceCode(row.referenceCode);
                    if (!asset) {
                        summary.errors.push({
                            sheet: 'Locations',
                            row: i + 2,
                            message: `Asset not found for referenceCode: ${row.referenceCode}`
                        });
                        continue;
                    }
                    const branchId = yield getOrCreateBranch(row.branchName);
                    const employeeResponsibleId = yield getEmployeeIdByCode(row.employeeResponsibleCode);
                    yield prismaClient_1.default.assetLocation.create({
                        data: {
                            assetId: asset.id,
                            branchId: branchId,
                            block: toStringOrNull(row.block),
                            floor: toStringOrNull(row.floor),
                            room: toStringOrNull(row.room),
                            departmentSnapshot: toStringOrNull(row.departmentSnapshot),
                            employeeResponsibleId,
                            isActive: (_0 = toBool(row.isActive)) !== null && _0 !== void 0 ? _0 : true,
                        }
                    });
                    summary.locationsCreated++;
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'Locations',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 6. SUB-ASSETS
            // ---------------------------
            for (let i = 0; i < subAssetsRows.length; i++) {
                const row = subAssetsRows[i];
                try {
                    // parentReferenceCode required to locate parent; sub-asset's own referenceCode is optional
                    if (!row.parentReferenceCode || !row.assetName || !row.assetType || !row.assetCategory) {
                        summary.errors.push({
                            sheet: 'SubAssets',
                            row: i + 2,
                            message: 'parentReferenceCode, assetName, assetType, assetCategory are required'
                        });
                        continue;
                    }
                    const parent = yield findAssetByReferenceCode(row.parentReferenceCode);
                    if (!parent) {
                        summary.errors.push({
                            sheet: 'SubAssets',
                            row: i + 2,
                            message: `Parent asset not found for parentReferenceCode: ${row.parentReferenceCode}`
                        });
                        continue;
                    }
                    const category = yield prismaClient_1.default.assetCategory.upsert({
                        where: { name: String(row.assetCategory).trim() },
                        update: {},
                        create: { name: String(row.assetCategory).trim() }
                    });
                    let existingSubAsset = null;
                    if (row.referenceCode) {
                        existingSubAsset = yield prismaClient_1.default.asset.findUnique({
                            where: { referenceCode: String(row.referenceCode).trim() }
                        });
                    }
                    if (!existingSubAsset && row.serialNumber) {
                        existingSubAsset = yield prismaClient_1.default.asset.findUnique({
                            where: { serialNumber: String(row.serialNumber).trim() }
                        });
                    }
                    const subAssetData = {
                        assetName: String(row.assetName).trim(),
                        assetType: String(row.assetType).trim(),
                        assetCategoryId: category.id,
                        serialNumber: String(row.serialNumber || row.referenceCode || `${parent.assetId}-TEMP`).trim(),
                        referenceCode: toStringOrNull(row.referenceCode),
                        status: String(row.status || 'ACTIVE'),
                        parentAssetId: parent.id,
                        isBranded: (_1 = toBool(row.isBranded)) !== null && _1 !== void 0 ? _1 : false,
                        isAssembled: (_2 = toBool(row.isAssembled)) !== null && _2 !== void 0 ? _2 : false,
                        isCustomized: (_3 = toBool(row.isCustomized)) !== null && _3 !== void 0 ? _3 : false,
                        customDetails: toStringOrNull(row.customDetails),
                        hasSpecifications: (_4 = toBool(row.hasSpecifications)) !== null && _4 !== void 0 ? _4 : false,
                        specificationSummary: toStringOrNull(row.specificationSummary),
                    };
                    if (existingSubAsset) {
                        yield prismaClient_1.default.asset.update({
                            where: { id: existingSubAsset.id },
                            data: subAssetData
                        });
                        summary.subAssetsUpdated++;
                    }
                    else {
                        const generatedSubAssetId = yield (0, assetIdGenerator_1.generateSubAssetId)(parent.assetId, parent.id);
                        yield prismaClient_1.default.asset.create({
                            data: Object.assign({ assetId: generatedSubAssetId }, subAssetData)
                        });
                        summary.subAssetsCreated++;
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'SubAssets',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 7. MAINTENANCE SCHEDULES
            // ---------------------------
            for (let i = 0; i < maintenanceRows.length; i++) {
                const row = maintenanceRows[i];
                try {
                    if (!row.referenceCode || !row.frequencyValue || !row.frequencyUnit || !row.nextDueAt) {
                        continue;
                    }
                    const asset = yield findAssetByReferenceCode(row.referenceCode);
                    if (!asset) {
                        summary.errors.push({
                            sheet: 'MaintenanceSchedules',
                            row: i + 2,
                            message: `Asset not found for referenceCode: ${row.referenceCode}`
                        });
                        continue;
                    }
                    yield prismaClient_1.default.maintenanceSchedule.create({
                        data: {
                            assetId: asset.id,
                            frequencyValue: Number(row.frequencyValue),
                            frequencyUnit: String(row.frequencyUnit),
                            nextDueAt: parseDate(row.nextDueAt),
                            isActive: (_5 = toBool(row.isActive)) !== null && _5 !== void 0 ? _5 : true,
                            reminderDays: toNumber(row.reminderDays),
                            createdBy: toStringOrNull(row.createdBy),
                            reason: toStringOrNull(row.reason),
                        }
                    });
                    summary.maintenanceSchedulesCreated++;
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'MaintenanceSchedules',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 8. CALIBRATION SCHEDULES
            // ---------------------------
            for (let i = 0; i < calibrationRows.length; i++) {
                const row = calibrationRows[i];
                try {
                    if (!row.referenceCode || !row.frequencyValue || !row.frequencyUnit || !row.nextDueAt) {
                        continue;
                    }
                    const asset = yield findAssetByReferenceCode(row.referenceCode);
                    if (!asset) {
                        summary.errors.push({
                            sheet: 'CalibrationSchedules',
                            row: i + 2,
                            message: `Asset not found for referenceCode: ${row.referenceCode}`
                        });
                        continue;
                    }
                    const vendorId = yield getOrCreateVendor(row);
                    yield prismaClient_1.default.calibrationSchedule.create({
                        data: {
                            assetId: asset.id,
                            frequencyValue: Number(row.frequencyValue),
                            frequencyUnit: String(row.frequencyUnit),
                            nextDueAt: parseDate(row.nextDueAt),
                            lastCalibratedAt: parseDate(row.lastCalibratedAt),
                            isActive: (_6 = toBool(row.isActive)) !== null && _6 !== void 0 ? _6 : true,
                            standardProcedure: toStringOrNull(row.standardProcedure),
                            vendorId,
                            reminderDays: toNumber(row.reminderDays),
                            notes: toStringOrNull(row.notes),
                        }
                    });
                    summary.calibrationSchedulesCreated++;
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'CalibrationSchedules',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            fs_1.default.unlinkSync(file.path);
            res.status(200).json({
                message: 'Excel imported successfully',
                summary
            });
            return;
        }
        catch (err) {
            if (fs_1.default.existsSync(file.path))
                fs_1.default.unlinkSync(file.path);
            res.status(500).json({
                message: 'Import failed',
                error: err.message
            });
            return;
        }
    });
}
function getAssetCategoryIdByName(name) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!name)
            return null;
        const category = yield prismaClient_1.default.assetCategory.upsert({
            where: { name: String(name).trim() },
            update: {},
            create: { name: String(name).trim() }
        });
        return category.id;
    });
}
function getAssetIdByReferenceCode(referenceCode) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!referenceCode)
            return null;
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { referenceCode: String(referenceCode).trim() }
        });
        return (_a = asset === null || asset === void 0 ? void 0 : asset.id) !== null && _a !== void 0 ? _a : null;
    });
}
function importChecklistWorkbook(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: 'Excel file is required' });
            return;
        }
        const summary = {
            // preventiveTemplatesCreated: 0,
            // preventiveItemsCreated: 0,
            acknowledgementTemplatesCreated: 0,
            acknowledgementItemsCreated: 0,
            pmTemplatesCreated: 0,
            pmItemsCreated: 0,
            calibrationTemplatesCreated: 0,
            calibrationItemsCreated: 0,
            supportMatrixRowsCreated: 0,
            errors: [],
        };
        try {
            const workbook = xlsx_1.default.readFile(file.path);
            const readSheet = (name) => workbook.Sheets[name]
                ? xlsx_1.default.utils.sheet_to_json(workbook.Sheets[name], { defval: '' })
                : [];
            // const preventiveRows = readSheet('PreventiveChecklistTemplates');
            const acknowledgementRows = readSheet('AssetAcknowledgementTemplates');
            const pmRows = readSheet('PMChecklistTemplates');
            const calibrationRows = readSheet('CalibrationChecklistTemplates');
            const supportRows = readSheet('AssetSupportMatrix');
            // ---------------------------
            // 1. PREVENTIVE CHECKLIST TEMPLATES
            // Columns:
            // templateName, description, assetCategory, referenceCode, isActive, itemTitle, itemDescription, sortOrder, isRequired
            // ---------------------------
            // for (let i = 0; i < preventiveRows.length; i++) {
            //     const row = preventiveRows[i];
            //     try {
            //         if (!row.templateName || !row.itemTitle) {
            //             summary.errors.push({
            //                 sheet: 'PreventiveChecklistTemplates',
            //                 row: i + 2,
            //                 message: 'templateName and itemTitle are required'
            //             });
            //             continue;
            //         }
            //         const assetCategoryId = await getAssetCategoryIdByName(row.assetCategory);
            //         const assetId = await getAssetIdByReferenceCode(row.referenceCode);
            //         let template = await prisma.preventiveChecklistTemplate.findFirst({
            //             where: {
            //                 name: String(row.templateName).trim(),
            //                 assetCategoryId: assetCategoryId ?? undefined,
            //                 assetId: assetId ?? undefined,
            //             }
            //         });
            //         if (!template) {
            //             template = await prisma.preventiveChecklistTemplate.create({
            //                 data: {
            //                     name: String(row.templateName).trim(),
            //                     description: toStringOrNull(row.description),
            //                     assetCategoryId,
            //                     assetId,
            //                     isActive: toBool(row.isActive) ?? true,
            //                 }
            //             });
            //             summary.preventiveTemplatesCreated++;
            //         }
            //         const existingItem = await prisma.preventiveChecklistItem.findFirst({
            //             where: {
            //                 templateId: template.id,
            //                 title: String(row.itemTitle).trim(),
            //             }
            //         });
            //         if (!existingItem) {
            //             await prisma.preventiveChecklistItem.create({
            //                 data: {
            //                     templateId: template.id,
            //                     title: String(row.itemTitle).trim(),
            //                     description: toStringOrNull(row.itemDescription),
            //                     sortOrder: toNumber(row.sortOrder) ?? 0,
            //                     isRequired: toBool(row.isRequired) ?? true,
            //                 }
            //             });
            //             summary.preventiveItemsCreated++;
            //         }
            //     } catch (err: any) {
            //         summary.errors.push({
            //             sheet: 'PreventiveChecklistTemplates',
            //             row: i + 2,
            //             message: err.message
            //         });
            //     }
            // }
            // ---------------------------
            // 2. ASSET ACKNOWLEDGEMENT TEMPLATES
            // Columns:
            // templateName, description, assetCategory, referenceCode, isActive, itemTitle, itemDescription, sortOrder, isRequired
            // ---------------------------
            for (let i = 0; i < acknowledgementRows.length; i++) {
                const row = acknowledgementRows[i];
                try {
                    if (!row.templateName || !row.itemTitle) {
                        summary.errors.push({
                            sheet: 'AssetAcknowledgementTemplates',
                            row: i + 2,
                            message: 'templateName and itemTitle are required'
                        });
                        continue;
                    }
                    const assetCategoryId = yield getAssetCategoryIdByName(row.assetCategory);
                    const assetId = yield getAssetIdByReferenceCode(row.referenceCode);
                    let template = yield prismaClient_1.default.assetAcknowledgementTemplate.findFirst({
                        where: {
                            name: String(row.templateName).trim(),
                            assetCategoryId: assetCategoryId !== null && assetCategoryId !== void 0 ? assetCategoryId : undefined,
                            assetId: assetId !== null && assetId !== void 0 ? assetId : undefined,
                        }
                    });
                    if (!template) {
                        template = yield prismaClient_1.default.assetAcknowledgementTemplate.create({
                            data: {
                                name: String(row.templateName).trim(),
                                description: toStringOrNull(row.description),
                                assetCategoryId,
                                assetId,
                                isActive: (_a = toBool(row.isActive)) !== null && _a !== void 0 ? _a : true,
                            }
                        });
                        summary.acknowledgementTemplatesCreated++;
                    }
                    const existingItem = yield prismaClient_1.default.assetAcknowledgementItem.findFirst({
                        where: {
                            templateId: template.id,
                            title: String(row.itemTitle).trim(),
                        }
                    });
                    if (!existingItem) {
                        yield prismaClient_1.default.assetAcknowledgementItem.create({
                            data: {
                                templateId: template.id,
                                title: String(row.itemTitle).trim(),
                                description: toStringOrNull(row.itemDescription),
                                sortOrder: (_b = toNumber(row.sortOrder)) !== null && _b !== void 0 ? _b : 0,
                                isRequired: (_c = toBool(row.isRequired)) !== null && _c !== void 0 ? _c : true,
                            }
                        });
                        summary.acknowledgementItemsCreated++;
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'AssetAcknowledgementTemplates',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 3. PM CHECKLIST TEMPLATES
            // Columns:
            // templateName, pmFormatCode, description, assetCategory, referenceCode, isActive,
            // itemTitle, itemDescription, itemType, expectedValue, unit, sortOrder, isRequired
            // ---------------------------
            for (let i = 0; i < pmRows.length; i++) {
                const row = pmRows[i];
                try {
                    if (!row.templateName || !row.itemTitle) {
                        summary.errors.push({
                            sheet: 'PMChecklistTemplates',
                            row: i + 2,
                            message: 'templateName and itemTitle are required'
                        });
                        continue;
                    }
                    const assetCategoryId = yield getAssetCategoryIdByName(row.assetCategory);
                    const assetId = yield getAssetIdByReferenceCode(row.referenceCode);
                    let template = yield prismaClient_1.default.pMChecklistTemplate.findFirst({
                        where: {
                            name: String(row.templateName).trim(),
                            assetCategoryId: assetCategoryId !== null && assetCategoryId !== void 0 ? assetCategoryId : undefined,
                            assetId: assetId !== null && assetId !== void 0 ? assetId : undefined,
                        }
                    });
                    if (!template) {
                        template = yield prismaClient_1.default.pMChecklistTemplate.create({
                            data: {
                                name: String(row.templateName).trim(),
                                description: toStringOrNull(row.description),
                                pmFormatCode: toStringOrNull(row.pmFormatCode),
                                assetCategoryId,
                                assetId,
                                isActive: (_d = toBool(row.isActive)) !== null && _d !== void 0 ? _d : true,
                            }
                        });
                        summary.pmTemplatesCreated++;
                    }
                    const existingItem = yield prismaClient_1.default.pMChecklistItem.findFirst({
                        where: {
                            templateId: template.id,
                            title: String(row.itemTitle).trim(),
                        }
                    });
                    if (!existingItem) {
                        yield prismaClient_1.default.pMChecklistItem.create({
                            data: {
                                templateId: template.id,
                                title: String(row.itemTitle).trim(),
                                description: toStringOrNull(row.itemDescription),
                                itemType: toStringOrNull(row.itemType),
                                expectedValue: toStringOrNull(row.expectedValue),
                                unit: toStringOrNull(row.unit),
                                sortOrder: (_e = toNumber(row.sortOrder)) !== null && _e !== void 0 ? _e : 0,
                                isRequired: (_f = toBool(row.isRequired)) !== null && _f !== void 0 ? _f : true,
                            }
                        });
                        summary.pmItemsCreated++;
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'PMChecklistTemplates',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 4. CALIBRATION CHECKLIST TEMPLATES
            // Columns:
            // templateName, description, assetCategory, referenceCode, isActive,
            // itemTitle, itemDescription, expectedValue, unit, sortOrder, isRequired
            // ---------------------------
            for (let i = 0; i < calibrationRows.length; i++) {
                const row = calibrationRows[i];
                try {
                    if (!row.templateName || !row.itemTitle) {
                        summary.errors.push({
                            sheet: 'CalibrationChecklistTemplates',
                            row: i + 2,
                            message: 'templateName and itemTitle are required'
                        });
                        continue;
                    }
                    const assetCategoryId = yield getAssetCategoryIdByName(row.assetCategory);
                    const assetId = yield getAssetIdByReferenceCode(row.referenceCode);
                    let template = yield prismaClient_1.default.calibrationChecklistTemplate.findFirst({
                        where: {
                            name: String(row.templateName).trim(),
                            assetCategoryId: assetCategoryId !== null && assetCategoryId !== void 0 ? assetCategoryId : undefined,
                            assetId: assetId !== null && assetId !== void 0 ? assetId : undefined,
                        }
                    });
                    if (!template) {
                        template = yield prismaClient_1.default.calibrationChecklistTemplate.create({
                            data: {
                                name: String(row.templateName).trim(),
                                description: toStringOrNull(row.description),
                                assetCategoryId,
                                assetId,
                                isActive: (_g = toBool(row.isActive)) !== null && _g !== void 0 ? _g : true,
                            }
                        });
                        summary.calibrationTemplatesCreated++;
                    }
                    const existingItem = yield prismaClient_1.default.calibrationChecklistItem.findFirst({
                        where: {
                            templateId: template.id,
                            title: String(row.itemTitle).trim(),
                        }
                    });
                    if (!existingItem) {
                        yield prismaClient_1.default.calibrationChecklistItem.create({
                            data: {
                                templateId: template.id,
                                title: String(row.itemTitle).trim(),
                                description: toStringOrNull(row.itemDescription),
                                expectedValue: toStringOrNull(row.expectedValue),
                                unit: toStringOrNull(row.unit),
                                sortOrder: (_h = toNumber(row.sortOrder)) !== null && _h !== void 0 ? _h : 0,
                                isRequired: (_j = toBool(row.isRequired)) !== null && _j !== void 0 ? _j : true,
                            }
                        });
                        summary.calibrationItemsCreated++;
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'CalibrationChecklistTemplates',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            // ---------------------------
            // 5. ASSET SUPPORT MATRIX
            // Columns:
            // assetCategory, referenceCode, levelNo, roleName, personName, employeeCode,
            // contactNumber, email, escalationTime, escalationUnit, notes
            // ---------------------------
            for (let i = 0; i < supportRows.length; i++) {
                const row = supportRows[i];
                try {
                    if (!row.levelNo) {
                        summary.errors.push({
                            sheet: 'AssetSupportMatrix',
                            row: i + 2,
                            message: 'levelNo is required'
                        });
                        continue;
                    }
                    const assetCategoryId = yield getAssetCategoryIdByName(row.assetCategory);
                    const assetId = yield getAssetIdByReferenceCode(row.referenceCode);
                    const employeeId = yield getEmployeeIdByCode(row.employeeCode);
                    const exists = yield prismaClient_1.default.assetSupportMatrix.findFirst({
                        where: {
                            assetCategoryId: assetCategoryId !== null && assetCategoryId !== void 0 ? assetCategoryId : undefined,
                            assetId: assetId !== null && assetId !== void 0 ? assetId : undefined,
                            levelNo: Number(row.levelNo),
                            roleName: toStringOrNull(row.roleName),
                            personName: toStringOrNull(row.personName),
                        }
                    });
                    if (!exists) {
                        yield prismaClient_1.default.assetSupportMatrix.create({
                            data: {
                                assetCategoryId,
                                assetId,
                                levelNo: Number(row.levelNo),
                                roleName: toStringOrNull(row.roleName),
                                personName: toStringOrNull(row.personName),
                                employeeId,
                                contactNumber: toStringOrNull(row.contactNumber),
                                email: toStringOrNull(row.email),
                                escalationTime: toNumber(row.escalationTime),
                                escalationUnit: toStringOrNull(row.escalationUnit),
                                notes: toStringOrNull(row.notes),
                            }
                        });
                        summary.supportMatrixRowsCreated++;
                    }
                }
                catch (err) {
                    summary.errors.push({
                        sheet: 'AssetSupportMatrix',
                        row: i + 2,
                        message: err.message
                    });
                }
            }
            fs_1.default.unlinkSync(file.path);
            res.status(200).json({
                message: 'Checklist workbook imported successfully',
                summary
            });
            return;
        }
        catch (err) {
            if (fs_1.default.existsSync(file.path))
                fs_1.default.unlinkSync(file.path);
            res.status(500).json({
                message: 'Checklist workbook import failed',
                error: err.message
            });
            return;
        }
    });
}
// ─── Download Legacy Asset Import Template ───────────────────────────────────
const downloadLegacyTemplate = (req, res) => {
    // Assets sheet — standard columns + legacy columns
    const assetsHeaders = [
        // Required
        'referenceCode', 'assetName', 'assetType', 'assetCategory',
        // Optional basic
        'serialNumber', 'modeOfProcurement', 'department',
        'purchaseDate', 'purchaseCost', 'vendorName',
        'manufacturer', 'modelNumber', 'currentLocation', 'status',
        // Legacy flag + opening balances
        'isLegacyAsset',
        'historicalMaintenanceCost',
        'historicalSparePartsCost',
        'historicalOtherCost',
        'historicalCostAsOf',
        'dataAvailableSince',
        'historicalCostNote',
        // Depreciation setup (optional — auto-created on import if provided)
        'depreciationMethod',
        'depreciationRate',
        'expectedLifeYears',
        'depreciationStart',
        'openingAccumulatedDepreciation',
    ];
    const assetsExample = [
        {
            referenceCode: 'REF-001',
            assetName: 'MRI Scanner',
            assetType: 'Medical Equipment',
            assetCategory: 'Radiology',
            serialNumber: 'SN-12345',
            modeOfProcurement: 'PURCHASE',
            department: 'Radiology',
            purchaseDate: '2021-06-01',
            purchaseCost: 2500000,
            vendorName: 'GE Healthcare',
            manufacturer: 'GE',
            modelNumber: 'SIGNA',
            currentLocation: 'Block A - Room 101',
            status: 'ACTIVE',
            isLegacyAsset: 'true',
            historicalMaintenanceCost: 180000,
            historicalSparePartsCost: 45000,
            historicalOtherCost: 15000,
            historicalCostAsOf: '2024-03-31',
            dataAvailableSince: '2024-04-01',
            historicalCostNote: 'Based on service register and vendor invoices 2021–2024',
            depreciationMethod: 'SL',
            depreciationRate: 10,
            expectedLifeYears: 10,
            depreciationStart: '2021-06-01',
            openingAccumulatedDepreciation: 750000,
        },
        {
            referenceCode: 'REF-002',
            assetName: 'Ventilator',
            assetType: 'Life Support',
            assetCategory: 'ICU Equipment',
            serialNumber: '',
            modeOfProcurement: 'PURCHASE',
            department: 'ICU',
            purchaseDate: '2020-01-15',
            purchaseCost: 350000,
            vendorName: 'Medtronic',
            manufacturer: 'Medtronic',
            modelNumber: 'PB980',
            currentLocation: 'ICU - Bed 3',
            status: 'ACTIVE',
            isLegacyAsset: 'true',
            historicalMaintenanceCost: 52000,
            historicalSparePartsCost: 18000,
            historicalOtherCost: 0,
            historicalCostAsOf: '2024-03-31',
            dataAvailableSince: '2024-04-01',
            historicalCostNote: 'From maintenance logbook',
            depreciationMethod: 'DB',
            depreciationRate: 15,
            expectedLifeYears: 8,
            depreciationStart: '2020-01-15',
            openingAccumulatedDepreciation: 157500,
        },
    ];
    // Instructions sheet
    const instructions = [
        { Field: 'referenceCode', Required: 'YES', Notes: 'Unique code per asset. Used to match on re-import.' },
        { Field: 'assetName', Required: 'YES', Notes: 'Full asset name' },
        { Field: 'assetType', Required: 'YES', Notes: 'e.g. Medical Equipment, Furniture, IT Equipment' },
        { Field: 'assetCategory', Required: 'YES', Notes: 'Category name — created automatically if not exists' },
        { Field: 'serialNumber', Required: 'NO (legacy)', Notes: 'Leave blank if unknown for legacy assets' },
        { Field: 'modeOfProcurement', Required: 'NO', Notes: 'PURCHASE / DONATION / LEASE / RENTAL. Default: PURCHASE' },
        { Field: 'department', Required: 'NO', Notes: 'Department name — created automatically if not exists' },
        { Field: 'purchaseDate', Required: 'NO', Notes: 'YYYY-MM-DD format' },
        { Field: 'purchaseCost', Required: 'NO (legacy)', Notes: 'Original purchase cost in INR. Skip if unknown for legacy.' },
        { Field: 'vendorName', Required: 'NO (legacy)', Notes: 'Vendor name — created automatically if not exists' },
        { Field: 'status', Required: 'NO', Notes: 'ACTIVE / IN_STORE / IN_MAINTENANCE / RETIRED. Default: ACTIVE' },
        { Field: 'isLegacyAsset', Required: 'NO', Notes: 'Set to true for assets onboarded from pre-system history' },
        { Field: 'historicalMaintenanceCost', Required: 'NO', Notes: 'Total repair/service spend BEFORE system onboarding (INR)' },
        { Field: 'historicalSparePartsCost', Required: 'NO', Notes: 'Total spare parts/consumables spend before onboarding (INR)' },
        { Field: 'historicalOtherCost', Required: 'NO', Notes: 'Other historical costs — calibration, transport, etc. (INR)' },
        { Field: 'historicalCostAsOf', Required: 'NO', Notes: 'Date up to which historical costs are captured (YYYY-MM-DD)' },
        { Field: 'dataAvailableSince', Required: 'NO', Notes: 'Date from which live system tracking begins (YYYY-MM-DD)' },
        { Field: 'historicalCostNote', Required: 'NO', Notes: 'Source of historical figures — e.g. "From service register 2021-2024"' },
        { Field: 'depreciationMethod', Required: 'NO', Notes: 'SL (Straight Line) or DB (Declining Balance). Leave blank to skip depreciation setup.' },
        { Field: 'depreciationRate', Required: 'NO', Notes: 'Annual depreciation rate in %. E.g. 10 for 10%.' },
        { Field: 'expectedLifeYears', Required: 'NO', Notes: 'Total expected useful life of the asset in years.' },
        { Field: 'depreciationStart', Required: 'NO', Notes: 'Date depreciation began (usually purchaseDate). YYYY-MM-DD format.' },
        { Field: 'openingAccumulatedDepreciation', Required: 'NO', Notes: 'Amount already depreciated before system onboarding (INR). Sets correct opening book value = purchaseCost − this value.' },
    ];
    const wb = xlsx_1.default.utils.book_new();
    // Sheet 1: Assets (with example rows)
    const assetsWs = xlsx_1.default.utils.json_to_sheet(assetsExample, { header: assetsHeaders });
    // Style header row width (approximate)
    assetsWs['!cols'] = assetsHeaders.map(h => ({ wch: Math.max(h.length + 4, 18) }));
    xlsx_1.default.utils.book_append_sheet(wb, assetsWs, 'Assets');
    // Sheet 2: Instructions
    const instrWs = xlsx_1.default.utils.json_to_sheet(instructions);
    instrWs['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 60 }];
    xlsx_1.default.utils.book_append_sheet(wb, instrWs, 'Instructions');
    const buffer = xlsx_1.default.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=legacy-asset-import-template.xlsx');
    res.send(buffer);
};
exports.downloadLegacyTemplate = downloadLegacyTemplate;

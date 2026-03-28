import { Request, Response } from 'express';
import fs from 'fs';
import XLSX from 'xlsx';
import prisma from '../../prismaClient';

function parseDate(value: any): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;

    if (typeof value === 'number') {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(excelEpoch.getTime() + value * 86400000);
    }

    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

function toBool(value: any): boolean | null {
    if (value === true || value === false) return value;
    if (value == null || value === '') return null;

    const v = String(value).trim().toLowerCase();
    if (['yes', 'true', '1', 'y'].includes(v)) return true;
    if (['no', 'false', '0', 'n'].includes(v)) return false;
    return null;
}

function toNumber(value: any): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return isNaN(n) ? null : n;
}

function toStringOrNull(value: any): string | null {
    if (value == null || value === '') return null;
    return String(value).trim();
}

function getFinancialYearParts(date = new Date()) {
    const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    const nextYear = year + 1;

    const fyStart = String(year).slice(-2);
    const fyEnd = String(nextYear).slice(-2);

    return { fyStart, fyEnd };
}

async function createAssetWithGeneratedId(assetData: any) {
    const now = new Date();

    const fyStart = now.getMonth() >= 3
        ? now.getFullYear()
        : now.getFullYear() - 1;

    const fyEnd = fyStart + 1;
    const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
    const prefix = `AST-${fyStr}-`;

    const existing = await prisma.asset.findMany({
        where: {
            assetId: {
                startsWith: prefix
            }
        },
        select: {
            assetId: true
        }
    });

    let maxSeq = 0;

    for (const row of existing) {
        const parts = row.assetId.split("-");

        if (parts.length !== 4) continue;

        const seq = Number(parts[3]);

        if (Number.isInteger(seq) && seq > maxSeq) {
            maxSeq = seq;
        }
    }

    for (let seq = maxSeq + 1; seq <= maxSeq + 100; seq++) {
        const candidate = `${prefix}${String(seq).padStart(3, "0")}`;

        const exists = await prisma.asset.findUnique({
            where: { assetId: candidate },
            select: { id: true }
        });

        if (exists) continue;

        try {
            return await prisma.asset.create({
                data: {
                    assetId: candidate,
                    ...assetData
                }
            });
        } catch (err: any) {
            if (err.code === 'P2002') continue;
            throw err;
        }
    }

    throw new Error('Unable to generate unique assetId after scanning available sequence range');
}

async function generateAssetId(): Promise<string> {
    const now = new Date();

    const fyStart = now.getMonth() >= 3
        ? now.getFullYear()
        : now.getFullYear() - 1;

    const fyEnd = fyStart + 1;
    const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
    const prefix = `AST-${fyStr}-`;

    const existing = await prisma.asset.findMany({
        where: {
            assetId: {
                startsWith: prefix
            }
        },
        select: {
            assetId: true
        }
    });

    let maxSeq = 0;

    for (const row of existing) {
        const parts = row.assetId.split("-");

        // Expect: AST-FY2025-26-007  => 4 parts
        if (parts.length !== 4) continue;

        const lastPart = parts[3];
        const seq = Number(lastPart);

        if (Number.isInteger(seq) && seq > maxSeq) {
            maxSeq = seq;
        }
    }

    return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}
async function generateSubAssetId(parentAsset: any): Promise<string> {

    const existingSubAssets = await prisma.asset.findMany({
        where: {
            parentAssetId: parentAsset.id
        },
        select: {
            assetId: true
        }
    });

    let maxSeq = 0;

    for (const item of existingSubAssets) {

        const suffix = item.assetId.split("-").pop();

        if (suffix && /^\d{3}$/.test(suffix)) {
            const num = Number(suffix);
            if (num > maxSeq) maxSeq = num;
        }
    }

    const next = String(maxSeq + 1).padStart(3, "0");

    return `${parentAsset.assetId}-${next}`;
}

async function getOrCreateVendor(row: any): Promise<number | null> {
    if (!row.vendorName) return null;

    const vendor = await prisma.vendor.upsert({
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
}

async function getOrCreateDepartment(name: any): Promise<number | null> {
    if (!name) return null;

    const dept = await prisma.department.upsert({
        where: { name: String(name).trim() },
        update: {},
        create: { name: String(name).trim() }
    });

    return dept.id;
}

async function getOrCreateBranch(name: any): Promise<number | null> {
    if (!name) return null;

    const branch = await prisma.branch.upsert({
        where: { name: String(name).trim() },
        update: {},
        create: { name: String(name).trim() }
    });

    return branch.id;
}

async function getEmployeeIdByCode(employeeCode: any): Promise<number | null> {
    if (!employeeCode) return null;

    const emp = await prisma.employee.findUnique({
        where: { employeeID: String(employeeCode).trim() }
    });

    return emp?.id ?? null;
}

async function findAssetByReferenceCode(referenceCode: any) {
    if (!referenceCode) return null;

    return prisma.asset.findUnique({
        where: { referenceCode: String(referenceCode).trim() }
    });
}

async function findAssetByReferenceOrSerial(referenceCode: any, serialNumber: any) {
    let asset = null;

    if (referenceCode) {
        asset = await prisma.asset.findUnique({
            where: { referenceCode: String(referenceCode).trim() }
        });
    }

    if (!asset && serialNumber) {
        asset = await prisma.asset.findUnique({
            where: { serialNumber: String(serialNumber).trim() }
        });
    }

    return asset;
}

export async function importAssetsExcel(req: Request, res: Response) {
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
        errors: [] as any[],
    };

    try {
        const workbook = XLSX.readFile(file.path);

        const readSheet = (name: string) =>
            workbook.Sheets[name]
                ? XLSX.utils.sheet_to_json<any>(workbook.Sheets[name], { defval: '' })
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
                if (!row.employeeID || !row.name) continue;

                let departmentId: number | null = null;

                if (row.departmentName) {
                    const dept = await prisma.department.upsert({
                        where: { name: String(row.departmentName).trim() },
                        update: {},
                        create: { name: String(row.departmentName).trim() }
                    });
                    departmentId = dept.id;
                }

                const role = toStringOrNull(row.role) || 'EXECUTIVE';

                await prisma.employee.upsert({
                    where: { employeeID: String(row.employeeID).trim() },
                    update: {
                        name: String(row.name).trim(),
                        departmentId,
                        role: role as any
                    },
                    create: {
                        employeeID: String(row.employeeID).trim(),
                        name: String(row.name).trim(),
                        departmentId,
                        role: role as any
                    }
                });

                summary.employeesUpserted++;
            } catch (err: any) {
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
                if (!row.referenceCode || !row.assetName || !row.assetType || !row.assetCategory) {
                    summary.errors.push({
                        sheet: 'Assets',
                        row: i + 2,
                        message: 'referenceCode, assetName, assetType, assetCategory are required'
                    });
                    continue;
                }

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

                // ---------------------------
                // Mode-based validation
                // ---------------------------
                if (modeOfProcurement === 'PURCHASE') {
                    if (!row.vendorName || !row.purchaseCost) {
                        summary.errors.push({
                            sheet: 'Assets',
                            row: i + 2,
                            message: 'For PURCHASE, vendorName and purchaseCost are required'
                        });
                        continue;
                    }
                }

                if (modeOfProcurement === 'DONATION') {
                    if (!row.donorName || !row.donationDate) {
                        summary.errors.push({
                            sheet: 'Assets',
                            row: i + 2,
                            message: 'For DONATION, donorName and donationDate are required'
                        });
                        continue;
                    }
                }

                if (modeOfProcurement === 'LEASE') {
                    if (!row.vendorName || !row.leaseStartDate || !row.leaseEndDate || !row.leaseAmount) {
                        summary.errors.push({
                            sheet: 'Assets',
                            row: i + 2,
                            message: 'For LEASE, vendorName, leaseStartDate, leaseEndDate, and leaseAmount are required'
                        });
                        continue;
                    }
                }

                if (modeOfProcurement === 'RENTAL') {
                    if (!row.vendorName || !row.rentalStartDate || !row.rentalEndDate || !row.rentalAmount) {
                        summary.errors.push({
                            sheet: 'Assets',
                            row: i + 2,
                            message: 'For RENTAL, vendorName, rentalStartDate, rentalEndDate, and rentalAmount are required'
                        });
                        continue;
                    }
                }

                const category = await prisma.assetCategory.upsert({
                    where: { name: String(row.assetCategory).trim() },
                    update: {},
                    create: { name: String(row.assetCategory).trim() }
                });

                const vendorId = await getOrCreateVendor(row);
                const departmentId = await getOrCreateDepartment(row.department);
                const targetDepartmentId = await getOrCreateDepartment(row.targetDepartment);
                const allottedToId = await getEmployeeIdByCode(row.endUserEmployeeCode);
                const supervisorId = await getEmployeeIdByCode(row.supervisorEmployeeCode);

                const existing = await findAssetByReferenceOrSerial(row.referenceCode, row.serialNumber);

                const assetData = {
                    assetName: String(row.assetName).trim(),
                    assetType: String(row.assetType).trim(),
                    assetCategoryId: category.id,
                    serialNumber: String(row.serialNumber || row.referenceCode).trim(),
                    referenceCode: String(row.referenceCode).trim(),

                    purchaseDate: parseDate(row.purchaseDate),
                    modeOfProcurement,

                    isBranded: toBool(row.isBranded) ?? false,
                    isAssembled: toBool(row.isAssembled) ?? false,
                    isCustomized: toBool(row.isCustomized) ?? false,
                    customDetails: toStringOrNull(row.customDetails),

                    hasSpecifications: toBool(row.hasSpecifications) ?? false,
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

                    //     rfidCode: toStringOrNull(row.rfidCode),
                    //     qrCode: toStringOrNull(row.qrCode),

                    //     specificationSummary: toStringOrNull(row.specificationSummary),
                    //     organogramNotes: toStringOrNull(row.organogramNotes),
                    //     ticketHierarchyNotes: toStringOrNull(row.ticketHierarchyNotes),
                    //     pmFormatNotes: toStringOrNull(row.pmFormatNotes),
                };

                if (existing) {
                    await prisma.asset.update({
                        where: { id: existing.id },
                        data: assetData
                    });
                    summary.assetsUpdated++;
                } else {
                    await createAssetWithGeneratedId(assetData);
                    summary.assetsCreated++;
                }
            } catch (err: any) {
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

                const asset = await findAssetByReferenceCode(row.referenceCode);

                if (!asset) {
                    summary.errors.push({
                        sheet: 'Specifications',
                        row: i + 2,
                        message: `Asset not found for referenceCode: ${row.referenceCode}`
                    });
                    continue;
                }

                const existingSpec = await prisma.assetSpecification.findFirst({
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
                    sortOrder: toNumber(row.sortOrder) ?? 0,
                    isMandatory: toBool(row.isMandatory) ?? false,
                    source: toStringOrNull(row.source),
                    remarks: toStringOrNull(row.remarks),
                };

                if (existingSpec) {
                    await prisma.assetSpecification.update({
                        where: { id: existingSpec.id },
                        data: specData
                    });
                    summary.specificationsUpdated++;
                } else {
                    await prisma.assetSpecification.create({
                        data: specData
                    });
                    summary.specificationsCreated++;
                }
            } catch (err: any) {
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
                if (!row.referenceCode) continue;

                const asset = await findAssetByReferenceCode(row.referenceCode);

                if (!asset) {
                    summary.errors.push({
                        sheet: 'Warranty',
                        row: i + 2,
                        message: `Asset not found for referenceCode: ${row.referenceCode}`
                    });
                    continue;
                }

                const vendorId = await getOrCreateVendor(row);
                const isUnderWarranty = toBool(row.isUnderWarranty) ?? false;
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

                const existingActive = await prisma.warranty.findFirst({
                    where: {
                        assetId: asset.id,
                        isActive: true,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                });

                if (existingActive) {
                    await prisma.warranty.update({
                        where: { id: existingActive.id },
                        data: payload,
                    });
                } else {
                    await prisma.warranty.create({
                        data: {
                            assetId: asset.id,
                            isActive: true,
                            ...payload,
                        },
                    });
                }

                summary.warrantiesUpserted++;
            } catch (err: any) {
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

                const asset = await findAssetByReferenceCode(row.referenceCode);

                if (!asset) {
                    summary.errors.push({
                        sheet: 'ServiceContracts',
                        row: i + 2,
                        message: `Asset not found for referenceCode: ${row.referenceCode}`
                    });
                    continue;
                }

                const vendorId = await getOrCreateVendor(row);

                await prisma.serviceContract.create({
                    data: {
                        assetId: asset.id,
                        vendorId,
                        contractType: String(row.contractType).trim(),
                        contractNumber: toStringOrNull(row.contractNumber),
                        startDate: parseDate(row.startDate)!,
                        endDate: parseDate(row.endDate)!,
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
            } catch (err: any) {
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

                const asset = await findAssetByReferenceCode(row.referenceCode);

                if (!asset) {
                    summary.errors.push({
                        sheet: 'Locations',
                        row: i + 2,
                        message: `Asset not found for referenceCode: ${row.referenceCode}`
                    });
                    continue;
                }

                const branchId = await getOrCreateBranch(row.branchName);
                const employeeResponsibleId = await getEmployeeIdByCode(row.employeeResponsibleCode);

                await prisma.assetLocation.create({
                    data: {
                        assetId: asset.id,
                        branchId: branchId!,
                        block: toStringOrNull(row.block),
                        floor: toStringOrNull(row.floor),
                        room: toStringOrNull(row.room),
                        departmentSnapshot: toStringOrNull(row.departmentSnapshot),
                        employeeResponsibleId,
                        isActive: toBool(row.isActive) ?? true,
                    }
                });

                summary.locationsCreated++;
            } catch (err: any) {
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
                if (!row.parentReferenceCode || !row.referenceCode || !row.assetName || !row.assetType || !row.assetCategory) {
                    summary.errors.push({
                        sheet: 'SubAssets',
                        row: i + 2,
                        message: 'parentReferenceCode,referenceCode, assetName, assetType, assetCategory are required'
                    });
                    continue;
                }

                const parent = await findAssetByReferenceCode(row.parentReferenceCode);

                if (!parent) {
                    summary.errors.push({
                        sheet: 'SubAssets',
                        row: i + 2,
                        message: `Parent asset not found for parentReferenceCode: ${row.parentReferenceCode}`
                    });
                    continue;
                }

                const category = await prisma.assetCategory.upsert({
                    where: { name: String(row.assetCategory).trim() },
                    update: {},
                    create: { name: String(row.assetCategory).trim() }
                });

                let existingSubAsset = null;

                if (row.referenceCode) {
                    existingSubAsset = await prisma.asset.findUnique({
                        where: { referenceCode: String(row.referenceCode).trim() }
                    });
                }

                if (!existingSubAsset && row.serialNumber) {
                    existingSubAsset = await prisma.asset.findUnique({
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
                    isBranded: toBool(row.isBranded) ?? false,
                    isAssembled: toBool(row.isAssembled) ?? false,
                    isCustomized: toBool(row.isCustomized) ?? false,
                    customDetails: toStringOrNull(row.customDetails),
                    hasSpecifications: toBool(row.hasSpecifications) ?? false,
                    specificationSummary: toStringOrNull(row.specificationSummary),
                };

                if (existingSubAsset) {
                    await prisma.asset.update({
                        where: { id: existingSubAsset.id },
                        data: subAssetData
                    });
                    summary.subAssetsUpdated++;
                } else {
                    const generatedSubAssetId = await generateSubAssetId(parent);

                    await prisma.asset.create({
                        data: {
                            assetId: generatedSubAssetId,
                            ...subAssetData
                        }
                    });

                    summary.subAssetsCreated++;
                }
            } catch (err: any) {
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

                const asset = await findAssetByReferenceCode(row.referenceCode);

                if (!asset) {
                    summary.errors.push({
                        sheet: 'MaintenanceSchedules',
                        row: i + 2,
                        message: `Asset not found for referenceCode: ${row.referenceCode}`
                    });
                    continue;
                }

                await prisma.maintenanceSchedule.create({
                    data: {
                        assetId: asset.id,
                        frequencyValue: Number(row.frequencyValue),
                        frequencyUnit: String(row.frequencyUnit),
                        nextDueAt: parseDate(row.nextDueAt)!,
                        isActive: toBool(row.isActive) ?? true,
                        reminderDays: toNumber(row.reminderDays),
                        createdBy: toStringOrNull(row.createdBy),
                        reason: toStringOrNull(row.reason),
                    }
                });

                summary.maintenanceSchedulesCreated++;
            } catch (err: any) {
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

                const asset = await findAssetByReferenceCode(row.referenceCode);

                if (!asset) {
                    summary.errors.push({
                        sheet: 'CalibrationSchedules',
                        row: i + 2,
                        message: `Asset not found for referenceCode: ${row.referenceCode}`
                    });
                    continue;
                }

                const vendorId = await getOrCreateVendor(row);

                await prisma.calibrationSchedule.create({
                    data: {
                        assetId: asset.id,
                        frequencyValue: Number(row.frequencyValue),
                        frequencyUnit: String(row.frequencyUnit),
                        nextDueAt: parseDate(row.nextDueAt)!,
                        lastCalibratedAt: parseDate(row.lastCalibratedAt),
                        isActive: toBool(row.isActive) ?? true,
                        standardProcedure: toStringOrNull(row.standardProcedure),
                        vendorId,
                        reminderDays: toNumber(row.reminderDays),
                        notes: toStringOrNull(row.notes),
                    }
                });

                summary.calibrationSchedulesCreated++;
            } catch (err: any) {
                summary.errors.push({
                    sheet: 'CalibrationSchedules',
                    row: i + 2,
                    message: err.message
                });
            }
        }

        fs.unlinkSync(file.path);

        res.status(200).json({
            message: 'Excel imported successfully',
            summary
        });
        return;
    } catch (err: any) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        res.status(500).json({
            message: 'Import failed',
            error: err.message
        });
        return;
    }
}

async function getAssetCategoryIdByName(name: any): Promise<number | null> {
    if (!name) return null;

    const category = await prisma.assetCategory.upsert({
        where: { name: String(name).trim() },
        update: {},
        create: { name: String(name).trim() }
    });

    return category.id;
}

async function getAssetIdByReferenceCode(referenceCode: any): Promise<number | null> {
    if (!referenceCode) return null;

    const asset = await prisma.asset.findUnique({
        where: { referenceCode: String(referenceCode).trim() }
    });

    return asset?.id ?? null;
}

export async function importChecklistWorkbook(req: Request, res: Response) {
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
        errors: [] as any[],
    };

    try {
        const workbook = XLSX.readFile(file.path);

        const readSheet = (name: string) =>
            workbook.Sheets[name]
                ? XLSX.utils.sheet_to_json<any>(workbook.Sheets[name], { defval: '' })
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

                const assetCategoryId = await getAssetCategoryIdByName(row.assetCategory);
                const assetId = await getAssetIdByReferenceCode(row.referenceCode);

                let template = await prisma.assetAcknowledgementTemplate.findFirst({
                    where: {
                        name: String(row.templateName).trim(),
                        assetCategoryId: assetCategoryId ?? undefined,
                        assetId: assetId ?? undefined,
                    }
                });

                if (!template) {
                    template = await prisma.assetAcknowledgementTemplate.create({
                        data: {
                            name: String(row.templateName).trim(),
                            description: toStringOrNull(row.description),
                            assetCategoryId,
                            assetId,
                            isActive: toBool(row.isActive) ?? true,
                        }
                    });
                    summary.acknowledgementTemplatesCreated++;
                }

                const existingItem = await prisma.assetAcknowledgementItem.findFirst({
                    where: {
                        templateId: template.id,
                        title: String(row.itemTitle).trim(),
                    }
                });

                if (!existingItem) {
                    await prisma.assetAcknowledgementItem.create({
                        data: {
                            templateId: template.id,
                            title: String(row.itemTitle).trim(),
                            description: toStringOrNull(row.itemDescription),
                            sortOrder: toNumber(row.sortOrder) ?? 0,
                            isRequired: toBool(row.isRequired) ?? true,
                        }
                    });
                    summary.acknowledgementItemsCreated++;
                }
            } catch (err: any) {
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

                const assetCategoryId = await getAssetCategoryIdByName(row.assetCategory);
                const assetId = await getAssetIdByReferenceCode(row.referenceCode);

                let template = await prisma.pMChecklistTemplate.findFirst({
                    where: {
                        name: String(row.templateName).trim(),
                        assetCategoryId: assetCategoryId ?? undefined,
                        assetId: assetId ?? undefined,
                    }
                });

                if (!template) {
                    template = await prisma.pMChecklistTemplate.create({
                        data: {
                            name: String(row.templateName).trim(),
                            description: toStringOrNull(row.description),
                            pmFormatCode: toStringOrNull(row.pmFormatCode),
                            assetCategoryId,
                            assetId,
                            isActive: toBool(row.isActive) ?? true,
                        }
                    });
                    summary.pmTemplatesCreated++;
                }

                const existingItem = await prisma.pMChecklistItem.findFirst({
                    where: {
                        templateId: template.id,
                        title: String(row.itemTitle).trim(),
                    }
                });

                if (!existingItem) {
                    await prisma.pMChecklistItem.create({
                        data: {
                            templateId: template.id,
                            title: String(row.itemTitle).trim(),
                            description: toStringOrNull(row.itemDescription),
                            itemType: toStringOrNull(row.itemType),
                            expectedValue: toStringOrNull(row.expectedValue),
                            unit: toStringOrNull(row.unit),
                            sortOrder: toNumber(row.sortOrder) ?? 0,
                            isRequired: toBool(row.isRequired) ?? true,
                        }
                    });
                    summary.pmItemsCreated++;
                }
            } catch (err: any) {
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

                const assetCategoryId = await getAssetCategoryIdByName(row.assetCategory);
                const assetId = await getAssetIdByReferenceCode(row.referenceCode);

                let template = await prisma.calibrationChecklistTemplate.findFirst({
                    where: {
                        name: String(row.templateName).trim(),
                        assetCategoryId: assetCategoryId ?? undefined,
                        assetId: assetId ?? undefined,
                    }
                });

                if (!template) {
                    template = await prisma.calibrationChecklistTemplate.create({
                        data: {
                            name: String(row.templateName).trim(),
                            description: toStringOrNull(row.description),
                            assetCategoryId,
                            assetId,
                            isActive: toBool(row.isActive) ?? true,
                        }
                    });
                    summary.calibrationTemplatesCreated++;
                }

                const existingItem = await prisma.calibrationChecklistItem.findFirst({
                    where: {
                        templateId: template.id,
                        title: String(row.itemTitle).trim(),
                    }
                });

                if (!existingItem) {
                    await prisma.calibrationChecklistItem.create({
                        data: {
                            templateId: template.id,
                            title: String(row.itemTitle).trim(),
                            description: toStringOrNull(row.itemDescription),
                            expectedValue: toStringOrNull(row.expectedValue),
                            unit: toStringOrNull(row.unit),
                            sortOrder: toNumber(row.sortOrder) ?? 0,
                            isRequired: toBool(row.isRequired) ?? true,
                        }
                    });
                    summary.calibrationItemsCreated++;
                }
            } catch (err: any) {
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

                const assetCategoryId = await getAssetCategoryIdByName(row.assetCategory);
                const assetId = await getAssetIdByReferenceCode(row.referenceCode);
                const employeeId = await getEmployeeIdByCode(row.employeeCode);

                const exists = await prisma.assetSupportMatrix.findFirst({
                    where: {
                        assetCategoryId: assetCategoryId ?? undefined,
                        assetId: assetId ?? undefined,
                        levelNo: Number(row.levelNo),
                        roleName: toStringOrNull(row.roleName),
                        personName: toStringOrNull(row.personName),
                    }
                });

                if (!exists) {
                    await prisma.assetSupportMatrix.create({
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
            } catch (err: any) {
                summary.errors.push({
                    sheet: 'AssetSupportMatrix',
                    row: i + 2,
                    message: err.message
                });
            }
        }

        fs.unlinkSync(file.path);

        res.status(200).json({
            message: 'Checklist workbook imported successfully',
            summary
        });
        return;
    } catch (err: any) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        res.status(500).json({
            message: 'Checklist workbook import failed',
            error: err.message
        });
        return;
    }
}
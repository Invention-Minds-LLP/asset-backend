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
exports.getAssetScanDetails = exports.updateAssetSpecification = exports.getAssetSpecifications = exports.createAssetSpecification = exports.updateAssetAssignment = exports.uploadAssetImage = exports.getAssetByAssetId = exports.deleteAsset = exports.updateAsset = exports.createAsset = exports.getAssetById = exports.getAllAssets = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const basic_ftp_1 = require("basic-ftp");
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
// export const getAllAssets = async (req: Request, res: Response) => {
//   const assets = await prisma.asset.findMany(
//     {
//       include: { assetCategory: true, vendor: true, department: true, allottedTo: true }
//     });
//   res.json(assets);
// };
const getAllAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user; // from auth middleware
        const role = user === null || user === void 0 ? void 0 : user.role;
        const departmentId = user === null || user === void 0 ? void 0 : user.departmentId;
        const employeeDbId = (user === null || user === void 0 ? void 0 : user.employeeDbId) || (user === null || user === void 0 ? void 0 : user.employeeId) || (user === null || user === void 0 ? void 0 : user.id);
        console.log(user);
        let where = {};
        if (role === 'ADMIN') {
            where = {};
        }
        else if (role === 'HOD') {
            where = {
                departmentId: Number(departmentId)
            };
        }
        else if (role === 'SUPERVISOR') {
            where = {
                supervisorId: Number(employeeDbId)
            };
        }
        else {
            where = {
                id: -1
            };
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where,
            include: {
                assetCategory: true,
                vendor: true,
                department: true,
                allottedTo: true,
                supervisor: true
            }
        });
        res.json(assets);
    }
    catch (error) {
        console.error('getAllAssets error:', error);
        res.status(500).json({ message: 'Failed to fetch assets' });
    }
});
exports.getAllAssets = getAllAssets;
const getAssetById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    const asset = yield prismaClient_1.default.asset.findUnique({
        where: { id },
        include: {
            assetCategory: true,
            vendor: true,
            department: true,
            allottedTo: true
        }
    });
    if (!asset) {
        res.status(404).json({ message: "Asset not found" });
        return;
    }
    res.json(asset);
});
exports.getAssetById = getAssetById;
// export const createAsset = async (req: Request, res: Response) => {
//     // 1️⃣ Determine the financial year (e.g., FY2025-26)
//     const now = new Date();
//     const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
//     const fyEndYear = fyStartYear + 1;
//     const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, '0')}`;
//     // 2️⃣ Find the latest asset ID in this FY
//     const latestAsset = await prisma.asset.findFirst({
//         where: {
//             assetId: {
//                 startsWith: `AST-${fyString}`
//             }
//         },
//         orderBy: {
//             id: 'desc'
//         }
//     });
//     // 3️⃣ Extract last sequence number or start at 0
//     let nextNumber = 1;
//     if (latestAsset) {
//         const parts = latestAsset.assetId.split('-');
//         const lastSeq = parseInt(parts[3], 10);
//         nextNumber = lastSeq + 1;
//     }
//     // 4️⃣ Generate asset ID
//     const assetId = `AST-${fyString}-${nextNumber.toString().padStart(3, '0')}`;
//     const {
//         assetCategoryId,
//         vendorId,
//         departmentId,
//         allottedToId,
//         ...rest
//       } = req.body;
//       const asset = await prisma.asset.create({
//         data: {
//           ...rest,
//           assetId,  // generated assetId
//           assetCategory: { connect: { id: assetCategoryId } },
//           vendor: { connect: { id: vendorId } },
//           department: { connect: { id: departmentId } },
//           allottedTo: { connect: { id: allottedToId } },
//         }
//       });
//     res.status(201).json(asset);
// };
const createAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // if (req.user.role !== "store_user" && req.user.role !== "superadmin") {
        //   res.status(403).json({ message: "Only store users can create assets" });
        //   return
        // }
        // Financial Year ID (AST-FY2025-26-001)
        const now = new Date();
        const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEnd = fyStart + 1;
        const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
        const latest = yield prismaClient_1.default.asset.findFirst({
            where: {
                assetId: { startsWith: `AST-${fyStr}` },
                parentAssetId: null
            },
            orderBy: { id: "desc" }
        });
        console.log(latest);
        let next = 1;
        if (latest) {
            next = parseInt(latest.assetId.split("-")[3], 10) + 1;
        }
        const assetId = `AST-${fyStr}-${next.toString().padStart(3, "0")}`;
        const data = req.body;
        const asset = yield prismaClient_1.default.asset.create({
            data: {
                assetId,
                assetName: data.assetName,
                assetType: data.assetType,
                assetCategoryId: data.assetCategoryId,
                // rfidCode: data.rfidCode ?? null,
                rfidCode: data.rfidCode && String(data.rfidCode).trim() !== ""
                    ? String(data.rfidCode).trim()
                    : null,
                referenceCode: data.referenceCode ? String(data.referenceCode).trim() : null,
                serialNumber: data.serialNumber,
                assetPhoto: (_a = data.assetPhoto) !== null && _a !== void 0 ? _a : null,
                modeOfProcurement: data.modeOfProcurement,
                // PURCHASE
                invoiceNumber: data.invoiceNumber,
                purchaseOrderNo: data.purchaseOrderNo,
                purchaseOrderDate: data.purchaseOrderDate ? new Date(data.purchaseOrderDate) : null,
                purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
                purchaseCost: data.purchaseCost,
                vendorId: data.vendorId,
                // DONATION
                donorName: data.donorName,
                donationDate: data.donationDate ? new Date(data.donationDate) : null,
                assetCondition: data.assetCondition,
                estimatedValue: data.estimatedValue,
                donationDocument: data.donationDocument,
                // LEASE
                leaseStartDate: data.leaseStartDate ? new Date(data.leaseStartDate) : null,
                leaseEndDate: data.leaseEndDate ? new Date(data.leaseEndDate) : null,
                leaseAmount: data.leaseAmount,
                leaseRenewalDate: data.leaseRenewalDate ? new Date(data.leaseRenewalDate) : null,
                leaseContractDoc: data.leaseContractDoc,
                // RENTAL
                rentalStartDate: data.rentalStartDate ? new Date(data.rentalStartDate) : null,
                rentalEndDate: data.rentalEndDate ? new Date(data.rentalEndDate) : null,
                rentalAmount: data.rentalAmount,
                rentalAgreementDoc: data.rentalAgreementDoc,
                // GRN
                grnNumber: data.grnNumber,
                grnDate: data.grnDate ? new Date(data.grnDate) : null,
                grnValue: data.grnValue,
                inspectionStatus: data.inspectionStatus,
                inspectionRemarks: data.inspectionRemarks,
                departmentId: data.departmentId ? Number(data.departmentId) : null,
                status: "PENDING_COMPLETION"
            }
        });
        res.status(201).json(asset);
        return;
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error creating asset" });
    }
});
exports.createAsset = createAsset;
// export const completeAssetDetails = async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
//       res.status(403).json({ message: "Only department users can complete assets" });
//       return
//     }
//     const id = parseInt(req.params.id);
//     const data = req.body;
//     const updated = await prisma.asset.update({
//       where: { id },
//       data: {
//         departmentId: data.departmentId,
//         allottedToId: data.allottedToId,
//         rfidCode: data.rfidCode,
//         slaExpectedValue: data.slaExpectedValue,
//         slaExpectedUnit: data.slaExpectedUnit,
//         slaDetails: data.slaDetails,
//         expectedLifetime: data.expectedLifetime,
//         expectedLifetimeUnit: data.expectedLifetimeUnit,
//         status: "ACTIVE"
//       }
//     });
//     // Also create a location history entry
//     await prisma.assetLocation.create({
//       data: {
//         assetId: id,
//         branchId: data.branchId,
//         block: data.block,
//         floor: data.floor,
//         room: data.room,
//         employeeResponsibleId: data.employeeResponsibleId,
//         isActive: true
//       }
//     });
//     res.json(updated);
//     return
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Error completing asset details" });
//     return
//   }
// };
// export const adminUpdateAsset = async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     if (req.user.role !== "superadmin") {
//       res.status(403).json({ message: "Admins only" });
//       return;
//     }
//     const id = parseInt(req.params.id);
//     const data = req.body;
//     const updated = await prisma.asset.update({
//       where: { id },
//       data
//     });
//     res.json(updated);
//     return;
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Admin update failed" });
//     return
//   }
// };
// export const updateAsset = async (req: Request, res: Response) => {
//   const id = parseInt(req.params.id);
//   const {
//     assetId,
//     assetName,
//     assetType,
//     serialNumber,
//     purchaseDate,
//     rfidCode,
//     currentLocation,
//     status,
//     assetCategoryId,
//     vendorId,
//     departmentId,
//     allottedToId,
//     expectedLifetime,
//     expectedLifetimeUnit,
//     slaExpectedValue,
//     slaExpectedUnit
//   } = req.body;
//   const asset = await prisma.asset.update({
//     where: { id },
//     data: {
//       assetId,
//       assetName,
//       assetType,
//       serialNumber,
//       purchaseDate,
//       rfidCode,
//       currentLocation,
//       status,
//       expectedLifetime,
//       expectedLifetimeUnit,
//       slaExpectedValue,
//       slaExpectedUnit,
//       assetCategory: {
//         connect: { id: assetCategoryId },
//       },
//       vendor: {
//         connect: { id: vendorId },
//       },
//       department: {
//         connect: { id: departmentId },
//       },
//       allottedTo: {
//         connect: { id: allottedToId },
//       },
//     },
//     include: {
//       assetCategory: true,
//       vendor: true,
//       department: true,
//       allottedTo: true,
//     },
//   });
//   res.json(asset);
// };
const updateAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const data = req.body;
        const updateData = {
            assetName: data.assetName,
            assetType: data.assetType,
            referenceCode: data.referenceCode ? String(data.referenceCode).trim() : null,
            serialNumber: data.serialNumber,
            assetPhoto: data.assetPhoto,
            rfidCode: data.rfidCode,
            modeOfProcurement: data.modeOfProcurement,
            // GRN
            grnNumber: data.grnNumber,
            grnDate: data.grnDate ? new Date(data.grnDate) : null,
            grnValue: data.grnValue ? Number(data.grnValue) : null,
            inspectionStatus: data.inspectionStatus,
            inspectionRemarks: data.inspectionRemarks,
            // Lifetime
            expectedLifetime: data.expectedLifetime ? Number(data.expectedLifetime) : null,
            expectedLifetimeUnit: data.expectedLifetimeUnit || null,
            slaCategory: data.slaCategory || null,
            // SLA
            slaExpectedValue: data.slaExpectedValue ? Number(data.slaExpectedValue) : null,
            slaExpectedUnit: data.slaExpectedUnit || null,
            // slaDetails: data.slaDetails,
            status: data.status,
        };
        // ---------------------------
        // CATEGORY (SAFE CONNECT)
        // ---------------------------
        if (data.assetCategoryId) {
            updateData.assetCategory = {
                connect: { id: Number(data.assetCategoryId) }
            };
        }
        // ---------------------------
        // VENDOR (SAFE CONNECT)
        // ---------------------------
        if (data.vendorId) {
            updateData.vendor = {
                connect: { id: Number(data.vendorId) }
            };
        }
        // ---------------------------
        // DEPARTMENT
        // ---------------------------
        if (data.departmentId) {
            updateData.department = {
                connect: { id: Number(data.departmentId) }
            };
        }
        // ---------------------------
        // ALLOTTED TO
        // ---------------------------
        if (data.allottedToId) {
            updateData.allottedTo = {
                connect: { id: Number(data.allottedToId) }
            };
        }
        if (data.supervisorId) {
            updateData.supervisor = {
                connect: { id: Number(data.supervisorId) }
            };
        }
        // ---------------------------
        // MODE-BASED FIELDS
        // ---------------------------
        if (data.modeOfProcurement === "PURCHASE") {
            Object.assign(updateData, {
                purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
                invoiceNumber: data.invoiceNumber,
                purchaseOrderNo: data.purchaseOrderNo,
                purchaseOrderDate: data.purchaseOrderDate ? new Date(data.purchaseOrderDate) : null,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
                purchaseCost: data.purchaseCost ? Number(data.purchaseCost) : null
            });
        }
        if (data.modeOfProcurement === "DONATION") {
            Object.assign(updateData, {
                donorName: data.donorName,
                donationDate: data.donationDate ? new Date(data.donationDate) : null,
                assetCondition: data.assetCondition,
                estimatedValue: data.estimatedValue ? Number(data.estimatedValue) : null,
                donationDocument: data.donationDocument,
            });
        }
        if (data.modeOfProcurement === "LEASE") {
            Object.assign(updateData, {
                leaseStartDate: data.leaseStartDate ? new Date(data.leaseStartDate) : null,
                leaseEndDate: data.leaseEndDate ? new Date(data.leaseEndDate) : null,
                leaseAmount: data.leaseAmount ? Number(data.leaseAmount) : null,
                leaseRenewalDate: data.leaseRenewalDate ? new Date(data.leaseRenewalDate) : null,
                leaseContractDoc: data.leaseContractDoc
            });
        }
        if (data.modeOfProcurement === "RENTAL") {
            Object.assign(updateData, {
                rentalStartDate: data.rentalStartDate ? new Date(data.rentalStartDate) : null,
                rentalEndDate: data.rentalEndDate ? new Date(data.rentalEndDate) : null,
                rentalAmount: data.rentalAmount ? Number(data.rentalAmount) : null,
                rentalAgreementDoc: data.rentalAgreementDoc
            });
        }
        const updated = yield prismaClient_1.default.asset.update({
            where: { id },
            data: updateData,
            include: {
                assetCategory: true,
                vendor: true,
                department: true,
                allottedTo: true,
            },
        });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Asset update error", error: err.message });
    }
});
exports.updateAsset = updateAsset;
const deleteAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    yield prismaClient_1.default.asset.delete({ where: { id } });
    res.status(204).send();
});
exports.deleteAsset = deleteAsset;
const getAssetByAssetId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId } = req.params;
        const asset = yield prismaClient_1.default.asset.findFirst({
            where: { assetId },
            include: {
                depreciation: true,
                insurance: true,
                // ✅ CURRENT LOCATION ONLY
                locations: {
                    where: { isActive: true },
                    take: 1,
                    include: {
                        branch: true,
                        employeeResponsible: true
                    }
                },
                // ✅ TRANSFER HISTORY (latest first)
                transfers: {
                    orderBy: { transferDate: "desc" },
                    include: {
                        fromBranch: true,
                        toBranch: true
                    }
                }
            }
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        res.json(asset);
    }
    catch (err) {
        console.error("getAssetByAssetId error:", err);
        res.status(500).json({ message: "Error fetching asset" });
    }
});
exports.getAssetByAssetId = getAssetByAssetId;
const TEMP_FOLDER = path_1.default.join(__dirname, "../../temp");
if (!fs_1.default.existsSync(TEMP_FOLDER)) {
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
}
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = true;
        try {
            yield client.access(FTP_CONFIG);
            console.log("Connected to FTP server for asset image upload");
            const remoteDir = path_1.default.dirname(remoteFilePath);
            yield client.ensureDir(remoteDir);
            yield client.uploadFrom(localFilePath, remoteFilePath);
            console.log(`Uploaded asset image to: ${remoteFilePath}`);
            yield client.close();
            const fileName = path_1.default.basename(remoteFilePath);
            return `https://smartassets.inventionminds.com/assets_images/${fileName}`;
        }
        catch (error) {
            console.error("FTP upload error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const uploadAssetImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = req.params.assetId;
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: false,
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                console.error("Formidable parse error:", err);
                res.status(500).json({ error: err.message });
                return;
            }
            if (!files.file || files.file.length === 0) {
                res.status(400).json({ error: "No image file uploaded." });
                return;
            }
            const file = files.file[0];
            const tempFilePath = file.filepath;
            const originalFileName = file.originalFilename || `asset-${Date.now()}.jpg`;
            if (!fs_1.default.existsSync(tempFilePath)) {
                res.status(500).json({ error: "Temporary image file not found." });
                return;
            }
            const remoteFilePath = `/public_html/smartassets/assets_images/${originalFileName}`;
            let fileUrl;
            try {
                fileUrl = yield uploadToFTP(tempFilePath, remoteFilePath);
                console.log("Asset image uploaded successfully:", fileUrl);
                yield prismaClient_1.default.asset.update({
                    where: { assetId: assetId.toString() },
                    data: { assetPhoto: fileUrl },
                });
            }
            catch (uploadErr) {
                console.error("Asset image upload failed:", uploadErr);
                res.status(500).json({ error: "Asset image upload failed." });
                return;
            }
            console.log("Uploaded asset image URL:", fileUrl);
            // Delete local temp file
            fs_1.default.unlinkSync(tempFilePath);
            res.json({ url: fileUrl });
            return;
        }));
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: error.message });
        return;
    }
});
exports.uploadAssetImage = uploadAssetImage;
const updateAssetAssignment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { departmentId, supervisorId, allottedToId } = req.body;
        if (!id) {
            res.status(400).json({ message: "Asset ID required" });
        }
        const updateData = {};
        if (departmentId !== undefined) {
            updateData.department = { connect: { id: Number(departmentId) } };
        }
        if (supervisorId !== undefined) {
            updateData.supervisor = { connect: { id: Number(supervisorId) } };
        }
        if (allottedToId !== undefined) {
            updateData.allottedTo = { connect: { id: Number(allottedToId) } };
        }
        updateData.status = 'active';
        const updated = yield prismaClient_1.default.asset.update({
            where: { id },
            data: updateData,
            include: {
                department: true,
                supervisor: true,
                allottedTo: true,
            }
        });
        res.json(updated);
    }
    catch (err) {
        console.error("Assignment update error:", err);
        res.status(500).json({ message: "Failed to update assignment" });
    }
});
exports.updateAssetAssignment = updateAssetAssignment;
const createAssetSpecification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, key, value, specificationGroup, valueType, unit, sortOrder, isMandatory, source, remarks, } = req.body;
        if (!assetId || !key || !value) {
            res.status(400).json({ message: "assetId, key and value are required" });
            return;
        }
        const spec = yield prismaClient_1.default.assetSpecification.create({
            data: {
                assetId: Number(assetId),
                key: String(key).trim(),
                value: String(value).trim(),
                specificationGroup: specificationGroup || null,
                valueType: valueType || null,
                unit: unit || null,
                sortOrder: sortOrder != null ? Number(sortOrder) : 0,
                isMandatory: !!isMandatory,
                source: source || null,
                remarks: remarks || null,
            }
        });
        res.status(201).json(spec);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create specification", error: err.message });
    }
});
exports.createAssetSpecification = createAssetSpecification;
const getAssetSpecifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const specs = yield prismaClient_1.default.assetSpecification.findMany({
            where: { assetId },
            orderBy: [
                { sortOrder: 'asc' },
                { id: 'asc' }
            ]
        });
        res.json(specs);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch specifications", error: err.message });
    }
});
exports.getAssetSpecifications = getAssetSpecifications;
const updateAssetSpecification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { key, value, specificationGroup, valueType, unit, sortOrder, isMandatory, source, remarks, } = req.body;
        const existing = yield prismaClient_1.default.assetSpecification.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Specification not found" });
            return;
        }
        const updated = yield prismaClient_1.default.assetSpecification.update({
            where: { id },
            data: {
                key: key ? String(key).trim() : existing.key,
                value: value ? String(value).trim() : existing.value,
                specificationGroup: specificationGroup || null,
                valueType: valueType || null,
                unit: unit || null,
                sortOrder: sortOrder != null ? Number(sortOrder) : 0,
                isMandatory: !!isMandatory,
                source: source || null,
                remarks: remarks || null,
            }
        });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update specification", error: err.message });
    }
});
exports.updateAssetSpecification = updateAssetSpecification;
const getAssetScanDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId } = req.params;
        if (!assetId || !String(assetId).trim()) {
            res.status(400).json({ message: "assetId is required" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findFirst({
            where: {
                assetId: String(assetId).trim()
            },
            include: {
                // master relations
                assetCategory: true,
                vendor: true,
                department: true,
                targetDepartment: true,
                supervisor: true,
                allottedTo: true,
                employee: true,
                // core details
                depreciation: true,
                warranty: {
                    include: {
                        vendor: true
                    }
                },
                insurance: {
                    include: {
                        claims: true
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                },
                // specifications
                specifications: {
                    orderBy: [
                        { specificationGroup: "asc" },
                        { sortOrder: "asc" },
                        { id: "asc" }
                    ]
                },
                // location
                locations: {
                    where: { isActive: true },
                    include: {
                        branch: true,
                        employeeResponsible: true
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                },
                // transfer history
                transfers: {
                    include: {
                        fromBranch: true,
                        toBranch: true
                    },
                    orderBy: {
                        transferDate: "desc"
                    }
                },
                // assignments
                assignments: {
                    include: {
                        assignedTo: true,
                        assignedBy: true,
                        employee: true,
                        assetAssignmentHistories: {
                            include: {
                                performedBy: true
                            },
                            orderBy: {
                                createdAt: "desc"
                            }
                        }
                    },
                    orderBy: {
                        assignedAt: "desc"
                    }
                },
                // tickets
                tickets: {
                    include: {
                        raisedBy: true,
                        assignedTo: true,
                        assignedBy: true,
                        department: true,
                        owningDepartment: true,
                        statusHistory: {
                            orderBy: {
                                changedAt: "desc"
                            }
                        },
                        ticketAssignmentHistories: {
                            include: {
                                fromEmployee: true,
                                toEmployee: true,
                                performedBy: true
                            },
                            orderBy: {
                                createdAt: "desc"
                            }
                        },
                        ticketTransferHistories: {
                            include: {
                                fromDepartment: true,
                                toDepartment: true,
                                vendor: true,
                                requestedBy: true,
                                approvedBy: true
                            },
                            orderBy: {
                                createdAt: "desc"
                            }
                        },
                        sparePartUsages: {
                            include: {
                                sparePart: true,
                                usedBy: true
                            },
                            orderBy: {
                                usedAt: "desc"
                            }
                        }
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                },
                // maintenance / service
                maintenanceHistory: {
                    include: {
                        serviceContract: {
                            include: {
                                vendor: true
                            }
                        },
                        ticket: true,
                        preventiveChecklistRuns: {
                            include: {
                                template: true,
                                performedBy: true,
                                results: {
                                    include: {
                                        item: true
                                    }
                                }
                            },
                            orderBy: {
                                createdAt: "desc"
                            }
                        },
                        pmChecklistRuns: {
                            include: {
                                template: true,
                                results: {
                                    include: {
                                        item: true
                                    }
                                }
                            },
                            orderBy: {
                                createdAt: "desc"
                            }
                        }
                    },
                    orderBy: {
                        actualDoneAt: "desc"
                    }
                },
                maintenanceSchedules: {
                    where: { isActive: true },
                    orderBy: {
                        nextDueAt: "asc"
                    }
                },
                // service contracts
                serviceContracts: {
                    include: {
                        vendor: true,
                        maintenanceHistories: true
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                },
                // documents
                serviceDocuments: {
                    include: {
                        uploadedBy: true
                    },
                    orderBy: {
                        uploadedAt: "desc"
                    }
                },
                // calibration
                calibrationSchedules: {
                    include: {
                        vendor: true,
                        histories: {
                            orderBy: {
                                calibratedAt: "desc"
                            }
                        }
                    },
                    orderBy: {
                        nextDueAt: "asc"
                    }
                },
                calibrationHistory: {
                    include: {
                        vendor: true,
                        schedule: true,
                        createdBy: true
                    },
                    orderBy: {
                        calibratedAt: "desc"
                    }
                },
                // checklist templates / runs
                preventiveChecklistTemplates: {
                    include: {
                        items: {
                            orderBy: {
                                sortOrder: "asc"
                            }
                        }
                    }
                },
                preventiveChecklistRuns: {
                    include: {
                        template: true,
                        performedBy: true,
                        results: {
                            include: {
                                item: true
                            }
                        }
                    },
                    orderBy: {
                        scheduledDue: "desc"
                    }
                },
                pmChecklistTemplates: {
                    include: {
                        items: {
                            orderBy: {
                                sortOrder: "asc"
                            }
                        }
                    }
                },
                pmChecklistRuns: {
                    include: {
                        template: true,
                        maintenanceHistory: true,
                        results: {
                            include: {
                                item: true
                            }
                        }
                    },
                    orderBy: {
                        scheduledDue: "desc"
                    }
                },
                acknowledgementTemplates: {
                    include: {
                        items: {
                            orderBy: {
                                sortOrder: "asc"
                            }
                        }
                    }
                },
                acknowledgementRuns: {
                    include: {
                        template: true,
                        assignedTo: true,
                        rows: {
                            include: {
                                item: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                },
                supportMatrixes: {
                    include: {
                        employee: true
                    },
                    orderBy: {
                        levelNo: "asc"
                    }
                },
                sparePartUsages: {
                    include: {
                        sparePart: true,
                        usedBy: true,
                        ticket: true
                    },
                    orderBy: {
                        usedAt: "desc"
                    }
                },
                scanLogs: {
                    include: {
                        scannedBy: true
                    },
                    orderBy: {
                        scannedAt: "desc"
                    },
                    take: 20
                },
                qrScans: {
                    include: {
                        scannedBy: true
                    },
                    orderBy: {
                        scannedAt: "desc"
                    },
                    take: 20
                },
                gatePasses: {
                    orderBy: {
                        createdAt: "desc"
                    }
                },
                depreciationLogs: {
                    include: {
                        doneBy: true
                    },
                    orderBy: {
                        periodEnd: "desc"
                    }
                },
                insuranceClaims: {
                    include: {
                        insurance: true
                    },
                    orderBy: {
                        claimDate: "desc"
                    }
                }
            }
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const response = {
            masterDetails: {
                id: asset.id,
                assetId: asset.assetId,
                assetName: asset.assetName,
                assetType: asset.assetType,
                serialNumber: asset.serialNumber,
                referenceCode: asset.referenceCode,
                modeOfProcurement: asset.modeOfProcurement,
                status: asset.status,
                assetPhoto: asset.assetPhoto,
                currentLocation: asset.currentLocation,
                fromLocation: asset.fromLocation,
                toLocation: asset.toLocation,
                rfidCode: asset.rfidCode,
                qrCode: asset.qrCode,
                qrGeneratedAt: asset.qrGeneratedAt,
                qrLabelPrinted: asset.qrLabelPrinted,
                purchaseDate: asset.purchaseDate,
                purchaseCost: asset.purchaseCost,
                installedAt: asset.installedAt,
                criticalityLevel: asset.criticalityLevel,
                riskClass: asset.riskClass,
                workingCondition: asset.workingCondition,
                healthScore: asset.healthScore,
                lastInspectionDate: asset.lastInspectionDate,
                slaExpectedValue: asset.slaExpectedValue,
                slaExpectedUnit: asset.slaExpectedUnit,
                slaNextDueAt: asset.slaNextDueAt,
                slaBreached: asset.slaBreached,
                lastSlaServiceDate: asset.lastSlaServiceDate,
                expectedLifetime: asset.expectedLifetime,
                expectedLifetimeUnit: asset.expectedLifetimeUnit,
                retiredDate: asset.retiredDate,
                retiredReason: asset.retiredReason,
                retiredBy: asset.retiredBy,
                specificationSummary: asset.specificationSummary,
                organogramNotes: asset.organogramNotes,
                ticketHierarchyNotes: asset.ticketHierarchyNotes,
                pmFormatNotes: asset.pmFormatNotes,
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
                assetCategory: asset.assetCategory,
                vendor: asset.vendor,
                department: asset.department,
                targetDepartment: asset.targetDepartment,
                supervisor: asset.supervisor,
                allottedTo: asset.allottedTo,
                employee: asset.employee
            },
            procurementDetails: {
                invoiceNumber: asset.invoiceNumber,
                purchaseOrderNo: asset.purchaseOrderNo,
                purchaseOrderDate: asset.purchaseOrderDate,
                deliveryDate: asset.deliveryDate,
                donorName: asset.donorName,
                donationDate: asset.donationDate,
                assetCondition: asset.assetCondition,
                estimatedValue: asset.estimatedValue,
                donationDocument: asset.donationDocument,
                leaseStartDate: asset.leaseStartDate,
                leaseEndDate: asset.leaseEndDate,
                leaseAmount: asset.leaseAmount,
                leaseRenewalDate: asset.leaseRenewalDate,
                leaseContractDoc: asset.leaseContractDoc,
                rentalStartDate: asset.rentalStartDate,
                rentalEndDate: asset.rentalEndDate,
                rentalAmount: asset.rentalAmount,
                rentalAgreementDoc: asset.rentalAgreementDoc,
                grnNumber: asset.grnNumber,
                grnDate: asset.grnDate,
                grnValue: asset.grnValue,
                inspectionStatus: asset.inspectionStatus,
                inspectionRemarks: asset.inspectionRemarks
            },
            specifications: asset.specifications,
            depreciation: asset.depreciation,
            depreciationLogs: asset.depreciationLogs,
            warranty: asset.warranty,
            insurance: asset.insurance,
            insuranceClaims: asset.insuranceClaims,
            currentLocations: asset.locations,
            transferHistory: asset.transfers,
            assignments: asset.assignments,
            tickets: asset.tickets,
            maintenanceHistory: asset.maintenanceHistory,
            maintenanceSchedules: asset.maintenanceSchedules,
            serviceContracts: asset.serviceContracts,
            documents: asset.serviceDocuments,
            calibrationSchedules: asset.calibrationSchedules,
            calibrationHistory: asset.calibrationHistory,
            preventiveChecklistTemplates: asset.preventiveChecklistTemplates,
            preventiveChecklistRuns: asset.preventiveChecklistRuns,
            pmChecklistTemplates: asset.pmChecklistTemplates,
            pmChecklistRuns: asset.pmChecklistRuns,
            acknowledgementTemplates: asset.acknowledgementTemplates,
            acknowledgementRuns: asset.acknowledgementRuns,
            supportMatrixes: asset.supportMatrixes,
            sparePartUsages: asset.sparePartUsages,
            qrScans: asset.qrScans,
            scanLogs: asset.scanLogs,
            gatePasses: asset.gatePasses,
        };
        res.json({
            success: true,
            message: "Asset scan details fetched successfully",
            data: response
        });
    }
    catch (err) {
        console.error("getAssetScanDetails error:", err);
        res.status(500).json({
            success: false,
            message: "Error fetching asset scan details",
            error: err.message
        });
    }
});
exports.getAssetScanDetails = getAssetScanDetails;

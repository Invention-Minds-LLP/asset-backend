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
exports.uploadContractDocument = exports.expireContracts = exports.getContractsByAsset = exports.updateServiceContract = exports.createServiceContract = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const asset_1 = require("../../utilis/asset");
function mustUser(req) {
    var _a;
    if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId))
        throw new Error("Unauthorized");
    return req.user;
}
const createServiceContract = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { assetId, // ✅ STRING (Asset.assetId)
        vendorId, contractType, // AMC | CMC
        startDate, endDate, cost, includesParts, includesLabor, visitsPerYear, document, terms, reason, currency, contractNumber, } = req.body;
        if (!assetId || !contractType || !startDate || !endDate) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        if (!["AMC", "CMC"].includes(contractType)) {
            res.status(400).json({ message: "contractType must be AMC or CMC" });
            return;
        }
        const asset = yield (0, asset_1.requireAssetByAssetId)(assetId);
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (end <= start) {
            res.status(400).json({ message: "End date must be after start date" });
            return;
        }
        // ❗ prevent overlap
        const overlapping = yield prismaClient_1.default.serviceContract.findFirst({
            where: {
                assetId: asset.id,
                startDate: { lte: end },
                endDate: { gte: start },
            },
        });
        if (overlapping) {
            res.status(400).json({ message: "Contract dates overlap with existing contract" });
            return;
        }
        // ❗ prevent contract starting during active warranty (optional business rule)
        const warrantyConflict = yield prismaClient_1.default.warranty.findFirst({
            where: {
                assetId: asset.id,
                isUnderWarranty: true,
                warrantyEnd: { gte: start },
            },
        });
        if (warrantyConflict) {
            res.status(400).json({
                message: "Warranty still active. Contract should start after warranty ends",
            });
            return;
        }
        const contract = yield prismaClient_1.default.serviceContract.create({
            data: {
                assetId: asset.id,
                vendorId: vendorId !== null && vendorId !== void 0 ? vendorId : null,
                contractType,
                contractNumber: contractNumber !== null && contractNumber !== void 0 ? contractNumber : null,
                startDate: start,
                endDate: end,
                includesParts: includesParts !== null && includesParts !== void 0 ? includesParts : null,
                includesLabor: includesLabor !== null && includesLabor !== void 0 ? includesLabor : null,
                visitsPerYear: visitsPerYear !== null && visitsPerYear !== void 0 ? visitsPerYear : null,
                cost: cost !== null && cost !== void 0 ? cost : null,
                currency: currency !== null && currency !== void 0 ? currency : null,
                document: document !== null && document !== void 0 ? document : null,
                terms: terms !== null && terms !== void 0 ? terms : null,
                status: "ACTIVE",
                createdBy: user.employeeID,
                reason: reason || null,
            },
        });
        // 🔔 Notify HOD (kept from your logic)
        if (asset.departmentId) {
            const hod = yield prismaClient_1.default.employee.findFirst({
                where: { departmentId: asset.departmentId, role: "HOD" },
            });
            if (hod) {
                const notif = yield prismaClient_1.default.notification.create({
                    data: {
                        type: "AMC_CMC_EXPIRY",
                        title: "New Service Contract Created",
                        message: `${contract.contractType} contract created for asset ${asset.assetName}`,
                        assetId: asset.id,
                        createdById: user.employeeDbId,
                    },
                });
                yield prismaClient_1.default.notificationRecipient.create({
                    data: {
                        notificationId: notif.id,
                        employeeId: hod.id,
                    },
                });
            }
        }
        res.status(201).json(contract);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createServiceContract = createServiceContract;
const updateServiceContract = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const id = Number(req.params.id);
        const existing = yield prismaClient_1.default.serviceContract.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Service contract not found" });
            return;
        }
        const { vendorId, contractType, contractNumber, startDate, endDate, includesParts, includesLabor, visitsPerYear, cost, currency, terms, status, reason, createdBy, } = req.body;
        const data = {};
        if ("vendorId" in req.body)
            data.vendorId = vendorId ? Number(vendorId) : null;
        if ("contractType" in req.body)
            data.contractType = contractType;
        if ("contractNumber" in req.body)
            data.contractNumber = contractNumber || null;
        if ("startDate" in req.body)
            data.startDate = startDate ? new Date(startDate) : null;
        if ("endDate" in req.body)
            data.endDate = endDate ? new Date(endDate) : null;
        if ("includesParts" in req.body)
            data.includesParts = typeof includesParts === "boolean" ? includesParts : null;
        if ("includesLabor" in req.body)
            data.includesLabor = typeof includesLabor === "boolean" ? includesLabor : null;
        if ("visitsPerYear" in req.body)
            data.visitsPerYear = visitsPerYear ? Number(visitsPerYear) : null;
        if ("cost" in req.body)
            data.cost = cost !== null && cost !== undefined ? Number(cost) : null;
        if ("currency" in req.body)
            data.currency = currency || null;
        if ("terms" in req.body)
            data.terms = terms || null;
        if ("status" in req.body)
            data.status = status || null;
        if ("reason" in req.body)
            data.reason = reason || null;
        if ("createdBy" in req.body)
            data.createdBy = createdBy || null;
        const finalStart = (_a = data.startDate) !== null && _a !== void 0 ? _a : existing.startDate;
        const finalEnd = (_b = data.endDate) !== null && _b !== void 0 ? _b : existing.endDate;
        if (finalStart && finalEnd && finalEnd <= finalStart) {
            res.status(400).json({ message: "Contract end must be after start date" });
            return;
        }
        const contract = yield prismaClient_1.default.serviceContract.update({
            where: { id },
            data,
            include: { vendor: true },
        });
        res.json(contract);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.updateServiceContract = updateServiceContract;
// GET /service-contracts/asset/:assetId   (assetId is STRING)
const getContractsByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const assetId = req.params.assetId;
    const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId } });
    if (!asset) {
        res.status(404).json({ message: "Asset not found" });
        return;
    }
    const contracts = yield prismaClient_1.default.serviceContract.findMany({
        where: { assetId: asset.id },
        orderBy: { startDate: "desc" },
        include: { vendor: true },
    });
    res.json(contracts);
});
exports.getContractsByAsset = getContractsByAsset;
const expireContracts = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    const expired = yield prismaClient_1.default.serviceContract.updateMany({
        where: {
            endDate: { lt: now },
            status: "ACTIVE",
        },
        data: { status: "EXPIRED" },
    });
    res.json({ message: "Contracts expired successfully", count: expired.count });
});
exports.expireContracts = expireContracts;
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
const PUBLIC_CONTRACT_DOC_BASE = process.env.PUBLIC_CONTRACT_DOC_BASE ||
    "https://smartassets.inventionminds.com/contract_docs";
const TEMP_FOLDER = path_1.default.join(__dirname, "../../temp");
if (!fs_1.default.existsSync(TEMP_FOLDER))
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        yield client.access(FTP_CONFIG);
        yield client.ensureDir(path_1.default.dirname(remoteFilePath));
        yield client.uploadFrom(localFilePath, remoteFilePath);
        yield client.close();
        return `${PUBLIC_CONTRACT_DOC_BASE}/${path_1.default.basename(remoteFilePath)}`;
    });
}
// POST /service-contracts/upload-doc
const uploadContractDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const form = (0, formidable_1.default)({ uploadDir: TEMP_FOLDER, keepExtensions: true, multiples: false });
    form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        if (err)
            return res.status(500).json({ error: "File parsing failed." });
        const assetId = ((_a = fields.assetId) === null || _a === void 0 ? void 0 : _a[0]) || "asset";
        const fileArr = files.file;
        if (!(fileArr === null || fileArr === void 0 ? void 0 : fileArr[0]))
            return res.status(400).json({ error: "No file uploaded" });
        const file = fileArr[0];
        const tempPath = file.filepath;
        const ext = path_1.default.extname(file.originalFilename || ".pdf");
        const safeName = `contract-${assetId}-${Date.now()}${ext}`;
        try {
            const remoteFilePath = `/public_html/smartassets/contract_docs/${safeName}`;
            const url = yield uploadToFTP(tempPath, remoteFilePath);
            fs_1.default.unlinkSync(tempPath);
            res.json({ url });
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: "FTP upload failed" });
        }
    }));
});
exports.uploadContractDocument = uploadContractDocument;

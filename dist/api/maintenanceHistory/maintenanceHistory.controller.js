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
exports.uploadMaintenanceReport = exports.getMaintenanceHistoryByAsset = exports.createMaintenanceRecord = exports.getMaintenanceHistory = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const basic_ftp_1 = require("basic-ftp");
/**
 * ✅ env based
 * PUBLIC_MAINT_REPORT_BASE=https://smartassets.inventionminds.com/maintenance_reports
 */
// const FTP_CONFIG = {
//   host: process.env.FTP_HOST || "",
//   user: process.env.FTP_USER || "",
//   password: process.env.FTP_PASSWORD || "",
//   secure: (process.env.FTP_SECURE || "false") === "true",
// };
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
const PUBLIC_MAINT_REPORT_BASE = process.env.PUBLIC_MAINT_REPORT_BASE ||
    "https://smartassets.inventionminds.com/maintenance_reports";
const getMaintenanceHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const history = yield prismaClient_1.default.maintenanceHistory.findMany({
        include: { asset: true, ticket: true },
        orderBy: { id: "desc" },
    });
    res.json(history);
});
exports.getMaintenanceHistory = getMaintenanceHistory;
const createMaintenanceRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // ✅ basic safe create: you can restrict fields as needed
        const record = yield prismaClient_1.default.maintenanceHistory.create({ data: req.body });
        res.status(201).json(record);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to create record" });
    }
});
exports.createMaintenanceRecord = createMaintenanceRecord;
const getMaintenanceHistoryByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const assetId = req.params.assetId; // ✅ STRING
    try {
        const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId } });
        if (!asset) {
            res.status(404).json({ error: "Asset not found" });
            return;
        }
        const history = yield prismaClient_1.default.maintenanceHistory.findMany({
            where: { assetId: asset.id },
            orderBy: { actualDoneAt: "desc" },
            include: { serviceContract: true },
        });
        res.status(200).json(history);
    }
    catch (error) {
        console.error("Error fetching maintenance history:", error);
        res.status(500).json({ error: "Failed to fetch history." });
    }
});
exports.getMaintenanceHistoryByAsset = getMaintenanceHistoryByAsset;
const TEMP_FOLDER = path_1.default.join(__dirname, "../../temp");
if (!fs_1.default.existsSync(TEMP_FOLDER))
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            const remoteDir = path_1.default.dirname(remoteFilePath);
            yield client.ensureDir(remoteDir);
            yield client.uploadFrom(localFilePath, remoteFilePath);
            yield client.close();
            const fileName = path_1.default.basename(remoteFilePath);
            return `${PUBLIC_MAINT_REPORT_BASE}/${fileName}`;
        }
        catch (error) {
            console.error("FTP upload error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const uploadMaintenanceReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const form = (0, formidable_1.default)({
        uploadDir: TEMP_FOLDER,
        keepExtensions: true,
        multiples: false,
    });
    form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (err) {
            res.status(500).json({ error: "File parsing failed." });
            return;
        }
        const assetId = (_a = fields.assetId) === null || _a === void 0 ? void 0 : _a[0];
        const scheduledDue = (_b = fields.scheduledDue) === null || _b === void 0 ? void 0 : _b[0];
        const actualDoneAt = (_c = fields.actualDoneAt) === null || _c === void 0 ? void 0 : _c[0];
        const wasLate = ((_d = fields.wasLate) === null || _d === void 0 ? void 0 : _d[0]) === "true";
        const performedBy = (_e = fields.performedBy) === null || _e === void 0 ? void 0 : _e[0];
        const notes = ((_f = fields.notes) === null || _f === void 0 ? void 0 : _f[0]) || null;
        const ticketId = ((_g = fields.ticketId) === null || _g === void 0 ? void 0 : _g[0]) || null; // optional link to ticket
        const serviceContractId = ((_h = fields.serviceContractId) === null || _h === void 0 ? void 0 : _h[0]) || null;
        if (!assetId || !scheduledDue || !actualDoneAt || !performedBy) {
            res.status(400).json({ error: "Required fields are missing." });
            return;
        }
        let fileUrl = null;
        const fileArr = files.file;
        if (fileArr && fileArr[0]) {
            const file = fileArr[0];
            const tempPath = file.filepath;
            const originalFileName = file.originalFilename || `maintenance-${Date.now()}.pdf`;
            try {
                const remoteFilePath = `/public_html/smartassets/maintenance_reports/${originalFileName}`;
                fileUrl = yield uploadToFTP(tempPath, remoteFilePath);
                fs_1.default.unlinkSync(tempPath);
            }
            catch (e) {
                res.status(500).json({ error: "FTP upload failed." });
                return;
            }
        }
        try {
            const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId } });
            if (!asset) {
                res.status(404).json({ error: "Asset not found" });
                return;
            }
            // ✅ validate contract belongs to same asset (if provided)
            let contractIdInt = null;
            if (serviceContractId) {
                contractIdInt = Number(serviceContractId);
                if (Number.isNaN(contractIdInt)) {
                    res.status(400).json({ error: "Invalid serviceContractId" });
                    return;
                }
                const contract = yield prismaClient_1.default.serviceContract.findUnique({ where: { id: contractIdInt } });
                if (!contract || contract.assetId !== asset.id) {
                    res.status(400).json({ error: "Contract does not belong to this asset" });
                    return;
                }
            }
            const saved = yield prismaClient_1.default.maintenanceHistory.create({
                data: {
                    assetId: asset.id,
                    serviceContractId: contractIdInt,
                    scheduledDue: new Date(scheduledDue),
                    actualDoneAt: new Date(actualDoneAt),
                    wasLate,
                    performedBy,
                    notes,
                    serviceReport: fileUrl,
                    ticketId: ticketId ? parseInt(ticketId) : null,
                },
            });
            res.status(200).json(saved);
            return;
        }
        catch (e) {
            console.error("DB save error:", e);
            res.status(500).json({ error: "Failed to save maintenance history" });
            return;
        }
    }));
});
exports.uploadMaintenanceReport = uploadMaintenanceReport;

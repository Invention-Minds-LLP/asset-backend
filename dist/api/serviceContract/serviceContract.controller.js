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
exports.approveVisitCharge = exports.getServiceVisits = exports.logServiceVisit = exports.uploadContractDocument = exports.expireContracts = exports.getServiceContractStats = exports.getAllServiceContracts = exports.getContractsByAsset = exports.updateServiceContract = exports.createServiceContract = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const asset_1 = require("../../utilis/asset");
const notificationHelper_1 = require("../../utilis/notificationHelper");
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
        startDate, endDate, cost, includesParts, includesLabor, visitsPerYear, document, terms, reason, currency, contractNumber, 
        // Vendor SLA commitments
        vendorResponseValue, vendorResponseUnit, vendorResolutionValue, vendorResolutionUnit, 
        // Split visit counts
        regularVisitsPerYear, emergencyVisitsPerYear, } = req.body;
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
                regularVisitsPerYear: regularVisitsPerYear != null ? Number(regularVisitsPerYear) : null,
                emergencyVisitsPerYear: emergencyVisitsPerYear != null ? Number(emergencyVisitsPerYear) : null,
                cost: cost !== null && cost !== void 0 ? cost : null,
                currency: currency !== null && currency !== void 0 ? currency : null,
                document: document !== null && document !== void 0 ? document : null,
                terms: terms !== null && terms !== void 0 ? terms : null,
                status: "ACTIVE",
                createdBy: user.employeeID,
                reason: reason || null,
                vendorResponseValue: vendorResponseValue != null ? Number(vendorResponseValue) : null,
                vendorResponseUnit: vendorResponseUnit !== null && vendorResponseUnit !== void 0 ? vendorResponseUnit : null,
                vendorResolutionValue: vendorResolutionValue != null ? Number(vendorResolutionValue) : null,
                vendorResolutionUnit: vendorResolutionUnit !== null && vendorResolutionUnit !== void 0 ? vendorResolutionUnit : null,
            },
        });
        // Fire-and-forget: notify admins about new service contract
        (0, notificationHelper_1.getAdminIds)().then(adminIds => (0, notificationHelper_1.notify)({
            type: "AMC_CMC_EXPIRY",
            title: "New Service Contract Created",
            message: `${contract.contractType} contract created for asset ${asset.assetName}`,
            recipientIds: adminIds,
            createdById: user.employeeDbId,
        })).catch(() => { });
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
        if ("vendorResponseValue" in req.body)
            data.vendorResponseValue = req.body.vendorResponseValue != null ? Number(req.body.vendorResponseValue) : null;
        if ("vendorResponseUnit" in req.body)
            data.vendorResponseUnit = req.body.vendorResponseUnit || null;
        if ("vendorResolutionValue" in req.body)
            data.vendorResolutionValue = req.body.vendorResolutionValue != null ? Number(req.body.vendorResolutionValue) : null;
        if ("vendorResolutionUnit" in req.body)
            data.vendorResolutionUnit = req.body.vendorResolutionUnit || null;
        if ("regularVisitsPerYear" in req.body)
            data.regularVisitsPerYear = req.body.regularVisitsPerYear != null ? Number(req.body.regularVisitsPerYear) : null;
        if ("emergencyVisitsPerYear" in req.body)
            data.emergencyVisitsPerYear = req.body.emergencyVisitsPerYear != null ? Number(req.body.emergencyVisitsPerYear) : null;
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
// GET /service-contracts/all (standalone page with filters, pagination, CSV)
const getAllServiceContracts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const { status, contractType, vendorId, search, page = "1", limit = "25", exportCsv, expiringDays } = req.query;
        // Department scoping: non-admin sees only their department's assets
        let scopedAssetIds;
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            const deptAssets = yield prismaClient_1.default.asset.findMany({
                where: { departmentId: Number(user.departmentId) },
                select: { id: true },
            });
            scopedAssetIds = deptAssets.map(a => a.id);
        }
        const where = {};
        if (scopedAssetIds) {
            where.assetId = { in: scopedAssetIds };
        }
        if (status)
            where.status = String(status);
        if (contractType)
            where.contractType = String(contractType);
        if (vendorId)
            where.vendorId = Number(vendorId);
        if (search) {
            where.OR = [
                { contractNumber: { contains: String(search) } },
                { asset: { assetName: { contains: String(search) } } },
                { asset: { assetId: { contains: String(search) } } },
                { vendor: { name: { contains: String(search) } } },
            ];
        }
        if (expiringDays) {
            const now = new Date();
            const future = new Date();
            future.setDate(now.getDate() + Number(expiringDays));
            where.status = "ACTIVE";
            where.endDate = { gte: now, lte: future };
        }
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, contracts] = yield Promise.all([
            prismaClient_1.default.serviceContract.count({ where }),
            prismaClient_1.default.serviceContract.findMany(Object.assign({ where, include: {
                    asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true } },
                    vendor: { select: { id: true, name: true, contact: true } },
                }, orderBy: { endDate: "asc" } }, (exportCsv !== "true" ? { skip, take } : {}))),
        ]);
        if (exportCsv === "true") {
            const csvRows = contracts.map((c) => {
                var _a, _b, _c;
                return ({
                    ContractNumber: c.contractNumber || "",
                    Type: c.contractType || "",
                    AssetId: ((_a = c.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    AssetName: ((_b = c.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    Vendor: ((_c = c.vendor) === null || _c === void 0 ? void 0 : _c.name) || "",
                    StartDate: c.startDate ? new Date(c.startDate).toISOString().split("T")[0] : "",
                    EndDate: c.endDate ? new Date(c.endDate).toISOString().split("T")[0] : "",
                    Cost: c.cost ? Number(c.cost) : "",
                    Status: c.status || "",
                    IncludesParts: c.includesParts ? "Yes" : "No",
                    IncludesLabor: c.includesLabor ? "Yes" : "No",
                    VisitsPerYear: c.visitsPerYear || "",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=service-contracts.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json({ data: contracts, total, page: parseInt(String(page)), limit: take });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllServiceContracts = getAllServiceContracts;
// GET /service-contracts/stats
const getServiceContractStats = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = _req.user;
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        // Department scoping
        let scope = {};
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            const deptAssets = yield prismaClient_1.default.asset.findMany({ where: { departmentId: Number(user.departmentId) }, select: { id: true } });
            scope = { assetId: { in: deptAssets.map(a => a.id) } };
        }
        const [total, active, expired, expiring30, amcCount, cmcCount] = yield Promise.all([
            prismaClient_1.default.serviceContract.count({ where: Object.assign({}, scope) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign({ status: "ACTIVE" }, scope) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign({ status: "EXPIRED" }, scope) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign({ status: "ACTIVE", endDate: { gte: now, lte: thirtyDays } }, scope) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign({ contractType: "AMC", status: "ACTIVE" }, scope) }),
            prismaClient_1.default.serviceContract.count({ where: Object.assign({ contractType: "CMC", status: "ACTIVE" }, scope) }),
        ]);
        res.json({ total, active, expired, expiring30, amcCount, cmcCount });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getServiceContractStats = getServiceContractStats;
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
// ── Service Visit Logging ─────────────────────────────────────────────────────
// POST /service-contracts/:contractId/visits
// Log a service visit (PM or Repair) with chargeable rules:
//   - No active warranty + no active contract → chargeable
//   - Amount ≤ 1000 → direct approval (auto-approved)
//   - Amount > 1000 → needs manager approval (chargeApprovalStatus = PENDING)
const logServiceVisit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const contractId = Number(req.params.contractId);
        const contract = yield prismaClient_1.default.serviceContract.findUnique({
            where: { id: contractId },
            include: { asset: true },
        });
        if (!contract) {
            res.status(404).json({ message: "Service contract not found" });
            return;
        }
        const { visitType, // PREVENTIVE_MAINTENANCE | REPAIR
        visitDate, visitedById, workDone, partsReplaced, outcome, chargeAmount, } = req.body;
        if (!visitType || !visitDate) {
            res.status(400).json({ message: "visitType and visitDate are required" });
            return;
        }
        if (!["PREVENTIVE_MAINTENANCE", "REPAIR"].includes(visitType)) {
            res.status(400).json({ message: "visitType must be PREVENTIVE_MAINTENANCE or REPAIR" });
            return;
        }
        const assetId = contract.assetId;
        const now = new Date();
        // Chargeable determination
        const hasActiveWarranty = yield prismaClient_1.default.warranty.findFirst({
            where: { assetId, isUnderWarranty: true, warrantyEnd: { gte: now } },
        });
        const hasActiveContract = yield prismaClient_1.default.serviceContract.findFirst({
            where: { assetId, status: "ACTIVE", endDate: { gte: now } },
        });
        let isChargeable = false;
        let chargeableReason = null;
        let chargeApprovalStatus = null;
        const amount = chargeAmount != null ? Number(chargeAmount) : null;
        if (!hasActiveWarranty && !hasActiveContract) {
            isChargeable = true;
            chargeableReason = "NO_WARRANTY_OR_CONTRACT";
        }
        // If chargeable: ≤1000 auto-approved, >1000 needs approval
        if (isChargeable && amount != null) {
            chargeApprovalStatus = amount <= 1000 ? "APPROVED" : "PENDING";
        }
        const visit = yield prismaClient_1.default.serviceVisit.create({
            data: {
                serviceContractId: contractId,
                assetId,
                visitType,
                visitDate: new Date(visitDate),
                visitedById: visitedById ? Number(visitedById) : null,
                workDone: workDone !== null && workDone !== void 0 ? workDone : null,
                partsReplaced: partsReplaced !== null && partsReplaced !== void 0 ? partsReplaced : null,
                outcome: outcome !== null && outcome !== void 0 ? outcome : null,
                isChargeable,
                chargeableReason,
                chargeAmount: amount,
                chargeApprovalStatus,
                createdById: user.employeeDbId,
            },
        });
        // Fire-and-forget: notify admins about service visit logged
        (0, notificationHelper_1.getAdminIds)().then(adminIds => (0, notificationHelper_1.notify)({
            type: "AMC_CMC_EXPIRY",
            title: "Service Visit Logged",
            message: `${visitType} visit logged for asset ${contract.asset.assetName} under contract ${contract.contractNumber || contractId}`,
            recipientIds: adminIds,
            createdById: user.employeeDbId,
        })).catch(() => { });
        // If charge > 1000, notify HOD/manager
        if (isChargeable && amount != null && amount > 1000 && contract.asset.departmentId) {
            const hod = yield prismaClient_1.default.employee.findFirst({
                where: { departmentId: contract.asset.departmentId, role: "HOD" },
                select: { id: true },
            });
            if (hod) {
                const notif = yield prismaClient_1.default.notification.create({
                    data: {
                        type: "OTHER",
                        title: `Chargeable Service Visit — Approval Required`,
                        message: `Service visit for asset ${contract.asset.assetName} is chargeable ₹${amount}. Approval needed.`,
                        priority: "HIGH",
                        assetId,
                        dedupeKey: `SVC_VISIT_CHARGE_${visit.id}`,
                        createdById: user.employeeDbId,
                    },
                });
                yield prismaClient_1.default.notificationRecipient.create({
                    data: { notificationId: notif.id, employeeId: hod.id },
                });
            }
        }
        res.status(201).json(visit);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to log service visit" });
    }
});
exports.logServiceVisit = logServiceVisit;
// GET /service-contracts/:contractId/visits
const getServiceVisits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const contractId = Number(req.params.contractId);
        const visits = yield prismaClient_1.default.serviceVisit.findMany({
            where: { serviceContractId: contractId },
            include: {
                visitedBy: { select: { id: true, name: true } },
                chargeApprovedBy: { select: { id: true, name: true } },
            },
            orderBy: { visitDate: "desc" },
        });
        res.json(visits);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch visits" });
    }
});
exports.getServiceVisits = getServiceVisits;
// PATCH /service-contracts/visits/:visitId/approve-charge
const approveVisitCharge = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const visitId = Number(req.params.visitId);
        const { decision, remarks } = req.body; // APPROVED | REJECTED
        if (!["APPROVED", "REJECTED"].includes(decision)) {
            res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
            return;
        }
        const visit = yield prismaClient_1.default.serviceVisit.findUnique({ where: { id: visitId } });
        if (!visit) {
            res.status(404).json({ message: "Service visit not found" });
            return;
        }
        if (visit.chargeApprovalStatus !== "PENDING") {
            res.status(400).json({ message: "Charge approval not pending" });
            return;
        }
        const updated = yield prismaClient_1.default.serviceVisit.update({
            where: { id: visitId },
            data: {
                chargeApprovalStatus: decision,
                chargeApprovedById: user.employeeDbId,
                chargeApprovedAt: new Date(),
            },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to approve charge" });
    }
});
exports.approveVisitCharge = approveVisitCharge;

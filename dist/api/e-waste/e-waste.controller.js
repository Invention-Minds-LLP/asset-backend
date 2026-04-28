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
exports.updateEWasteDetails = exports.uploadRecyclerCert = exports.securitySign = exports.operationsSign = exports.hodSign = exports.getEWasteById = exports.getAllEWaste = void 0;
exports.autoCreateEWasteRecord = autoCreateEWasteRecord;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
// ── Auto-ref number generator ─────────────────────────────────────────────────
function generateEWasteRef() {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const count = yield prismaClient_1.default.eWasteRecord.count();
        return `EW-${year}-${String(count + 1).padStart(5, "0")}`;
    });
}
// ── Shared include ────────────────────────────────────────────────────────────
const fullInclude = {
    asset: { select: { id: true, assetId: true, assetName: true, assetCategory: { select: { name: true } }, department: { select: { name: true } } } },
    assetDisposal: { select: { id: true, disposalType: true, estimatedScrapValue: true, actualSaleValue: true, completedAt: true } },
    hodSignedBy: { select: { id: true, name: true, role: true } },
    operationsSignedBy: { select: { id: true, name: true, role: true } },
    securitySignedBy: { select: { id: true, name: true, role: true } },
    createdBy: { select: { id: true, name: true } },
};
// ── GET /e-waste ──────────────────────────────────────────────────────────────
const getAllEWaste = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const { status, page = "1", limit = "20" } = req.query;
        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (status)
            where.status = String(status);
        // Scope non-admin to their department
        if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS", "SECURITY"].includes(user === null || user === void 0 ? void 0 : user.role) && (user === null || user === void 0 ? void 0 : user.departmentId)) {
            const deptAssets = yield prismaClient_1.default.asset.findMany({
                where: { departmentId: Number(user.departmentId) },
                select: { id: true },
            });
            where.assetId = { in: deptAssets.map((a) => a.id) };
        }
        const [records, total] = yield Promise.all([
            prismaClient_1.default.eWasteRecord.findMany({ where, skip, take: limitNum, orderBy: { createdAt: "desc" }, include: fullInclude }),
            prismaClient_1.default.eWasteRecord.count({ where }),
        ]);
        res.json({ data: records, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    }
    catch (err) {
        console.error("getAllEWaste error:", err);
        res.status(500).json({ message: "Failed to fetch e-waste records", error: err.message });
    }
});
exports.getAllEWaste = getAllEWaste;
// ── GET /e-waste/:id ──────────────────────────────────────────────────────────
const getEWasteById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const record = yield prismaClient_1.default.eWasteRecord.findUnique({
            where: { id: Number(req.params.id) },
            include: fullInclude,
        });
        if (!record) {
            res.status(404).json({ message: "E-Waste record not found" });
            return;
        }
        res.json(record);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch record", error: err.message });
    }
});
exports.getEWasteById = getEWasteById;
// ── Internal: called from disposal controller when SCRAP is COMPLETED ─────────
function autoCreateEWasteRecord(disposalId, assetId, createdById) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const existing = yield prismaClient_1.default.eWasteRecord.findUnique({ where: { assetDisposalId: disposalId } });
            if (existing)
                return existing;
            const ref = yield generateEWasteRef();
            const record = yield prismaClient_1.default.eWasteRecord.create({
                data: {
                    eWasteRefNo: ref,
                    assetDisposalId: disposalId,
                    assetId,
                    status: "PENDING_HOD",
                    createdById: createdById !== null && createdById !== void 0 ? createdById : null,
                },
            });
            // Notify admins
            const adminIds = yield (0, notificationHelper_1.getAdminIds)();
            yield (0, notificationHelper_1.notify)({
                type: "EWASTE",
                title: "E-Waste Record Created",
                message: `E-Waste record ${ref} created for asset #${assetId}. HOD signature required.`,
                recipientIds: adminIds,
                assetId,
            });
            return record;
        }
        catch (err) {
            console.error("autoCreateEWasteRecord error:", err);
        }
    });
}
// ── PUT /e-waste/:id/hod-sign ─────────────────────────────────────────────────
const hodSign = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        const { signature, remarks, assetCondition, dataWiped, dataWipeMethod, dataWipeCertUrl, recyclerName, recyclerAuthNo, recyclerContact, handoverDate } = req.body;
        if (!signature) {
            res.status(400).json({ message: "Signature is required" });
            return;
        }
        const record = yield prismaClient_1.default.eWasteRecord.findUnique({ where: { id } });
        if (!record) {
            res.status(404).json({ message: "Record not found" });
            return;
        }
        if (record.status !== "PENDING_HOD") {
            res.status(400).json({ message: `Cannot sign at HOD stage — current status is ${record.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.eWasteRecord.update({
            where: { id },
            data: {
                status: "PENDING_OPERATIONS",
                hodSignedById: user.employeeDbId,
                hodSignedAt: new Date(),
                hodSignature: signature,
                hodRemarks: remarks || null,
                assetCondition: assetCondition || null,
                dataWiped: dataWiped === true || dataWiped === "true",
                dataWipeMethod: dataWipeMethod || null,
                dataWipeCertUrl: dataWipeCertUrl || null,
                recyclerName: recyclerName || null,
                recyclerAuthNo: recyclerAuthNo || null,
                recyclerContact: recyclerContact || null,
                handoverDate: handoverDate ? new Date(handoverDate) : null,
            },
            include: fullInclude,
        });
        res.json({ data: updated, message: "HOD signature recorded. Forwarded to Operations." });
    }
    catch (err) {
        console.error("hodSign error:", err);
        res.status(500).json({ message: "Failed to record HOD signature", error: err.message });
    }
});
exports.hodSign = hodSign;
// ── PUT /e-waste/:id/operations-sign ─────────────────────────────────────────
const operationsSign = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        const { signature, remarks } = req.body;
        if (!signature) {
            res.status(400).json({ message: "Signature is required" });
            return;
        }
        const record = yield prismaClient_1.default.eWasteRecord.findUnique({ where: { id } });
        if (!record) {
            res.status(404).json({ message: "Record not found" });
            return;
        }
        if (record.status !== "PENDING_OPERATIONS") {
            res.status(400).json({ message: `Cannot sign at Operations stage — current status is ${record.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.eWasteRecord.update({
            where: { id },
            data: {
                status: "PENDING_SECURITY",
                operationsSignedById: user.employeeDbId,
                operationsSignedAt: new Date(),
                operationsSignature: signature,
                operationsRemarks: remarks || null,
            },
            include: fullInclude,
        });
        res.json({ data: updated, message: "Operations signature recorded. Forwarded to Security." });
    }
    catch (err) {
        console.error("operationsSign error:", err);
        res.status(500).json({ message: "Failed to record Operations signature", error: err.message });
    }
});
exports.operationsSign = operationsSign;
// ── PUT /e-waste/:id/security-sign ───────────────────────────────────────────
const securitySign = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        const { signature, remarks, gatePassNo } = req.body;
        if (!signature) {
            res.status(400).json({ message: "Signature is required" });
            return;
        }
        const record = yield prismaClient_1.default.eWasteRecord.findUnique({ where: { id } });
        if (!record) {
            res.status(404).json({ message: "Record not found" });
            return;
        }
        if (record.status !== "PENDING_SECURITY") {
            res.status(400).json({ message: `Cannot sign at Security stage — current status is ${record.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.eWasteRecord.update({
            where: { id },
            data: {
                status: "CLOSED",
                securitySignedById: user.employeeDbId,
                securitySignedAt: new Date(),
                securitySignature: signature,
                securityRemarks: remarks || null,
                gatePassNo: gatePassNo || null,
                closedAt: new Date(),
            },
            include: fullInclude,
        });
        // Notify all admins of closure
        const adminIds = yield (0, notificationHelper_1.getAdminIds)();
        yield (0, notificationHelper_1.notify)({
            type: "EWASTE",
            title: "E-Waste Record Closed",
            message: `E-Waste record ${record.eWasteRefNo} has been fully signed and closed.`,
            recipientIds: adminIds,
            assetId: record.assetId,
        });
        res.json({ data: updated, message: "E-Waste record closed. All three stages signed." });
    }
    catch (err) {
        console.error("securitySign error:", err);
        res.status(500).json({ message: "Failed to record Security signature", error: err.message });
    }
});
exports.securitySign = securitySign;
// ── POST /e-waste/:id/upload-cert ────────────────────────────────────────────
const uploadRecyclerCert = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const fileUrl = `/uploads/e-waste/${req.file.filename}`;
        const updated = yield prismaClient_1.default.eWasteRecord.update({
            where: { id },
            data: { eWasteCertUrl: fileUrl },
            include: fullInclude,
        });
        res.json({ data: updated, message: "Recycler certificate uploaded", fileUrl });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to upload certificate", error: err.message });
    }
});
exports.uploadRecyclerCert = uploadRecyclerCert;
// ── PUT /e-waste/:id/update-details ──────────────────────────────────────────
// Admin can update recycler details / upload certificate before signing
const updateEWasteDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { recyclerName, recyclerAuthNo, recyclerContact, handoverDate, eWasteCertUrl, assetDescription } = req.body;
        const updated = yield prismaClient_1.default.eWasteRecord.update({
            where: { id },
            data: {
                recyclerName: recyclerName !== null && recyclerName !== void 0 ? recyclerName : undefined,
                recyclerAuthNo: recyclerAuthNo !== null && recyclerAuthNo !== void 0 ? recyclerAuthNo : undefined,
                recyclerContact: recyclerContact !== null && recyclerContact !== void 0 ? recyclerContact : undefined,
                handoverDate: handoverDate ? new Date(handoverDate) : undefined,
                eWasteCertUrl: eWasteCertUrl !== null && eWasteCertUrl !== void 0 ? eWasteCertUrl : undefined,
                assetDescription: assetDescription !== null && assetDescription !== void 0 ? assetDescription : undefined,
            },
            include: fullInclude,
        });
        res.json({ data: updated, message: "Details updated" });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to update details", error: err.message });
    }
});
exports.updateEWasteDetails = updateEWasteDetails;

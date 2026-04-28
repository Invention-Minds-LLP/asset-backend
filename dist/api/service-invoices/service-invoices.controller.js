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
exports.getStats = exports.uploadDoc = exports.markPaid = exports.reject = exports.approve = exports.create = exports.getById = exports.getAll = exports.upload = exports.uploadStorage = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ── File upload ────────────────────────────────────────────────────────────────
const uploadDir = path_1.default.join(process.cwd(), "uploads", "service-invoices");
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
exports.uploadStorage = multer_1.default.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});
exports.upload = (0, multer_1.default)({ storage: exports.uploadStorage, limits: { fileSize: 10 * 1024 * 1024 } });
// ── Shared include ─────────────────────────────────────────────────────────────
const fullInclude = {
    asset: { select: { id: true, assetId: true, assetName: true } },
    vendor: { select: { id: true, name: true } },
    ticket: { select: { id: true, ticketId: true, description: true } },
    maintenanceSchedule: { select: { id: true, scheduleName: true } },
    calibrationSchedule: { select: { id: true, equipmentName: true } },
    serviceContract: { select: { id: true, contractNumber: true, contractType: true } },
    createdBy: { select: { id: true, name: true } },
    approvedBy: { select: { id: true, name: true } },
};
// ── GET /service-invoices ─────────────────────────────────────────────────────
const getAll = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, vendorId, assetId, page = "1", limit = "25" } = req.query;
        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const where = {};
        if (status)
            where.status = String(status);
        if (vendorId)
            where.vendorId = Number(vendorId);
        if (assetId)
            where.assetId = Number(assetId);
        const [total, records] = yield Promise.all([
            prismaClient_1.default.serviceInvoice.count({ where }),
            prismaClient_1.default.serviceInvoice.findMany({
                where, skip: (pageNum - 1) * limitNum, take: limitNum,
                orderBy: { invoiceDate: "desc" },
                include: fullInclude,
            }),
        ]);
        res.json({ data: records, pagination: { total, page: pageNum, limit: limitNum } });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch service invoices", error: err.message });
    }
});
exports.getAll = getAll;
// ── GET /service-invoices/:id ─────────────────────────────────────────────────
const getById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const record = yield prismaClient_1.default.serviceInvoice.findUnique({
            where: { id: Number(req.params.id) },
            include: fullInclude,
        });
        if (!record) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        res.json(record);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch invoice", error: err.message });
    }
});
exports.getById = getById;
// ── POST /service-invoices ────────────────────────────────────────────────────
const create = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        const { invoiceNo, invoiceDate, dueDate, ticketId, maintenanceScheduleId, calibrationScheduleId, serviceContractId, assetId, vendorId, invoiceAmount, gstPct, tdsAmount, serviceDescription, remarks, } = req.body;
        if (!invoiceNo || !invoiceDate || !invoiceAmount) {
            res.status(400).json({ message: "invoiceNo, invoiceDate and invoiceAmount are required" });
            return;
        }
        const amt = Number(invoiceAmount);
        const gst = Number(gstPct !== null && gstPct !== void 0 ? gstPct : 18);
        const tds = Number(tdsAmount !== null && tdsAmount !== void 0 ? tdsAmount : 0);
        const gstAmt = Math.round(amt * gst / 100 * 100) / 100;
        const netAmt = Math.round((amt + gstAmt) * 100) / 100;
        const payable = Math.round((netAmt - tds) * 100) / 100;
        const record = yield prismaClient_1.default.serviceInvoice.create({
            data: {
                invoiceNo, invoiceDate: new Date(invoiceDate),
                dueDate: dueDate ? new Date(dueDate) : null,
                ticketId: ticketId ? Number(ticketId) : null,
                maintenanceScheduleId: maintenanceScheduleId ? Number(maintenanceScheduleId) : null,
                calibrationScheduleId: calibrationScheduleId ? Number(calibrationScheduleId) : null,
                serviceContractId: serviceContractId ? Number(serviceContractId) : null,
                assetId: assetId ? Number(assetId) : null,
                vendorId: vendorId ? Number(vendorId) : null,
                invoiceAmount: amt, gstPct: gst, gstAmount: gstAmt,
                netAmount: netAmt, tdsAmount: tds, payableAmount: payable,
                serviceDescription: serviceDescription || null,
                remarks: remarks || null,
                status: "PENDING_APPROVAL",
                createdById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null,
            },
            include: fullInclude,
        });
        res.status(201).json({ data: record, message: "Service invoice created" });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to create invoice", error: err.message });
    }
});
exports.create = create;
// ── PUT /service-invoices/:id/approve ─────────────────────────────────────────
const approve = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        const id = Number(req.params.id);
        const record = yield prismaClient_1.default.serviceInvoice.findUnique({ where: { id } });
        if (!record) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        if (record.status !== "PENDING_APPROVAL") {
            res.status(400).json({ message: `Cannot approve — current status is ${record.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.serviceInvoice.update({
            where: { id },
            data: { status: "APPROVED", approvedById: (_a = user === null || user === void 0 ? void 0 : user.employeeDbId) !== null && _a !== void 0 ? _a : null },
            include: fullInclude,
        });
        res.json({ data: updated, message: "Invoice approved" });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to approve", error: err.message });
    }
});
exports.approve = approve;
// ── PUT /service-invoices/:id/reject ──────────────────────────────────────────
const reject = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { remarks } = req.body;
        const record = yield prismaClient_1.default.serviceInvoice.findUnique({ where: { id } });
        if (!record) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        if (record.status !== "PENDING_APPROVAL") {
            res.status(400).json({ message: `Cannot reject — status is ${record.status}` });
            return;
        }
        const updated = yield prismaClient_1.default.serviceInvoice.update({
            where: { id },
            data: { status: "REJECTED", remarks: remarks || record.remarks },
            include: fullInclude,
        });
        res.json({ data: updated, message: "Invoice rejected" });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to reject", error: err.message });
    }
});
exports.reject = reject;
// ── PUT /service-invoices/:id/mark-paid ───────────────────────────────────────
const markPaid = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { paymentMode, paymentRef } = req.body;
        const record = yield prismaClient_1.default.serviceInvoice.findUnique({ where: { id } });
        if (!record) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        if (record.status !== "APPROVED") {
            res.status(400).json({ message: "Invoice must be APPROVED before marking as paid" });
            return;
        }
        const updated = yield prismaClient_1.default.serviceInvoice.update({
            where: { id },
            data: { status: "PAID", paidAt: new Date(), paymentMode: paymentMode || null, paymentRef: paymentRef || null },
            include: fullInclude,
        });
        res.json({ data: updated, message: "Invoice marked as paid" });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to mark paid", error: err.message });
    }
});
exports.markPaid = markPaid;
// ── POST /service-invoices/:id/upload ─────────────────────────────────────────
const uploadDoc = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const fileUrl = `/uploads/service-invoices/${req.file.filename}`;
        const updated = yield prismaClient_1.default.serviceInvoice.update({
            where: { id }, data: { fileUrl }, include: fullInclude,
        });
        res.json({ data: updated, message: "Document uploaded", fileUrl });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to upload", error: err.message });
    }
});
exports.uploadDoc = uploadDoc;
// ── GET /service-invoices/stats ────────────────────────────────────────────────
const getStats = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const [pending, approved, paid, rejected, totalPayable] = yield Promise.all([
            prismaClient_1.default.serviceInvoice.count({ where: { status: "PENDING_APPROVAL" } }),
            prismaClient_1.default.serviceInvoice.count({ where: { status: "APPROVED" } }),
            prismaClient_1.default.serviceInvoice.count({ where: { status: "PAID" } }),
            prismaClient_1.default.serviceInvoice.count({ where: { status: "REJECTED" } }),
            prismaClient_1.default.serviceInvoice.aggregate({ where: { status: { in: ["APPROVED", "PENDING_APPROVAL"] } }, _sum: { payableAmount: true } }),
        ]);
        res.json({
            pending, approved, paid, rejected,
            totalPayable: Number((_a = totalPayable._sum.payableAmount) !== null && _a !== void 0 ? _a : 0),
        });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch stats", error: err.message });
    }
});
exports.getStats = getStats;

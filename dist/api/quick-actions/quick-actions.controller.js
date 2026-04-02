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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQRBulkPrintData = exports.bulkUpdateStatus = exports.duplicateAsset = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Clone/Duplicate Asset ───────────────────────────────────────────────────
const duplicateAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const sourceId = Number(req.params.id);
        const { newAssetId, newSerialNumber } = req.body;
        if (!newAssetId || !newSerialNumber) {
            res.status(400).json({ message: "newAssetId and newSerialNumber are required" });
            return;
        }
        const source = yield prismaClient_1.default.asset.findUnique({ where: { id: sourceId } });
        if (!source) {
            res.status(404).json({ message: "Source asset not found" });
            return;
        }
        // Check uniqueness
        const existing = yield prismaClient_1.default.asset.findFirst({
            where: { OR: [{ assetId: newAssetId }, { serialNumber: newSerialNumber }] },
        });
        if (existing) {
            res.status(409).json({ message: "Asset ID or Serial Number already exists" });
            return;
        }
        // Clone asset - exclude IDs, unique fields, and timestamps
        const _a = source, { id, assetId, serialNumber, rfidCode, qrCode, referenceCode, createdAt, updatedAt, createdById, updatedById, qrGeneratedAt, qrLabelPrinted, lastAuditDate, auditedBy, retiredDate, retiredReason, retiredBy, disposalMethod, disposalValue, disposalDate, disposalApprovedBy, disposalCertificate } = _a, cloneData = __rest(_a, ["id", "assetId", "serialNumber", "rfidCode", "qrCode", "referenceCode", "createdAt", "updatedAt", "createdById", "updatedById", "qrGeneratedAt", "qrLabelPrinted", "lastAuditDate", "auditedBy", "retiredDate", "retiredReason", "retiredBy", "disposalMethod", "disposalValue", "disposalDate", "disposalApprovedBy", "disposalCertificate"]);
        const clone = yield prismaClient_1.default.asset.create({
            data: Object.assign(Object.assign({}, cloneData), { assetId: newAssetId, serialNumber: newSerialNumber, status: "AVAILABLE", createdById: req.user.employeeDbId, updatedById: req.user.employeeDbId }),
        });
        res.status(201).json(clone);
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === "P2002") {
            res.status(409).json({ message: "Duplicate unique field constraint" });
            return;
        }
        console.error("duplicateAsset error:", error);
        res.status(500).json({ message: "Failed to duplicate asset" });
    }
});
exports.duplicateAsset = duplicateAsset;
// ─── Bulk Status Update ──────────────────────────────────────────────────────
const bulkUpdateStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const { assetIds, status, remarks } = req.body;
        if (!Array.isArray(assetIds) || assetIds.length === 0 || !status) {
            res.status(400).json({ message: "assetIds (array) and status are required" });
            return;
        }
        const validStatuses = ["AVAILABLE", "IN_USE", "UNDER_MAINTENANCE", "RETIRED", "DISPOSED", "LOST", "IN_TRANSIT"];
        if (!validStatuses.includes(status)) {
            res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
            return;
        }
        const result = yield prismaClient_1.default.asset.updateMany({
            where: { id: { in: assetIds.map(Number) } },
            data: {
                status,
                remarks: remarks || undefined,
                updatedById: req.user.employeeDbId,
            },
        });
        // Log to audit trail
        for (const aid of assetIds) {
            yield prismaClient_1.default.auditLog.create({
                data: {
                    entityType: "ASSET",
                    entityId: Number(aid),
                    action: "BULK_STATUS_UPDATE",
                    performedById: req.user.employeeDbId,
                    newValue: JSON.stringify({ status, remarks }),
                },
            });
        }
        res.json({ message: `${result.count} assets updated to ${status}`, count: result.count });
    }
    catch (error) {
        console.error("bulkUpdateStatus error:", error);
        res.status(500).json({ message: "Failed to update assets" });
    }
});
exports.bulkUpdateStatus = bulkUpdateStatus;
// ─── QR Bulk Print (returns data for frontend to render labels) ──────────────
const getQRBulkPrintData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetIds } = req.body;
        if (!Array.isArray(assetIds) || assetIds.length === 0) {
            res.status(400).json({ message: "assetIds (array) is required" });
            return;
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where: { id: { in: assetIds.map(Number) } },
            select: {
                id: true,
                assetId: true,
                assetName: true,
                serialNumber: true,
                qrCode: true,
                department: { select: { name: true } },
                currentLocation: true,
                assetCategory: { select: { name: true } },
            },
        });
        // Generate QR data for each asset (the actual QR image generation happens on frontend)
        const printData = assets.map((a) => {
            var _a, _b;
            return ({
                id: a.id,
                assetId: a.assetId,
                assetName: a.assetName,
                serialNumber: a.serialNumber,
                qrCode: a.qrCode || a.assetId, // fallback to assetId if no QR
                department: ((_a = a.department) === null || _a === void 0 ? void 0 : _a.name) || "",
                location: a.currentLocation || "",
                category: ((_b = a.assetCategory) === null || _b === void 0 ? void 0 : _b.name) || "",
                qrValue: JSON.stringify({
                    assetId: a.assetId,
                    serialNumber: a.serialNumber,
                    name: a.assetName,
                }),
            });
        });
        // Mark as printed
        yield prismaClient_1.default.asset.updateMany({
            where: { id: { in: assetIds.map(Number) } },
            data: { qrLabelPrinted: true },
        });
        res.json({ count: printData.length, printData });
    }
    catch (error) {
        console.error("getQRBulkPrintData error:", error);
        res.status(500).json({ message: "Failed to get QR print data" });
    }
});
exports.getQRBulkPrintData = getQRBulkPrintData;

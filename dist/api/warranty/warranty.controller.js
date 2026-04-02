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
exports.getWarrantyHistoryByAssetId = exports.getWarrantyStats = exports.renewWarranty = exports.getWarrantyByAssetId = exports.deleteWarranty = exports.updateWarranty = exports.createWarranty = exports.getWarrantyById = exports.getAllWarranties = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const asset_1 = require("../../utilis/asset");
function parseDate(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
// GET /warranties/
const getAllWarranties = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, isActive, search, page = "1", limit = "25", exportCsv, expiringDays } = req.query;
        const where = {};
        if (isActive !== undefined)
            where.isActive = isActive === "true";
        if (search) {
            where.OR = [
                { warrantyProvider: { contains: String(search) } },
                { warrantyReference: { contains: String(search) } },
                { asset: { assetName: { contains: String(search) } } },
                { asset: { assetId: { contains: String(search) } } },
            ];
        }
        // Filter for expiring soon
        if (expiringDays) {
            const now = new Date();
            const future = new Date();
            future.setDate(now.getDate() + Number(expiringDays));
            where.isActive = true;
            where.isUnderWarranty = true;
            where.warrantyEnd = { gte: now, lte: future };
        }
        // Filter by warranty status (active/expired based on dates)
        if (status === "ACTIVE") {
            where.isActive = true;
            where.isUnderWarranty = true;
            where.warrantyEnd = { gte: new Date() };
        }
        else if (status === "EXPIRED") {
            where.OR = [
                { isActive: false },
                { warrantyEnd: { lt: new Date() } },
            ];
        }
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, warranties] = yield Promise.all([
            prismaClient_1.default.warranty.count({ where }),
            prismaClient_1.default.warranty.findMany(Object.assign({ where, include: { asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true, departmentId: true } }, vendor: true }, orderBy: { warrantyEnd: "asc" } }, (exportCsv !== "true" ? { skip, take } : {}))),
        ]);
        if (exportCsv === "true") {
            const csvRows = warranties.map((w) => {
                var _a, _b, _c;
                return ({
                    AssetId: ((_a = w.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    AssetName: ((_b = w.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    WarrantyType: w.warrantyType || "",
                    Provider: w.warrantyProvider || "",
                    Vendor: ((_c = w.vendor) === null || _c === void 0 ? void 0 : _c.name) || "",
                    Start: w.warrantyStart ? new Date(w.warrantyStart).toISOString().split("T")[0] : "",
                    End: w.warrantyEnd ? new Date(w.warrantyEnd).toISOString().split("T")[0] : "",
                    UnderWarranty: w.isUnderWarranty ? "Yes" : "No",
                    Active: w.isActive ? "Yes" : "No",
                    Reference: w.warrantyReference || "",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=warranties.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json({ data: warranties, total, page: parseInt(String(page)), limit: take });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllWarranties = getAllWarranties;
// GET /warranties/:id
const getWarrantyById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    const warranty = yield prismaClient_1.default.warranty.findUnique({
        where: { id },
        include: { asset: true },
    });
    if (!warranty) {
        res.status(404).json({ message: "Warranty not found" });
        return;
    }
    res.json(warranty);
});
exports.getWarrantyById = getWarrantyById;
// POST /warranties/
// export const createWarranty = async (req: Request, res: Response) => {
//   const warranty = await prisma.warranty.create({
//     data: {
//       warrantyStart: new Date(req.body.warrantyStart),
//       warrantyEnd: new Date(req.body.warrantyEnd),
//       isUnderWarranty: req.body.isUnderWarranty,
//       amcActive: req.body.amcActive,
//       amcVendor: req.body.amcVendor,
//       amcStart: req.body.amcStart ? new Date(req.body.amcStart) : null,
//       amcEnd: req.body.amcEnd ? new Date(req.body.amcEnd) : null,
//       amcVisitsDue: req.body.amcVisitsDue ? Number(req.body.amcVisitsDue) : null,
//       lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
//       nextVisitDue: req.body.nextVisitDue ? new Date(req.body.nextVisitDue) : null,
//       serviceReport: req.body.serviceReport ?? null,
//       asset: {
//         connect: {
//           assetId: req.body.assetId,
//         },
//       },
//     },
//   });
//    res.status(201).json(warranty);
// };
const createWarranty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, warrantyStart, warrantyEnd, isUnderWarranty, warrantyType, warrantyProvider, vendorId, warrantyReference, coverageDetails, exclusions, supportContact, supportEmail, termsUrl, remarks, } = req.body;
        if (!assetId || typeof isUnderWarranty !== "boolean") {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const asset = yield (0, asset_1.requireAssetByAssetId)(assetId);
        let start = null;
        let end = null;
        if (isUnderWarranty) {
            if (!warrantyStart || !warrantyEnd) {
                res.status(400).json({ message: "Warranty start and end are required when under warranty" });
                return;
            }
            start = new Date(warrantyStart);
            end = new Date(warrantyEnd);
            if (end <= start) {
                res.status(400).json({ message: "Warranty end must be after start" });
                return;
            }
        }
        // Optional safety: allow only one active warranty
        const existingActive = yield prismaClient_1.default.warranty.findFirst({
            where: {
                assetId: asset.id,
                isActive: true,
            },
        });
        if (existingActive) {
            res.status(409).json({
                message: "An active warranty already exists for this asset. Use renewal API or update existing warranty.",
            });
            return;
        }
        const warranty = yield prismaClient_1.default.warranty.create({
            data: {
                assetId: asset.id,
                warrantyStart: start !== null && start !== void 0 ? start : new Date(),
                warrantyEnd: end !== null && end !== void 0 ? end : new Date(),
                isUnderWarranty,
                isActive: true,
                warrantyType: warrantyType || null,
                warrantyProvider: warrantyProvider || null,
                vendorId: vendorId ? Number(vendorId) : null,
                warrantyReference: warrantyReference || null,
                coverageDetails: coverageDetails || null,
                exclusions: exclusions || null,
                supportContact: supportContact || null,
                supportEmail: supportEmail || null,
                termsUrl: termsUrl || null,
                remarks: remarks || null,
            },
        });
        res.status(201).json(warranty);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createWarranty = createWarranty;
// PUT /warranties/:id
// export const updateWarranty = async (req: Request, res: Response) => {
//   const id = parseInt(req.params.id);
//   const warranty = await prisma.warranty.update({
//     where: { id },
//     data: {
//       warrantyStart: new Date(req.body.warrantyStart),
//       warrantyEnd: new Date(req.body.warrantyEnd),
//       isUnderWarranty: req.body.isUnderWarranty,
//       amcActive: req.body.amcActive,
//       amcVendor: req.body.amcVendor,
//       amcStart: req.body.amcStart ? new Date(req.body.amcStart) : null,
//       amcEnd: req.body.amcEnd ? new Date(req.body.amcEnd) : null,
//       amcVisitsDue: req.body.amcVisitsDue ? Number(req.body.amcVisitsDue) : null,
//       lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
//       nextVisitDue: req.body.nextVisitDue ? new Date(req.body.nextVisitDue) : null,
//       serviceReport: req.body.serviceReport ?? null,
//     },
//   });
//  res.json(warranty);
// };
const updateWarranty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = Number(req.params.id);
        const existing = yield prismaClient_1.default.warranty.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Warranty not found" });
            return;
        }
        const { warrantyStart, warrantyEnd, isUnderWarranty, warrantyType, warrantyProvider, vendorId, warrantyReference, coverageDetails, exclusions, supportContact, supportEmail, termsUrl, remarks, } = req.body;
        const data = {};
        if (typeof isUnderWarranty === "boolean")
            data.isUnderWarranty = isUnderWarranty;
        if (warrantyStart)
            data.warrantyStart = new Date(warrantyStart);
        if (warrantyEnd)
            data.warrantyEnd = new Date(warrantyEnd);
        if ("warrantyType" in req.body)
            data.warrantyType = warrantyType || null;
        if ("warrantyProvider" in req.body)
            data.warrantyProvider = warrantyProvider || null;
        if ("vendorId" in req.body)
            data.vendorId = vendorId ? Number(vendorId) : null;
        if ("warrantyReference" in req.body)
            data.warrantyReference = warrantyReference || null;
        if ("coverageDetails" in req.body)
            data.coverageDetails = coverageDetails || null;
        if ("exclusions" in req.body)
            data.exclusions = exclusions || null;
        if ("supportContact" in req.body)
            data.supportContact = supportContact || null;
        if ("supportEmail" in req.body)
            data.supportEmail = supportEmail || null;
        if ("termsUrl" in req.body)
            data.termsUrl = termsUrl || null;
        if ("remarks" in req.body)
            data.remarks = remarks || null;
        const finalStart = (_a = data.warrantyStart) !== null && _a !== void 0 ? _a : existing.warrantyStart;
        const finalEnd = (_b = data.warrantyEnd) !== null && _b !== void 0 ? _b : existing.warrantyEnd;
        const finalIsUnderWarranty = (_c = data.isUnderWarranty) !== null && _c !== void 0 ? _c : existing.isUnderWarranty;
        if (finalIsUnderWarranty && finalEnd <= finalStart) {
            res.status(400).json({ message: "Warranty end must be after start" });
            return;
        }
        // prevent multiple active warranties for same asset when manually setting active=true
        if (data.isActive === true && existing.isActive !== true) {
            const otherActive = yield prismaClient_1.default.warranty.findFirst({
                where: {
                    assetId: existing.assetId,
                    isActive: true,
                    id: { not: existing.id },
                },
            });
            if (otherActive) {
                res.status(409).json({
                    message: "Another active warranty already exists for this asset",
                });
                return;
            }
        }
        const warranty = yield prismaClient_1.default.warranty.update({
            where: { id },
            data,
        });
        res.json(warranty);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.updateWarranty = updateWarranty;
// DELETE /warranties/:id
const deleteWarranty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    yield prismaClient_1.default.warranty.delete({
        where: { id },
    });
    res.status(204).send();
});
exports.deleteWarranty = deleteWarranty;
const getWarrantyByAssetId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = req.params.assetId;
        const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId } });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const warranty = yield prismaClient_1.default.warranty.findFirst({
            where: {
                assetId: asset.id,
                isActive: true,
            },
            include: { asset: true, vendor: true },
            orderBy: { createdAt: "desc" },
        });
        if (!warranty) {
            res.status(404).json({ message: "Warranty not found for given assetId" });
            return;
        }
        res.json(warranty);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getWarrantyByAssetId = getWarrantyByAssetId;
// POST /warranties/asset/:assetId/renew
const renewWarranty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetCode = req.params.assetId;
        const { warrantyStart, warrantyEnd, isUnderWarranty, warrantyType, warrantyProvider, vendorId, warrantyReference, coverageDetails, exclusions, supportContact, supportEmail, termsUrl, remarks, } = req.body;
        if (typeof isUnderWarranty !== "boolean") {
            res.status(400).json({ message: "isUnderWarranty is required" });
            return;
        }
        const asset = yield (0, asset_1.requireAssetByAssetId)(assetCode);
        let start = null;
        let end = null;
        if (isUnderWarranty) {
            start = parseDate(warrantyStart);
            end = parseDate(warrantyEnd);
            if (!start || !end) {
                res.status(400).json({
                    message: "Warranty start and end are required when under warranty",
                });
                return;
            }
            if (end <= start) {
                res.status(400).json({ message: "Warranty end must be after start" });
                return;
            }
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.warranty.updateMany({
                where: {
                    assetId: asset.id,
                    isActive: true,
                },
                data: {
                    isActive: false,
                },
            });
            const newWarranty = yield tx.warranty.create({
                data: {
                    assetId: asset.id,
                    warrantyStart: start !== null && start !== void 0 ? start : new Date(),
                    warrantyEnd: end !== null && end !== void 0 ? end : new Date(),
                    isUnderWarranty,
                    isActive: true,
                    warrantyType: warrantyType || null,
                    warrantyProvider: warrantyProvider || null,
                    vendorId: vendorId ? Number(vendorId) : null,
                    warrantyReference: warrantyReference || null,
                    coverageDetails: coverageDetails || null,
                    exclusions: exclusions || null,
                    supportContact: supportContact || null,
                    supportEmail: supportEmail || null,
                    termsUrl: termsUrl || null,
                    remarks: remarks || null,
                },
                include: { asset: true, vendor: true },
            });
            return newWarranty;
        }));
        res.status(201).json(result);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.renewWarranty = renewWarranty;
// GET /warranties/stats
const getWarrantyStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const sixtyDays = new Date();
        sixtyDays.setDate(now.getDate() + 60);
        const [total, active, expired, expiring30, expiring60] = yield Promise.all([
            prismaClient_1.default.warranty.count({ where: { isActive: true } }),
            prismaClient_1.default.warranty.count({ where: { isActive: true, isUnderWarranty: true, warrantyEnd: { gte: now } } }),
            prismaClient_1.default.warranty.count({ where: { isActive: true, warrantyEnd: { lt: now } } }),
            prismaClient_1.default.warranty.count({ where: { isActive: true, isUnderWarranty: true, warrantyEnd: { gte: now, lte: thirtyDays } } }),
            prismaClient_1.default.warranty.count({ where: { isActive: true, isUnderWarranty: true, warrantyEnd: { gte: now, lte: sixtyDays } } }),
        ]);
        res.json({ total, active, expired, expiring30, expiring60 });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getWarrantyStats = getWarrantyStats;
const getWarrantyHistoryByAssetId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetCode = req.params.assetId;
        const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId: assetCode } });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const history = yield prismaClient_1.default.warranty.findMany({
            where: {
                assetId: asset.id,
            },
            include: {
                asset: true,
                vendor: true,
            },
            orderBy: [
                { isActive: "desc" },
                { warrantyEnd: "desc" },
                { createdAt: "desc" },
            ],
        });
        res.json(history);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getWarrantyHistoryByAssetId = getWarrantyHistoryByAssetId;

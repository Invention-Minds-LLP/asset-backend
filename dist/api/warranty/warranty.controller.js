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
exports.getWarrantyByAssetId = exports.deleteWarranty = exports.updateWarranty = exports.createWarranty = exports.getWarrantyById = exports.getAllWarranties = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const asset_1 = require("../../utilis/asset");
// GET /warranties/
const getAllWarranties = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const warranties = yield prismaClient_1.default.warranty.findMany({ include: { asset: true } });
    res.json(warranties);
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
        const warranty = yield prismaClient_1.default.warranty.create({
            data: {
                assetId: asset.id,
                warrantyStart: start !== null && start !== void 0 ? start : new Date(),
                warrantyEnd: end !== null && end !== void 0 ? end : new Date(),
                isUnderWarranty,
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
    const assetId = req.params.assetId;
    const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId } });
    if (!asset) {
        res.status(404).json({ message: "Asset not found" });
        return;
    }
    const warranty = yield prismaClient_1.default.warranty.findUnique({
        where: { assetId: asset.id },
        include: { asset: true, vendor: true },
    });
    if (!warranty) {
        res.status(404).json({ message: "Warranty not found for given assetId" });
        return;
    }
    res.json(warranty);
});
exports.getWarrantyByAssetId = getWarrantyByAssetId;

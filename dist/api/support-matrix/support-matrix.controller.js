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
exports.bulkUpsertSupportMatrix = exports.deleteSupportMatrixEntry = exports.updateSupportMatrixEntry = exports.getSupportMatrixByCategory = exports.getSupportMatrixByAsset = exports.getAllSupportMatrix = exports.createSupportMatrixEntry = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const createSupportMatrixEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetCategoryId, assetId, levelNo, roleName, personName, employeeId, contactNumber, email, escalationTime, escalationUnit, notes, } = req.body;
        if (!levelNo) {
            res.status(400).json({ message: "levelNo is required" });
            return;
        }
        if (!assetCategoryId && !assetId) {
            res.status(400).json({ message: "Either assetCategoryId or assetId is required" });
            return;
        }
        const entry = yield prismaClient_1.default.assetSupportMatrix.create({
            data: {
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                assetId: assetId ? Number(assetId) : undefined,
                levelNo: Number(levelNo),
                roleName,
                personName,
                employeeId: employeeId ? Number(employeeId) : undefined,
                contactNumber,
                email,
                escalationTime: escalationTime ? Number(escalationTime) : undefined,
                escalationUnit,
                notes,
            },
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
                employee: { select: { name: true, employeeID: true } },
            },
        });
        res.status(201).json(entry);
    }
    catch (error) {
        console.error("createSupportMatrixEntry error:", error);
        res.status(500).json({ message: "Failed to create support matrix entry" });
    }
});
exports.createSupportMatrixEntry = createSupportMatrixEntry;
const getAllSupportMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetCategoryId, assetId } = req.query;
        const where = {};
        if (assetCategoryId)
            where.assetCategoryId = Number(assetCategoryId);
        if (assetId)
            where.assetId = Number(assetId);
        const entries = yield prismaClient_1.default.assetSupportMatrix.findMany({
            where,
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
                employee: { select: { name: true, employeeID: true } },
            },
            orderBy: [{ assetCategoryId: "asc" }, { levelNo: "asc" }],
        });
        res.json(entries);
    }
    catch (error) {
        console.error("getAllSupportMatrix error:", error);
        res.status(500).json({ message: "Failed to fetch support matrix" });
    }
});
exports.getAllSupportMatrix = getAllSupportMatrix;
const getSupportMatrixByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        // First try asset-specific matrix, then fall back to category-level
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetId },
            select: { assetCategoryId: true },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const assetSpecific = yield prismaClient_1.default.assetSupportMatrix.findMany({
            where: { assetId },
            include: { employee: { select: { name: true, employeeID: true } } },
            orderBy: { levelNo: "asc" },
        });
        const categoryLevel = yield prismaClient_1.default.assetSupportMatrix.findMany({
            where: { assetCategoryId: asset.assetCategoryId, assetId: null },
            include: { employee: { select: { name: true, employeeID: true } } },
            orderBy: { levelNo: "asc" },
        });
        res.json({ assetSpecific, categoryLevel });
    }
    catch (error) {
        console.error("getSupportMatrixByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch support matrix" });
    }
});
exports.getSupportMatrixByAsset = getSupportMatrixByAsset;
const getSupportMatrixByCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetCategoryId = parseInt(req.params.assetCategoryId);
        const entries = yield prismaClient_1.default.assetSupportMatrix.findMany({
            where: { assetCategoryId },
            include: { employee: { select: { name: true, employeeID: true } } },
            orderBy: { levelNo: "asc" },
        });
        res.json(entries);
    }
    catch (error) {
        console.error("getSupportMatrixByCategory error:", error);
        res.status(500).json({ message: "Failed to fetch support matrix" });
    }
});
exports.getSupportMatrixByCategory = getSupportMatrixByCategory;
const updateSupportMatrixEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.assetSupportMatrix.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Entry not found" });
            return;
        }
        const updated = yield prismaClient_1.default.assetSupportMatrix.update({
            where: { id },
            data: req.body,
            include: {
                assetCategory: { select: { name: true } },
                employee: { select: { name: true } },
            },
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateSupportMatrixEntry error:", error);
        res.status(500).json({ message: "Failed to update entry" });
    }
});
exports.updateSupportMatrixEntry = updateSupportMatrixEntry;
const deleteSupportMatrixEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.assetSupportMatrix.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Entry not found" });
            return;
        }
        yield prismaClient_1.default.assetSupportMatrix.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteSupportMatrixEntry error:", error);
        res.status(500).json({ message: "Failed to delete entry" });
    }
});
exports.deleteSupportMatrixEntry = deleteSupportMatrixEntry;
const bulkUpsertSupportMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetCategoryId, assetId, entries } = req.body;
        if (!(entries === null || entries === void 0 ? void 0 : entries.length)) {
            res.status(400).json({ message: "entries array is required" });
            return;
        }
        // Delete existing entries for this scope and recreate
        yield prismaClient_1.default.assetSupportMatrix.deleteMany({
            where: {
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                assetId: assetId ? Number(assetId) : undefined,
            },
        });
        const created = yield prismaClient_1.default.$transaction(entries.map((e) => prismaClient_1.default.assetSupportMatrix.create({
            data: {
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                assetId: assetId ? Number(assetId) : undefined,
                levelNo: e.levelNo,
                roleName: e.roleName,
                personName: e.personName,
                employeeId: e.employeeId ? Number(e.employeeId) : undefined,
                contactNumber: e.contactNumber,
                email: e.email,
                escalationTime: e.escalationTime,
                escalationUnit: e.escalationUnit,
                notes: e.notes,
            },
        })));
        res.status(201).json(created);
    }
    catch (error) {
        console.error("bulkUpsertSupportMatrix error:", error);
        res.status(500).json({ message: "Failed to save support matrix" });
    }
});
exports.bulkUpsertSupportMatrix = bulkUpsertSupportMatrix;

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
exports.deleteAssetSlaMatrix = exports.updateAssetSlaMatrix = exports.getAssetSlaMatrixByCategoryAndSla = exports.getAssetSlaMatrixByCategory = exports.getAllAssetSlaMatrix = exports.createAssetSlaMatrix = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const createAssetSlaMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetCategoryId, slaCategory, level, responseTimeValue, responseTimeUnit, resolutionTimeValue, resolutionTimeUnit, isActive } = req.body;
        if (!assetCategoryId ||
            !slaCategory ||
            !level ||
            responseTimeValue == null ||
            !responseTimeUnit ||
            resolutionTimeValue == null ||
            !resolutionTimeUnit) {
            res.status(400).json({ message: "All required fields must be provided" });
            return;
        }
        const created = yield prismaClient_1.default.assetSlaMatrix.create({
            data: {
                assetCategoryId: Number(assetCategoryId),
                slaCategory,
                level,
                responseTimeValue: Number(responseTimeValue),
                responseTimeUnit,
                resolutionTimeValue: Number(resolutionTimeValue),
                resolutionTimeUnit,
                isActive: isActive !== null && isActive !== void 0 ? isActive : true
            }
        });
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to create SLA matrix",
            error: err.message
        });
    }
});
exports.createAssetSlaMatrix = createAssetSlaMatrix;
const getAllAssetSlaMatrix = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield prismaClient_1.default.assetSlaMatrix.findMany({
            include: {
                assetCategory: true
            },
            orderBy: [
                { assetCategoryId: "asc" },
                { slaCategory: "asc" },
                { level: "asc" }
            ]
        });
        res.json(rows);
    }
    catch (err) {
        console.error("getAllAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to fetch SLA matrix",
            error: err.message
        });
    }
});
exports.getAllAssetSlaMatrix = getAllAssetSlaMatrix;
const getAssetSlaMatrixByCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetCategoryId = Number(req.params.assetCategoryId);
        const rows = yield prismaClient_1.default.assetSlaMatrix.findMany({
            where: {
                assetCategoryId,
                isActive: true
            },
            orderBy: [
                { slaCategory: "asc" },
                { level: "asc" }
            ]
        });
        res.json(rows);
    }
    catch (err) {
        console.error("getAssetSlaMatrixByCategory error:", err);
        res.status(500).json({
            message: "Failed to fetch category SLA matrix",
            error: err.message
        });
    }
});
exports.getAssetSlaMatrixByCategory = getAssetSlaMatrixByCategory;
const getAssetSlaMatrixByCategoryAndSla = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetCategoryId = Number(req.params.assetCategoryId);
        const slaCategory = req.params.slaCategory;
        if (Number.isNaN(assetCategoryId)) {
            res.status(400).json({ message: "Invalid assetCategoryId" });
            return;
        }
        const rows = yield prismaClient_1.default.assetSlaMatrix.findMany({
            where: {
                assetCategoryId,
                slaCategory,
                isActive: true
            },
            orderBy: {
                level: "asc"
            }
        });
        res.json(rows);
    }
    catch (err) {
        console.error("getAssetSlaMatrixByCategoryAndSla error:", err);
        res.status(500).json({
            message: "Failed to fetch SLA matrix by category and SLA",
            error: err.message
        });
    }
});
exports.getAssetSlaMatrixByCategoryAndSla = getAssetSlaMatrixByCategoryAndSla;
const updateAssetSlaMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { responseTimeValue, responseTimeUnit, resolutionTimeValue, resolutionTimeUnit, isActive } = req.body;
        const updated = yield prismaClient_1.default.assetSlaMatrix.update({
            where: { id },
            data: {
                responseTimeValue: responseTimeValue != null ? Number(responseTimeValue) : undefined,
                responseTimeUnit: responseTimeUnit !== null && responseTimeUnit !== void 0 ? responseTimeUnit : undefined,
                resolutionTimeValue: resolutionTimeValue != null ? Number(resolutionTimeValue) : undefined,
                resolutionTimeUnit: resolutionTimeUnit !== null && resolutionTimeUnit !== void 0 ? resolutionTimeUnit : undefined,
                isActive: isActive !== null && isActive !== void 0 ? isActive : undefined
            }
        });
        res.json(updated);
    }
    catch (err) {
        console.error("updateAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to update SLA matrix",
            error: err.message
        });
    }
});
exports.updateAssetSlaMatrix = updateAssetSlaMatrix;
const deleteAssetSlaMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        yield prismaClient_1.default.assetSlaMatrix.delete({
            where: { id }
        });
        res.status(204).send();
    }
    catch (err) {
        console.error("deleteAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to delete SLA matrix",
            error: err.message
        });
    }
});
exports.deleteAssetSlaMatrix = deleteAssetSlaMatrix;

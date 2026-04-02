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
exports.deleteCategory = exports.updateCategory = exports.createCategory = exports.getAllCategories = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllCategories = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { includeInactive, search, exportCsv } = req.query;
        const where = {};
        if (includeInactive !== "true")
            where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: String(search) } },
                { code: { contains: String(search) } },
            ];
        }
        const categories = yield prismaClient_1.default.assetCategory.findMany({
            where,
            include: { _count: { select: { assets: true } } },
            orderBy: { name: "asc" },
        });
        if (exportCsv === "true") {
            const csvRows = categories.map((c) => {
                var _a;
                return ({
                    Name: c.name, Code: c.code || "", Description: c.description || "",
                    AssetCount: ((_a = c._count) === null || _a === void 0 ? void 0 : _a.assets) || 0, Active: c.isActive ? "Yes" : "No",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=categories.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json(categories);
    }
    catch (error) {
        console.error("getAllCategories error:", error);
        res.status(500).json({ message: "Failed to fetch categories" });
    }
});
exports.getAllCategories = getAllCategories;
const createCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const category = yield prismaClient_1.default.assetCategory.create({ data: req.body });
    res.status(201).json(category);
});
exports.createCategory = createCategory;
const updateCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const { name } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim())) {
            res.status(400).json({ message: "Category name is required" });
            return;
        }
        const updated = yield prismaClient_1.default.assetCategory.update({ where: { id }, data: { name: name.trim() } });
        res.json(updated);
    }
    catch (error) {
        console.error("updateCategory error:", error);
        res.status(500).json({ message: "Failed to update category" });
    }
});
exports.updateCategory = updateCategory;
const deleteCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const inUse = yield prismaClient_1.default.asset.findFirst({ where: { assetCategoryId: id } });
        if (inUse) {
            res.status(400).json({ message: "Category has assets assigned. Cannot delete." });
            return;
        }
        yield prismaClient_1.default.assetCategory.update({ where: { id }, data: { isActive: false } });
        res.json({ message: "Category deactivated" });
    }
    catch (error) {
        console.error("deleteCategory error:", error);
        res.status(500).json({ message: "Failed to delete category" });
    }
});
exports.deleteCategory = deleteCategory;

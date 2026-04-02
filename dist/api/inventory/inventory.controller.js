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
exports.deleteConsumable = exports.updateConsumable = exports.getAllConsumables = exports.createConsumable = exports.deleteSparePart = exports.updateSparePart = exports.getAllSpareParts = exports.createSparePart = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ================= CREATE =================
const createSparePart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, partNumber, model, category, vendorId, stockQuantity, reorderLevel, cost } = req.body;
        if (!name) {
            res.status(400).json({ message: "Name is required" });
            return;
        }
        const spare = yield prismaClient_1.default.sparePart.create({
            data: {
                name,
                partNumber: partNumber || null,
                model: model || null,
                category: category || null,
                vendorId: vendorId ? Number(vendorId) : null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: Number(reorderLevel || 0),
                cost: cost ? Number(cost) : null
            }
        });
        res.json(spare);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createSparePart = createSparePart;
// ================= GET ALL =================
const getAllSpareParts = (_, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const list = yield prismaClient_1.default.sparePart.findMany({
            orderBy: { id: "desc" },
            include: {
                vendor: true
            }
        });
        res.json(list);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllSpareParts = getAllSpareParts;
// ================= UPDATE =================
const updateSparePart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { name, partNumber, model, category, vendorId, stockQuantity, reorderLevel, cost } = req.body;
        if (stockQuantity < 0) {
            res.status(400).json({ message: "Stock cannot be negative" });
            return;
        }
        const updated = yield prismaClient_1.default.sparePart.update({
            where: { id },
            data: {
                name,
                partNumber: partNumber || null,
                model: model || null,
                category: category || null,
                vendorId: vendorId ? Number(vendorId) : null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: Number(reorderLevel || 0),
                cost: cost ? Number(cost) : null
            }
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.updateSparePart = updateSparePart;
// ================= DELETE =================
const deleteSparePart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const usage = yield prismaClient_1.default.sparePartUsage.findFirst({
            where: { sparePartId: id }
        });
        if (usage) {
            res.status(400).json({
                message: "Cannot delete spare part. It is already used in maintenance."
            });
            return;
        }
        yield prismaClient_1.default.sparePart.delete({
            where: { id }
        });
        res.json({ message: "Deleted successfully" });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.deleteSparePart = deleteSparePart;
// ================= CREATE =================
const createConsumable = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, unit, stockQuantity, reorderLevel } = req.body;
        if (!name) {
            res.status(400).json({ message: "Name is required" });
            return;
        }
        const consumable = yield prismaClient_1.default.consumable.create({
            data: {
                name,
                unit: unit || null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: reorderLevel ? Number(reorderLevel) : null
            }
        });
        res.json(consumable);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createConsumable = createConsumable;
// ================= GET ALL =================
const getAllConsumables = (_, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const list = yield prismaClient_1.default.consumable.findMany({
            orderBy: { id: "desc" }
        });
        res.json(list);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllConsumables = getAllConsumables;
// ================= UPDATE =================
const updateConsumable = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { name, unit, stockQuantity, reorderLevel } = req.body;
        const updated = yield prismaClient_1.default.consumable.update({
            where: { id },
            data: {
                name,
                unit: unit || null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: reorderLevel ? Number(reorderLevel) : null
            }
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.updateConsumable = updateConsumable;
// ================= DELETE =================
const deleteConsumable = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        yield prismaClient_1.default.consumable.delete({
            where: { id }
        });
        res.json({ message: "Deleted successfully" });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.deleteConsumable = deleteConsumable;

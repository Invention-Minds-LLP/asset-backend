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
exports.updateVendor = exports.deleteVendor = exports.createVendor = exports.getAllVendors = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllVendors = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const vendors = yield prismaClient_1.default.vendor.findMany();
    res.json(vendors);
});
exports.getAllVendors = getAllVendors;
const createVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const vendor = yield prismaClient_1.default.vendor.create({ data: req.body });
    res.status(201).json(vendor);
});
exports.createVendor = createVendor;
const deleteVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    yield prismaClient_1.default.vendor.delete({ where: { id } });
    res.status(204).send();
});
exports.deleteVendor = deleteVendor;
const updateVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id, 10);
        const updatedVendor = yield prismaClient_1.default.vendor.update({
            where: { id },
            data: req.body, // update only the fields sent in request body
        });
        res.json(updatedVendor);
    }
    catch (error) {
        console.error('Error updating vendor:', error);
        res.status(500).json({ error: 'Failed to update vendor.' });
    }
});
exports.updateVendor = updateVendor;

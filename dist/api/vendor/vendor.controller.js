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
    try {
        const { includeInactive, search, page, limit: lim, exportCsv } = req.query;
        const where = {};
        if (includeInactive !== "true")
            where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: String(search) } },
                { contact: { contains: String(search) } },
                { email: { contains: String(search) } },
                { gstNumber: { contains: String(search) } },
            ];
        }
        if (page && lim) {
            const skip = (parseInt(String(page)) - 1) * parseInt(String(lim));
            const take = parseInt(String(lim));
            const [total, vendors] = yield Promise.all([
                prismaClient_1.default.vendor.count({ where }),
                prismaClient_1.default.vendor.findMany({ where, orderBy: { name: "asc" }, skip, take }),
            ]);
            if (exportCsv === "true") {
                const csvRows = vendors.map((v) => ({
                    Name: v.name, Contact: v.contact, Email: v.email || "", VendorType: v.vendorType || "",
                    GST: v.gstNumber || "", PAN: v.panNumber || "", Rating: v.rating || "", Active: v.isActive ? "Yes" : "No",
                }));
                const headers = Object.keys(csvRows[0] || {}).join(",");
                const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", "attachment; filename=vendors.csv");
                res.send(headers + "\n" + rows);
                return;
            }
            res.json({ data: vendors, total, page: parseInt(String(page)), limit: take });
            return;
        }
        const vendors = yield prismaClient_1.default.vendor.findMany({ where, orderBy: { name: "asc" } });
        res.json(vendors);
    }
    catch (error) {
        console.error("getAllVendors error:", error);
        res.status(500).json({ message: "Failed to fetch vendors" });
    }
});
exports.getAllVendors = getAllVendors;
const createVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const vendor = yield prismaClient_1.default.vendor.create({ data: req.body });
    res.status(201).json(vendor);
});
exports.createVendor = createVendor;
const deleteVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        // Soft delete
        yield prismaClient_1.default.vendor.update({ where: { id }, data: { isActive: false } });
        res.json({ message: "Vendor deactivated" });
    }
    catch (error) {
        console.error("deleteVendor error:", error);
        res.status(500).json({ message: "Failed to delete vendor" });
    }
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

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
exports.globalSearch = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Global Search across assets, tickets, employees ─────────────────────────
const globalSearch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { q, limit = "5" } = req.query;
        if (!q || String(q).trim().length < 2) {
            res.json({ assets: [], tickets: [], employees: [], vendors: [] });
            return;
        }
        const query = String(q).trim();
        const take = Math.min(parseInt(String(limit)), 20);
        const [assets, tickets, employees, vendors] = yield Promise.all([
            prismaClient_1.default.asset.findMany({
                where: {
                    OR: [
                        { assetId: { contains: query } },
                        { assetName: { contains: query } },
                        { serialNumber: { contains: query } },
                        { manufacturer: { contains: query } },
                        { modelNumber: { contains: query } },
                    ],
                },
                select: {
                    id: true,
                    assetId: true,
                    assetName: true,
                    serialNumber: true,
                    status: true,
                    department: { select: { name: true } },
                },
                take,
            }),
            prismaClient_1.default.ticket.findMany({
                where: {
                    OR: [
                        { ticketId: { contains: query } },
                        { detailedDesc: { contains: query } },
                        { issueType: { contains: query } },
                    ],
                },
                select: {
                    id: true,
                    ticketId: true,
                    issueType: true,
                    status: true,
                    priority: true,
                    asset: { select: { assetId: true, assetName: true } },
                },
                take,
            }),
            prismaClient_1.default.employee.findMany({
                where: {
                    OR: [
                        { name: { contains: query } },
                        { employeeID: { contains: query } },
                        { email: { contains: query } },
                        { designation: { contains: query } },
                    ],
                },
                select: {
                    id: true,
                    name: true,
                    employeeID: true,
                    email: true,
                    designation: true,
                    department: { select: { name: true } },
                    isActive: true,
                },
                take,
            }),
            prismaClient_1.default.vendor.findMany({
                where: {
                    OR: [
                        { name: { contains: query } },
                        { contact: { contains: query } },
                        { email: { contains: query } },
                        { gstNumber: { contains: query } },
                    ],
                },
                select: {
                    id: true,
                    name: true,
                    vendorType: true,
                    contact: true,
                    email: true,
                    isActive: true,
                },
                take,
            }),
        ]);
        res.json({
            assets: assets.map((a) => (Object.assign(Object.assign({}, a), { type: "asset" }))),
            tickets: tickets.map((t) => (Object.assign(Object.assign({}, t), { type: "ticket" }))),
            employees: employees.map((e) => (Object.assign(Object.assign({}, e), { type: "employee" }))),
            vendors: vendors.map((v) => (Object.assign(Object.assign({}, v), { type: "vendor" }))),
            totalResults: assets.length + tickets.length + employees.length + vendors.length,
        });
    }
    catch (error) {
        console.error("globalSearch error:", error);
        res.status(500).json({ message: "Failed to perform search" });
    }
});
exports.globalSearch = globalSearch;

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
exports.updateVendorRating = exports.getVendorPerformance = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Vendor Performance Dashboard ────────────────────────────────────────────
const getVendorPerformance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { vendorId, dateFrom, dateTo } = req.query;
        const dateFilter = {};
        if (dateFrom)
            dateFilter.gte = new Date(String(dateFrom));
        if (dateTo)
            dateFilter.lte = new Date(String(dateTo));
        const vendors = yield prismaClient_1.default.vendor.findMany({
            where: Object.assign({ isActive: true }, (vendorId ? { id: Number(vendorId) } : {})),
            select: {
                id: true,
                name: true,
                contact: true,
                email: true,
                vendorType: true,
                rating: true,
                serviceContracts: {
                    select: {
                        id: true,
                        contractType: true,
                        status: true,
                        cost: true,
                        visitsPerYear: true,
                        startDate: true,
                        endDate: true,
                    },
                },
            },
        });
        const performanceData = yield Promise.all(vendors.map((vendor) => __awaiter(void 0, void 0, void 0, function* () {
            // Tickets resolved by this vendor's assets
            const allTicketWhere = {
                asset: { vendorId: vendor.id },
            };
            if (dateFrom || dateTo)
                allTicketWhere.createdAt = dateFilter;
            const resolvedTicketWhere = {
                asset: { vendorId: vendor.id },
                status: { in: ["RESOLVED", "CLOSED"] },
            };
            if (dateFrom || dateTo)
                resolvedTicketWhere.createdAt = dateFilter;
            const [totalTickets, resolvedTickets] = yield Promise.all([
                prismaClient_1.default.ticket.count({
                    where: allTicketWhere,
                }),
                prismaClient_1.default.ticket.findMany({
                    where: resolvedTicketWhere,
                    select: {
                        id: true,
                        createdAt: true,
                        slaResolvedAt: true,
                        slaBreached: true,
                        serviceCost: true,
                        partsCost: true,
                        totalCost: true,
                    },
                }),
            ]);
            // Calculate response time (avg days from created to resolved)
            let totalResponseDays = 0;
            let resolvedCount = 0;
            let slaBreachCount = 0;
            let totalCost = 0;
            for (const t of resolvedTickets) {
                if (t.slaResolvedAt) {
                    const days = (new Date(t.slaResolvedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
                    totalResponseDays += days;
                    resolvedCount++;
                }
                if (t.slaBreached)
                    slaBreachCount++;
                totalCost += Number(t.totalCost || 0);
            }
            const activeContracts = vendor.serviceContracts.filter((c) => c.status === "ACTIVE").length;
            const totalContractValue = vendor.serviceContracts.reduce((sum, c) => sum + Number(c.cost || 0), 0);
            return {
                vendorId: vendor.id,
                vendorName: vendor.name,
                vendorType: vendor.vendorType,
                contact: vendor.contact,
                email: vendor.email,
                currentRating: vendor.rating,
                activeContracts,
                totalContractValue,
                totalTicketsResolved: resolvedCount,
                totalTickets,
                ticketSummary: `${resolvedCount}/${totalTickets}`,
                avgResponseDays: resolvedCount > 0 ? Number((totalResponseDays / resolvedCount).toFixed(1)) : null,
                slaBreachCount,
                slaComplianceRate: resolvedTickets.length > 0
                    ? Number((((resolvedTickets.length - slaBreachCount) / resolvedTickets.length) * 100).toFixed(1))
                    : null,
                totalMaintenanceCost: Number(totalCost.toFixed(2)),
            };
        })));
        res.json(performanceData);
    }
    catch (error) {
        console.error("getVendorPerformance error:", error);
        res.status(500).json({ message: "Failed to fetch vendor performance" });
    }
});
exports.getVendorPerformance = getVendorPerformance;
// ─── Update Vendor Rating ────────────────────────────────────────────────────
const updateVendorRating = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { rating } = req.body;
        if (!rating || rating < 1 || rating > 5) {
            res.status(400).json({ message: "Rating must be between 1 and 5" });
            return;
        }
        const vendor = yield prismaClient_1.default.vendor.update({
            where: { id },
            data: { rating },
        });
        res.json(vendor);
    }
    catch (error) {
        console.error("updateVendorRating error:", error);
        res.status(500).json({ message: "Failed to update vendor rating" });
    }
});
exports.updateVendorRating = updateVendorRating;

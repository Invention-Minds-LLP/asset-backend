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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFinanceConfig = getFinanceConfig;
exports.updateFinanceConfig = updateFinanceConfig;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// GET /api/finance/config
function getFinanceConfig(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let config = yield prisma.financeConfig.findFirst();
            if (!config) {
                config = yield prisma.financeConfig.create({ data: {} });
            }
            res.json(config);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load finance config" });
        }
    });
}
// PUT /api/finance/config
function updateFinanceConfig(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const { accountingMode, exportTarget, autoVoucher, requireApproval, fyStartMonth, defaultCurrency } = req.body;
        try {
            let config = yield prisma.financeConfig.findFirst();
            if (!config) {
                config = yield prisma.financeConfig.create({
                    data: { accountingMode, exportTarget, autoVoucher, requireApproval, fyStartMonth, defaultCurrency, updatedById: req.user.employeeDbId }
                });
            }
            else {
                config = yield prisma.financeConfig.update({
                    where: { id: config.id },
                    data: { accountingMode, exportTarget, autoVoucher, requireApproval, fyStartMonth, defaultCurrency, updatedById: req.user.employeeDbId }
                });
            }
            res.json(config);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to update finance config" });
        }
    });
}

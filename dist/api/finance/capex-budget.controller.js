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
exports.listCapexBudgets = listCapexBudgets;
exports.createCapexBudget = createCapexBudget;
exports.updateCapexBudget = updateCapexBudget;
exports.refreshCapexActuals = refreshCapexActuals;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const include = {
    department: { select: { id: true, name: true } },
    category: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
};
// GET /api/finance/capex-budgets?fiscalYear=
function listCapexBudgets(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fy = parseInt(req.query.fiscalYear || String(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1));
        try {
            const budgets = yield prisma.capexBudget.findMany({ where: { fiscalYear: fy }, include, orderBy: { id: "asc" } });
            const totals = budgets.reduce((acc, b) => ({
                budget: acc.budget + Number(b.budgetAmount),
                actual: acc.actual + Number(b.actualAmount),
            }), { budget: 0, actual: 0 });
            res.json({ budgets, totals, fiscalYear: fy });
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load capex budgets" });
        }
    });
}
// POST /api/finance/capex-budgets
function createCapexBudget(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || (req.user.role !== "FINANCE" && req.user.role !== "CEO_COO")) {
            res.status(403).json({ error: "FINANCE or CEO_COO role required" });
            return;
        }
        const { fiscalYear, departmentId, categoryId, budgetAmount, notes } = req.body;
        try {
            const budget = yield prisma.capexBudget.create({
                data: { fiscalYear: parseInt(fiscalYear), departmentId: departmentId || null, categoryId: categoryId || null, budgetAmount, notes: notes || null, createdById: req.user.employeeDbId },
                include,
            });
            res.status(201).json(budget);
        }
        catch (err) {
            if (err.code === "P2002") {
                res.status(400).json({ error: "Budget already exists for this FY/Department/Category combination" });
                return;
            }
            console.error(err);
            res.status(500).json({ error: "Failed to create budget" });
        }
    });
}
// PUT /api/finance/capex-budgets/:id
function updateCapexBudget(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || (req.user.role !== "FINANCE" && req.user.role !== "CEO_COO")) {
            res.status(403).json({ error: "FINANCE or CEO_COO role required" });
            return;
        }
        const { budgetAmount, notes } = req.body;
        try {
            const budget = yield prisma.capexBudget.update({
                where: { id: Number(req.params.id) },
                data: { budgetAmount, notes: notes || null },
                include,
            });
            res.json(budget);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to update budget" });
        }
    });
}
// POST /api/finance/capex-budgets/refresh-actuals
function refreshCapexActuals(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fy = parseInt(req.query.fiscalYear || String(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1));
        const fyStart = new Date(`${fy}-04-01`);
        const fyEnd = new Date(`${fy + 1}-03-31T23:59:59`);
        try {
            const budgets = yield prisma.capexBudget.findMany({ where: { fiscalYear: fy }, include: { department: true, category: true } });
            for (const budget of budgets) {
                const where = { purchaseDate: { gte: fyStart, lte: fyEnd } };
                if (budget.departmentId)
                    where.departmentId = budget.departmentId;
                if (budget.categoryId)
                    where.assetCategoryId = budget.categoryId;
                const assets = yield prisma.asset.findMany({ where, select: { purchaseCost: true } });
                const actual = assets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0);
                yield prisma.capexBudget.update({ where: { id: budget.id }, data: { actualAmount: actual } });
            }
            res.json({ message: "Actuals refreshed", fiscalYear: fy });
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to refresh actuals" });
        }
    });
}

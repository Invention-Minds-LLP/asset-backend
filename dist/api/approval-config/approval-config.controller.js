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
exports.getRequiredLevel = exports.seedApprovalConfigs = exports.deleteApprovalConfig = exports.updateApprovalConfig = exports.createApprovalConfig = exports.listApprovalConfigs = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ═══════════════════════════════════════════════════════════
// GET / — List all approval configs
// ═══════════════════════════════════════════════════════════
const listApprovalConfigs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { module } = req.query;
        const where = {};
        if (module)
            where.module = String(module);
        const configs = yield prismaClient_1.default.approvalConfig.findMany({
            where,
            orderBy: [{ module: "asc" }, { level: "asc" }],
        });
        res.json(configs);
    }
    catch (err) {
        console.error("listApprovalConfigs error:", err);
        res.status(500).json({ error: "Failed to list approval configs", details: err.message });
    }
});
exports.listApprovalConfigs = listApprovalConfigs;
// ═══════════════════════════════════════════════════════════
// POST / — Create or upsert config
// ═══════════════════════════════════════════════════════════
const createApprovalConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { module, level, roleName, minAmount, maxAmount } = req.body;
        if (!module || level == null || !roleName || minAmount == null) {
            res.status(400).json({ error: "module, level, roleName, and minAmount are required" });
            return;
        }
        const config = yield prismaClient_1.default.approvalConfig.upsert({
            where: { module_level: { module, level: Number(level) } },
            update: {
                roleName,
                minAmount,
                maxAmount: maxAmount !== null && maxAmount !== void 0 ? maxAmount : null,
                isActive: true,
            },
            create: {
                module,
                level: Number(level),
                roleName,
                minAmount,
                maxAmount: maxAmount !== null && maxAmount !== void 0 ? maxAmount : null,
                isActive: true,
            },
        });
        res.status(201).json(config);
    }
    catch (err) {
        console.error("createApprovalConfig error:", err);
        res.status(500).json({ error: "Failed to create approval config", details: err.message });
    }
});
exports.createApprovalConfig = createApprovalConfig;
// ═══════════════════════════════════════════════════════════
// PUT /:id — Update config
// ═══════════════════════════════════════════════════════════
const updateApprovalConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { module, level, roleName, minAmount, maxAmount, isActive } = req.body;
        const existing = yield prismaClient_1.default.approvalConfig.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: "Approval config not found" });
            return;
        }
        const updated = yield prismaClient_1.default.approvalConfig.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (module !== undefined && { module })), (level !== undefined && { level: Number(level) })), (roleName !== undefined && { roleName })), (minAmount !== undefined && { minAmount })), (maxAmount !== undefined && { maxAmount })), (isActive !== undefined && { isActive })),
        });
        res.json(updated);
    }
    catch (err) {
        console.error("updateApprovalConfig error:", err);
        res.status(500).json({ error: "Failed to update approval config", details: err.message });
    }
});
exports.updateApprovalConfig = updateApprovalConfig;
// ═══════════════════════════════════════════════════════════
// DELETE /:id — Delete config
// ═══════════════════════════════════════════════════════════
const deleteApprovalConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const existing = yield prismaClient_1.default.approvalConfig.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: "Approval config not found" });
            return;
        }
        yield prismaClient_1.default.approvalConfig.delete({ where: { id } });
        res.json({ message: "Approval config deleted" });
    }
    catch (err) {
        console.error("deleteApprovalConfig error:", err);
        res.status(500).json({ error: "Failed to delete approval config", details: err.message });
    }
});
exports.deleteApprovalConfig = deleteApprovalConfig;
// ═══════════════════════════════════════════════════════════
// POST /seed — Seed default approval levels
// ═══════════════════════════════════════════════════════════
const seedApprovalConfigs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const defaults = [
            // PURCHASE_ORDER — roleName maps to approvalChain keys in purchase-order.controller.ts
            { module: "PURCHASE_ORDER", level: 1, roleName: "HOD", minAmount: 0, maxAmount: 100000 },
            { module: "PURCHASE_ORDER", level: 2, roleName: "MANAGEMENT", minAmount: 100001, maxAmount: 500000 },
            { module: "PURCHASE_ORDER", level: 3, roleName: "COO", minAmount: 500001, maxAmount: 2000000 },
            { module: "PURCHASE_ORDER", level: 4, roleName: "CFO", minAmount: 2000001, maxAmount: null },
            // WORK_ORDER
            { module: "WORK_ORDER", level: 1, roleName: "HOD", minAmount: 0, maxAmount: 100000 },
            { module: "WORK_ORDER", level: 2, roleName: "MANAGEMENT", minAmount: 100001, maxAmount: 500000 },
            { module: "WORK_ORDER", level: 3, roleName: "COO", minAmount: 500001, maxAmount: 2000000 },
            { module: "WORK_ORDER", level: 4, roleName: "CFO", minAmount: 2000001, maxAmount: null },
            // DISPOSAL
            { module: "DISPOSAL", level: 1, roleName: "HOD", minAmount: 0, maxAmount: 100000 },
            { module: "DISPOSAL", level: 2, roleName: "MANAGEMENT", minAmount: 100001, maxAmount: 500000 },
            { module: "DISPOSAL", level: 3, roleName: "COO", minAmount: 500001, maxAmount: 2000000 },
            { module: "DISPOSAL", level: 4, roleName: "CFO", minAmount: 2000001, maxAmount: null },
        ];
        const results = [];
        for (const d of defaults) {
            const config = yield prismaClient_1.default.approvalConfig.upsert({
                where: { module_level: { module: d.module, level: d.level } },
                update: {
                    roleName: d.roleName,
                    minAmount: d.minAmount,
                    maxAmount: d.maxAmount,
                    isActive: true,
                },
                create: {
                    module: d.module,
                    level: d.level,
                    roleName: d.roleName,
                    minAmount: d.minAmount,
                    maxAmount: d.maxAmount,
                    isActive: true,
                },
            });
            results.push(config);
        }
        res.status(201).json({ message: "Seeded approval configs", count: results.length, configs: results });
    }
    catch (err) {
        console.error("seedApprovalConfigs error:", err);
        res.status(500).json({ error: "Failed to seed approval configs", details: err.message });
    }
});
exports.seedApprovalConfigs = seedApprovalConfigs;
// ═══════════════════════════════════════════════════════════
// GET /required-level — Which role needs to approve for a given amount?
// ═══════════════════════════════════════════════════════════
const getRequiredLevel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { module, amount } = req.query;
        if (!module || amount == null) {
            res.status(400).json({ error: "module and amount query params are required" });
            return;
        }
        const amt = Number(amount);
        const configs = yield prismaClient_1.default.approvalConfig.findMany({
            where: {
                module: String(module),
                isActive: true,
            },
            orderBy: { level: "asc" },
        });
        if (configs.length === 0) {
            res.status(404).json({ error: `No approval config found for module ${module}` });
            return;
        }
        // Find the matching level for the given amount
        const matched = configs.find((c) => {
            const min = Number(c.minAmount);
            const max = c.maxAmount !== null ? Number(c.maxAmount) : Infinity;
            return amt >= min && amt <= max;
        });
        if (!matched) {
            // If no range matches, return the highest level (unlimited)
            const highest = configs[configs.length - 1];
            res.json({
                module: String(module),
                amount: amt,
                requiredLevel: highest.level,
                requiredRole: highest.roleName,
                allLevels: configs.map((c) => ({
                    level: c.level,
                    roleName: c.roleName,
                    minAmount: Number(c.minAmount),
                    maxAmount: c.maxAmount !== null ? Number(c.maxAmount) : null,
                })),
            });
            return;
        }
        res.json({
            module: String(module),
            amount: amt,
            requiredLevel: matched.level,
            requiredRole: matched.roleName,
            allLevels: configs.map((c) => ({
                level: c.level,
                roleName: c.roleName,
                minAmount: Number(c.minAmount),
                maxAmount: c.maxAmount !== null ? Number(c.maxAmount) : null,
            })),
        });
    }
    catch (err) {
        console.error("getRequiredLevel error:", err);
        res.status(500).json({ error: "Failed to get required approval level", details: err.message });
    }
});
exports.getRequiredLevel = getRequiredLevel;

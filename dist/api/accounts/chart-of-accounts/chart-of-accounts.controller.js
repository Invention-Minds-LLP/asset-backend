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
exports.getAccountsDropdown = exports.deleteAccount = exports.updateAccount = exports.createAccount = exports.getAccountById = exports.getAllAccounts = void 0;
const prismaClient_1 = __importDefault(require("../../../prismaClient"));
const audit_trail_controller_1 = require("../../audit-trail/audit-trail.controller");
// GET /api/accounts/chart-of-accounts
const getAllAccounts = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const accounts = yield prismaClient_1.default.chartOfAccount.findMany({
            include: { children: true, parent: { select: { id: true, code: true, name: true } } },
            orderBy: { code: "asc" },
        });
        res.json(accounts);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch chart of accounts" });
    }
});
exports.getAllAccounts = getAllAccounts;
// GET /api/accounts/chart-of-accounts/:id
const getAccountById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const account = yield prismaClient_1.default.chartOfAccount.findUnique({
            where: { id },
            include: { children: true, parent: true },
        });
        if (!account) {
            res.status(404).json({ message: "Account not found" });
            return;
        }
        res.json(account);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch account" });
    }
});
exports.getAccountById = getAccountById;
// POST /api/accounts/chart-of-accounts
const createAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { code, name, type, subType, description, parentId } = req.body;
        if (!code || !name || !type) {
            res.status(400).json({ message: "code, name and type are required" });
            return;
        }
        const account = yield prismaClient_1.default.chartOfAccount.create({
            data: { code, name, type, subType: subType !== null && subType !== void 0 ? subType : null, description: description !== null && description !== void 0 ? description : null, parentId: parentId ? Number(parentId) : null },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "CHART_OF_ACCOUNT", entityId: account.id, action: "CREATE", description: `Account ${account.code} - ${account.name} created`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        res.status(201).json(account);
    }
    catch (err) {
        if (err.code === "P2002") {
            res.status(409).json({ message: "Account code already exists" });
            return;
        }
        console.error(err);
        res.status(500).json({ message: "Failed to create account" });
    }
});
exports.createAccount = createAccount;
// PUT /api/accounts/chart-of-accounts/:id
const updateAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        const { name, subType, description, parentId, isActive } = req.body;
        const updated = yield prismaClient_1.default.chartOfAccount.update({
            where: { id },
            data: { name, subType: subType !== null && subType !== void 0 ? subType : null, description: description !== null && description !== void 0 ? description : null, parentId: parentId ? Number(parentId) : null, isActive: isActive !== null && isActive !== void 0 ? isActive : true },
        });
        (0, audit_trail_controller_1.logAction)({ entityType: "CHART_OF_ACCOUNT", entityId: id, action: "UPDATE", description: `Account ${updated.code} updated`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update account" });
    }
});
exports.updateAccount = updateAccount;
// DELETE /api/accounts/chart-of-accounts/:id
const deleteAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id);
        yield prismaClient_1.default.chartOfAccount.update({ where: { id }, data: { isActive: false } });
        (0, audit_trail_controller_1.logAction)({ entityType: "CHART_OF_ACCOUNT", entityId: id, action: "DELETE", description: `Account deactivated`, performedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId });
        res.json({ message: "Account deactivated" });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to deactivate account" });
    }
});
exports.deleteAccount = deleteAccount;
// GET /api/accounts/chart-of-accounts/dropdown  — for voucher form selects
const getAccountsDropdown = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const accounts = yield prismaClient_1.default.chartOfAccount.findMany({
            where: { isActive: true },
            select: { id: true, code: true, name: true, type: true, subType: true },
            orderBy: { code: "asc" },
        });
        res.json(accounts);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch accounts dropdown" });
    }
});
exports.getAccountsDropdown = getAccountsDropdown;

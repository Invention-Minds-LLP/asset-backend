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
exports.APPROVAL_AUTHORITY = void 0;
exports.getRequiredApprovalLevel = getRequiredApprovalLevel;
exports.canApproveAtLevel = canApproveAtLevel;
const prismaClient_1 = __importDefault(require("../prismaClient"));
/** Fallback thresholds when no ApprovalConfig rows exist for a module */
const FALLBACK = [
    { roleName: "HOD", minAmount: 0, maxAmount: 100000 },
    { roleName: "MANAGEMENT", minAmount: 100001, maxAmount: 500000 },
    { roleName: "COO", minAmount: 500001, maxAmount: 2000000 },
    { roleName: "CFO", minAmount: 2000001, maxAmount: null },
];
/**
 * Returns the approval level key ("HOD" | "MANAGEMENT" | "COO" | "CFO")
 * required for the given module and amount.
 * Reads live from ApprovalConfig table; falls back to hardcoded defaults.
 */
function getRequiredApprovalLevel(module, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        const configs = yield prismaClient_1.default.approvalConfig.findMany({
            where: { module, isActive: true },
            orderBy: { level: "asc" },
        });
        const levels = configs.length > 0
            ? configs.map((c) => ({
                roleName: c.roleName,
                minAmount: Number(c.minAmount),
                maxAmount: c.maxAmount != null ? Number(c.maxAmount) : null,
            }))
            : FALLBACK;
        const matched = levels.find((c) => {
            const max = c.maxAmount != null ? c.maxAmount : Infinity;
            return amount >= c.minAmount && amount <= max;
        });
        return (matched !== null && matched !== void 0 ? matched : levels[levels.length - 1]).roleName;
    });
}
/**
 * Employee roles that have authority to approve at each level.
 * Any role listed can act on behalf of that level or higher.
 * e.g. a CEO_COO can approve HOD, MANAGEMENT, or COO level items.
 */
exports.APPROVAL_AUTHORITY = {
    HOD: ["HOD", "FINANCE", "CEO_COO", "ADMIN"],
    MANAGEMENT: ["FINANCE", "CEO_COO", "ADMIN"],
    COO: ["CEO_COO", "ADMIN"],
    CFO: ["ADMIN"],
};
/**
 * Returns true if the given employee role can approve at the required level.
 */
function canApproveAtLevel(employeeRole, requiredLevel) {
    var _a;
    return ((_a = exports.APPROVAL_AUTHORITY[requiredLevel]) !== null && _a !== void 0 ? _a : ["ADMIN"]).includes(employeeRole);
}

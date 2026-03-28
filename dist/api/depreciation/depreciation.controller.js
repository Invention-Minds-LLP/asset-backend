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
exports.runDepreciationForAsset = exports.calculateDepreciation = exports.updateDepreciation = exports.addDepreciation = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const addDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
        //    res.status(403).json({ message: "Not allowed" });
        //    return;
        // }
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const { assetId, depreciationMethod, depreciationRate, expectedLifeYears, salvageValue, depreciationStart, depreciationFrequency, } = req.body;
        if (!assetId || !depreciationMethod || !expectedLifeYears || !depreciationStart) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: Number(assetId) },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        if (!cost || cost <= 0) {
            res.status(400).json({ message: "Asset cost is missing (purchaseCost/estimatedValue)" });
            return;
        }
        const existing = yield prismaClient_1.default.assetDepreciation.findUnique({
            where: { assetId: Number(assetId) }
        });
        if (existing) {
            res.status(400).json({ message: "Depreciation already exists for asset" });
            return;
        }
        const depreciation = yield prismaClient_1.default.assetDepreciation.create({
            data: {
                assetId: Number(assetId),
                depreciationMethod,
                depreciationRate: depreciationRate != null ? String(depreciationRate) : "0",
                expectedLifeYears: Number(expectedLifeYears),
                salvageValue: salvageValue != null && salvageValue !== "" ? String(salvageValue) : null,
                depreciationStart: new Date(depreciationStart),
                depreciationFrequency: depreciationFrequency || "YEARLY",
                accumulatedDepreciation: "0",
                currentBookValue: String(cost),
                lastCalculatedAt: null,
                createdById: employeeId,
                updatedById: employeeId,
                isActive: true,
            }
        });
        res.status(201).json(depreciation);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to add depreciation" });
    }
});
exports.addDepreciation = addDepreciation;
const updateDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // if (req.user.role !== "superadmin") {
        //    res.status(403).json({ message: "Admins only" });
        //    return;
        // }
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const id = parseInt(req.params.id);
        const data = req.body;
        const updated = yield prismaClient_1.default.assetDepreciation.update({
            where: { id },
            data: {
                depreciationMethod: data.depreciationMethod,
                depreciationRate: data.depreciationRate != null ? String(data.depreciationRate) : undefined,
                expectedLifeYears: data.expectedLifeYears != null ? Number(data.expectedLifeYears) : undefined,
                salvageValue: data.salvageValue != null && data.salvageValue !== "" ? String(data.salvageValue) : null,
                depreciationStart: data.depreciationStart ? new Date(data.depreciationStart) : undefined,
                depreciationFrequency: (_a = data.depreciationFrequency) !== null && _a !== void 0 ? _a : undefined,
                isActive: (_b = data.isActive) !== null && _b !== void 0 ? _b : undefined,
                updatedById: employeeId,
            }
        });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed updating depreciation" });
    }
});
exports.updateDepreciation = updateDepreciation;
const calculateDepreciation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { assetId } = req.params;
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: parseInt(assetId) },
            include: { depreciation: true }
        });
        if (!asset || !asset.depreciation) {
            res.status(404).json({ message: "Depreciation not found" });
            return;
        }
        const dep = asset.depreciation;
        // ✅ Convert Decimal → number safely
        const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        const salvage = Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0);
        const life = dep.expectedLifeYears || 1; // avoid divide by 0
        const rate = Number((_d = dep.depreciationRate) !== null && _d !== void 0 ? _d : 0);
        const method = dep.depreciationMethod;
        const start = new Date(dep.depreciationStart);
        const today = new Date();
        const diffYears = (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365);
        let depreciationTillDate = 0;
        let bookValue = cost;
        // =========================
        // STRAIGHT LINE (SL)
        // =========================
        if (method === "SL") {
            const annual = (cost - salvage) / life;
            depreciationTillDate = Math.min(annual * diffYears, cost - salvage);
            bookValue = cost - depreciationTillDate;
        }
        // =========================
        // DECLINING BALANCE (DB)
        // =========================
        else if (method === "DB") {
            bookValue = cost * Math.pow((1 - rate / 100), diffYears);
            depreciationTillDate = cost - bookValue;
        }
        // =========================
        // SAFETY FIXES
        // =========================
        if (bookValue < salvage) {
            bookValue = salvage;
        }
        if (depreciationTillDate < 0) {
            depreciationTillDate = 0;
        }
        yield prismaClient_1.default.assetDepreciation.update({
            where: { assetId: asset.id },
            data: {
                accumulatedDepreciation: depreciationTillDate,
                currentBookValue: bookValue,
                lastCalculatedAt: new Date()
            }
        });
        res.json({
            assetId,
            depreciationMethod: method,
            purchaseCost: cost,
            salvageValue: salvage,
            depreciationTillDate: Number(depreciationTillDate.toFixed(2)),
            bookValue: Number(bookValue.toFixed(2)),
            yearsUsed: Number(diffYears.toFixed(2))
        });
        return;
    }
    catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Error calculating depreciation",
            error: err.message
        });
        return;
    }
});
exports.calculateDepreciation = calculateDepreciation;
function monthsDiff(a, b) {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
const runDepreciationForAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const assetId = Number(req.params.assetId);
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetId },
            include: { depreciation: true },
        });
        if (!asset || !asset.depreciation) {
            res.status(404).json({ message: "Depreciation not found" });
            return;
        }
        const dep = asset.depreciation;
        if (!dep.isActive) {
            res.status(400).json({ message: "Depreciation is inactive" });
            return;
        }
        const cost = Number((_b = (_a = asset.purchaseCost) !== null && _a !== void 0 ? _a : asset.estimatedValue) !== null && _b !== void 0 ? _b : 0);
        const salvage = Number((_c = dep.salvageValue) !== null && _c !== void 0 ? _c : 0);
        const lifeYears = dep.expectedLifeYears;
        const rate = Number((_d = dep.depreciationRate) !== null && _d !== void 0 ? _d : 0);
        const method = dep.depreciationMethod;
        const start = new Date(dep.depreciationStart);
        const today = new Date();
        // decide next periodStart
        const last = dep.lastCalculatedAt ? new Date(dep.lastCalculatedAt) : start;
        let periodStart = last;
        let periodEnd;
        if ((dep.depreciationFrequency || "YEARLY") === "MONTHLY") {
            periodEnd = new Date(periodStart);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
        }
        else {
            periodEnd = new Date(periodStart);
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        }
        // don’t run into future
        if (periodEnd > today) {
            res.status(400).json({ message: "Next depreciation period not reached yet" });
            return;
        }
        // current values
        const prevBook = Number((_e = dep.currentBookValue) !== null && _e !== void 0 ? _e : cost);
        const prevAccum = Number((_f = dep.accumulatedDepreciation) !== null && _f !== void 0 ? _f : 0);
        let depreciationAmount = 0;
        if (method === "SL") {
            const annual = (cost - salvage) / lifeYears;
            depreciationAmount = (dep.depreciationFrequency === "MONTHLY") ? annual / 12 : annual;
        }
        else if (method === "DB") {
            // simple declining balance per period
            const periodRate = (dep.depreciationFrequency === "MONTHLY") ? (rate / 100) / 12 : (rate / 100);
            depreciationAmount = prevBook * periodRate;
        }
        else {
            res.status(400).json({ message: "Unsupported depreciation method" });
            return;
        }
        // don’t depreciate below salvage
        const maxAllowed = Math.max(0, prevBook - salvage);
        depreciationAmount = Math.min(depreciationAmount, maxAllowed);
        const newBook = Number((prevBook - depreciationAmount).toFixed(2));
        const newAccum = Number((prevAccum + depreciationAmount).toFixed(2));
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const log = yield tx.depreciationLog.create({
                data: {
                    assetId,
                    periodStart,
                    periodEnd,
                    depreciationAmount: String(depreciationAmount.toFixed(2)),
                    bookValueAfter: String(newBook.toFixed(2)),
                    doneById: employeeId,
                    reason: "SYSTEM_RUN",
                }
            });
            const updated = yield tx.assetDepreciation.update({
                where: { id: dep.id },
                data: {
                    accumulatedDepreciation: String(newAccum.toFixed(2)),
                    currentBookValue: String(newBook.toFixed(2)),
                    lastCalculatedAt: periodEnd,
                    updatedById: employeeId,
                }
            });
            return { log, updated };
        }));
        res.json(Object.assign({ message: "Depreciation applied" }, result));
        return;
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to run depreciation" });
        return;
    }
});
exports.runDepreciationForAsset = runDepreciationForAsset;

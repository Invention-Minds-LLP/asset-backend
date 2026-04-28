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
exports.revertMigration = exports.listMigratedAssets = exports.migrateProportional = exports.migrateBulk = exports.migrateSingleAsset = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const depreciationEngine_1 = require("../../utilis/depreciationEngine");
const VALID_MODES = ["GRANULAR", "PROPORTIONAL", "CARRY_AS_NEW"];
// ── POST /legacy-migration/single — migrate one asset ────────────────────────
const migrateSingleAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { assetId, migrationMode, migrationDate, originalPurchaseDate, originalCost, accDepAtMigration, openingWdvAtMigration, auditedBookValueAtMigration, auditReferenceId, migrationNotes, } = req.body;
        if (!assetId || !migrationMode || !migrationDate) {
            res.status(400).json({ message: "assetId, migrationMode and migrationDate are required" });
            return;
        }
        if (!VALID_MODES.includes(migrationMode)) {
            res.status(400).json({ message: `migrationMode must be one of ${VALID_MODES.join(", ")}` });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: Number(assetId) },
            include: { depreciation: true },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        const migDate = new Date(migrationDate);
        const cost = Number((_a = originalCost !== null && originalCost !== void 0 ? originalCost : asset.purchaseCost) !== null && _a !== void 0 ? _a : 0);
        const accDep = Number(accDepAtMigration !== null && accDepAtMigration !== void 0 ? accDepAtMigration : 0);
        const openingWdv = Number(openingWdvAtMigration !== null && openingWdvAtMigration !== void 0 ? openingWdvAtMigration : Math.max(0, cost - accDep));
        // Validate mode-specific requirements
        if (migrationMode === "GRANULAR") {
            if (originalCost == null || accDepAtMigration == null) {
                res.status(400).json({ message: "GRANULAR mode requires originalCost and accDepAtMigration" });
                return;
            }
        }
        if (migrationMode === "CARRY_AS_NEW") {
            // Treat the audited NB as the new cost; reset accDep to 0
            // The engine will start from migrationDate with cost = audited NB
        }
        const updated = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const u = yield tx.asset.update({
                where: { id: asset.id },
                data: {
                    isLegacyAsset: true,
                    migrationMode,
                    migrationDate: migDate,
                    originalPurchaseDate: originalPurchaseDate ? new Date(originalPurchaseDate) : null,
                    originalCost: originalCost != null ? cost.toFixed(2) : null,
                    accDepAtMigration: accDep.toFixed(2),
                    openingWdvAtMigration: openingWdv.toFixed(2),
                    auditedBookValueAtMigration: auditedBookValueAtMigration != null
                        ? Number(auditedBookValueAtMigration).toFixed(2) : null,
                    auditReferenceId: auditReferenceId || null,
                    migrationApprovedById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
                    migrationApprovedAt: new Date(),
                    migrationNotes: migrationNotes || null,
                },
            });
            // Sync AssetDepreciation so engine picks up the migrated values
            if (asset.depreciation) {
                const startDate = migrationMode === "CARRY_AS_NEW" ? migDate : asset.depreciation.depreciationStart;
                yield tx.assetDepreciation.update({
                    where: { id: asset.depreciation.id },
                    data: {
                        currentBookValue: openingWdv.toFixed(2),
                        accumulatedDepreciation: accDep.toFixed(2),
                        depreciationStart: startDate,
                        // Set lastCalculatedAt to FY-end before migration, so engine resumes from migration FY
                        lastCalculatedAt: (0, depreciationEngine_1.getFYContext)(migDate).fyStart,
                    },
                });
            }
            return u;
        }));
        res.json({ message: "Asset migrated successfully", asset: updated });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to migrate asset", error: err.message });
    }
});
exports.migrateSingleAsset = migrateSingleAsset;
// ── POST /legacy-migration/bulk — migrate multiple assets in one shot ─────────
// Body: { migrationMode, migrationDate, items: [{ assetId, originalCost, accDepAtMigration, ... }] }
const migrateBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const { migrationMode, migrationDate, items, auditReferenceId } = req.body;
        if (!migrationMode || !migrationDate || !Array.isArray(items) || !items.length) {
            res.status(400).json({ message: "migrationMode, migrationDate, items[] are required" });
            return;
        }
        if (!VALID_MODES.includes(migrationMode)) {
            res.status(400).json({ message: `migrationMode must be one of ${VALID_MODES.join(", ")}` });
            return;
        }
        const migDate = new Date(migrationDate);
        const fyStart = (0, depreciationEngine_1.getFYContext)(migDate).fyStart;
        const employeeId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null;
        const results = [];
        const errors = [];
        for (const it of items) {
            try {
                const asset = yield prismaClient_1.default.asset.findUnique({
                    where: { id: Number(it.assetId) },
                    include: { depreciation: true },
                });
                if (!asset) {
                    errors.push({ assetId: it.assetId, error: "Not found" });
                    continue;
                }
                const cost = Number((_d = (_c = it.originalCost) !== null && _c !== void 0 ? _c : asset.purchaseCost) !== null && _d !== void 0 ? _d : 0);
                const accDep = Number((_e = it.accDepAtMigration) !== null && _e !== void 0 ? _e : 0);
                const openingWdv = Number((_f = it.openingWdvAtMigration) !== null && _f !== void 0 ? _f : Math.max(0, cost - accDep));
                yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    yield tx.asset.update({
                        where: { id: asset.id },
                        data: {
                            isLegacyAsset: true,
                            migrationMode,
                            migrationDate: migDate,
                            originalPurchaseDate: it.originalPurchaseDate ? new Date(it.originalPurchaseDate) : null,
                            originalCost: cost.toFixed(2),
                            accDepAtMigration: accDep.toFixed(2),
                            openingWdvAtMigration: openingWdv.toFixed(2),
                            auditedBookValueAtMigration: it.auditedBookValueAtMigration != null
                                ? Number(it.auditedBookValueAtMigration).toFixed(2) : null,
                            auditReferenceId: auditReferenceId || it.auditReferenceId || null,
                            migrationApprovedById: employeeId,
                            migrationApprovedAt: new Date(),
                            migrationNotes: it.notes || null,
                        },
                    });
                    if (asset.depreciation) {
                        const startDate = migrationMode === "CARRY_AS_NEW" ? migDate : asset.depreciation.depreciationStart;
                        yield tx.assetDepreciation.update({
                            where: { id: asset.depreciation.id },
                            data: {
                                currentBookValue: openingWdv.toFixed(2),
                                accumulatedDepreciation: accDep.toFixed(2),
                                depreciationStart: startDate,
                                lastCalculatedAt: fyStart,
                            },
                        });
                    }
                }));
                results.push({ assetId: asset.assetId, openingWdv, accDep });
            }
            catch (e) {
                errors.push({ assetId: it.assetId, error: e.message });
            }
        }
        res.json({ migratedCount: results.length, errorCount: errors.length, results, errors });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Bulk migration failed", error: err.message });
    }
});
exports.migrateBulk = migrateBulk;
// ── POST /legacy-migration/proportional — pool-level pro-rate ────────────────
// Body: { categoryId | poolId, migrationDate, totalGross, totalAccDep, auditReferenceId }
const migrateProportional = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { categoryId, poolId, migrationDate, totalGross, totalAccDep, auditReferenceId } = req.body;
        if (!migrationDate || (totalGross == null) || (totalAccDep == null)) {
            res.status(400).json({ message: "migrationDate, totalGross, totalAccDep are required" });
            return;
        }
        if (!categoryId && !poolId) {
            res.status(400).json({ message: "categoryId or poolId required" });
            return;
        }
        const where = {};
        if (categoryId)
            where.assetCategoryId = Number(categoryId);
        if (poolId)
            where.assetPoolId = Number(poolId);
        const assets = yield prismaClient_1.default.asset.findMany({ where, include: { depreciation: true } });
        if (!assets.length) {
            res.status(404).json({ message: "No assets matched" });
            return;
        }
        const sumOfCosts = assets.reduce((s, a) => { var _a; return s + Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0); }, 0);
        if (sumOfCosts <= 0) {
            res.status(400).json({ message: "Selected assets have zero total cost — cannot pro-rate" });
            return;
        }
        const migDate = new Date(migrationDate);
        const fyStart = (0, depreciationEngine_1.getFYContext)(migDate).fyStart;
        const employeeId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null;
        const results = [];
        yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            for (const a of assets) {
                const ratio = Number((_a = a.purchaseCost) !== null && _a !== void 0 ? _a : 0) / sumOfCosts;
                const assetGross = Number(totalGross) * ratio;
                const assetAccDep = Number(totalAccDep) * ratio;
                const openingWdv = Math.max(0, assetGross - assetAccDep);
                yield tx.asset.update({
                    where: { id: a.id },
                    data: {
                        isLegacyAsset: true,
                        migrationMode: "PROPORTIONAL",
                        migrationDate: migDate,
                        originalCost: assetGross.toFixed(2),
                        accDepAtMigration: assetAccDep.toFixed(2),
                        openingWdvAtMigration: openingWdv.toFixed(2),
                        auditReferenceId: auditReferenceId || null,
                        migrationApprovedById: employeeId,
                        migrationApprovedAt: new Date(),
                    },
                });
                if (a.depreciation) {
                    yield tx.assetDepreciation.update({
                        where: { id: a.depreciation.id },
                        data: {
                            currentBookValue: openingWdv.toFixed(2),
                            accumulatedDepreciation: assetAccDep.toFixed(2),
                            lastCalculatedAt: fyStart,
                        },
                    });
                }
                results.push({
                    assetId: a.assetId, ratio: Math.round(ratio * 10000) / 100,
                    assetGross, assetAccDep, openingWdv,
                });
            }
        }));
        res.json({
            message: `Pro-rated migration applied to ${assets.length} assets`,
            mode: "PROPORTIONAL", migrationDate: migDate, results,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Proportional migration failed", error: err.message });
    }
});
exports.migrateProportional = migrateProportional;
// ── GET /legacy-migration/list — list all migrated assets ────────────────────
const listMigratedAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { mode, fromDate, toDate } = req.query;
        const where = { isLegacyAsset: true };
        if (mode)
            where.migrationMode = String(mode);
        if (fromDate || toDate) {
            where.migrationDate = {};
            if (fromDate)
                where.migrationDate.gte = new Date(String(fromDate));
            if (toDate)
                where.migrationDate.lte = new Date(String(toDate));
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where,
            orderBy: { migrationDate: "desc" },
            select: {
                id: true, assetId: true, assetName: true,
                purchaseCost: true,
                isLegacyAsset: true,
                migrationMode: true,
                migrationDate: true,
                originalCost: true,
                accDepAtMigration: true,
                openingWdvAtMigration: true,
                auditedBookValueAtMigration: true,
                auditReferenceId: true,
                migrationApprovedAt: true,
                assetCategory: { select: { name: true } },
                department: { select: { name: true } },
            },
        });
        // Add variance vs audited book value
        const enriched = assets.map((a) => {
            var _a;
            const variance = a.auditedBookValueAtMigration != null
                ? Number((_a = a.openingWdvAtMigration) !== null && _a !== void 0 ? _a : 0) - Number(a.auditedBookValueAtMigration)
                : null;
            return Object.assign(Object.assign({}, a), { varianceVsAudited: variance, varianceFlagged: variance != null && Math.abs(variance) > 1 });
        });
        res.json({ count: enriched.length, data: enriched });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to list migrated assets", error: err.message });
    }
});
exports.listMigratedAssets = listMigratedAssets;
// ── DELETE /legacy-migration/:assetId — revert (clear migration flags) ───────
const revertMigration = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.assetId);
        const asset = yield prismaClient_1.default.asset.findUnique({ where: { id } });
        if (!asset) {
            res.status(404).json({ message: "Not found" });
            return;
        }
        const updated = yield prismaClient_1.default.asset.update({
            where: { id },
            data: {
                isLegacyAsset: false,
                migrationMode: null,
                migrationDate: null,
                originalPurchaseDate: null,
                originalCost: null,
                accDepAtMigration: null,
                openingWdvAtMigration: null,
                auditedBookValueAtMigration: null,
                auditReferenceId: null,
                migrationApprovedById: null,
                migrationApprovedAt: null,
                migrationNotes: null,
            },
        });
        res.json({ message: "Migration reverted", asset: updated });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to revert migration", error: err.message });
    }
});
exports.revertMigration = revertMigration;

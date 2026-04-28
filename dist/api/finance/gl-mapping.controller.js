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
exports.getGLMappings = getGLMappings;
exports.getGLMappingByCategory = getGLMappingByCategory;
exports.upsertGLMapping = upsertGLMapping;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const include = {
    assetCategory: true,
    fixedAssetAccount: true,
    accDepAccount: true,
    depExpenseAccount: true,
    disposalAccount: true,
    maintenanceAccount: true,
    insuranceAccount: true,
};
// GET /api/finance/gl-mappings
function getGLMappings(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const mappings = yield prisma.assetGLMapping.findMany({ include });
            res.json(mappings);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load GL mappings" });
        }
    });
}
// GET /api/finance/gl-mappings/:categoryId
function getGLMappingByCategory(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const categoryId = Number(req.params.categoryId);
        try {
            const mapping = yield prisma.assetGLMapping.findUnique({ where: { assetCategoryId: categoryId }, include });
            res.json(mapping || {});
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load GL mapping" });
        }
    });
}
// PUT /api/finance/gl-mappings/:categoryId  (upsert)
function upsertGLMapping(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const categoryId = Number(req.params.categoryId);
        const { fixedAssetAccountId, accDepAccountId, depExpenseAccountId, disposalAccountId, maintenanceAccountId, insuranceAccountId } = req.body;
        try {
            const data = {
                fixedAssetAccountId: fixedAssetAccountId || null,
                accDepAccountId: accDepAccountId || null,
                depExpenseAccountId: depExpenseAccountId || null,
                disposalAccountId: disposalAccountId || null,
                maintenanceAccountId: maintenanceAccountId || null,
                insuranceAccountId: insuranceAccountId || null,
            };
            const mapping = yield prisma.assetGLMapping.upsert({
                where: { assetCategoryId: categoryId },
                create: Object.assign({ assetCategoryId: categoryId }, data),
                update: data,
                include,
            });
            res.json(mapping);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to save GL mapping" });
        }
    });
}

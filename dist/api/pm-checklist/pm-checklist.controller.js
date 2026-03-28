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
exports.getRunById = exports.getRunsByAsset = exports.submitChecklistRun = exports.createChecklistRun = exports.getTemplates = exports.addChecklistItems = exports.createTemplate = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
function mustUser(req) {
    var _a;
    if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId))
        throw new Error("Unauthorized");
    return req.user;
}
/** =========================
 * 1. Create Checklist Template
 * ========================= */
const createTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        mustUser(req);
        const { name, description, assetCategoryId, assetId } = req.body;
        if (!name) {
            res.status(400).json({ message: "name required" });
            return;
        }
        const template = yield prismaClient_1.default.preventiveChecklistTemplate.create({
            data: {
                name,
                description,
                assetCategoryId: assetCategoryId !== null && assetCategoryId !== void 0 ? assetCategoryId : null,
                assetId: assetId !== null && assetId !== void 0 ? assetId : null,
            },
        });
        res.status(201).json(template);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createTemplate = createTemplate;
/** =========================
 * 2. Add Items to Template
 * ========================= */
const addChecklistItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        mustUser(req);
        const templateId = Number(req.params.templateId);
        const { items } = req.body;
        /**
         * items = [
         *   { title: "Check battery", description: "...", sortOrder: 1 },
         * ]
         */
        if (!items || !Array.isArray(items)) {
            res.status(400).json({ message: "items array required" });
            return;
        }
        const created = yield prismaClient_1.default.$transaction(items.map((item, index) => {
            var _a, _b;
            return prismaClient_1.default.preventiveChecklistItem.create({
                data: {
                    templateId,
                    title: item.title,
                    description: item.description,
                    sortOrder: (_a = item.sortOrder) !== null && _a !== void 0 ? _a : index,
                    isRequired: (_b = item.isRequired) !== null && _b !== void 0 ? _b : true,
                },
            });
        }));
        res.json(created);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.addChecklistItems = addChecklistItems;
/** =========================
 * 3. Get Templates
 * ========================= */
const getTemplates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = yield prismaClient_1.default.preventiveChecklistTemplate.findMany({
        include: {
            items: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
    res.json(data);
});
exports.getTemplates = getTemplates;
/** =========================
 * 4. Create Checklist Run (Assign to Asset)
 * ========================= */
const createChecklistRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { assetId, templateId, scheduledDue } = req.body;
        if (!assetId || !templateId || !scheduledDue) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const run = yield prismaClient_1.default.preventiveChecklistRun.create({
            data: {
                assetId,
                templateId,
                scheduledDue: new Date(scheduledDue),
                status: "DUE",
                createdAt: new Date(),
            },
        });
        res.status(201).json(run);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createChecklistRun = createChecklistRun;
/** =========================
 * 5. Submit Checklist Results
 * ========================= */
const submitChecklistRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const runId = Number(req.params.runId);
        const { results } = req.body;
        /**
         * results = [
         *   { itemId: 1, result: "PASS", remarks: "...", photoProof: "url" }
         * ]
         */
        if (!results || !Array.isArray(results)) {
            res.status(400).json({ message: "results array required" });
            return;
        }
        const run = yield prismaClient_1.default.preventiveChecklistRun.findUnique({
            where: { id: runId },
        });
        if (!run) {
            res.status(404).json({ message: "Run not found" });
            return;
        }
        const updated = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            // 1️⃣ Save results
            for (const r of results) {
                yield tx.preventiveChecklistResultRow.create({
                    data: {
                        runId,
                        itemId: r.itemId,
                        result: r.result,
                        remarks: (_a = r.remarks) !== null && _a !== void 0 ? _a : null,
                        photoProof: (_b = r.photoProof) !== null && _b !== void 0 ? _b : null,
                    },
                });
            }
            // 2️⃣ Update run status
            const updatedRun = yield tx.preventiveChecklistRun.update({
                where: { id: runId },
                data: {
                    status: "COMPLETED",
                    performedAt: new Date(),
                    performedById: user.employeeDbId,
                },
            });
            return updatedRun;
        }));
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.submitChecklistRun = submitChecklistRun;
/** =========================
 * 6. Get Runs by Asset
 * ========================= */
const getRunsByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const assetId = Number(req.params.assetId);
    const runs = yield prismaClient_1.default.preventiveChecklistRun.findMany({
        where: { assetId },
        include: {
            template: true,
            results: {
                include: {
                    item: true,
                },
            },
        },
        orderBy: { scheduledDue: "desc" },
    });
    res.json(runs);
});
exports.getRunsByAsset = getRunsByAsset;
/** =========================
 * 7. Get Single Run
 * ========================= */
const getRunById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    const run = yield prismaClient_1.default.preventiveChecklistRun.findUnique({
        where: { id },
        include: {
            template: {
                include: { items: true },
            },
            results: true,
        },
    });
    if (!run) {
        res.status(404).json({ message: "Run not found" });
        return;
    }
    res.json(run);
});
exports.getRunById = getRunById;

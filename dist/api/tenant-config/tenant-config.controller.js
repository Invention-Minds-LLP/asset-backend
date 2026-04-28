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
exports.seedDefaults = exports.upsertConfig = exports.getByKey = exports.getAllConfigs = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const DEFAULT_CONFIGS = [
    { key: "ENABLE_PO_MODULE", value: "true", group: "PROCUREMENT" },
    { key: "ENABLE_GRA_MODULE", value: "true", group: "PROCUREMENT" },
    { key: "ENABLE_EXTERNAL_PROCUREMENT", value: "false", group: "PROCUREMENT" },
    { key: "MANDATORY_INDENT_BEFORE_PO", value: "false", group: "PROCUREMENT" },
    { key: "AUTO_CREATE_ASSET_ON_GRA", value: "true", group: "PROCUREMENT" },
    { key: "MANUAL_ASSET_WITHOUT_PROCUREMENT", value: "true", group: "PROCUREMENT" },
    { key: "SERIAL_NUMBER_MANDATORY_ON_RECEIPT", value: "false", group: "PROCUREMENT" },
    { key: "RECEIPT_CHECKLIST_MANDATORY", value: "false", group: "PROCUREMENT" },
    { key: "ENABLE_WORKORDER_MODULE", value: "true", group: "WORKORDER" },
    { key: "ENABLE_STORE_MODULE", value: "true", group: "STORE" },
    { key: "RCA_MANDATORY_FOR_MAJOR", value: "true", group: "RCA" },
    { key: "RCA_MANDATORY_COST_THRESHOLD", value: "50000", group: "RCA" },
    { key: "PO_APPROVAL_HOD_MAX", value: "100000", label: "PO up to this amount needs HOD only", group: "PROCUREMENT" },
    { key: "PO_APPROVAL_MGMT_MAX", value: "500000", label: "PO up to this amount needs HOD + Management", group: "PROCUREMENT" },
    { key: "PO_APPROVAL_COO_MAX", value: "2000000", label: "PO up to this amount needs HOD + Mgmt + COO. Above this needs CFO", group: "PROCUREMENT" },
];
const getAllConfigs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { group } = req.query;
        const where = {};
        if (group) {
            where.group = String(group);
        }
        const configs = yield prismaClient_1.default.tenantConfig.findMany({
            where,
            orderBy: { key: "asc" },
        });
        res.json(configs);
    }
    catch (error) {
        console.error("getAllConfigs error:", error);
        res.status(500).json({ message: "Failed to fetch tenant configs" });
    }
});
exports.getAllConfigs = getAllConfigs;
const getByKey = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { key } = req.params;
        const config = yield prismaClient_1.default.tenantConfig.findUnique({
            where: { key },
        });
        if (!config) {
            res.status(404).json({ message: `Config key '${key}' not found` });
            return;
        }
        res.json(config);
    }
    catch (error) {
        console.error("getByKey error:", error);
        res.status(500).json({ message: "Failed to fetch config" });
    }
});
exports.getByKey = getByKey;
const upsertConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { key } = req.params;
        const { value, label, group } = req.body;
        if (value === undefined || value === null) {
            res.status(400).json({ message: "Field 'value' is required" });
            return;
        }
        const config = yield prismaClient_1.default.tenantConfig.upsert({
            where: { key },
            update: { value, label, group },
            create: { key, value, label, group },
        });
        res.json(config);
    }
    catch (error) {
        console.error("upsertConfig error:", error);
        res.status(500).json({ message: "Failed to upsert config" });
    }
});
exports.upsertConfig = upsertConfig;
const seedDefaults = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const results = [];
        for (const cfg of DEFAULT_CONFIGS) {
            const existing = yield prismaClient_1.default.tenantConfig.findUnique({
                where: { key: cfg.key },
            });
            if (existing) {
                results.push({ key: cfg.key, action: "skipped" });
            }
            else {
                yield prismaClient_1.default.tenantConfig.create({
                    data: {
                        key: cfg.key,
                        value: cfg.value,
                        label: cfg.label,
                        group: cfg.group,
                    },
                });
                results.push({ key: cfg.key, action: "created" });
            }
        }
        const created = results.filter((r) => r.action === "created").length;
        const skipped = results.filter((r) => r.action === "skipped").length;
        res.json({
            message: `Seed complete: ${created} created, ${skipped} skipped`,
            details: results,
        });
    }
    catch (error) {
        console.error("seedDefaults error:", error);
        res.status(500).json({ message: "Failed to seed default configs" });
    }
});
exports.seedDefaults = seedDefaults;

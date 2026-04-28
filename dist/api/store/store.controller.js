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
exports.getStoreHierarchy = exports.createStoreLocation = exports.getStoreLocations = exports.deleteStore = exports.updateStore = exports.createStore = exports.getStoreById = exports.getAllStores = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllStores = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { storeType } = req.query;
        const where = { isActive: true };
        if (storeType) {
            where.storeType = String(storeType);
        }
        const stores = yield prismaClient_1.default.store.findMany({
            where,
            orderBy: { name: "asc" },
            include: {
                parentStore: { select: { id: true, name: true, code: true } },
                _count: {
                    select: {
                        childStores: true,
                        locations: true,
                    },
                },
            },
        });
        res.json(stores);
    }
    catch (error) {
        console.error("getAllStores error:", error);
        res.status(500).json({ message: "Failed to fetch stores" });
    }
});
exports.getAllStores = getAllStores;
const getStoreById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id, 10);
        const store = yield prismaClient_1.default.store.findUnique({
            where: { id },
            include: {
                locations: true,
                childStores: true,
                stockPositions: true,
            },
        });
        if (!store) {
            res.status(404).json({ message: "Store not found" });
            return;
        }
        res.json(store);
    }
    catch (error) {
        console.error("getStoreById error:", error);
        res.status(500).json({ message: "Failed to fetch store" });
    }
});
exports.getStoreById = getStoreById;
const createStore = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const body = req.body;
        // Sub-store must have a parent
        if (body.storeType === "SUB_STORE" && !body.parentStoreId) {
            res.status(400).json({ message: "Sub-store must have a parentStoreId" });
            return;
        }
        // Validate parent exists if parentStoreId is provided
        if (body.parentStoreId) {
            const parent = yield prismaClient_1.default.store.findUnique({
                where: { id: body.parentStoreId },
            });
            if (!parent) {
                res.status(400).json({ message: "Parent store not found" });
                return;
            }
        }
        const store = yield prismaClient_1.default.store.create({
            data: {
                name: body.name,
                code: body.code,
                storeType: body.storeType || "MAIN_STORE",
                parentStoreId: body.parentStoreId,
                branchId: body.branchId,
                departmentId: body.departmentId,
                managerId: body.managerId,
                address: body.address,
                createdById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId,
            },
        });
        res.status(201).json(store);
    }
    catch (error) {
        console.error("createStore error:", error);
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002") {
            res.status(409).json({ message: "Store with this name or code already exists" });
            return;
        }
        res.status(500).json({ message: "Failed to create store" });
    }
});
exports.createStore = createStore;
const updateStore = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id, 10);
        const store = yield prismaClient_1.default.store.update({
            where: { id },
            data: Object.assign(Object.assign({}, req.body), { updatedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId }),
        });
        res.json(store);
    }
    catch (error) {
        console.error("updateStore error:", error);
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2025") {
            res.status(404).json({ message: "Store not found" });
            return;
        }
        res.status(500).json({ message: "Failed to update store" });
    }
});
exports.updateStore = updateStore;
const deleteStore = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id, 10);
        yield prismaClient_1.default.store.update({
            where: { id },
            data: { isActive: false, updatedById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId },
        });
        res.json({ message: "Store deactivated" });
    }
    catch (error) {
        console.error("deleteStore error:", error);
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2025") {
            res.status(404).json({ message: "Store not found" });
            return;
        }
        res.status(500).json({ message: "Failed to delete store" });
    }
});
exports.deleteStore = deleteStore;
const getStoreLocations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const storeId = parseInt(req.params.id, 10);
        const locations = yield prismaClient_1.default.storeLocation.findMany({
            where: { storeId, isActive: true },
            orderBy: { rack: "asc" },
        });
        res.json(locations);
    }
    catch (error) {
        console.error("getStoreLocations error:", error);
        res.status(500).json({ message: "Failed to fetch store locations" });
    }
});
exports.getStoreLocations = getStoreLocations;
const createStoreLocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const storeId = parseInt(req.params.id, 10);
        const { rack, shelf, bin, label } = req.body;
        // Verify store exists
        const store = yield prismaClient_1.default.store.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ message: "Store not found" });
            return;
        }
        const location = yield prismaClient_1.default.storeLocation.create({
            data: { storeId, rack, shelf, bin, label },
        });
        res.status(201).json(location);
    }
    catch (error) {
        console.error("createStoreLocation error:", error);
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002") {
            res.status(409).json({ message: "This rack/shelf/bin combination already exists in the store" });
            return;
        }
        res.status(500).json({ message: "Failed to create store location" });
    }
});
exports.createStoreLocation = createStoreLocation;
const getStoreHierarchy = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const stores = yield prismaClient_1.default.store.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                code: true,
                storeType: true,
                parentStoreId: true,
                isActive: true,
            },
        });
        // Build tree from flat list
        const storeMap = new Map();
        const roots = [];
        for (const s of stores) {
            storeMap.set(s.id, {
                id: s.id,
                name: s.name,
                code: s.code,
                storeType: s.storeType,
                isActive: s.isActive,
                children: [],
            });
        }
        for (const s of stores) {
            const node = storeMap.get(s.id);
            if (s.parentStoreId && storeMap.has(s.parentStoreId)) {
                storeMap.get(s.parentStoreId).children.push(node);
            }
            else {
                roots.push(node);
            }
        }
        res.json(roots);
    }
    catch (error) {
        console.error("getStoreHierarchy error:", error);
        res.status(500).json({ message: "Failed to fetch store hierarchy" });
    }
});
exports.getStoreHierarchy = getStoreHierarchy;

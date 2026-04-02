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
exports.getBranches = exports.createBranch = exports.getLocationHistory = exports.getCurrentLocation = exports.updateCurrentLocation = exports.addAssetLocation = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const addAssetLocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, branchId, block, floor, room, employeeResponsibleId, departmentSnapshot, rfid } = req.body;
        if (!assetId) {
            res.status(400).json({ message: "assetId is required" });
            return;
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // 1️⃣ Close previous active locations
            yield tx.assetLocation.updateMany({
                where: { assetId, isActive: true },
                data: { isActive: false }
            });
            // 2️⃣ Create new location
            const newLocation = yield tx.assetLocation.create({
                data: {
                    assetId,
                    branchId,
                    block,
                    floor,
                    room,
                    employeeResponsibleId,
                    departmentSnapshot,
                    isActive: true
                }
            });
            // 3️⃣ Update asset RFID (and optionally branch)
            yield tx.asset.update({
                where: { id: assetId },
                data: {
                    rfidCode: rfid,
                }
            });
            return newLocation;
        }));
        res.status(201).json(result);
    }
    catch (err) {
        console.error("Error adding location:", err);
        res.status(500).json({ message: "Failed to add location" });
    }
});
exports.addAssetLocation = addAssetLocation;
const updateCurrentLocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const locationId = Number(req.params.locationId);
        const { assetId, branchId, block, floor, room, employeeResponsibleId, departmentSnapshot, rfid } = req.body;
        // Option A: if frontend sends assetId
        if (!assetId) {
            res.status(400).json({ message: "assetId is required" });
            return;
        }
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // 1) deactivate current active location(s)
            yield tx.assetLocation.updateMany({
                where: { assetId, isActive: true },
                data: { isActive: false }
            });
            // 2) create a NEW active row (history)
            const newLocation = yield tx.assetLocation.create({
                data: {
                    assetId,
                    branchId,
                    block,
                    floor,
                    room,
                    employeeResponsibleId,
                    departmentSnapshot,
                    isActive: true
                },
                include: { branch: true, employeeResponsible: true }
            });
            // 3) update asset RFID if passed
            if (rfid !== undefined) {
                yield tx.asset.update({
                    where: { id: assetId },
                    data: { rfidCode: rfid }
                });
            }
            return newLocation;
        }));
        res.json(result);
    }
    catch (err) {
        console.error("Update location error:", err);
        res.status(500).json({ message: "Failed to update location" });
    }
});
exports.updateCurrentLocation = updateCurrentLocation;
const getCurrentLocation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const location = yield prismaClient_1.default.assetLocation.findFirst({
            where: { assetId, isActive: true },
            include: { branch: true, employeeResponsible: true },
            orderBy: { createdAt: "desc" }
        });
        if (!location) {
            res.status(404).json({ message: "No active location found" });
            return;
        }
        res.json(location);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch current location" });
    }
});
exports.getCurrentLocation = getCurrentLocation;
const getLocationHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = Number(req.params.assetId);
        const history = yield prismaClient_1.default.assetLocation.findMany({
            where: { assetId },
            include: { branch: true, employeeResponsible: true },
            orderBy: { createdAt: "desc" }
        });
        res.json(history);
    }
    catch (err) {
        console.error("Location history error:", err);
        res.status(500).json({ message: "Failed to fetch history" });
    }
});
exports.getLocationHistory = getLocationHistory;
const createBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branch = yield prismaClient_1.default.branch.create({
            data: { name: req.body.name }
        });
        res.status(201).json(branch);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create branch" });
    }
});
exports.createBranch = createBranch;
const getBranches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branches = yield prismaClient_1.default.branch.findMany();
        res.json(branches);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch branches" });
    }
});
exports.getBranches = getBranches;

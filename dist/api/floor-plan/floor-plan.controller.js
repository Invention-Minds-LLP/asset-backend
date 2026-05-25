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
exports.deleteFloorPlan = exports.removePin = exports.savePin = exports.getPinnableAssets = exports.getFloorPlanWithPins = exports.listFloorPlans = exports.uploadFloorPlan = exports.floorPlanUpload = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Image upload (stored under /uploads/floor-plans, served by static mw) ───
const DEST = path_1.default.join(process.cwd(), "uploads", "floor-plans");
fs_1.default.mkdirSync(DEST, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, DEST),
    filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, `${Date.now()}-${safe}`);
    },
});
exports.floorPlanUpload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        if (/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype))
            return cb(null, true);
        cb(new Error("Only image files (png, jpg, webp, gif, svg) are allowed"));
    },
});
// ─── POST /api/floor-plan  (multipart: file + name, branchId, block, floor) ──
const uploadFloorPlan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const file = req.file;
        const { name, branchId, block, floor, width, height } = req.body || {};
        if (!file) {
            res.status(400).json({ message: "Image file is required" });
            return;
        }
        if (!branchId) {
            res.status(400).json({ message: "branchId is required" });
            return;
        }
        const plan = yield prismaClient_1.default.floorPlan.create({
            data: {
                name: (name === null || name === void 0 ? void 0 : name.trim()) || file.originalname,
                branchId: Number(branchId),
                block: block || null,
                floor: floor || null,
                imageUrl: `/uploads/floor-plans/${file.filename}`,
                width: width ? Number(width) : null,
                height: height ? Number(height) : null,
                createdById: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId) !== null && _b !== void 0 ? _b : null,
            },
        });
        res.status(201).json(plan);
    }
    catch (err) {
        console.error("uploadFloorPlan error:", err);
        res.status(500).json({ message: "Failed to upload floor plan", error: err === null || err === void 0 ? void 0 : err.message });
    }
});
exports.uploadFloorPlan = uploadFloorPlan;
// ─── GET /api/floor-plan?branchId=&block=&floor= ─────────────────────────────
const listFloorPlans = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { branchId, block, floor } = req.query;
        const where = { isActive: true };
        if (branchId)
            where.branchId = Number(branchId);
        if (block)
            where.block = String(block);
        if (floor)
            where.floor = String(floor);
        const plans = yield prismaClient_1.default.floorPlan.findMany({
            where,
            include: { branch: { select: { id: true, name: true } }, _count: { select: { locations: true } } },
            orderBy: { createdAt: "desc" },
        });
        res.json(plans);
    }
    catch (err) {
        console.error("listFloorPlans error:", err);
        res.status(500).json({ message: "Failed to load floor plans" });
    }
});
exports.listFloorPlans = listFloorPlans;
// ─── GET /api/floor-plan/:id  → plan + the assets pinned on it ───────────────
const getFloorPlanWithPins = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const plan = yield prismaClient_1.default.floorPlan.findUnique({
            where: { id },
            include: { branch: { select: { id: true, name: true } } },
        });
        if (!plan) {
            res.status(404).json({ message: "Floor plan not found" });
            return;
        }
        const pins = yield prismaClient_1.default.assetLocation.findMany({
            where: { floorPlanId: id, isActive: true, planX: { not: null } },
            include: { asset: { select: { id: true, assetId: true, assetName: true, status: true, assetCategory: { select: { name: true, locationProfile: true } } } } },
        });
        res.json({ plan, pins });
    }
    catch (err) {
        console.error("getFloorPlanWithPins error:", err);
        res.status(500).json({ message: "Failed to load floor plan" });
    }
});
exports.getFloorPlanWithPins = getFloorPlanWithPins;
// ─── GET /api/floor-plan/:id/pinnable  → assets at this branch/floor to place ─
// Returns assets whose ACTIVE location is at the plan's branch (+ floor/block if
// set), so the user can drop pins for them. Includes their current pin if any.
const getPinnableAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const plan = yield prismaClient_1.default.floorPlan.findUnique({ where: { id } });
        if (!plan) {
            res.status(404).json({ message: "Floor plan not found" });
            return;
        }
        const where = { isActive: true, branchId: plan.branchId };
        if (plan.floor)
            where.floor = plan.floor;
        if (plan.block)
            where.block = plan.block;
        const locations = yield prismaClient_1.default.assetLocation.findMany({
            where,
            include: { asset: { select: { id: true, assetId: true, assetName: true, status: true, assetCategory: { select: { name: true } } } } },
            orderBy: { id: "desc" },
        });
        const assets = locations
            .filter((l) => l.asset)
            .map((l) => {
            var _a, _b;
            return ({
                locationId: l.id,
                assetId: l.asset.id,
                assetCode: l.asset.assetId,
                assetName: l.asset.assetName,
                status: l.asset.status,
                category: (_b = (_a = l.asset.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                pinnedHere: l.floorPlanId === id && l.planX != null,
                planX: l.floorPlanId === id ? l.planX : null,
                planY: l.floorPlanId === id ? l.planY : null,
            });
        });
        res.json(assets);
    }
    catch (err) {
        console.error("getPinnableAssets error:", err);
        res.status(500).json({ message: "Failed to load assets" });
    }
});
exports.getPinnableAssets = getPinnableAssets;
// ─── POST /api/floor-plan/:id/pin  { assetId, planX, planY } ─────────────────
// Pins an asset onto this plan by updating its ACTIVE AssetLocation row.
const savePin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const floorPlanId = Number(req.params.id);
        const { assetId, planX, planY } = req.body || {};
        if (!assetId || planX == null || planY == null) {
            res.status(400).json({ message: "assetId, planX and planY are required" });
            return;
        }
        const active = yield prismaClient_1.default.assetLocation.findFirst({
            where: { assetId: Number(assetId), isActive: true },
            orderBy: { id: "desc" },
        });
        if (!active) {
            res.status(400).json({ message: "Asset has no active location to pin. Set its location first." });
            return;
        }
        const updated = yield prismaClient_1.default.assetLocation.update({
            where: { id: active.id },
            data: { floorPlanId, planX: Number(planX), planY: Number(planY) },
        });
        res.json(updated);
    }
    catch (err) {
        console.error("savePin error:", err);
        res.status(500).json({ message: "Failed to save pin", error: err === null || err === void 0 ? void 0 : err.message });
    }
});
exports.savePin = savePin;
// ─── DELETE /api/floor-plan/:id/pin/:assetId  → clear an asset's pin ─────────
const removePin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const floorPlanId = Number(req.params.id);
        const assetId = Number(req.params.assetId);
        yield prismaClient_1.default.assetLocation.updateMany({
            where: { assetId, floorPlanId, isActive: true },
            data: { floorPlanId: null, planX: null, planY: null },
        });
        res.json({ success: true });
    }
    catch (err) {
        console.error("removePin error:", err);
        res.status(500).json({ message: "Failed to remove pin" });
    }
});
exports.removePin = removePin;
// ─── DELETE /api/floor-plan/:id  → soft delete + unpin its assets ────────────
const deleteFloorPlan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        yield prismaClient_1.default.$transaction([
            prismaClient_1.default.assetLocation.updateMany({
                where: { floorPlanId: id },
                data: { floorPlanId: null, planX: null, planY: null },
            }),
            prismaClient_1.default.floorPlan.update({ where: { id }, data: { isActive: false } }),
        ]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("deleteFloorPlan error:", err);
        res.status(500).json({ message: "Failed to delete floor plan" });
    }
});
exports.deleteFloorPlan = deleteFloorPlan;

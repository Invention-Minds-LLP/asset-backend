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
exports.deleteCalibrationTemplate = exports.updateCalibrationTemplate = exports.addCalibrationTemplateItems = exports.getAllCalibrationTemplates = exports.createCalibrationTemplate = exports.getCalibrationHistoryByAsset = exports.logCalibrationHistory = exports.getDueCalibrations = exports.deleteCalibrationSchedule = exports.updateCalibrationSchedule = exports.getCalibrationSchedulesByAsset = exports.getAllCalibrationSchedules = exports.createCalibrationSchedule = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Calibration Schedules ─────────────────────────────────────────────────────
const createCalibrationSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, frequencyValue, frequencyUnit, nextDueAt, standardProcedure, vendorId, reminderDays, notes, } = req.body;
        if (!assetId || !frequencyValue || !frequencyUnit || !nextDueAt) {
            res.status(400).json({ message: "assetId, frequencyValue, frequencyUnit, nextDueAt are required" });
            return;
        }
        const schedule = yield prismaClient_1.default.calibrationSchedule.create({
            data: {
                assetId: Number(assetId),
                frequencyValue: Number(frequencyValue),
                frequencyUnit,
                nextDueAt: new Date(nextDueAt),
                standardProcedure,
                vendorId: vendorId ? Number(vendorId) : undefined,
                reminderDays: reminderDays ? Number(reminderDays) : 7,
                notes,
            },
            include: {
                asset: { select: { assetId: true, assetName: true } },
                vendor: { select: { name: true } },
            },
        });
        res.status(201).json(schedule);
    }
    catch (error) {
        console.error("createCalibrationSchedule error:", error);
        res.status(500).json({ message: "Failed to create calibration schedule" });
    }
});
exports.createCalibrationSchedule = createCalibrationSchedule;
const getAllCalibrationSchedules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, isActive } = req.query;
        const where = {};
        if (assetId)
            where.assetId = Number(assetId);
        if (isActive !== undefined)
            where.isActive = isActive === "true";
        const schedules = yield prismaClient_1.default.calibrationSchedule.findMany({
            where,
            include: {
                asset: { select: { assetId: true, assetName: true, assetType: true } },
                vendor: { select: { name: true } },
            },
            orderBy: { nextDueAt: "asc" },
        });
        res.json(schedules);
    }
    catch (error) {
        console.error("getAllCalibrationSchedules error:", error);
        res.status(500).json({ message: "Failed to fetch calibration schedules" });
    }
});
exports.getAllCalibrationSchedules = getAllCalibrationSchedules;
const getCalibrationSchedulesByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        const schedules = yield prismaClient_1.default.calibrationSchedule.findMany({
            where: { assetId },
            include: {
                vendor: { select: { name: true } },
                histories: { orderBy: { calibratedAt: "desc" }, take: 3 },
            },
            orderBy: { nextDueAt: "asc" },
        });
        res.json(schedules);
    }
    catch (error) {
        console.error("getCalibrationSchedulesByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch schedules" });
    }
});
exports.getCalibrationSchedulesByAsset = getCalibrationSchedulesByAsset;
const updateCalibrationSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.calibrationSchedule.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Schedule not found" });
            return;
        }
        const { nextDueAt, frequencyValue, frequencyUnit, isActive, vendorId, reminderDays, notes, standardProcedure } = req.body;
        const updated = yield prismaClient_1.default.calibrationSchedule.update({
            where: { id },
            data: {
                nextDueAt: nextDueAt ? new Date(nextDueAt) : undefined,
                frequencyValue: frequencyValue ? Number(frequencyValue) : undefined,
                frequencyUnit,
                isActive,
                vendorId: vendorId ? Number(vendorId) : undefined,
                reminderDays: reminderDays ? Number(reminderDays) : undefined,
                notes,
                standardProcedure,
            },
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateCalibrationSchedule error:", error);
        res.status(500).json({ message: "Failed to update calibration schedule" });
    }
});
exports.updateCalibrationSchedule = updateCalibrationSchedule;
const deleteCalibrationSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.calibrationSchedule.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Schedule not found" });
            return;
        }
        yield prismaClient_1.default.calibrationSchedule.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteCalibrationSchedule error:", error);
        res.status(500).json({ message: "Failed to delete schedule" });
    }
});
exports.deleteCalibrationSchedule = deleteCalibrationSchedule;
const getDueCalibrations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const daysAhead = parseInt(req.query.days || "7");
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + daysAhead);
        const due = yield prismaClient_1.default.calibrationSchedule.findMany({
            where: { nextDueAt: { lte: cutoff }, isActive: true },
            include: {
                asset: { select: { assetId: true, assetName: true, assetType: true, departmentId: true } },
                vendor: { select: { name: true, contact: true } },
            },
            orderBy: { nextDueAt: "asc" },
        });
        res.json(due);
    }
    catch (error) {
        console.error("getDueCalibrations error:", error);
        res.status(500).json({ message: "Failed to fetch due calibrations" });
    }
});
exports.getDueCalibrations = getDueCalibrations;
// ─── Calibration History ───────────────────────────────────────────────────────
const logCalibrationHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { assetId, scheduleId, calibratedAt, dueAt, calibratedByType, calibratedByName, vendorId, result, certificateNo, certificateUrl, remarks, } = req.body;
        if (!assetId) {
            res.status(400).json({ message: "assetId is required" });
            return;
        }
        const history = yield prismaClient_1.default.calibrationHistory.create({
            data: {
                assetId: Number(assetId),
                scheduleId: scheduleId ? Number(scheduleId) : undefined,
                calibratedAt: calibratedAt ? new Date(calibratedAt) : new Date(),
                dueAt: dueAt ? new Date(dueAt) : undefined,
                calibratedByType,
                calibratedByName,
                vendorId: vendorId ? Number(vendorId) : undefined,
                result: result !== null && result !== void 0 ? result : "NA",
                certificateNo,
                certificateUrl,
                remarks,
                createdById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId,
            },
            include: {
                asset: { select: { assetId: true, assetName: true } },
                vendor: { select: { name: true } },
                createdBy: { select: { name: true } },
            },
        });
        // Advance next due date on linked schedule
        if (scheduleId) {
            const schedule = yield prismaClient_1.default.calibrationSchedule.findUnique({ where: { id: Number(scheduleId) } });
            if (schedule) {
                const base = calibratedAt ? new Date(calibratedAt) : new Date();
                let nextDue = new Date(base);
                if (schedule.frequencyUnit === "DAYS")
                    nextDue.setDate(nextDue.getDate() + schedule.frequencyValue);
                else if (schedule.frequencyUnit === "MONTHS")
                    nextDue.setMonth(nextDue.getMonth() + schedule.frequencyValue);
                else if (schedule.frequencyUnit === "YEARS")
                    nextDue.setFullYear(nextDue.getFullYear() + schedule.frequencyValue);
                yield prismaClient_1.default.calibrationSchedule.update({
                    where: { id: Number(scheduleId) },
                    data: { nextDueAt: nextDue, lastCalibratedAt: base },
                });
            }
        }
        res.status(201).json(history);
    }
    catch (error) {
        console.error("logCalibrationHistory error:", error);
        res.status(500).json({ message: "Failed to log calibration history" });
    }
});
exports.logCalibrationHistory = logCalibrationHistory;
const getCalibrationHistoryByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assetId = parseInt(req.params.assetId);
        const history = yield prismaClient_1.default.calibrationHistory.findMany({
            where: { assetId },
            include: {
                vendor: { select: { name: true } },
                createdBy: { select: { name: true, employeeID: true } },
            },
            orderBy: { calibratedAt: "desc" },
        });
        res.json(history);
    }
    catch (error) {
        console.error("getCalibrationHistoryByAsset error:", error);
        res.status(500).json({ message: "Failed to fetch calibration history" });
    }
});
exports.getCalibrationHistoryByAsset = getCalibrationHistoryByAsset;
// ─── Calibration Checklist Templates ──────────────────────────────────────────
const createCalibrationTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description, assetCategoryId, assetId, isActive } = req.body;
        if (!name) {
            res.status(400).json({ message: "name is required" });
            return;
        }
        const template = yield prismaClient_1.default.calibrationChecklistTemplate.create({
            data: {
                name,
                description,
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                assetId: assetId ? Number(assetId) : undefined,
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            },
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
            },
        });
        res.status(201).json(template);
    }
    catch (error) {
        console.error("createCalibrationTemplate error:", error);
        res.status(500).json({ message: "Failed to create calibration template" });
    }
});
exports.createCalibrationTemplate = createCalibrationTemplate;
const getAllCalibrationTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetCategoryId, assetId } = req.query;
        const where = {};
        if (assetCategoryId)
            where.assetCategoryId = Number(assetCategoryId);
        if (assetId)
            where.assetId = Number(assetId);
        const templates = yield prismaClient_1.default.calibrationChecklistTemplate.findMany({
            where,
            include: {
                assetCategory: { select: { name: true } },
                asset: { select: { assetId: true, assetName: true } },
                items: { orderBy: { sortOrder: "asc" } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(templates);
    }
    catch (error) {
        console.error("getAllCalibrationTemplates error:", error);
        res.status(500).json({ message: "Failed to fetch calibration templates" });
    }
});
exports.getAllCalibrationTemplates = getAllCalibrationTemplates;
const addCalibrationTemplateItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templateId = parseInt(req.params.templateId);
        const { items } = req.body;
        if (!(items === null || items === void 0 ? void 0 : items.length)) {
            res.status(400).json({ message: "items array is required" });
            return;
        }
        const template = yield prismaClient_1.default.calibrationChecklistTemplate.findUnique({ where: { id: templateId } });
        if (!template) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        const created = yield prismaClient_1.default.$transaction(items.map((item, idx) => {
            var _a;
            return prismaClient_1.default.calibrationChecklistItem.create({
                data: {
                    templateId,
                    title: item.title,
                    description: item.description,
                    expectedValue: item.expectedValue,
                    unit: item.unit,
                    sortOrder: (_a = item.sortOrder) !== null && _a !== void 0 ? _a : idx,
                    isRequired: item.isRequired !== undefined ? item.isRequired : true,
                },
            });
        }));
        res.status(201).json(created);
    }
    catch (error) {
        console.error("addCalibrationTemplateItems error:", error);
        res.status(500).json({ message: "Failed to add items" });
    }
});
exports.addCalibrationTemplateItems = addCalibrationTemplateItems;
const updateCalibrationTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.calibrationChecklistTemplate.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        const updated = yield prismaClient_1.default.calibrationChecklistTemplate.update({
            where: { id },
            data: req.body,
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateCalibrationTemplate error:", error);
        res.status(500).json({ message: "Failed to update template" });
    }
});
exports.updateCalibrationTemplate = updateCalibrationTemplate;
const deleteCalibrationTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.calibrationChecklistTemplate.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Template not found" });
            return;
        }
        yield prismaClient_1.default.calibrationChecklistItem.deleteMany({ where: { templateId: id } });
        yield prismaClient_1.default.calibrationChecklistTemplate.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteCalibrationTemplate error:", error);
        res.status(500).json({ message: "Failed to delete template" });
    }
});
exports.deleteCalibrationTemplate = deleteCalibrationTemplate;

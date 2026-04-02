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
exports.triggerPMNotifications = exports.getAllMaintenanceHistory = exports.updateSchedule = exports.rescheduleMaintenance = exports.getCalendarView = exports.getServiceContract = exports.getHistoryByAsset = exports.executeMaintenance = exports.getDueSchedules = exports.getAllSchedules = exports.createSchedule = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const client_1 = require("@prisma/client");
/** =========================
 * Helpers
 * ========================= */
function mustUser(req) {
    var _a;
    if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId))
        throw new Error("Unauthorized");
    return req.user;
}
function createNotification(tx, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const notif = yield tx.notification.create({
            data: {
                title: data.title,
                message: data.message,
                assetId: data.assetId,
                ticketId: data.ticketId,
                type: "OTHER",
                createdById: data.createdById,
            },
        });
        for (const empId of data.recipients) {
            yield tx.notificationRecipient.create({
                data: {
                    notificationId: notif.id,
                    employeeId: empId,
                },
            });
        }
    });
}
function calculateNextDue(schedule) {
    const next = new Date(schedule.nextDueAt);
    if (schedule.frequencyUnit === "DAYS") {
        next.setDate(next.getDate() + schedule.frequencyValue);
    }
    else if (schedule.frequencyUnit === "MONTHS") {
        next.setMonth(next.getMonth() + schedule.frequencyValue);
    }
    else if (schedule.frequencyUnit === "YEARS") {
        next.setFullYear(next.getFullYear() + schedule.frequencyValue);
    }
    return next;
}
/** =========================
 * 1. Create Schedule
 * ========================= */
const createSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { assetId, frequencyValue, frequencyUnit, nextDueAt, reminderDays, reason, } = req.body;
        if (!assetId || !frequencyValue || !frequencyUnit || !nextDueAt) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const schedule = yield prismaClient_1.default.maintenanceSchedule.create({
            data: {
                assetId,
                frequencyValue,
                frequencyUnit,
                nextDueAt: new Date(nextDueAt),
                reminderDays,
                reason,
                createdBy: user.employeeID,
            },
        });
        res.status(201).json(schedule);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createSchedule = createSchedule;
/** =========================
 * 2. Get All Schedules
 * ========================= */
const getAllSchedules = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = yield prismaClient_1.default.maintenanceSchedule.findMany({
        include: { asset: true },
        orderBy: { nextDueAt: "asc" },
    });
    res.json(data);
});
exports.getAllSchedules = getAllSchedules;
/** =========================
 * 3. Get Due Schedules
 * ========================= */
const getDueSchedules = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    const schedules = yield prismaClient_1.default.maintenanceSchedule.findMany({
        where: {
            nextDueAt: { lte: now },
            isActive: true,
        },
        include: { asset: true },
    });
    res.json(schedules);
});
exports.getDueSchedules = getDueSchedules;
/** =========================
 * 4. Execute Maintenance
 * ========================= */
const executeMaintenance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { assetId, scheduleId, notes, spareParts = [], consumables = [], serviceCost = 0, partsCost = 0, } = req.body;
        if (!assetId) {
            res.status(400).json({ message: "assetId required" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: assetId },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        // 🔹 Detect AMC / CMC
        const contract = yield prismaClient_1.default.serviceContract.findFirst({
            where: {
                assetId,
                status: "ACTIVE",
                startDate: { lte: new Date() },
                endDate: { gte: new Date() },
            },
        });
        const serviceType = contract ? contract.contractType : "PAID";
        const result = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            // ✅ get schedule once
            const schedule = scheduleId
                ? yield tx.maintenanceSchedule.findUnique({ where: { id: scheduleId } })
                : null;
            // 1️⃣ Create maintenance history
            const history = yield tx.maintenanceHistory.create({
                data: {
                    asset: {
                        connect: { id: assetId },
                    },
                    scheduledDue: (_a = schedule === null || schedule === void 0 ? void 0 : schedule.nextDueAt) !== null && _a !== void 0 ? _a : new Date(),
                    actualDoneAt: new Date(),
                    wasLate: schedule ? new Date() > schedule.nextDueAt : false,
                    performedBy: user.employeeID,
                    notes,
                    serviceType,
                    serviceCost: new client_1.Prisma.Decimal(serviceCost),
                    partsCost: new client_1.Prisma.Decimal(partsCost),
                    totalCost: new client_1.Prisma.Decimal(Number(serviceCost) + Number(partsCost)),
                    createdById: user.employeeDbId,
                },
            });
            // 2️⃣ Spare Parts
            for (const sp of spareParts) {
                yield tx.sparePartUsage.create({
                    data: {
                        sparePartId: sp.id,
                        assetId,
                        quantity: sp.qty,
                        usedById: user.employeeDbId,
                        reason: "Preventive Maintenance",
                    },
                });
                yield tx.sparePart.update({
                    where: { id: sp.id },
                    data: {
                        stockQuantity: { decrement: sp.qty },
                    },
                });
                yield tx.inventoryTransaction.create({
                    data: {
                        type: "OUT",
                        sparePartId: sp.id,
                        quantity: sp.qty,
                        referenceType: "MAINTENANCE",
                        referenceId: history.id, // ✅ FIXED
                        performedById: user.employeeDbId,
                    },
                });
            }
            // 3️⃣ Consumables
            for (const c of consumables) {
                yield tx.inventoryTransaction.create({
                    data: {
                        type: "OUT",
                        consumableId: c.id,
                        quantity: c.qty,
                        referenceType: "MAINTENANCE",
                        referenceId: history.id, // ✅ FIXED
                        performedById: user.employeeDbId,
                    },
                });
            }
            // 4️⃣ Update next schedule
            if (schedule) {
                const nextDue = calculateNextDue(schedule);
                yield tx.maintenanceSchedule.update({
                    where: { id: schedule.id },
                    data: { nextDueAt: nextDue },
                });
            }
            // 5️⃣ Notify HOD
            if (asset.departmentId) {
                const hod = yield tx.employee.findFirst({
                    where: {
                        departmentId: asset.departmentId,
                        role: "HOD",
                    },
                });
                if (hod) {
                    const notif = yield tx.notification.create({
                        data: {
                            type: "OTHER", // ✅ REQUIRED FIX
                            title: "Maintenance Completed",
                            message: `Asset ${asset.assetName} maintenance completed`,
                            assetId: asset.id,
                            createdById: user.employeeDbId,
                        },
                    });
                    yield tx.notificationRecipient.create({
                        data: {
                            notificationId: notif.id,
                            employeeId: hod.id,
                        },
                    });
                }
            }
            return history; // ✅ FIXED
        }));
        res.json(result);
    }
    catch (e) {
        console.error("executeMaintenance error:", e);
        res.status(500).json({ message: e.message });
    }
});
exports.executeMaintenance = executeMaintenance;
/** =========================
 * 5. Get History by Asset
 * ========================= */
const getHistoryByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const assetId = Number(req.params.assetId);
    const history = yield prismaClient_1.default.maintenanceHistory.findMany({
        where: { assetId },
        orderBy: { actualDoneAt: "desc" },
    });
    res.json(history);
});
exports.getHistoryByAsset = getHistoryByAsset;
/** =========================
 * 6. Get AMC/CMC Contract
 * ========================= */
const getServiceContract = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const assetId = Number(req.params.assetId);
    const contract = yield prismaClient_1.default.serviceContract.findFirst({
        where: {
            assetId,
            status: "ACTIVE",
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
        },
    });
    res.json(contract);
});
exports.getServiceContract = getServiceContract;
/** =========================
 * 7. Trigger Notifications (cron-ready)
 * ========================= */
/** =========================
 * Calendar View (month-based)
 * ========================= */
const getCalendarView = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month, year } = req.query;
        const m = Number(month) || new Date().getMonth() + 1;
        const y = Number(year) || new Date().getFullYear();
        const startDate = new Date(y, m - 1, 1);
        const endDate = new Date(y, m, 0, 23, 59, 59);
        const schedules = yield prismaClient_1.default.maintenanceSchedule.findMany({
            where: {
                nextDueAt: { gte: startDate, lte: endDate },
                isActive: true,
            },
            include: {
                asset: {
                    select: {
                        id: true,
                        assetId: true,
                        assetName: true,
                        departmentId: true,
                        department: { select: { name: true } },
                        currentLocation: true,
                    },
                },
            },
            orderBy: { nextDueAt: "asc" },
        });
        const now = new Date();
        const events = schedules.map((s) => {
            var _a;
            const dueDate = new Date(s.nextDueAt);
            let status;
            if (dueDate < now) {
                status = "OVERDUE";
            }
            else {
                const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                status = daysUntil <= (s.reminderDays || 7) ? "UPCOMING" : "SCHEDULED";
            }
            return {
                id: s.id,
                assetId: s.asset.id,
                assetCode: s.asset.assetId,
                assetName: s.asset.assetName,
                department: ((_a = s.asset.department) === null || _a === void 0 ? void 0 : _a.name) || "",
                location: s.asset.currentLocation || "",
                dueDate: s.nextDueAt,
                frequencyValue: s.frequencyValue,
                frequencyUnit: s.frequencyUnit,
                status,
                reason: s.reason,
            };
        });
        const overdue = events.filter((e) => e.status === "OVERDUE").length;
        const upcoming = events.filter((e) => e.status === "UPCOMING").length;
        const scheduled = events.filter((e) => e.status === "SCHEDULED").length;
        res.json({ month: m, year: y, overdue, upcoming, scheduled, total: events.length, events });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getCalendarView = getCalendarView;
/** =========================
 * Reschedule a PM
 * ========================= */
const rescheduleMaintenance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const id = Number(req.params.id);
        const { newDueDate, reason } = req.body;
        if (!newDueDate) {
            res.status(400).json({ message: "newDueDate is required" });
            return;
        }
        const schedule = yield prismaClient_1.default.maintenanceSchedule.findUnique({ where: { id } });
        if (!schedule) {
            res.status(404).json({ message: "Schedule not found" });
            return;
        }
        const updated = yield prismaClient_1.default.maintenanceSchedule.update({
            where: { id },
            data: {
                nextDueAt: new Date(newDueDate),
                reason: reason || schedule.reason,
            },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.rescheduleMaintenance = rescheduleMaintenance;
/** =========================
 * Update schedule (toggle active, change frequency)
 * ========================= */
const updateSchedule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { frequencyValue, frequencyUnit, nextDueAt, reminderDays, reason, isActive } = req.body;
        const data = {};
        if (frequencyValue !== undefined)
            data.frequencyValue = frequencyValue;
        if (frequencyUnit !== undefined)
            data.frequencyUnit = frequencyUnit;
        if (nextDueAt !== undefined)
            data.nextDueAt = new Date(nextDueAt);
        if (reminderDays !== undefined)
            data.reminderDays = reminderDays;
        if (reason !== undefined)
            data.reason = reason;
        if (isActive !== undefined)
            data.isActive = isActive;
        const updated = yield prismaClient_1.default.maintenanceSchedule.update({
            where: { id },
            data,
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.updateSchedule = updateSchedule;
/** =========================
 * PM History with pagination & CSV export
 * ========================= */
const getAllMaintenanceHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { assetId, serviceType, page = "1", limit = "25", search, exportCsv } = req.query;
        const where = {};
        if (assetId)
            where.assetId = Number(assetId);
        if (serviceType)
            where.serviceType = String(serviceType);
        if (search) {
            where.OR = [
                { performedBy: { contains: String(search) } },
                { notes: { contains: String(search) } },
                { asset: { assetName: { contains: String(search) } } },
            ];
        }
        const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const take = parseInt(String(limit));
        const [total, history] = yield Promise.all([
            prismaClient_1.default.maintenanceHistory.count({ where }),
            prismaClient_1.default.maintenanceHistory.findMany(Object.assign({ where, include: {
                    asset: { select: { assetId: true, assetName: true } },
                }, orderBy: { actualDoneAt: "desc" } }, (exportCsv !== "true" ? { skip, take } : {}))),
        ]);
        if (exportCsv === "true") {
            const csvRows = history.map((h) => {
                var _a, _b;
                return ({
                    AssetId: ((_a = h.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    AssetName: ((_b = h.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    ScheduledDue: h.scheduledDue ? new Date(h.scheduledDue).toISOString().split("T")[0] : "",
                    ActualDone: h.actualDoneAt ? new Date(h.actualDoneAt).toISOString().split("T")[0] : "",
                    WasLate: h.wasLate ? "Yes" : "No",
                    PerformedBy: h.performedBy || "",
                    ServiceType: h.serviceType || "",
                    ServiceCost: h.serviceCost ? Number(h.serviceCost) : "",
                    PartsCost: h.partsCost ? Number(h.partsCost) : "",
                    TotalCost: h.totalCost ? Number(h.totalCost) : "",
                    Notes: h.notes || "",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=maintenance-history.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json({ data: history, total, page: parseInt(String(page)), limit: take });
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getAllMaintenanceHistory = getAllMaintenanceHistory;
const triggerPMNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    const schedules = yield prismaClient_1.default.maintenanceSchedule.findMany({
        where: {
            nextDueAt: { lte: now },
            isActive: true,
        },
        include: { asset: true },
    });
    for (const s of schedules) {
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: {
                departmentId: s.asset.departmentId,
                role: "HOD",
            },
        });
        if (hod) {
            const notif = yield prismaClient_1.default.notification.create({
                data: {
                    type: "OTHER",
                    title: "Maintenance Due",
                    message: `Asset ${s.asset.assetName} is due`,
                    assetId: s.asset.id,
                },
            });
            yield prismaClient_1.default.notificationRecipient.create({
                data: {
                    notificationId: notif.id,
                    employeeId: hod.id,
                },
            });
        }
    }
    res.json({ message: "PM notifications triggered" });
});
exports.triggerPMNotifications = triggerPMNotifications;

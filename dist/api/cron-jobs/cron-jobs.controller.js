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
exports.runAllChecks = exports.checkGatePassOverdue = exports.checkAssetActivation = exports.checkLowStock = exports.checkMaintenanceDue = exports.checkCalibrationDue = exports.checkMaintenanceSLABreach = exports.checkSLABreach = exports.checkContractExpiry = exports.checkInsuranceExpiry = exports.checkWarrantyExpiry = void 0;
exports.runAllChecksInternal = runAllChecksInternal;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const notificationHelper_1 = require("../../utilis/notificationHelper");
// ─── Date helpers ────────────────────────────────────────────────────────────
const dayStr = (d) => d.toISOString().split("T")[0];
const daysBetween = (from, to) => Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
// Resolve the people who should receive an asset-scoped alert: the department's
// HOD(s), falling back to Admins so an alert is never created with no recipients.
function hodOrAdmin(departmentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const hods = yield (0, notificationHelper_1.getDepartmentHODs)(departmentId);
        if (hods.length)
            return hods;
        return (0, notificationHelper_1.getAdminIds)();
    });
}
// ─── Helper: Get Active SMTP Config (used by the gate-pass email path) ───────
function getTransporter() {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield prismaClient_1.default.smtpConfig.findFirst({ where: { isActive: true } });
        if (!config) {
            return nodemailer_1.default.createTransport({
                host: "smtp.hostinger.com",
                port: 465,
                secure: true,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
        }
        return nodemailer_1.default.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: { user: config.username, pass: config.password },
        });
    });
}
function sendAlertEmail(to, subject, html) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const transporter = yield getTransporter();
            const config = yield prismaClient_1.default.smtpConfig.findFirst({ where: { isActive: true } });
            const from = config ? `"${config.fromName}" <${config.fromEmail}>` : `"Smart Assets" <${process.env.SMTP_USER}>`;
            yield transporter.sendMail({ from, to, subject, html });
            return true;
        }
        catch (err) {
            console.error("sendAlertEmail failed:", err);
            return false;
        }
    });
}
// ═════════════════════════════════════════════════════════════════════════════
//  WARRANTY EXPIRY — tiered 60 / 30 / 7-day reminders
// ═════════════════════════════════════════════════════════════════════════════
function checkWarrantyExpiryInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const horizon = new Date();
        horizon.setDate(now.getDate() + 60); // widest reminder window
        const warranties = yield prismaClient_1.default.warranty.findMany({
            where: {
                isActive: true,
                isUnderWarranty: true,
                warrantyEnd: { gte: now, lte: horizon },
            },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
            },
        });
        let alerted = 0;
        for (const w of warranties) {
            const daysLeft = daysBetween(now, new Date(w.warrantyEnd));
            // Pick the milestone band this warranty currently falls in.
            const milestone = daysLeft <= 7 ? "7d" : daysLeft <= 30 ? "30d" : "60d";
            const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";
            const recipients = yield hodOrAdmin(w.asset.departmentId);
            if (!recipients.length)
                continue;
            yield (0, notificationHelper_1.notify)({
                type: "WARRANTY_EXPIRY",
                title: "Warranty Expiring Soon",
                message: `Warranty for ${w.asset.assetName} (${w.asset.assetId}) expires in ${daysLeft} day(s).`,
                recipientIds: recipients,
                priority,
                channel: "BOTH",
                assetId: w.asset.id,
                // One alert per warranty per milestone band → each of 60/30/7 fires once.
                dedupeKey: `warranty-expiry-${w.id}-${milestone}`,
            });
            alerted++;
        }
        return { type: "warranty", expiringCount: warranties.length, alerted };
    });
}
const checkWarrantyExpiry = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkWarrantyExpiryInternal();
        res.json(Object.assign({ message: `${result.alerted} warranty expiry alert(s) processed` }, result));
    }
    catch (error) {
        console.error("checkWarrantyExpiry error:", error);
        res.status(500).json({ message: "Failed to check warranty expiry" });
    }
});
exports.checkWarrantyExpiry = checkWarrantyExpiry;
// ═════════════════════════════════════════════════════════════════════════════
//  INSURANCE EXPIRY
// ═════════════════════════════════════════════════════════════════════════════
function checkInsuranceExpiryInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const policies = yield prismaClient_1.default.assetInsurance.findMany({
            where: {
                isActive: true,
                policyStatus: "ACTIVE",
                endDate: { gte: now, lte: thirtyDays },
            },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
            },
        });
        let alerted = 0;
        for (const p of policies) {
            if (!p.endDate)
                continue;
            const daysLeft = daysBetween(now, new Date(p.endDate));
            const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";
            const hods = yield (0, notificationHelper_1.getDepartmentHODs)(p.asset.departmentId);
            const admins = yield (0, notificationHelper_1.getAdminIds)();
            const recipients = [...new Set([...hods, ...admins])];
            if (!recipients.length)
                continue;
            yield (0, notificationHelper_1.notify)({
                type: "INSURANCE_EXPIRY",
                title: "Insurance Policy Expiring Soon",
                message: `Insurance policy ${p.policyNumber || ""} for ${p.asset.assetName} expires in ${daysLeft} day(s).`,
                recipientIds: recipients,
                priority,
                channel: "BOTH",
                assetId: p.asset.id,
                insuranceId: p.id,
                dedupeKey: `insurance-expiry-${p.id}-${dayStr(new Date(p.endDate))}`,
            });
            alerted++;
        }
        return { type: "insurance", expiringCount: policies.length, alerted };
    });
}
const checkInsuranceExpiry = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkInsuranceExpiryInternal();
        res.json(Object.assign({ message: `${result.alerted} insurance expiry alert(s) processed` }, result));
    }
    catch (error) {
        console.error("checkInsuranceExpiry error:", error);
        res.status(500).json({ message: "Failed to check insurance expiry" });
    }
});
exports.checkInsuranceExpiry = checkInsuranceExpiry;
// ═════════════════════════════════════════════════════════════════════════════
//  AMC / CMC CONTRACT EXPIRY
// ═════════════════════════════════════════════════════════════════════════════
function checkContractExpiryInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const contracts = yield prismaClient_1.default.serviceContract.findMany({
            where: {
                status: "ACTIVE",
                endDate: { gte: now, lte: thirtyDays },
            },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
                vendor: { select: { name: true } },
            },
        });
        let alerted = 0;
        for (const c of contracts) {
            const daysLeft = daysBetween(now, new Date(c.endDate));
            const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";
            const hods = yield (0, notificationHelper_1.getDepartmentHODs)(c.asset.departmentId);
            const admins = yield (0, notificationHelper_1.getAdminIds)();
            const recipients = [...new Set([...hods, ...admins])];
            if (!recipients.length)
                continue;
            yield (0, notificationHelper_1.notify)({
                type: "AMC_CMC_EXPIRY",
                title: `${c.contractType} Contract Expiring`,
                message: `${c.contractType} contract for ${c.asset.assetName} (vendor: ${((_a = c.vendor) === null || _a === void 0 ? void 0 : _a.name) || "N/A"}) expires in ${daysLeft} day(s).`,
                recipientIds: recipients,
                priority,
                channel: "BOTH",
                assetId: c.asset.id,
                dedupeKey: `contract-expiry-${c.id}-${dayStr(new Date(c.endDate))}`,
            });
            alerted++;
        }
        return { type: "contract", expiringCount: contracts.length, alerted };
    });
}
const checkContractExpiry = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkContractExpiryInternal();
        res.json(Object.assign({ message: `${result.alerted} contract expiry alert(s) processed` }, result));
    }
    catch (error) {
        console.error("checkContractExpiry error:", error);
        res.status(500).json({ message: "Failed to check contract expiry" });
    }
});
exports.checkContractExpiry = checkContractExpiry;
// ═════════════════════════════════════════════════════════════════════════════
//  TICKET SLA — pre-breach warning + breach
// ═════════════════════════════════════════════════════════════════════════════
function checkSLAInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where: {
                status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
                slaExpectedValue: { not: null },
            },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
                assignedTo: { select: { id: true } },
            },
        });
        const now = new Date();
        let warned = 0;
        let breached = 0;
        for (const ticket of tickets) {
            if (!ticket.slaExpectedValue || !ticket.slaExpectedUnit)
                continue;
            const createdAt = new Date(ticket.createdAt);
            const value = ticket.slaExpectedValue;
            const unit = ticket.slaExpectedUnit;
            let totalMs;
            if (unit === "HOURS")
                totalMs = value * 60 * 60 * 1000;
            else if (unit === "DAYS")
                totalMs = value * 24 * 60 * 60 * 1000;
            else
                continue;
            const slaDeadline = new Date(createdAt.getTime() + totalMs);
            const remainingMs = slaDeadline.getTime() - now.getTime();
            // Recipients: assigned technician + the asset department's HOD(s).
            const recipients = new Set();
            if (ticket.assignedTo)
                recipients.add(ticket.assignedTo.id);
            (yield (0, notificationHelper_1.getDepartmentHODs)(ticket.asset.departmentId)).forEach(id => recipients.add(id));
            if (recipients.size === 0)
                (yield (0, notificationHelper_1.getAdminIds)()).forEach(id => recipients.add(id));
            if (recipients.size === 0)
                continue;
            if (remainingMs <= 0 && !ticket.slaBreached) {
                // ── Breach ──
                yield prismaClient_1.default.ticket.update({ where: { id: ticket.id }, data: { slaBreached: true } });
                yield (0, notificationHelper_1.notify)({
                    type: "SLA_BREACH",
                    title: "SLA Breached",
                    message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} has breached its SLA.`,
                    recipientIds: [...recipients],
                    priority: "CRITICAL",
                    channel: "BOTH",
                    assetId: ticket.asset.id,
                    ticketId: ticket.id,
                    dedupeKey: `sla-breach-${ticket.id}`,
                });
                breached++;
            }
            else if (remainingMs > 0 && remainingMs <= totalMs * 0.2) {
                // ── Pre-breach warning: ≤ 20% of the SLA window left ──
                const hoursLeft = Math.max(1, Math.round(remainingMs / (1000 * 60 * 60)));
                yield (0, notificationHelper_1.notify)({
                    type: "SLA_BREACH",
                    title: "SLA Deadline Approaching",
                    message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} will breach SLA in about ${hoursLeft} hour(s).`,
                    recipientIds: [...recipients],
                    priority: "HIGH",
                    channel: "BOTH",
                    assetId: ticket.asset.id,
                    ticketId: ticket.id,
                    dedupeKey: `sla-warning-${ticket.id}`,
                });
                warned++;
            }
        }
        return { type: "sla", warned, breached };
    });
}
const checkSLABreach = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkSLAInternal();
        res.json(Object.assign({ message: `${result.breached} SLA breach, ${result.warned} SLA warning alert(s)` }, result));
    }
    catch (error) {
        console.error("checkSLABreach error:", error);
        res.status(500).json({ message: "Failed to check SLA" });
    }
});
exports.checkSLABreach = checkSLABreach;
// ═════════════════════════════════════════════════════════════════════════════
//  MAINTENANCE SLA BREACH — PM checklist runs overdue beyond grace
// ═════════════════════════════════════════════════════════════════════════════
function checkMaintenanceSLABreachInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const now = new Date();
        const overdueRuns = yield prismaClient_1.default.preventiveChecklistRun.findMany({
            where: { status: { in: ["DUE"] } },
            include: {
                template: { select: { slaOverdueDays: true, name: true } },
                asset: { select: { id: true, assetName: true, assetId: true, departmentId: true } },
            },
        });
        let breachCount = 0;
        for (const run of overdueRuns) {
            const template = run.template;
            const overdueDays = (_a = template === null || template === void 0 ? void 0 : template.slaOverdueDays) !== null && _a !== void 0 ? _a : 3;
            const deadline = new Date(run.scheduledDue);
            deadline.setDate(deadline.getDate() + overdueDays);
            if (now > deadline) {
                yield prismaClient_1.default.preventiveChecklistRun.update({
                    where: { id: run.id },
                    data: { status: "OVERDUE" },
                });
                const recipients = yield hodOrAdmin(run.asset.departmentId);
                if (recipients.length) {
                    yield (0, notificationHelper_1.notify)({
                        type: "SLA_BREACH",
                        title: "Preventive Maintenance Overdue",
                        message: `PM schedule "${template === null || template === void 0 ? void 0 : template.name}" for asset ${run.asset.assetName} is overdue by more than ${overdueDays} day(s).`,
                        recipientIds: recipients,
                        priority: "HIGH",
                        channel: "BOTH",
                        assetId: run.asset.id,
                        dedupeKey: `pm-sla-breach-${run.id}`,
                    });
                }
                breachCount++;
            }
        }
        return { type: "maintenanceSla", overdueCount: breachCount };
    });
}
const checkMaintenanceSLABreach = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkMaintenanceSLABreachInternal();
        res.json(Object.assign({ message: `${result.overdueCount} maintenance SLA breach alert(s)` }, result));
    }
    catch (error) {
        console.error("checkMaintenanceSLABreach error:", error);
        res.status(500).json({ message: "Failed to check maintenance SLA breach" });
    }
});
exports.checkMaintenanceSLABreach = checkMaintenanceSLABreach;
// ═════════════════════════════════════════════════════════════════════════════
//  CALIBRATION DUE
// ═════════════════════════════════════════════════════════════════════════════
function checkCalibrationDueInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const schedules = yield prismaClient_1.default.calibrationSchedule.findMany({
            where: {
                isActive: true,
                nextDueAt: { gte: now, lte: thirtyDays },
            },
            include: {
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
            },
        });
        let alerted = 0;
        for (const s of schedules) {
            const daysLeft = daysBetween(now, new Date(s.nextDueAt));
            const priority = daysLeft <= 7 ? "HIGH" : "MEDIUM";
            const recipients = yield hodOrAdmin(s.asset.departmentId);
            if (!recipients.length)
                continue;
            yield (0, notificationHelper_1.notify)({
                type: "CALIBRATION",
                title: "Calibration Due Soon",
                message: `Calibration for ${s.asset.assetName} (${s.asset.assetId}) is due in ${daysLeft} day(s).`,
                recipientIds: recipients,
                priority,
                channel: "BOTH",
                assetId: s.asset.id,
                dedupeKey: `calibration-due-${s.id}-${dayStr(new Date(s.nextDueAt))}`,
            });
            alerted++;
        }
        return { type: "calibrationDue", dueCount: schedules.length, alerted };
    });
}
const checkCalibrationDue = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkCalibrationDueInternal();
        res.json(Object.assign({ message: `${result.alerted} calibration due alert(s) processed` }, result));
    }
    catch (error) {
        console.error("checkCalibrationDue error:", error);
        res.status(500).json({ message: "Failed to check calibration due" });
    }
});
exports.checkCalibrationDue = checkCalibrationDue;
// ═════════════════════════════════════════════════════════════════════════════
//  PREVENTIVE MAINTENANCE DUE SOON
// ═════════════════════════════════════════════════════════════════════════════
function checkMaintenanceDueInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const sevenDays = new Date();
        sevenDays.setDate(now.getDate() + 7);
        const runs = yield prismaClient_1.default.preventiveChecklistRun.findMany({
            where: {
                status: "DUE",
                scheduledDue: { gte: now, lte: sevenDays },
            },
            include: {
                template: { select: { name: true } },
                asset: { select: { id: true, assetId: true, assetName: true, departmentId: true } },
            },
        });
        let alerted = 0;
        for (const run of runs) {
            const daysLeft = daysBetween(now, new Date(run.scheduledDue));
            const priority = daysLeft <= 2 ? "HIGH" : "MEDIUM";
            const template = run.template;
            const recipients = yield hodOrAdmin(run.asset.departmentId);
            if (!recipients.length)
                continue;
            yield (0, notificationHelper_1.notify)({
                type: "MAINTENANCE_DUE",
                title: "Preventive Maintenance Due Soon",
                message: `PM "${(template === null || template === void 0 ? void 0 : template.name) || "schedule"}" for ${run.asset.assetName} (${run.asset.assetId}) is due in ${daysLeft} day(s).`,
                recipientIds: recipients,
                priority,
                channel: "BOTH",
                assetId: run.asset.id,
                dedupeKey: `maintenance-due-${run.id}-${dayStr(new Date(run.scheduledDue))}`,
            });
            alerted++;
        }
        return { type: "maintenanceDue", dueCount: runs.length, alerted };
    });
}
const checkMaintenanceDue = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkMaintenanceDueInternal();
        res.json(Object.assign({ message: `${result.alerted} maintenance due alert(s) processed` }, result));
    }
    catch (error) {
        console.error("checkMaintenanceDue error:", error);
        res.status(500).json({ message: "Failed to check maintenance due" });
    }
});
exports.checkMaintenanceDue = checkMaintenanceDue;
// ═════════════════════════════════════════════════════════════════════════════
//  LOW STOCK / REORDER
// ═════════════════════════════════════════════════════════════════════════════
function checkLowStockInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const today = dayStr(new Date());
        // Prisma can't compare two columns directly → fetch candidates and filter in code.
        const positions = yield prismaClient_1.default.storeStockPosition.findMany({
            where: { reorderLevel: { not: null } },
            include: { store: { select: { name: true } } },
        });
        const lowStock = positions.filter(p => p.reorderLevel && p.currentQty.lessThanOrEqualTo(p.reorderLevel));
        if (lowStock.length === 0)
            return { type: "lowStock", lowCount: 0, alerted: 0 };
        const admins = yield (0, notificationHelper_1.getAdminIds)();
        if (!admins.length)
            return { type: "lowStock", lowCount: lowStock.length, alerted: 0 };
        let alerted = 0;
        for (const p of lowStock) {
            // Resolve a readable item name.
            let itemName = "stock item";
            if (p.itemType === "SPARE_PART" && p.sparePartId) {
                const sp = yield prismaClient_1.default.sparePart.findUnique({
                    where: { id: p.sparePartId },
                    select: { name: true, partNumber: true },
                });
                if (sp)
                    itemName = `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}`;
            }
            else if (p.itemType === "CONSUMABLE" && p.consumableId) {
                const c = yield prismaClient_1.default.consumable.findUnique({
                    where: { id: p.consumableId },
                    select: { name: true },
                });
                if (c)
                    itemName = c.name;
            }
            const qty = p.currentQty.toString();
            const reorder = p.reorderLevel.toString();
            const priority = p.currentQty.lessThanOrEqualTo(0) ? "HIGH" : "MEDIUM";
            yield (0, notificationHelper_1.notify)({
                type: "LOW_STOCK",
                title: "Low Stock Alert",
                message: `${itemName} at store "${((_a = p.store) === null || _a === void 0 ? void 0 : _a.name) || "Store"}" is low — quantity ${qty} (reorder level ${reorder}).`,
                recipientIds: admins,
                priority,
                channel: "BOTH",
                // Per-item, per-day → re-alerts once daily until restocked.
                dedupeKey: `low-stock-${p.id}-${today}`,
            });
            alerted++;
        }
        return { type: "lowStock", lowCount: lowStock.length, alerted };
    });
}
const checkLowStock = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkLowStockInternal();
        res.json(Object.assign({ message: `${result.alerted} low stock alert(s) processed` }, result));
    }
    catch (error) {
        console.error("checkLowStock error:", error);
        res.status(500).json({ message: "Failed to check low stock" });
    }
});
exports.checkLowStock = checkLowStock;
// ═════════════════════════════════════════════════════════════════════════════
//  ASSET ACTIVATION — IN_STORE → ACTIVE on depreciation start date
// ═════════════════════════════════════════════════════════════════════════════
function checkAssetActivationInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const candidates = yield prismaClient_1.default.assetDepreciation.findMany({
            where: {
                isActive: true,
                depreciationStart: { lte: today },
                asset: { status: "IN_STORE" },
            },
            select: {
                assetId: true,
                depreciationStart: true,
                asset: { select: { id: true, assetId: true, assetName: true } },
            },
        });
        if (!candidates.length) {
            return { type: "assetActivation", activated: 0, assets: [] };
        }
        const assetDbIds = candidates.map(c => c.assetId);
        yield prismaClient_1.default.asset.updateMany({
            where: { id: { in: assetDbIds }, status: "IN_STORE" },
            data: { status: "ACTIVE" },
        });
        const activatedAssets = candidates.map(c => ({
            id: c.asset.id,
            assetId: c.asset.assetId,
            assetName: c.asset.assetName,
            depreciationStart: c.depreciationStart,
        }));
        console.log(`[Asset Activation] ${activatedAssets.length} asset(s) moved to ACTIVE:`, activatedAssets.map(a => a.assetId).join(", "));
        return { type: "assetActivation", activated: activatedAssets.length, assets: activatedAssets };
    });
}
const checkAssetActivation = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkAssetActivationInternal();
        res.json(Object.assign({ message: `${result.activated} asset(s) activated` }, result));
    }
    catch (error) {
        console.error("checkAssetActivation error:", error);
        res.status(500).json({ message: "Failed to run asset activation check" });
    }
});
exports.checkAssetActivation = checkAssetActivation;
// ═════════════════════════════════════════════════════════════════════════════
//  GATE PASS OVERDUE
// ═════════════════════════════════════════════════════════════════════════════
function runGatePassOverdueCheck() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const now = new Date();
        const today = dayStr(now); // per-day dedupe
        const overdue = yield prismaClient_1.default.gatePass.findMany({
            where: {
                type: "RETURNABLE",
                status: "ISSUED",
                expectedReturnDate: { lt: now },
            },
            include: {
                requestedBy: { select: { id: true, name: true, departmentId: true, email: true } },
                items: { include: { asset: { select: { assetId: true, assetName: true } } } },
            },
        });
        const securityUsers = yield prismaClient_1.default.user.findMany({
            where: { role: "SECURITY" },
            select: { employee: { select: { id: true, email: true } } },
        });
        const securityIds = securityUsers.map(u => { var _a; return (_a = u.employee) === null || _a === void 0 ? void 0 : _a.id; }).filter(Boolean);
        let alerted = 0;
        for (const gp of overdue) {
            const daysOverdue = daysBetween(new Date(gp.expectedReturnDate), now);
            const priority = daysOverdue > 7 ? "HIGH" : "MEDIUM";
            const recipients = new Set();
            if (gp.requestedById)
                recipients.add(gp.requestedById);
            if ((_a = gp.requestedBy) === null || _a === void 0 ? void 0 : _a.departmentId) {
                const hods = yield prismaClient_1.default.employee.findMany({
                    where: { departmentId: gp.requestedBy.departmentId, role: "HOD", isActive: true },
                    select: { id: true },
                });
                hods.forEach(h => recipients.add(h.id));
            }
            securityIds.forEach(id => recipients.add(id));
            if (recipients.size === 0)
                continue;
            const itemSummary = gp.items.length
                ? `${((_b = gp.items[0].asset) === null || _b === void 0 ? void 0 : _b.assetName) || "asset"}${gp.items.length > 1 ? ` +${gp.items.length - 1} more` : ""}`
                : "asset(s)";
            try {
                const notif = yield prismaClient_1.default.notification.create({
                    data: {
                        type: "GATEPASS_OVERDUE",
                        title: `Gate Pass Overdue · ${daysOverdue} day${daysOverdue > 1 ? "s" : ""}`,
                        message: `${gp.gatePassNo} (${itemSummary}) was due on ${new Date(gp.expectedReturnDate).toLocaleDateString("en-IN")} — issued to ${gp.issuedTo}.`,
                        priority,
                        gatePassId: gp.id,
                        dedupeKey: `gatepass-overdue-${gp.id}-${today}`,
                        recipients: { create: Array.from(recipients).map(id => ({ employeeId: id })) },
                    },
                });
                if (priority === "HIGH") {
                    const secEmails = securityUsers.map(u => { var _a; return (_a = u.employee) === null || _a === void 0 ? void 0 : _a.email; }).filter(Boolean);
                    for (const email of secEmails) {
                        yield sendAlertEmail(email, `Gate Pass Overdue: ${gp.gatePassNo}`, `<p>Gate pass <strong>${gp.gatePassNo}</strong> is <strong>${daysOverdue} days overdue</strong>.</p>
             <p>Issued to: ${gp.issuedTo}<br>Expected return: ${new Date(gp.expectedReturnDate).toLocaleDateString("en-IN")}<br>Items: ${itemSummary}</p>`);
                    }
                }
                void notif;
                alerted++;
            }
            catch (err) {
                // Unique-violation on dedupeKey just means we already alerted today — skip silently
                if ((err === null || err === void 0 ? void 0 : err.code) !== "P2002")
                    console.error("checkGatePassOverdue insert failed:", err);
            }
        }
        return { type: "gate-pass-overdue", overdueCount: overdue.length, alerted };
    });
}
const checkGatePassOverdue = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield runGatePassOverdueCheck();
        res.json(Object.assign({ message: `${result.alerted} overdue gate pass alert(s) sent` }, result));
    }
    catch (error) {
        console.error("checkGatePassOverdue error:", error);
        res.status(500).json({ message: "Failed to check overdue gate passes" });
    }
});
exports.checkGatePassOverdue = checkGatePassOverdue;
// ═════════════════════════════════════════════════════════════════════════════
//  RUN ALL — single entry point for the scheduler / cron
// ═════════════════════════════════════════════════════════════════════════════
function runAllChecksInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const results = {};
        const checks = [
            ["warranty", checkWarrantyExpiryInternal],
            ["insurance", checkInsuranceExpiryInternal],
            ["contract", checkContractExpiryInternal],
            ["sla", checkSLAInternal],
            ["maintenanceSla", checkMaintenanceSLABreachInternal],
            ["calibrationDue", checkCalibrationDueInternal],
            ["maintenanceDue", checkMaintenanceDueInternal],
            ["lowStock", checkLowStockInternal],
            ["assetActivation", checkAssetActivationInternal],
            ["gatePassOverdue", runGatePassOverdueCheck],
        ];
        for (const [key, fn] of checks) {
            try {
                results[key] = yield fn();
            }
            catch (e) {
                console.error(`[cron] check "${key}" failed:`, e);
                results[key] = { error: true };
            }
        }
        return results;
    });
}
const runAllChecks = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const results = yield runAllChecksInternal();
        res.json({ message: "All checks completed", results });
    }
    catch (error) {
        console.error("runAllChecks error:", error);
        res.status(500).json({ message: "Failed to run checks" });
    }
});
exports.runAllChecks = runAllChecks;

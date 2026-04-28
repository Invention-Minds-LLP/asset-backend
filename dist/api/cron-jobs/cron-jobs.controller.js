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
exports.checkMaintenanceSLABreach = exports.runAllChecks = exports.checkAssetActivation = exports.checkContractExpiry = exports.checkSLABreach = exports.checkInsuranceExpiry = exports.checkWarrantyExpiry = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const nodemailer_1 = __importDefault(require("nodemailer"));
// ─── Helper: Get Active SMTP Config ──────────────────────────────────────────
function getTransporter() {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield prismaClient_1.default.smtpConfig.findFirst({ where: { isActive: true } });
        if (!config) {
            // Fallback to env vars
            return nodemailer_1.default.createTransport({
                host: "smtp.hostinger.com",
                port: 465,
                secure: true,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });
        }
        return nodemailer_1.default.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.username,
                pass: config.password,
            },
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
// ─── Check Warranty Expiry ───────────────────────────────────────────────────
const checkWarrantyExpiry = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const expiringWarranties = yield prismaClient_1.default.warranty.findMany({
            where: {
                isActive: true,
                isUnderWarranty: true,
                alertSent: false,
                warrantyEnd: { gte: now, lte: thirtyDays },
            },
            include: {
                asset: { select: { assetId: true, assetName: true, departmentId: true } },
            },
        });
        let notified = 0;
        for (const w of expiringWarranties) {
            const daysLeft = Math.ceil((new Date(w.warrantyEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            // Create in-app notification
            const notif = yield prismaClient_1.default.notification.create({
                data: {
                    type: "WARRANTY_EXPIRY",
                    title: "Warranty Expiring Soon",
                    message: `Warranty for ${w.asset.assetName} (${w.asset.assetId}) expires in ${daysLeft} days.`,
                    assetId: w.assetId,
                    priority: daysLeft <= 7 ? "HIGH" : "MEDIUM",
                    dedupeKey: `warranty-expiry-${w.id}-${w.warrantyEnd.toISOString().split("T")[0]}`,
                },
            });
            // Notify HOD
            if (w.asset.departmentId) {
                const hod = yield prismaClient_1.default.employee.findFirst({
                    where: { departmentId: w.asset.departmentId, role: "HOD" },
                });
                if (hod) {
                    yield prismaClient_1.default.notificationRecipient.create({
                        data: { notificationId: notif.id, employeeId: hod.id },
                    });
                    // Send email if HOD has email preferences enabled
                    if (hod.email) {
                        const pref = yield prismaClient_1.default.notificationPreference.findUnique({ where: { employeeId: hod.id } });
                        if (!pref || pref.channelEmail) {
                            yield sendAlertEmail(hod.email, `Warranty Expiring: ${w.asset.assetName}`, `<p>The warranty for <strong>${w.asset.assetName}</strong> (${w.asset.assetId}) expires in <strong>${daysLeft} days</strong>.</p><p>Please take necessary action.</p>`);
                        }
                    }
                }
            }
            yield prismaClient_1.default.warranty.update({ where: { id: w.id }, data: { alertSent: true } });
            notified++;
        }
        res.json({ message: `${notified} warranty expiry alerts sent`, count: notified });
    }
    catch (error) {
        console.error("checkWarrantyExpiry error:", error);
        res.status(500).json({ message: "Failed to check warranty expiry" });
    }
});
exports.checkWarrantyExpiry = checkWarrantyExpiry;
// ─── Check Insurance Expiry ──────────────────────────────────────────────────
const checkInsuranceExpiry = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const expiringPolicies = yield prismaClient_1.default.assetInsurance.findMany({
            where: {
                isActive: true,
                policyStatus: "ACTIVE",
                endDate: { gte: now, lte: thirtyDays },
            },
            include: {
                asset: { select: { assetId: true, assetName: true, departmentId: true } },
            },
        });
        let notified = 0;
        for (const p of expiringPolicies) {
            const daysLeft = Math.ceil((new Date(p.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            yield prismaClient_1.default.notification.create({
                data: {
                    type: "INSURANCE_EXPIRY",
                    title: "Insurance Policy Expiring Soon",
                    message: `Insurance policy ${p.policyNumber || ""} for ${p.asset.assetName} expires in ${daysLeft} days.`,
                    assetId: p.assetId,
                    insuranceId: p.id,
                    priority: daysLeft <= 7 ? "HIGH" : "MEDIUM",
                    dedupeKey: `insurance-expiry-${p.id}-${(_a = p.endDate) === null || _a === void 0 ? void 0 : _a.toISOString().split("T")[0]}`,
                },
            });
            notified++;
        }
        res.json({ message: `${notified} insurance expiry alerts sent`, count: notified });
    }
    catch (error) {
        console.error("checkInsuranceExpiry error:", error);
        res.status(500).json({ message: "Failed to check insurance expiry" });
    }
});
exports.checkInsuranceExpiry = checkInsuranceExpiry;
// ─── Check SLA Breach ────────────────────────────────────────────────────────
const checkSLABreach = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Find open tickets that have breached SLA
        const breachedTickets = yield prismaClient_1.default.ticket.findMany({
            where: {
                status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
                slaBreached: false,
                slaExpectedValue: { not: null },
            },
            include: {
                asset: { select: { assetId: true, assetName: true } },
                assignedTo: { select: { id: true, name: true, email: true } },
            },
        });
        const now = new Date();
        let breachCount = 0;
        for (const ticket of breachedTickets) {
            if (!ticket.slaExpectedValue || !ticket.slaExpectedUnit)
                continue;
            const createdAt = new Date(ticket.createdAt);
            let slaDeadline;
            const value = ticket.slaExpectedValue;
            const unit = ticket.slaExpectedUnit;
            if (unit === "HOURS") {
                slaDeadline = new Date(createdAt.getTime() + value * 60 * 60 * 1000);
            }
            else if (unit === "DAYS") {
                slaDeadline = new Date(createdAt.getTime() + value * 24 * 60 * 60 * 1000);
            }
            else {
                continue;
            }
            if (now > slaDeadline) {
                // Mark as breached
                yield prismaClient_1.default.ticket.update({
                    where: { id: ticket.id },
                    data: { slaBreached: true },
                });
                // Create notification
                const notif = yield prismaClient_1.default.notification.create({
                    data: {
                        type: "SLA_BREACH",
                        title: "SLA Breached",
                        message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} has breached SLA.`,
                        assetId: ticket.assetId,
                        ticketId: ticket.id,
                        priority: "CRITICAL",
                        dedupeKey: `sla-breach-${ticket.id}`,
                    },
                });
                // Notify assigned technician
                if (ticket.assignedTo) {
                    yield prismaClient_1.default.notificationRecipient.create({
                        data: { notificationId: notif.id, employeeId: ticket.assignedTo.id },
                    });
                    if (ticket.assignedTo.email) {
                        yield sendAlertEmail(ticket.assignedTo.email, `SLA Breached: Ticket ${ticket.ticketId}`, `<p>Ticket <strong>${ticket.ticketId}</strong> for <strong>${ticket.asset.assetName}</strong> has breached its SLA. Please resolve immediately.</p>`);
                    }
                }
                breachCount++;
            }
        }
        res.json({ message: `${breachCount} SLA breaches detected`, count: breachCount });
    }
    catch (error) {
        console.error("checkSLABreach error:", error);
        res.status(500).json({ message: "Failed to check SLA breach" });
    }
});
exports.checkSLABreach = checkSLABreach;
// ─── Check AMC/CMC Expiry ────────────────────────────────────────────────────
const checkContractExpiry = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const expiringContracts = yield prismaClient_1.default.serviceContract.findMany({
            where: {
                status: "ACTIVE",
                endDate: { gte: now, lte: thirtyDays },
            },
            include: {
                asset: { select: { assetId: true, assetName: true, departmentId: true } },
                vendor: { select: { name: true } },
            },
        });
        let notified = 0;
        for (const c of expiringContracts) {
            const daysLeft = Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            yield prismaClient_1.default.notification.create({
                data: {
                    type: "AMC_CMC_EXPIRY",
                    title: `${c.contractType} Contract Expiring`,
                    message: `${c.contractType} contract for ${c.asset.assetName} (vendor: ${((_a = c.vendor) === null || _a === void 0 ? void 0 : _a.name) || "N/A"}) expires in ${daysLeft} days.`,
                    assetId: c.assetId,
                    priority: daysLeft <= 7 ? "HIGH" : "MEDIUM",
                    dedupeKey: `contract-expiry-${c.id}-${c.endDate.toISOString().split("T")[0]}`,
                },
            });
            notified++;
        }
        res.json({ message: `${notified} contract expiry alerts sent`, count: notified });
    }
    catch (error) {
        console.error("checkContractExpiry error:", error);
        res.status(500).json({ message: "Failed to check contract expiry" });
    }
});
exports.checkContractExpiry = checkContractExpiry;
// ─── Asset Activation via Depreciation Start Date ───────────────────────────
// Logic: new assets start as IN_STORE. When their depreciation start date
// arrives (depreciationStart <= today), they are "put into service" → ACTIVE.
// Past assets already have their correct status set by the user — they won't
// be IN_STORE so this query will never touch them.
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
// ─── Run All Checks (single endpoint for cron) ──────────────────────────────
const runAllChecks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const results = {};
        // Run sequentially to avoid overwhelming the DB
        try {
            results.warranty = yield checkWarrantyExpiryInternal();
        }
        catch (e) {
            results.warranty = { error: true };
        }
        try {
            results.insurance = yield checkInsuranceExpiryInternal();
        }
        catch (e) {
            results.insurance = { error: true };
        }
        try {
            results.sla = yield checkSLABreachInternal();
        }
        catch (e) {
            results.sla = { error: true };
        }
        try {
            results.maintenanceSla = yield checkMaintenanceSLABreachInternal();
        }
        catch (e) {
            results.maintenanceSla = { error: true };
        }
        try {
            results.contract = yield checkContractExpiryInternal();
        }
        catch (e) {
            results.contract = { error: true };
        }
        try {
            results.assetActivation = yield checkAssetActivationInternal();
        }
        catch (e) {
            results.assetActivation = { error: true };
        }
        res.json({ message: "All checks completed", results });
    }
    catch (error) {
        console.error("runAllChecks error:", error);
        res.status(500).json({ message: "Failed to run checks" });
    }
});
exports.runAllChecks = runAllChecks;
// Internal versions that return data instead of sending response
function checkWarrantyExpiryInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const count = yield prismaClient_1.default.warranty.count({
            where: { isActive: true, isUnderWarranty: true, alertSent: false, warrantyEnd: { gte: now, lte: thirtyDays } },
        });
        return { type: "warranty", expiringCount: count };
    });
}
function checkInsuranceExpiryInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const count = yield prismaClient_1.default.assetInsurance.count({
            where: { isActive: true, policyStatus: "ACTIVE", endDate: { gte: now, lte: thirtyDays } },
        });
        return { type: "insurance", expiringCount: count };
    });
}
function checkSLABreachInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const count = yield prismaClient_1.default.ticket.count({
            where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] }, slaBreached: true },
        });
        return { type: "sla", breachedCount: count };
    });
}
// ─── Maintenance SLA Breach (internal helper) ────────────────────────────────
// Checks PreventiveChecklistRuns where scheduledDue is overdue beyond template.slaOverdueDays
function checkMaintenanceSLABreachInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const now = new Date();
        const overdueRuns = yield prismaClient_1.default.preventiveChecklistRun.findMany({
            where: {
                status: { in: ["DUE"] },
            },
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
                // Mark as overdue
                yield prismaClient_1.default.preventiveChecklistRun.update({
                    where: { id: run.id },
                    data: { status: "OVERDUE" },
                });
                // Create notification
                yield prismaClient_1.default.notification.upsert({
                    where: { dedupeKey: `pm-sla-breach-${run.id}` },
                    create: {
                        type: "SLA_BREACH",
                        title: "Preventive Maintenance Overdue",
                        message: `PM schedule "${template === null || template === void 0 ? void 0 : template.name}" for asset ${run.asset.assetName} is overdue by more than ${overdueDays} day(s).`,
                        assetId: run.asset.id,
                        priority: "HIGH",
                        dedupeKey: `pm-sla-breach-${run.id}`,
                    },
                    update: {},
                }).catch(() => null);
                breachCount++;
            }
        }
        return { type: "maintenanceSla", overdueCount: breachCount };
    });
}
// ─── Exported endpoint for maintenance SLA breach check ──────────────────────
const checkMaintenanceSLABreach = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield checkMaintenanceSLABreachInternal();
        res.json({ message: `${result.overdueCount} maintenance SLA breaches detected`, count: result.overdueCount });
    }
    catch (error) {
        console.error("checkMaintenanceSLABreach error:", error);
        res.status(500).json({ message: "Failed to check maintenance SLA breach" });
    }
});
exports.checkMaintenanceSLABreach = checkMaintenanceSLABreach;
function checkContractExpiryInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(now.getDate() + 30);
        const count = yield prismaClient_1.default.serviceContract.count({
            where: { status: "ACTIVE", endDate: { gte: now, lte: thirtyDays } },
        });
        return { type: "contract", expiringCount: count };
    });
}
// ─── Asset Activation Internal ───────────────────────────────────────────────
// Finds IN_STORE assets whose depreciationStart has arrived → marks them ACTIVE.
// Only touches assets that:
//   1. Are currently IN_STORE (past assets already have their real status)
//   2. Have a depreciation record configured (meaning they were deliberately commissioned)
//   3. depreciationStart <= today (the "put into service" date has been reached)
function checkAssetActivationInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date();
        today.setHours(23, 59, 59, 999); // include the full current day
        // Find all IN_STORE assets that have a depreciation record with depreciationStart <= today
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

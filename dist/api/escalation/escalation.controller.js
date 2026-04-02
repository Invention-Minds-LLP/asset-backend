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
exports.checkAndEscalateTickets = exports.triggerTicketEscalation = exports.getTicketEscalations = exports.bulkUpsertEscalationMatrix = exports.deleteEscalationRule = exports.updateEscalationRule = exports.getEscalationRuleById = exports.getAllEscalationRules = exports.createEscalationRule = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Escalation Matrix (Rules) ─────────────────────────────────────────────────
const createEscalationRule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, assetCategoryId, priority, level, escalateAfterValue, escalateAfterUnit, notifyRole, notifyEmployeeId, slaType, // INTERNAL | VENDOR | null (both)
        applicableTo, // TICKET | MAINTENANCE | null (both)
        vendorContactName, vendorContactEmail, vendorContactPhone, } = req.body;
        if (!priority || !level || !escalateAfterValue || !escalateAfterUnit) {
            res.status(400).json({ message: "priority, level, escalateAfterValue, escalateAfterUnit are required" });
            return;
        }
        const rule = yield prismaClient_1.default.escalationMatrix.create({
            data: {
                departmentId: departmentId ? Number(departmentId) : undefined,
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                priority,
                level: Number(level),
                escalateAfterValue: Number(escalateAfterValue),
                escalateAfterUnit,
                notifyRole,
                notifyEmployeeId: notifyEmployeeId ? Number(notifyEmployeeId) : undefined,
                slaType: slaType !== null && slaType !== void 0 ? slaType : null,
                applicableTo: applicableTo !== null && applicableTo !== void 0 ? applicableTo : null,
                vendorContactName: vendorContactName !== null && vendorContactName !== void 0 ? vendorContactName : null,
                vendorContactEmail: vendorContactEmail !== null && vendorContactEmail !== void 0 ? vendorContactEmail : null,
                vendorContactPhone: vendorContactPhone !== null && vendorContactPhone !== void 0 ? vendorContactPhone : null,
            },
            include: {
                department: { select: { name: true } },
                assetCategory: { select: { name: true } },
                notifyEmployee: { select: { name: true, employeeID: true } },
            },
        });
        res.status(201).json(rule);
    }
    catch (error) {
        console.error("createEscalationRule error:", error);
        res.status(500).json({ message: "Failed to create escalation rule" });
    }
});
exports.createEscalationRule = createEscalationRule;
const getAllEscalationRules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, assetCategoryId, priority, slaType, applicableTo } = req.query;
        const where = {};
        if (departmentId)
            where.departmentId = Number(departmentId);
        if (assetCategoryId)
            where.assetCategoryId = Number(assetCategoryId);
        if (priority)
            where.priority = String(priority);
        if (slaType)
            where.slaType = String(slaType);
        if (applicableTo)
            where.applicableTo = String(applicableTo);
        const rules = yield prismaClient_1.default.escalationMatrix.findMany({
            where,
            include: {
                department: { select: { name: true } },
                assetCategory: { select: { name: true } },
                notifyEmployee: { select: { name: true, employeeID: true } },
            },
            orderBy: [{ priority: "asc" }, { level: "asc" }],
        });
        res.json(rules);
    }
    catch (error) {
        console.error("getAllEscalationRules error:", error);
        res.status(500).json({ message: "Failed to fetch escalation rules" });
    }
});
exports.getAllEscalationRules = getAllEscalationRules;
const getEscalationRuleById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const rule = yield prismaClient_1.default.escalationMatrix.findUnique({
            where: { id },
            include: {
                department: { select: { name: true } },
                assetCategory: { select: { name: true } },
                notifyEmployee: { select: { name: true, employeeID: true } },
            },
        });
        if (!rule) {
            res.status(404).json({ message: "Rule not found" });
            return;
        }
        res.json(rule);
    }
    catch (error) {
        console.error("getEscalationRuleById error:", error);
        res.status(500).json({ message: "Failed to fetch escalation rule" });
    }
});
exports.getEscalationRuleById = getEscalationRuleById;
const updateEscalationRule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.escalationMatrix.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Rule not found" });
            return;
        }
        const updated = yield prismaClient_1.default.escalationMatrix.update({ where: { id }, data: req.body });
        res.json(updated);
    }
    catch (error) {
        console.error("updateEscalationRule error:", error);
        res.status(500).json({ message: "Failed to update escalation rule" });
    }
});
exports.updateEscalationRule = updateEscalationRule;
const deleteEscalationRule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const existing = yield prismaClient_1.default.escalationMatrix.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Rule not found" });
            return;
        }
        yield prismaClient_1.default.escalationMatrix.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteEscalationRule error:", error);
        res.status(500).json({ message: "Failed to delete escalation rule" });
    }
});
exports.deleteEscalationRule = deleteEscalationRule;
const bulkUpsertEscalationMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, assetCategoryId, priority, rules } = req.body;
        if (!(rules === null || rules === void 0 ? void 0 : rules.length) || !priority) {
            res.status(400).json({ message: "priority and rules array are required" });
            return;
        }
        // Delete existing rules for this scope + priority
        yield prismaClient_1.default.escalationMatrix.deleteMany({
            where: {
                departmentId: departmentId ? Number(departmentId) : undefined,
                assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                priority,
            },
        });
        const created = yield prismaClient_1.default.$transaction(rules.map((r) => {
            var _a, _b, _c, _d, _e;
            return prismaClient_1.default.escalationMatrix.create({
                data: {
                    departmentId: departmentId ? Number(departmentId) : undefined,
                    assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
                    priority,
                    level: Number(r.level),
                    escalateAfterValue: Number(r.escalateAfterValue),
                    escalateAfterUnit: r.escalateAfterUnit,
                    notifyRole: r.notifyRole,
                    notifyEmployeeId: r.notifyEmployeeId ? Number(r.notifyEmployeeId) : undefined,
                    slaType: (_a = r.slaType) !== null && _a !== void 0 ? _a : null,
                    applicableTo: (_b = r.applicableTo) !== null && _b !== void 0 ? _b : null,
                    vendorContactName: (_c = r.vendorContactName) !== null && _c !== void 0 ? _c : null,
                    vendorContactEmail: (_d = r.vendorContactEmail) !== null && _d !== void 0 ? _d : null,
                    vendorContactPhone: (_e = r.vendorContactPhone) !== null && _e !== void 0 ? _e : null,
                },
            });
        }));
        res.status(201).json(created);
    }
    catch (error) {
        console.error("bulkUpsertEscalationMatrix error:", error);
        res.status(500).json({ message: "Failed to save escalation matrix" });
    }
});
exports.bulkUpsertEscalationMatrix = bulkUpsertEscalationMatrix;
// ─── Ticket Escalations ────────────────────────────────────────────────────────
const getTicketEscalations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ticketId = parseInt(req.params.ticketId);
        const escalations = yield prismaClient_1.default.ticketEscalation.findMany({
            where: { ticketId },
            include: {
                notifiedEmployee: { select: { name: true, employeeID: true } },
            },
            orderBy: { escalatedAt: "asc" },
        });
        res.json(escalations);
    }
    catch (error) {
        console.error("getTicketEscalations error:", error);
        res.status(500).json({ message: "Failed to fetch ticket escalations" });
    }
});
exports.getTicketEscalations = getTicketEscalations;
const triggerTicketEscalation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ticketId = parseInt(req.params.ticketId);
        const { level, notifiedEmployeeId, message } = req.body;
        const ticket = yield prismaClient_1.default.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        const escalation = yield prismaClient_1.default.ticketEscalation.create({
            data: {
                ticketId,
                level: Number(level) || 1,
                notifiedEmployeeId: notifiedEmployeeId ? Number(notifiedEmployeeId) : undefined,
                message,
            },
            include: {
                notifiedEmployee: { select: { name: true, employeeID: true } },
            },
        });
        res.status(201).json(escalation);
    }
    catch (error) {
        console.error("triggerTicketEscalation error:", error);
        res.status(500).json({ message: "Failed to trigger escalation" });
    }
});
exports.triggerTicketEscalation = triggerTicketEscalation;
const checkAndEscalateTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const now = new Date();
        const openTickets = yield prismaClient_1.default.ticket.findMany({
            where: {
                status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
            },
            include: {
                department: true,
                asset: { include: { assetCategory: true } },
            },
        });
        const escalated = [];
        for (const ticket of openTickets) {
            const t = ticket;
            const createdAt = new Date(ticket.createdAt);
            function calcDeadline(value, unit) {
                if (!value || !unit)
                    return null;
                const d = new Date(createdAt);
                if (unit === "HOURS")
                    d.setHours(d.getHours() + value);
                else if (unit === "DAYS")
                    d.setDate(d.getDate() + value);
                else if (unit === "MINUTES")
                    d.setMinutes(d.getMinutes() + value);
                return d;
            }
            const internalDeadline = calcDeadline(t.internalSlaValue, t.internalSlaUnit);
            const vendorDeadline = calcDeadline(t.vendorSlaValue, t.vendorSlaUnit);
            const governingDeadline = calcDeadline(ticket.slaExpectedValue, ticket.slaExpectedUnit);
            const updateData = {};
            let breachOccurred = false;
            // Check internal SLA
            if (internalDeadline && now > internalDeadline && !ticket.slaBreached) {
                updateData.slaBreached = true;
                breachOccurred = true;
            }
            // Check vendor SLA separately
            if (vendorDeadline && now > vendorDeadline && !t.vendorSlaBreached) {
                updateData.vendorSlaBreached = true;
                breachOccurred = true;
                // Vendor-specific escalation rules
                const vendorRules = yield prismaClient_1.default.escalationMatrix.findMany({
                    where: {
                        priority: ticket.priority,
                        slaType: "VENDOR",
                        applicableTo: { in: ["TICKET", null] },
                        OR: [
                            { departmentId: ticket.departmentId },
                            { assetCategoryId: (_b = (_a = ticket.asset) === null || _a === void 0 ? void 0 : _a.assetCategoryId) !== null && _b !== void 0 ? _b : undefined },
                            { departmentId: null, assetCategoryId: null },
                        ],
                    },
                    orderBy: { level: "asc" },
                });
                for (const rule of vendorRules) {
                    yield prismaClient_1.default.ticketEscalation.create({
                        data: {
                            ticketId: ticket.id,
                            level: rule.level,
                            notifiedEmployeeId: (_c = rule.notifyEmployeeId) !== null && _c !== void 0 ? _c : undefined,
                            message: `[VENDOR SLA BREACH] Ticket ${ticket.ticketId}: vendor resolution SLA exceeded. Contact: ${(_d = rule.vendorContactName) !== null && _d !== void 0 ? _d : "vendor"}`,
                        },
                    });
                }
                // Notification for vendor SLA breach
                yield ((_f = (_e = prismaClient_1.default.notification).upsert) === null || _f === void 0 ? void 0 : _f.call(_e, {
                    where: { dedupeKey: `vendor-sla-breach-${ticket.id}` },
                    create: {
                        type: "SLA_BREACH",
                        title: "Vendor SLA Breached",
                        message: `Ticket ${ticket.ticketId} exceeded vendor contractual SLA.`,
                        priority: "HIGH",
                        ticketId: ticket.id,
                        dedupeKey: `vendor-sla-breach-${ticket.id}`,
                    },
                    update: {},
                }).catch(() => null));
            }
            // Check governing (internal) SLA breach for escalation
            if (governingDeadline && now > governingDeadline && !ticket.slaBreached) {
                updateData.slaBreached = true;
                breachOccurred = true;
                const internalRules = yield prismaClient_1.default.escalationMatrix.findMany({
                    where: {
                        priority: ticket.priority,
                        slaType: { in: ["INTERNAL", null] },
                        applicableTo: { in: ["TICKET", null] },
                        OR: [
                            { departmentId: ticket.departmentId },
                            { assetCategoryId: (_h = (_g = ticket.asset) === null || _g === void 0 ? void 0 : _g.assetCategoryId) !== null && _h !== void 0 ? _h : undefined },
                            { departmentId: null, assetCategoryId: null },
                        ],
                    },
                    orderBy: { level: "asc" },
                });
                for (const rule of internalRules) {
                    yield prismaClient_1.default.ticketEscalation.create({
                        data: {
                            ticketId: ticket.id,
                            level: rule.level,
                            notifiedEmployeeId: (_j = rule.notifyEmployeeId) !== null && _j !== void 0 ? _j : undefined,
                            message: `[INTERNAL SLA BREACH] Ticket ${ticket.ticketId}: internal resolution SLA exceeded`,
                        },
                    });
                }
                // Notification
                yield prismaClient_1.default.notification.upsert({
                    where: { dedupeKey: `sla-breach-${ticket.id}` },
                    create: {
                        type: "SLA_BREACH",
                        title: "SLA Breached",
                        message: `Ticket ${ticket.ticketId} for ${ticket.asset.assetName} has breached internal SLA.`,
                        priority: "HIGH",
                        ticketId: ticket.id,
                        dedupeKey: `sla-breach-${ticket.id}`,
                    },
                    update: {},
                });
            }
            if (Object.keys(updateData).length > 0) {
                yield prismaClient_1.default.ticket.update({ where: { id: ticket.id }, data: updateData });
            }
            if (breachOccurred)
                escalated.push(ticket.id);
        }
        res.json({ escalated: escalated.length, ticketIds: escalated });
    }
    catch (error) {
        console.error("checkAndEscalateTickets error:", error);
        res.status(500).json({ message: "Failed to check escalations" });
    }
});
exports.checkAndEscalateTickets = checkAndEscalateTickets;

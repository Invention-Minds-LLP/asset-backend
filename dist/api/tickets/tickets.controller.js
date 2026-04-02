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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCollectionNote = exports.completeTicketWork = exports.getPendingTransferApprovals = exports.resolveTicket = exports.holdTicket = exports.startWork = exports.getMyRaisedTickets = exports.getMyAssignedTickets = exports.getTransferHistory = exports.completeTicketTransfer = exports.rejectTicketTransfer = exports.approveTicketTransfer = exports.requestTicketTransfer = exports.uploadTicketImage = exports.deleteTicket = exports.getAssignmentHistory = exports.closeTicket = exports.terminateTicket = exports.reassignTicket = exports.assignTicket = exports.updateTicket = exports.updateTicketBasic = exports.createTicket = exports.getTicketById = exports.getAllTickets = exports.getTicketMetrics = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const basic_ftp_1 = require("basic-ftp");
/**
 * ✅ Keep secrets in env
 * .env:
 * FTP_HOST=...
 * FTP_USER=...
 * FTP_PASSWORD=...
 * FTP_SECURE=false
 * PUBLIC_TICKET_IMAGE_BASE=https://smartassets.inventionminds.com/ticket_images
 */
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
const PUBLIC_TICKET_IMAGE_BASE = process.env.PUBLIC_TICKET_IMAGE_BASE ||
    "https://smartassets.inventionminds.com/ticket_images";
function mustUser(req) {
    var _a;
    if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId))
        throw new Error("Unauthorized");
    return req.user;
}
function toMs(value, unit) {
    if (value == null)
        return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    const u = (unit || "").toUpperCase();
    switch (u) {
        case "MINUTE":
        case "MINUTES":
            return n * 60000;
        case "HOUR":
        case "HOURS":
            return n * 3600000;
        case "DAY":
        case "DAYS":
            return n * 86400000;
        case "MONTH":
        case "MONTHS":
            return n * 30 * 86400000;
        case "YEAR":
        case "YEARS":
            return n * 365 * 86400000;
        default:
            return 0;
    }
}
function buildStatusTat(historyAsc, endAt) {
    var _a;
    const byStatus = {};
    for (let i = 0; i < historyAsc.length; i++) {
        const cur = historyAsc[i];
        const next = historyAsc[i + 1];
        const stop = (_a = next === null || next === void 0 ? void 0 : next.changedAt) !== null && _a !== void 0 ? _a : endAt;
        const dur = Math.max(0, stop.getTime() - cur.changedAt.getTime());
        byStatus[cur.status] = (byStatus[cur.status] || 0) + dur;
    }
    return byStatus;
}
const getTicketMetrics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const ticketId = Number(req.params.id);
        if (!ticketId) {
            res.status(400).json({ message: "Invalid ticket id" });
            return;
        }
        const ticket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: ticketId },
            include: {
                statusHistory: { orderBy: { changedAt: "asc" }, select: { status: true, changedAt: true }, },
                // optional: vendor work orders (if you add relation)
                // vendorWorkOrders: { orderBy: { createdAt: "desc" } },
            },
        });
        if (!ticket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        // Choose "end time" for calculations:
        const endAt = (_b = (_a = ticket.closedAt) !== null && _a !== void 0 ? _a : ticket.slaResolvedAt) !== null && _b !== void 0 ? _b : new Date(); // still running
        const totalTatMs = Math.max(0, endAt.getTime() - ticket.createdAt.getTime());
        // SLA
        const slaMs = toMs(ticket.slaExpectedValue, ticket.slaExpectedUnit);
        // Resolved TAT comparison
        const resolvedAt = (_c = ticket.slaResolvedAt) !== null && _c !== void 0 ? _c : null;
        const resolvedTatMs = resolvedAt ? Math.max(0, resolvedAt.getTime() - ticket.createdAt.getTime()) : null;
        const breached = resolvedTatMs != null && slaMs > 0 ? resolvedTatMs > slaMs : null;
        // Status-wise TAT
        const byStatus = buildStatusTat(ticket.statusHistory, endAt);
        // Active time excluding ON_HOLD
        const onHoldMs = byStatus["ON_HOLD"] || 0;
        const activeTatMs = Math.max(0, totalTatMs - onHoldMs);
        // Vendor time (if exists)
        // We keep vendor time separate from ticket SLA (recommended).
        let vendorTatMs = null;
        const vwo = (_d = ticket === null || ticket === void 0 ? void 0 : ticket.vendorWorkOrders) === null || _d === void 0 ? void 0 : _d[0]; // latest
        if (vwo === null || vwo === void 0 ? void 0 : vwo.createdAt) {
            const vEnd = (_e = vwo.completedAt) !== null && _e !== void 0 ? _e : endAt;
            vendorTatMs = Math.max(0, new Date(vEnd).getTime() - new Date(vwo.createdAt).getTime());
        }
        res.json({
            ticketId: ticket.id,
            ticketCode: ticket.ticketId,
            status: ticket.status,
            createdAt: ticket.createdAt,
            endAt,
            sla: {
                value: (_f = ticket.slaExpectedValue) !== null && _f !== void 0 ? _f : null,
                unit: (_g = ticket.slaExpectedUnit) !== null && _g !== void 0 ? _g : null,
                ms: slaMs || null,
            },
            resolved: {
                resolvedAt,
                ms: resolvedTatMs,
                breached,
            },
            tat: {
                totalMs: totalTatMs,
                activeMs: activeTatMs,
            },
            byStatus, // ms per status
            vendor: {
                latestWorkOrderId: (_h = vwo === null || vwo === void 0 ? void 0 : vwo.id) !== null && _h !== void 0 ? _h : null,
                status: (_j = vwo === null || vwo === void 0 ? void 0 : vwo.status) !== null && _j !== void 0 ? _j : null,
                ms: vendorTatMs,
            },
        });
    }
    catch (e) {
        console.error("getTicketMetrics error:", e);
        res.status(500).json({ message: "Failed to compute metrics", error: e.message });
    }
});
exports.getTicketMetrics = getTicketMetrics;
function detectServiceType(tx, assetId) {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const warranty = yield tx.warranty.findFirst({
            where: {
                assetId,
                isActive: true,
            },
            orderBy: {
                warrantyEnd: 'desc',
            },
        });
        if ((warranty === null || warranty === void 0 ? void 0 : warranty.isUnderWarranty) && warranty.warrantyEnd >= now) {
            return "WARRANTY";
        }
        const contract = yield tx.serviceContract.findFirst({
            where: {
                assetId,
                status: "ACTIVE",
                startDate: { lte: now },
                endDate: { gte: now },
            },
            orderBy: {
                endDate: 'desc',
            },
        });
        if (contract)
            return contract.contractType; // AMC | CMC
        return "PAID";
    });
}
function requireAssetOrTicketDeptHod(user, ticketId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ticket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: ticketId },
            include: { asset: true },
        });
        if (!ticket)
            throw new Error("Ticket not found");
        const deptIds = [
            ticket.departmentId,
            (_a = ticket.asset) === null || _a === void 0 ? void 0 : _a.departmentId,
        ].filter(Boolean);
        if (deptIds.length === 0)
            throw new Error("No department found");
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: { id: user.employeeDbId, role: "HOD", departmentId: { in: deptIds } },
        });
        if (!hod)
            throw new Error("Only related HOD allowed");
        return ticket;
    });
}
function requireTicketDeptHod(user, ticketDbId) {
    return __awaiter(this, void 0, void 0, function* () {
        const ticket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: ticketDbId },
            include: { department: true },
        });
        if (!ticket)
            throw new Error("Ticket not found");
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: ticket.departmentId, role: "HOD" },
        });
        if (!hod || hod.id !== user.employeeDbId) {
            throw new Error("Only current ticket department HOD allowed");
        }
        return ticket;
    });
}
function getAssetDeptHod(assetId) {
    return __awaiter(this, void 0, void 0, function* () {
        const asset = yield prismaClient_1.default.asset.findUnique({ where: { id: assetId } });
        if (!(asset === null || asset === void 0 ? void 0 : asset.departmentId))
            return { asset, hod: null, supervisor: null };
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: asset.departmentId, role: "HOD" },
        });
        const supervisor = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: asset.departmentId, role: "SUPERVISOR" },
        });
        return { asset, hod, supervisor };
    });
}
function requireAssetDeptHod(user, ticketId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ticket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: ticketId },
            include: { asset: true },
        });
        if (!ticket)
            throw new Error("Ticket not found");
        if (!((_a = ticket.asset) === null || _a === void 0 ? void 0 : _a.departmentId))
            throw new Error("Asset department missing");
        const hod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: ticket.asset.departmentId, role: "HOD" },
        });
        console.log(hod, user.employeeDbId);
        if (!hod || hod.id !== user.employeeDbId)
            throw new Error("Only asset department HOD allowed");
        return ticket;
    });
}
/**
 * ✅ Status history helper (matches new schema)
 * TicketStatusHistory requires `changedBy` (string)
 * and you may optionally store changedById (FK) and note.
 */
function createStatusHistory(tx, args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        return tx.ticketStatusHistory.create({
            data: {
                ticketId: args.ticketDbId,
                status: args.status,
                changedBy: args.changedBy,
                changedById: (_a = args.changedById) !== null && _a !== void 0 ? _a : null,
                note: (_b = args.note) !== null && _b !== void 0 ? _b : null,
            },
        });
    });
}
const getAllTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId)) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const { role, employeeDbId } = req.user;
        const { exportCsv, search, status, priority } = req.query;
        // Build role-based where
        let where = {};
        if (role === "HOD") {
            const me = yield prismaClient_1.default.employee.findUnique({
                where: { id: employeeDbId },
                select: { departmentId: true },
            });
            if (!(me === null || me === void 0 ? void 0 : me.departmentId)) {
                res.json(exportCsv ? [] : []);
                return;
            }
            where.departmentId = me.departmentId;
        }
        else if (role !== "ADMIN") {
            where.OR = [{ assignedToId: employeeDbId }, { raisedById: employeeDbId }];
        }
        // Additional filters
        if (status)
            where.status = String(status);
        if (priority)
            where.priority = String(priority);
        if (search) {
            const searchFilter = [
                { ticketId: { contains: String(search) } },
                { detailedDesc: { contains: String(search) } },
                { issueType: { contains: String(search) } },
            ];
            if (where.OR) {
                // Combine role filter with search
                where = { AND: [{ OR: where.OR }, { OR: searchFilter }] };
            }
            else {
                where.OR = searchFilter;
            }
        }
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where,
            include: {
                asset: { select: { assetId: true, assetName: true } },
                department: { select: { name: true } },
                assignedTo: { select: { name: true, employeeID: true } },
                raisedBy: { select: { name: true, employeeID: true } },
            },
            orderBy: { id: "desc" },
        });
        if (exportCsv === "true") {
            const csvRows = tickets.map((t) => {
                var _a, _b, _c, _d, _e;
                return ({
                    TicketID: t.ticketId,
                    AssetID: ((_a = t.asset) === null || _a === void 0 ? void 0 : _a.assetId) || "",
                    AssetName: ((_b = t.asset) === null || _b === void 0 ? void 0 : _b.assetName) || "",
                    Department: ((_c = t.department) === null || _c === void 0 ? void 0 : _c.name) || "",
                    IssueType: t.issueType,
                    Priority: t.priority,
                    Status: t.status,
                    RaisedBy: ((_d = t.raisedBy) === null || _d === void 0 ? void 0 : _d.name) || "",
                    AssignedTo: ((_e = t.assignedTo) === null || _e === void 0 ? void 0 : _e.name) || "",
                    ServiceType: t.serviceType || "",
                    TotalCost: t.totalCost ? Number(t.totalCost) : "",
                    SLABreached: t.slaBreached ? "Yes" : "No",
                    RootCause: t.rootCause || "",
                    Resolution: t.resolutionSummary || "",
                    CreatedAt: t.createdAt ? new Date(t.createdAt).toISOString().split("T")[0] : "",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).map((v) => {
                const str = String(v !== null && v !== void 0 ? v : "").replace(/"/g, '""');
                return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
            }).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=tickets.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json(tickets);
    }
    catch (e) {
        res.status(500).json({ message: "Failed to fetch tickets", error: e.message });
    }
});
exports.getAllTickets = getAllTickets;
const getTicketById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ticketId = req.params.ticketId;
    const ticket = yield prismaClient_1.default.ticket.findUnique({
        where: { ticketId },
        include: {
            asset: true,
            department: true,
            assignedTo: true,
            raisedBy: true,
            statusHistory: {
                orderBy: { changedAt: "desc" },
                include: {
                    changedByEmployee: true, // ✅ updated schema relation name
                },
            },
            sparePartUsages: {
                include: { sparePart: true, usedBy: true },
                orderBy: { usedAt: "desc" },
            },
            ticketAssignmentHistories: {
                orderBy: { createdAt: "desc" },
                include: { fromEmployee: true, toEmployee: true, performedBy: true },
            },
        },
    });
    if (!ticket) {
        res.status(404).json({ message: "Ticket not found" });
        return;
    }
    res.json(ticket);
});
exports.getTicketById = getTicketById;
const createTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    try {
        const user = mustUser(req);
        const assetId = Number(req.body.assetId);
        if (!assetId) {
            res.status(400).json({ message: "assetId required" });
            ;
            return;
        }
        const { asset, hod, supervisor } = yield getAssetDeptHod(assetId);
        if (!asset) {
            res.status(400).json({ message: "Invalid assetId" });
            return;
        }
        if (!asset.departmentId) {
            res.status(400).json({ message: "Asset department not assigned" });
            return;
        }
        const departmentId = asset.departmentId;
        if (departmentId == null) {
            res.status(400).json({ message: "Asset department not assigned" });
            return;
        }
        // 1️⃣ FY
        const now = new Date();
        const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEndYear = fyStartYear + 1;
        const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;
        // 2️⃣ latest FY ticket
        const latestTicket = yield prismaClient_1.default.ticket.findFirst({
            where: { ticketId: { startsWith: `TKT-${fyString}` } },
            orderBy: { id: "desc" },
        });
        let nextNumber = 1;
        if (latestTicket) {
            const parts = latestTicket.ticketId.split("-");
            const lastSeq = parseInt(parts[3], 10);
            if (!isNaN(lastSeq))
                nextNumber = lastSeq + 1;
        }
        const newTicketId = `TKT-${fyString}-${nextNumber.toString().padStart(3, "0")}`;
        // const created = await prisma.$transaction(async (tx) => {
        //   const ticket = await tx.ticket.create({
        //     data: {
        //       ticketId: newTicketId,
        //       raisedBy: user.employeeDbId
        //         ? { connect: { id: user.employeeDbId } }
        //         : undefined,
        //       department: { connect: { id: departmentId } },
        //       asset: { connect: { id: assetId } },
        //       issueType: req.body.issueType,
        //       detailedDesc: req.body.detailedDesc,
        //       priority: req.body.priority,
        //       photoOfIssue: req.body.photoOfIssue ?? null,
        //       // ✅ location must be string (not null)
        //       location: req.body.location ?? asset.currentLocation ?? "UNKNOWN",
        //       status: "OPEN",
        //       // ✅ relation style instead of assignedToId/assignedById
        //       assignedTo: supervisor?.id
        //         ? { connect: { id: supervisor.id } }
        //         : undefined,
        //       assignedBy: supervisor?.id
        //         ? { connect: { id: hod?.id ?? user.employeeDbId } }
        //         : undefined,
        //       lastAssignedAt: supervisor?.id ? new Date() : null,
        //       assignmentNote: supervisor?.id
        //         ? "Auto-assigned to department supervisor"
        //         : null,
        //     },
        //   });
        //   await createStatusHistory(tx, {
        //     ticketDbId: ticket.id,
        //     status: ticket.status,
        //     changedBy: user.employeeID ?? user.name ?? "system",
        //     changedById: user.employeeDbId ?? null,
        //     note: "Ticket created",
        //   });
        //   if (supervisor?.id) {
        //     await tx.ticketAssignmentHistory.create({
        //       data: {
        //         ticketId: ticket.id,
        //         fromEmployeeId: null,
        //         toEmployeeId: supervisor.id,
        //         action: "ASSIGNED",
        //         comment: "Auto-assigned to supervisor on ticket creation",
        //         performedById: hod?.id ?? user.employeeDbId,
        //       },
        //     });
        //   }
        //   return ticket;
        // });
        // ── SLA Resolution ─────────────────────────────────────────────────────
        // 1. Internal SLA: from AssetSlaMatrix by asset category + ticket priority
        const priority = (req.body.priority || "MEDIUM").toUpperCase();
        const slaCategoryMap = {
            LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "HIGH",
        };
        const slaCategory = (_a = slaCategoryMap[priority]) !== null && _a !== void 0 ? _a : "MEDIUM";
        const internalSlaRow = asset.assetCategoryId
            ? yield prismaClient_1.default.assetSlaMatrix.findFirst({
                where: {
                    assetCategoryId: asset.assetCategoryId,
                    slaCategory,
                    isActive: true,
                },
                orderBy: { level: "asc" },
            })
            : null;
        const internalSlaValue = (_c = (_b = internalSlaRow === null || internalSlaRow === void 0 ? void 0 : internalSlaRow.resolutionTimeValue) !== null && _b !== void 0 ? _b : asset.slaResolutionValue) !== null && _c !== void 0 ? _c : null;
        const internalSlaUnit = (_e = (_d = internalSlaRow === null || internalSlaRow === void 0 ? void 0 : internalSlaRow.resolutionTimeUnit) !== null && _d !== void 0 ? _d : asset.slaResolutionUnit) !== null && _e !== void 0 ? _e : null;
        // 2. Vendor SLA: from active AMC/CMC service contract
        const activeContract = yield prismaClient_1.default.serviceContract.findFirst({
            where: {
                assetId,
                status: "ACTIVE",
                contractType: { in: ["AMC", "CMC"] },
                endDate: { gte: new Date() },
            },
            orderBy: { endDate: "asc" },
        });
        const vendorSlaValue = (_f = activeContract === null || activeContract === void 0 ? void 0 : activeContract.vendorResolutionValue) !== null && _f !== void 0 ? _f : null;
        const vendorSlaUnit = (_g = activeContract === null || activeContract === void 0 ? void 0 : activeContract.vendorResolutionUnit) !== null && _g !== void 0 ? _g : null;
        // 3. Governing SLA = strictest (smallest in hours), prefer vendor if set
        function toHours(val, unit) {
            if (!val || !unit)
                return Infinity;
            if (unit === "HOURS")
                return val;
            if (unit === "DAYS")
                return val * 24;
            if (unit === "MINUTES")
                return val / 60;
            return Infinity;
        }
        let slaExpectedValue = null;
        let slaExpectedUnit = null;
        let slaSource = null;
        const internalHrs = toHours(internalSlaValue, internalSlaUnit);
        const vendorHrs = toHours(vendorSlaValue, vendorSlaUnit);
        if (internalSlaValue && vendorSlaValue) {
            slaSource = "BOTH";
            // Use stricter (smaller) SLA as governing
            if (vendorHrs <= internalHrs) {
                slaExpectedValue = vendorSlaValue;
                slaExpectedUnit = vendorSlaUnit;
            }
            else {
                slaExpectedValue = internalSlaValue;
                slaExpectedUnit = internalSlaUnit;
            }
        }
        else if (vendorSlaValue) {
            slaSource = "VENDOR";
            slaExpectedValue = vendorSlaValue;
            slaExpectedUnit = vendorSlaUnit;
        }
        else if (internalSlaValue) {
            slaSource = "INTERNAL";
            slaExpectedValue = internalSlaValue;
            slaExpectedUnit = internalSlaUnit;
        }
        // ────────────────────────────────────────────────────────────────────────
        // 1) create ticket
        const created = yield prismaClient_1.default.ticket.create({
            data: {
                ticketId: newTicketId,
                raisedBy: user.employeeDbId ? { connect: { id: user.employeeDbId } } : undefined,
                department: { connect: { id: departmentId } },
                asset: { connect: { id: assetId } },
                issueType: req.body.issueType,
                detailedDesc: req.body.detailedDesc,
                priority: req.body.priority,
                photoOfIssue: (_h = req.body.photoOfIssue) !== null && _h !== void 0 ? _h : null,
                location: (_k = (_j = req.body.location) !== null && _j !== void 0 ? _j : asset.currentLocation) !== null && _k !== void 0 ? _k : "UNKNOWN",
                status: "OPEN",
                assignedTo: (supervisor === null || supervisor === void 0 ? void 0 : supervisor.id) ? { connect: { id: supervisor.id } } : undefined,
                assignedBy: (supervisor === null || supervisor === void 0 ? void 0 : supervisor.id) ? { connect: { id: (_l = hod === null || hod === void 0 ? void 0 : hod.id) !== null && _l !== void 0 ? _l : user.employeeDbId } } : undefined,
                lastAssignedAt: (supervisor === null || supervisor === void 0 ? void 0 : supervisor.id) ? new Date() : null,
                assignmentNote: (supervisor === null || supervisor === void 0 ? void 0 : supervisor.id) ? "Auto-assigned to department supervisor" : null,
                slaCategory,
                slaSource,
                slaExpectedValue,
                slaExpectedUnit,
                internalSlaValue,
                internalSlaUnit,
                vendorSlaValue,
                vendorSlaUnit,
                workCategory: (_m = req.body.workCategory) !== null && _m !== void 0 ? _m : null,
            },
        });
        // 2) status history
        yield prismaClient_1.default.ticketStatusHistory.create({
            data: {
                ticketId: created.id,
                status: created.status,
                changedBy: (_p = (_o = user.employeeID) !== null && _o !== void 0 ? _o : user.name) !== null && _p !== void 0 ? _p : "system",
                changedById: (_q = user.employeeDbId) !== null && _q !== void 0 ? _q : null,
                note: "Ticket created",
            },
        });
        // 3) assignment history
        if (supervisor === null || supervisor === void 0 ? void 0 : supervisor.id) {
            yield prismaClient_1.default.ticketAssignmentHistory.create({
                data: {
                    ticketId: created.id,
                    fromEmployeeId: null,
                    toEmployeeId: supervisor.id,
                    action: "ASSIGNED",
                    comment: "Auto-assigned to supervisor on ticket creation",
                    performedById: (_r = hod === null || hod === void 0 ? void 0 : hod.id) !== null && _r !== void 0 ? _r : user.employeeDbId,
                },
            });
        }
        // Notify HOD + Supervisor
        const notif = yield prismaClient_1.default.notification.create({
            data: {
                ticketId: created.id,
                assetId: asset.id,
                type: "OTHER",
                title: `New Ticket ${newTicketId}`,
                message: `Ticket raised for asset ${asset.assetId} - ${asset.assetName}`,
                priority: created.priority,
                dedupeKey: `TICKET_NEW_${created.id}_${new Date()}`,
                createdById: user.employeeDbId,
            },
        });
        const recipients = [hod === null || hod === void 0 ? void 0 : hod.id, supervisor === null || supervisor === void 0 ? void 0 : supervisor.id].filter(Boolean);
        yield prismaClient_1.default.notificationRecipient.createMany({
            data: recipients.map(empId => ({ notificationId: notif.id, employeeId: empId })),
            skipDuplicates: true,
        });
        res.status(201).json(created);
    }
    catch (error) {
        console.error("Error creating ticket:", error);
        res.status(500).json({ message: "Failed to create ticket" });
    }
});
exports.createTicket = createTicket;
const updateTicketBasic = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        mustUser(req);
        const id = Number(req.params.id);
        const allowed = {};
        if (req.body.detailedDesc != null)
            allowed.detailedDesc = req.body.detailedDesc;
        if (req.body.location != null)
            allowed.location = req.body.location;
        if (req.body.photoOfIssue != null)
            allowed.photoOfIssue = req.body.photoOfIssue;
        const updated = yield prismaClient_1.default.ticket.update({ where: { id }, data: allowed });
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to update ticket" });
    }
});
exports.updateTicketBasic = updateTicketBasic;
const updateTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const id = Number(req.params.id);
        const existingTicket = yield prismaClient_1.default.ticket.findUnique({ where: { id } });
        if (!existingTicket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        // ✅ disallow client to spoof createdBy/updatedBy; accept only safe fields
        const _a = req.body, { status } = _a, rest = __rest(_a, ["status"]);
        const updatedTicket = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const updated = yield tx.ticket.update({
                where: { id },
                data: Object.assign(Object.assign(Object.assign({}, rest), (status ? { status } : {})), { updatedById: user.employeeDbId }),
            });
            // If status changed, create status history
            if (status && status !== existingTicket.status) {
                yield createStatusHistory(tx, {
                    ticketDbId: updated.id,
                    status,
                    changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                    changedById: (_c = user.employeeDbId) !== null && _c !== void 0 ? _c : null,
                    note: (_d = req.body.note) !== null && _d !== void 0 ? _d : null,
                });
            }
            return updated;
        }));
        res.json(updatedTicket);
    }
    catch (error) {
        console.error("Error updating ticket:", error);
        res.status(500).json({ message: "Failed to update ticket" });
    }
});
exports.updateTicket = updateTicket;
// export const assignTicket = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const ticketId = Number(req.params.id);
//     const toEmployeeId = Number(req.body.toEmployeeId);
//     const comment = String(req.body.comment || "").trim();
//     if (!toEmployeeId) {
//       res.status(400).json({ message: "toEmployeeId required" });
//       return;
//     }
//     if (!comment) {
//       res.status(400).json({ message: "comment required" });
//       return;
//     }
//     const ticket = await requireAssetDeptHod(user, ticketId);
//     const updated = await prisma.$transaction(async (tx) => {
//       const upd = await tx.ticket.update({
//         where: { id: ticketId },
//         data: {
//           assignedTo: { connect: { id: toEmployeeId } },
//           assignedBy: { connect: { id: user.employeeDbId } },
//           lastAssignedAt: new Date(),
//           assignmentNote: comment,
//           status: "ASSIGNED",
//         },
//       });
//       await tx.ticketAssignmentHistory.create({
//         data: {
//           ticketId,
//           fromEmployeeId: ticket.assignedToId ?? null,
//           toEmployeeId,
//           action: "ASSIGNED",
//           comment,
//           performedById: user.employeeDbId,
//         },
//       });
//       await createStatusHistory(tx, {
//         ticketDbId: ticketId,
//         status: "ASSIGNED",
//         changedBy: user.employeeID ?? user.name ?? "system",
//         changedById: user.employeeDbId ?? null,
//         note: comment,
//       });
//       return upd;
//     });
//     res.json(updated);
//   } catch (e: any) {
//     res.status(400).json({ message: e.message || "Failed to assign" });
//   }
// };
const assignTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const toEmployeeId = Number(req.body.toEmployeeId);
        const comment = String(req.body.comment || "").trim();
        if (!toEmployeeId) {
            res.status(400).json({ message: "toEmployeeId required" });
            return;
        }
        if (!comment) {
            res.status(400).json({ message: "comment required" });
            return;
        }
        const ticket = yield requireAssetDeptHod(user, ticketId);
        // ✅ 1. Update ticket
        const updated = yield prismaClient_1.default.ticket.update({
            where: { id: ticketId },
            data: {
                assignedTo: { connect: { id: toEmployeeId } },
                assignedBy: { connect: { id: user.employeeDbId } },
                lastAssignedAt: new Date(),
                assignmentNote: comment,
                status: "ASSIGNED",
            },
        });
        // ✅ 2. Save assignment history
        yield prismaClient_1.default.ticketAssignmentHistory.create({
            data: {
                ticketId,
                fromEmployeeId: (_a = ticket.assignedToId) !== null && _a !== void 0 ? _a : null,
                toEmployeeId,
                action: "ASSIGNED",
                comment,
                performedById: user.employeeDbId,
            },
        });
        // ✅ 3. Save status history
        yield createStatusHistory(prismaClient_1.default, {
            ticketDbId: ticketId,
            status: "ASSIGNED",
            changedBy: (_c = (_b = user.employeeID) !== null && _b !== void 0 ? _b : user.name) !== null && _c !== void 0 ? _c : "system",
            changedById: (_d = user.employeeDbId) !== null && _d !== void 0 ? _d : null,
            note: comment,
        });
        res.json(updated);
        return;
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to assign" });
        return;
    }
});
exports.assignTicket = assignTicket;
const reassignTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const toEmployeeId = Number(req.body.toEmployeeId);
        const comment = String(req.body.comment || "").trim();
        if (!toEmployeeId) {
            res.status(400).json({ message: "toEmployeeId required" });
            return;
        }
        if (!comment) {
            res.status(400).json({ message: "comment required" });
            return;
        }
        const ticket = yield requireAssetOrTicketDeptHod(user, ticketId);
        if (((_a = ticket.reassignCount) !== null && _a !== void 0 ? _a : 0) >= 2) {
            res.status(400).json({ message: "Reassign limit reached (max 2)" });
            return;
        }
        const updated = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const upd = yield tx.ticket.update({
                where: { id: ticketId },
                data: {
                    reassignCount: { increment: 1 },
                    assignedTo: { connect: { id: toEmployeeId } },
                    assignedBy: { connect: { id: user.employeeDbId } },
                    lastAssignedAt: new Date(),
                    assignmentNote: comment,
                    status: "ASSIGNED",
                },
            });
            yield tx.ticketAssignmentHistory.create({
                data: {
                    ticketId,
                    fromEmployeeId: (_a = ticket.assignedToId) !== null && _a !== void 0 ? _a : null,
                    toEmployeeId,
                    action: "REASSIGNED",
                    comment,
                    performedById: user.employeeDbId,
                },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "ASSIGNED",
                changedBy: (_c = (_b = user.employeeID) !== null && _b !== void 0 ? _b : user.name) !== null && _c !== void 0 ? _c : "system",
                changedById: (_d = user.employeeDbId) !== null && _d !== void 0 ? _d : null,
                note: comment,
            });
            return upd;
        }));
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to reassign" });
    }
});
exports.reassignTicket = reassignTicket;
const terminateTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const note = String(req.body.note || "").trim();
        if (!note) {
            res.status(400).json({ message: "termination note required" });
            return;
        }
        yield requireAssetDeptHod(user, ticketId);
        const upd = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: {
                    status: "TERMINATED",
                    terminatedAt: new Date(),
                    terminatedById: user.employeeDbId,
                    terminationNote: note,
                },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "TERMINATED",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: (_c = user.employeeDbId) !== null && _c !== void 0 ? _c : null,
                note,
            });
            return u;
        }));
        res.json(upd);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to terminate" });
    }
});
exports.terminateTicket = terminateTicket;
const closeTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const remarks = String(req.body.remarks || "").trim();
        const ticket = yield prismaClient_1.default.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        if (ticket.raisedById !== user.employeeDbId) {
            res.status(403).json({ message: "Only raised person can close this ticket" });
            return;
        }
        if (ticket.status !== "RESOLVED" && ticket.status !== "TERMINATED") {
            res.status(400).json({
                message: "Ticket can be closed only after RESOLVED/TERMINATED",
            });
            return;
        }
        const upd = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: {
                    status: "CLOSED",
                    closedAt: new Date(),
                    closedById: user.employeeDbId,
                    closeRemarks: remarks || null,
                },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "CLOSED",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: (_c = user.employeeDbId) !== null && _c !== void 0 ? _c : null,
                note: remarks || null,
            });
            return u;
        }));
        res.json(upd);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to close" });
    }
});
exports.closeTicket = closeTicket;
const getAssignmentHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ticketId = Number(req.params.id);
    const rows = yield prismaClient_1.default.ticketAssignmentHistory.findMany({
        where: { ticketId },
        orderBy: { createdAt: "desc" },
        include: { fromEmployee: true, toEmployee: true, performedBy: true },
    });
    res.json(rows);
});
exports.getAssignmentHistory = getAssignmentHistory;
const deleteTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    yield prismaClient_1.default.ticket.delete({ where: { id } });
    res.status(204).send();
});
exports.deleteTicket = deleteTicket;
/** ===========================
 *  Upload Ticket Image (FTP)
 *  ===========================
 */
const TEMP_FOLDER = path_1.default.join(__dirname, "../../temp");
if (!fs_1.default.existsSync(TEMP_FOLDER))
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            const remoteDir = path_1.default.dirname(remoteFilePath);
            yield client.ensureDir(remoteDir);
            yield client.uploadFrom(localFilePath, remoteFilePath);
            yield client.close();
            const fileName = path_1.default.basename(remoteFilePath);
            return `${PUBLIC_TICKET_IMAGE_BASE}/${fileName}`;
        }
        catch (error) {
            console.error("FTP upload error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const uploadTicketImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        mustUser(req); // ✅ protect upload too
        const ticketId = req.params.ticketId;
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: false,
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const fileArr = files.file;
            if (!fileArr || fileArr.length === 0) {
                res.status(400).json({ error: "No image file uploaded." });
                return;
            }
            const file = fileArr[0];
            const tempFilePath = file.filepath;
            const originalFileName = file.originalFilename || `ticket-${Date.now()}.jpg`;
            if (!fs_1.default.existsSync(tempFilePath)) {
                res.status(500).json({ error: "Temporary image file not found." });
                return;
            }
            const remoteFilePath = `/public_html/smartassets/ticket_images/${originalFileName}`;
            try {
                const fileUrl = yield uploadToFTP(tempFilePath, remoteFilePath);
                yield prismaClient_1.default.ticket.update({
                    where: { ticketId },
                    data: { photoOfIssue: fileUrl },
                });
                fs_1.default.unlinkSync(tempFilePath);
                res.json({ url: fileUrl });
                return;
            }
            catch (uploadErr) {
                console.error("Ticket image upload failed:", uploadErr);
                res.status(500).json({ error: "Ticket image upload failed." });
                return;
            }
        }));
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: error.message });
        return;
    }
});
exports.uploadTicketImage = uploadTicketImage;
// export const requestTicketTransfer = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const ticketId = Number(req.params.id);
//     const { transferType, toDepartmentId, vendorId, comment, serviceCenterName, expectedReturnDate } = req.body;
//     if (!comment) {
//       res.status(400).json({ message: "comment is required" });
//       return;
//     }
//     const ticket = await prisma.ticket.findUnique({
//       where: { id: ticketId },
//     });
//     if (!ticket) {
//       res.status(404).json({ message: "Ticket not found" });
//       return;
//     }
//     const existingPending = await prisma.ticketTransferHistory.findFirst({
//       where: { ticketId, status: "REQUESTED" },
//       orderBy: { createdAt: "desc" },
//     });
//     if (existingPending) {
//       res.status(400).json({ message: "A transfer request is already pending for this ticket" });
//       return;
//     }
//     // EXTERNAL_VENDOR requires a vendor; EXTERNAL_SERVICE uses serviceCenterName instead
//     if (transferType === "EXTERNAL_VENDOR" && !vendorId) {
//       res.status(400).json({ message: "vendorId is required for EXTERNAL_VENDOR transfer" });
//       return;
//     }
//     if (transferType === "EXTERNAL_SERVICE" && !serviceCenterName) {
//       res.status(400).json({ message: "serviceCenterName is required for EXTERNAL_SERVICE transfer" });
//       return;
//     }
//     //  Get TARGET HOD
//     let targetHod: any = null;
//     if (transferType === "INTERNAL_DEPARTMENT" && toDepartmentId) {
//       targetHod = await prisma.employee.findFirst({
//         where: { departmentId: toDepartmentId, role: "HOD" },
//       });
//     }
//     // const result = await prisma.$transaction(async (tx) => {
//     //   const transfer = await tx.ticketTransferHistory.create({
//     //     data: {
//     //       ticketId,
//     //       transferType,
//     //       fromDepartmentId: ticket.departmentId,
//     //       toDepartmentId: transferType === "INTERNAL_DEPARTMENT" ? toDepartmentId : null,
//     //       vendorId: transferType !== "INTERNAL_DEPARTMENT" ? vendorId : null,
//     //       comment,
//     //       requestedById: user.employeeDbId,
//     //     },
//     //   });
//     //   // 🔔 Notify target HOD
//     //   if (targetHod?.id) {
//     //     await createNotificationWithRecipients(tx, {
//     //       title: "Ticket Transfer Request",
//     //       message: `Ticket ${ticket.ticketId} transfer requested`,
//     //       ticketId: ticket.id,
//     //       createdById: user.employeeDbId,
//     //       recipients: [targetHod.id],
//     //     });
//     //   }
//     //   return transfer;
//     // });
//     const result = await prisma.$transaction(async (tx) => {
//       const transfer = await tx.ticketTransferHistory.create({
//         data: {
//           ticketId,
//           transferType,
//           fromDepartmentId: ticket.departmentId,
//           toDepartmentId: transferType === "INTERNAL_DEPARTMENT" ? toDepartmentId : null,
//           vendorId: transferType === "EXTERNAL_VENDOR" ? vendorId : null,
//           serviceCenterName: transferType === "EXTERNAL_SERVICE" ? (serviceCenterName || null) : null,
//           expectedReturnDate: transferType === "EXTERNAL_SERVICE" && expectedReturnDate ? new Date(expectedReturnDate) : null,
//           comment,
//           requestedById: user.employeeDbId,
//           status: transferType === "INTERNAL_DEPARTMENT" ? "REQUESTED" : "APPROVED",
//           approvedById: transferType === "INTERNAL_DEPARTMENT" ? null : user.employeeDbId,
//         } as any,
//       });
//       // ✅ If EXTERNAL, update ticket + asset status immediately
//       if (transferType !== "INTERNAL_DEPARTMENT") {
//         const serviceType = await detectServiceType(tx, ticket.assetId);
//         await tx.ticket.update({
//           where: { id: ticketId },
//           data: {
//             status: "ON_HOLD",
//             serviceType,
//             assignmentNote: `Sent to external service (${serviceType})`,
//           },
//         });
//         await createStatusHistory(tx, {
//           ticketDbId: ticketId,
//           status: "ON_HOLD",
//           changedBy: user.employeeID ?? user.name ?? "system",
//           changedById: user.employeeDbId,
//           note: `External transfer approved (${serviceType}). ${comment}`,
//         });
//         // Auto-set asset status to UNDER_MAINTENANCE when sent to service center
//         await tx.asset.update({
//           where: { id: ticket.assetId },
//           data: { status: "UNDER_MAINTENANCE" },
//         });
//       }
//       // 🔔 Notify target HOD ONLY for internal
//       if (transferType === "INTERNAL_DEPARTMENT" && targetHod?.id) {
//         await createNotificationWithRecipients(tx, {
//           title: "Ticket Transfer Request",
//           message: `Ticket ${ticket.ticketId} transfer requested`,
//           ticketId: ticket.id,
//           createdById: user.employeeDbId,
//           recipients: [targetHod.id],
//         });
//       }
//       return transfer;
//     });
//     res.json({ message: "Transfer requested", result });
//   }
//   catch (err: any) {
//     console.error("requestTicketTransfer error:", err);
//     res.status(500).json({
//       message: "Failed to request transfer",
//       error: err?.message || err,
//     });
//   }
// };
// export const approveTicketTransfer = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const transferId = Number(req.params.transferId);
//     const transfer = await prisma.ticketTransferHistory.findUnique({
//       where: { id: transferId },
//     });
//     if (!transfer) {
//       res.status(404).json({ message: "Transfer not found" });
//       return;
//     }
//     if (!transfer.toDepartmentId) {
//       res.status(400).json({ message: "Transfer missing toDepartmentId" });
//       return;
//     }
//     // ✅ Get target HOD (only target HOD can approve)
//     const targetHod = await prisma.employee.findFirst({
//       where: { departmentId: transfer.toDepartmentId, role: "HOD" },
//     });
//     if (!targetHod || targetHod.id !== user.employeeDbId) {
//       res.status(403).json({ message: "Only target HOD can approve" });
//       return;
//     }
//     // ✅ Ensure transfer is still REQUESTED
//     if (transfer.status !== "REQUESTED") {
//       res.status(400).json({ message: `Transfer already ${transfer.status}` });
//       return;
//     }
//     const result = await prisma.$transaction(async (tx) => {
//       // 1) approve transfer row
//       const updatedTransfer = await tx.ticketTransferHistory.update({
//         where: { id: transferId },
//         data: {
//           status: "APPROVED",
//           approvedById: user.employeeDbId,
//         },
//       });
//       // 2) find ticket (for old assignedTo / ids)
//       const oldTicket = await tx.ticket.findUnique({
//         where: { id: transfer.ticketId },
//       });
//       if (!oldTicket) throw new Error("Ticket not found");
//       // 3) find target supervisor (auto assign)
//       const targetSupervisor = await tx.employee.findFirst({
//         where: { departmentId: transfer.toDepartmentId!, role: "SUPERVISOR" },
//       });
//       // 4) update ticket department + assign to target supervisor
//       const ticket = await tx.ticket.update({
//         where: { id: transfer.ticketId },
//         data: {
//           departmentId: transfer.toDepartmentId!,
//           isTransferred: true,
//           transferCount: { increment: 1 },
//           // ✅ move assignment to target dept supervisor
//           assignedToId: targetSupervisor?.id ?? null,
//           assignedById: user.employeeDbId,
//           lastAssignedAt: targetSupervisor?.id ? new Date() : null,
//           assignmentNote: "Auto assigned to target supervisor after transfer",
//           // ✅ status after transfer
//           status: "ASSIGNED",
//           // optional: reset reassign count after transfer
//           reassignCount: 0,
//         },
//       });
//       // 5) assignment history (if supervisor exists)
//       if (targetSupervisor?.id) {
//         await tx.ticketAssignmentHistory.create({
//           data: {
//             ticketId: ticket.id,
//             fromEmployeeId: oldTicket.assignedToId ?? null,
//             toEmployeeId: targetSupervisor.id,
//             action: "ASSIGNED",
//             comment: "Auto assigned after department transfer approval",
//             performedById: user.employeeDbId,
//           },
//         });
//       }
//       // 6) status history
//       await createStatusHistory(tx, {
//         ticketDbId: ticket.id,
//         status: "ASSIGNED",
//         changedBy: user.employeeID ?? user.name ?? "system",
//         changedById: user.employeeDbId ?? null,
//         note: "Ticket transferred and assigned to target department",
//       });
//       // 7) notify requester + source HOD (+ target supervisor optional)
//       const sourceHod = transfer.fromDepartmentId
//         ? await tx.employee.findFirst({
//           where: { departmentId: transfer.fromDepartmentId, role: "HOD" },
//         })
//         : null;
//       const recipients = [
//         transfer.requestedById,
//         sourceHod?.id,
//         targetSupervisor?.id, // optional notify new supervisor
//       ].filter(Boolean) as number[];
//       await createNotificationWithRecipients(tx, {
//         title: "Transfer Approved",
//         message: `Ticket ${ticket.ticketId} transfer approved and moved to new department`,
//         ticketId: ticket.id,
//         createdById: user.employeeDbId,
//         recipients,
//       });
//       return { updatedTransfer, ticket, targetSupervisor };
//     });
//     res.json({ message: "Transfer approved", result });
//   } catch (err: any) {
//     console.error("approveTicketTransfer error:", err);
//     res.status(500).json({ message: err.message || "Failed to approve transfer" });
//   }
// };
const requestTicketTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const { transferType, toDepartmentId, vendorId, comment, serviceCenterName, expectedReturnDate, } = req.body;
        if (!comment) {
            res.status(400).json({ message: "comment is required" });
            return;
        }
        const ticket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: ticketId },
        });
        if (!ticket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        const existingPending = yield prismaClient_1.default.ticketTransferHistory.findFirst({
            where: { ticketId, status: "REQUESTED" },
            orderBy: { createdAt: "desc" },
        });
        if (existingPending) {
            res.status(400).json({
                message: "A transfer request is already pending for this ticket",
            });
            return;
        }
        if (transferType === "EXTERNAL_VENDOR" && !vendorId) {
            res.status(400).json({
                message: "vendorId is required for EXTERNAL_VENDOR transfer",
            });
            return;
        }
        if (transferType === "EXTERNAL_SERVICE" && !serviceCenterName) {
            res.status(400).json({
                message: "serviceCenterName is required for EXTERNAL_SERVICE transfer",
            });
            return;
        }
        let targetHod = null;
        if (transferType === "INTERNAL_DEPARTMENT" && toDepartmentId) {
            targetHod = yield prismaClient_1.default.employee.findFirst({
                where: { departmentId: toDepartmentId, role: "HOD" },
            });
        }
        const transfer = yield prismaClient_1.default.ticketTransferHistory.create({
            data: {
                ticketId,
                transferType,
                fromDepartmentId: ticket.departmentId,
                toDepartmentId: transferType === "INTERNAL_DEPARTMENT" ? toDepartmentId : null,
                vendorId: transferType === "EXTERNAL_VENDOR" ? vendorId : null,
                serviceCenterName: transferType === "EXTERNAL_SERVICE" ? serviceCenterName || null : null,
                expectedReturnDate: transferType === "EXTERNAL_SERVICE" && expectedReturnDate
                    ? new Date(expectedReturnDate)
                    : null,
                comment,
                requestedById: user.employeeDbId,
                status: transferType === "INTERNAL_DEPARTMENT" ? "REQUESTED" : "APPROVED",
                approvedById: transferType === "INTERNAL_DEPARTMENT" ? null : user.employeeDbId,
            },
        });
        if (transferType !== "INTERNAL_DEPARTMENT") {
            const serviceType = yield detectServiceType(prismaClient_1.default, ticket.assetId);
            yield prismaClient_1.default.ticket.update({
                where: { id: ticketId },
                data: {
                    status: "ON_HOLD",
                    serviceType,
                    assignmentNote: `Sent to external service (${serviceType})`,
                },
            });
            yield createStatusHistory(prismaClient_1.default, {
                ticketDbId: ticketId,
                status: "ON_HOLD",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: user.employeeDbId,
                note: `External transfer approved (${serviceType}). ${comment}`,
            });
            yield prismaClient_1.default.asset.update({
                where: { id: ticket.assetId },
                data: { status: "UNDER_MAINTENANCE" },
            });
            // Auto-create and auto-approve asset transfer for external ticket transfers
            const destinationType = transferType === "EXTERNAL_VENDOR" ? "VENDOR" : "SERVICE_CENTER";
            const destinationName = transferType === "EXTERNAL_VENDOR"
                ? (_d = (_c = (yield prismaClient_1.default.vendor.findUnique({ where: { id: Number(vendorId) }, select: { name: true } }))) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null
                : serviceCenterName !== null && serviceCenterName !== void 0 ? serviceCenterName : null;
            yield prismaClient_1.default.assetTransferHistory.create({
                data: {
                    assetId: ticket.assetId,
                    transferType: "EXTERNAL",
                    externalType: "SERVICE",
                    destinationType,
                    destinationName,
                    temporary: true,
                    expiresAt: expectedReturnDate ? new Date(expectedReturnDate) : null,
                    status: "APPROVED",
                    requestedById: user.employeeDbId,
                    approvedById: user.employeeDbId,
                    transferDate: new Date(),
                },
            });
        }
        if (transferType === "INTERNAL_DEPARTMENT" && (targetHod === null || targetHod === void 0 ? void 0 : targetHod.id)) {
            yield createNotificationWithRecipients(prismaClient_1.default, {
                title: "Ticket Transfer Request",
                message: `Ticket ${ticket.ticketId} transfer requested`,
                ticketId: ticket.id,
                createdById: user.employeeDbId,
                recipients: [targetHod.id],
            });
        }
        res.json({ message: "Transfer requested", result: transfer });
    }
    catch (err) {
        console.error("requestTicketTransfer error:", err);
        res.status(500).json({
            message: "Failed to request transfer",
            error: (err === null || err === void 0 ? void 0 : err.message) || err,
        });
    }
});
exports.requestTicketTransfer = requestTicketTransfer;
const approveTicketTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const user = mustUser(req);
        const transferId = Number(req.params.transferId);
        const transfer = yield prismaClient_1.default.ticketTransferHistory.findUnique({
            where: { id: transferId },
        });
        if (!transfer) {
            res.status(404).json({ message: "Transfer not found" });
            return;
        }
        if (!transfer.toDepartmentId) {
            res.status(400).json({ message: "Transfer missing toDepartmentId" });
            return;
        }
        // Only target HOD can approve
        const targetHod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: transfer.toDepartmentId, role: "HOD" },
        });
        if (!targetHod || targetHod.id !== user.employeeDbId) {
            res.status(403).json({ message: "Only target HOD can approve" });
            return;
        }
        // 1) Approve transfer (guard: only if REQUESTED)
        const updatedTransfer = yield prismaClient_1.default.ticketTransferHistory.updateMany({
            where: { id: transferId, status: "REQUESTED" },
            data: { status: "APPROVED", approvedById: user.employeeDbId },
        });
        if (updatedTransfer.count === 0) {
            res.status(400).json({ message: "Transfer already processed (not REQUESTED)" });
            return;
        }
        // 2) Read ticket (for old assignedTo)
        const oldTicket = yield prismaClient_1.default.ticket.findUnique({ where: { id: transfer.ticketId } });
        if (!oldTicket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        // 3) Target supervisor
        const targetSupervisor = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: transfer.toDepartmentId, role: "SUPERVISOR" },
        });
        // 4) Update ticket
        const ticket = yield prismaClient_1.default.ticket.update({
            where: { id: transfer.ticketId },
            data: {
                departmentId: transfer.toDepartmentId,
                isTransferred: true,
                transferCount: { increment: 1 },
                assignedToId: (_a = targetSupervisor === null || targetSupervisor === void 0 ? void 0 : targetSupervisor.id) !== null && _a !== void 0 ? _a : null,
                assignedById: user.employeeDbId,
                lastAssignedAt: (targetSupervisor === null || targetSupervisor === void 0 ? void 0 : targetSupervisor.id) ? new Date() : null,
                assignmentNote: "Auto assigned to target supervisor after transfer",
                status: "ASSIGNED",
                reassignCount: 0,
            },
        });
        // 5) Auto-create approved asset transfer for internal department transfer
        yield prismaClient_1.default.assetTransferHistory.create({
            data: {
                assetId: oldTicket.assetId,
                transferType: "INTERNAL",
                fromDepartmentId: (_b = transfer.fromDepartmentId) !== null && _b !== void 0 ? _b : null,
                toDepartmentId: (_c = transfer.toDepartmentId) !== null && _c !== void 0 ? _c : null,
                temporary: false,
                status: "APPROVED",
                requestedById: (_d = transfer.requestedById) !== null && _d !== void 0 ? _d : null,
                approvedById: user.employeeDbId,
                transferDate: new Date(),
            },
        });
        // 6) Assignment history (optional)
        if (targetSupervisor === null || targetSupervisor === void 0 ? void 0 : targetSupervisor.id) {
            yield prismaClient_1.default.ticketAssignmentHistory.create({
                data: {
                    ticketId: ticket.id,
                    fromEmployeeId: (_e = oldTicket.assignedToId) !== null && _e !== void 0 ? _e : null,
                    toEmployeeId: targetSupervisor.id,
                    action: "ASSIGNED",
                    comment: "Auto assigned after department transfer approval",
                    performedById: user.employeeDbId,
                },
            });
        }
        // 7) Status history
        yield createStatusHistory(prismaClient_1.default, {
            ticketDbId: ticket.id,
            status: "ASSIGNED",
            changedBy: (_g = (_f = user.employeeID) !== null && _f !== void 0 ? _f : user.name) !== null && _g !== void 0 ? _g : "system",
            changedById: (_h = user.employeeDbId) !== null && _h !== void 0 ? _h : null,
            note: "Ticket transferred and assigned to target department",
        });
        // 8) Notify requester + source HOD + target supervisor
        const sourceHod = transfer.fromDepartmentId
            ? yield prismaClient_1.default.employee.findFirst({
                where: { departmentId: transfer.fromDepartmentId, role: "HOD" },
            })
            : null;
        const recipients = [
            transfer.requestedById,
            sourceHod === null || sourceHod === void 0 ? void 0 : sourceHod.id,
            targetSupervisor === null || targetSupervisor === void 0 ? void 0 : targetSupervisor.id,
        ].filter(Boolean);
        yield createNotificationWithRecipients(prismaClient_1.default, {
            title: "Transfer Approved",
            message: `Ticket ${ticket.ticketId} transfer approved and moved to new department`,
            ticketId: ticket.id,
            createdById: user.employeeDbId,
            recipients,
        });
        res.json({ message: "Transfer approved", ticket });
        return;
    }
    catch (err) {
        console.error("approveTicketTransfer error:", err);
        res.status(500).json({ message: err.message || "Failed to approve transfer" });
        return;
    }
});
exports.approveTicketTransfer = approveTicketTransfer;
// export const rejectTicketTransfer = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const transferId = Number(req.params.transferId);
//     const { reason } = req.body;
//     const transfer = await prisma.ticketTransferHistory.findUnique({
//       where: { id: transferId },
//     });
//     if (!transfer) {
//       res.status(404).json({ message: "Transfer not found" });
//       return;
//     }
//     //  Only target HOD can reject
//     const targetHod = await prisma.employee.findFirst({
//       where: {
//         departmentId: transfer.toDepartmentId!,
//         role: "HOD",
//       },
//     });
//     if (!targetHod || targetHod.id !== user.employeeDbId) {
//       res.status(403).json({ message: "Only target HOD can reject" });
//       return;
//     }
//     await prisma.$transaction(async (tx) => {
//       await tx.ticketTransferHistory.update({
//         where: { id: transferId },
//         data: {
//           status: "REJECTED",
//           approvedById: user.employeeDbId,
//           rejectionReason: reason,
//         },
//       });
//       // 🔔 Notify requester
//       await createNotificationWithRecipients(tx, {
//         title: "Transfer Rejected",
//         message: `Transfer rejected: ${reason || ""}`,
//         ticketId: transfer.ticketId,
//         createdById: user.employeeDbId,
//         recipients: [transfer.requestedById!],
//       });
//     });
//     res.json({ message: "Transfer rejected" });
//   } catch (err) {
//     res.status(500).json({ message: "Failed to reject transfer" });
//   }
// };
const rejectTicketTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const transferId = Number(req.params.transferId);
        const { reason } = req.body;
        const transfer = yield prismaClient_1.default.ticketTransferHistory.findUnique({
            where: { id: transferId },
        });
        if (!transfer) {
            res.status(404).json({ message: "Transfer not found" });
            return;
        }
        const targetHod = yield prismaClient_1.default.employee.findFirst({
            where: { departmentId: transfer.toDepartmentId, role: "HOD" },
        });
        if (!targetHod || targetHod.id !== user.employeeDbId) {
            res.status(403).json({ message: "Only target HOD can reject" });
            return;
        }
        // guard: only reject if REQUESTED
        const updated = yield prismaClient_1.default.ticketTransferHistory.updateMany({
            where: { id: transferId, status: "REQUESTED" },
            data: {
                status: "REJECTED",
                approvedById: user.employeeDbId,
                rejectionReason: reason !== null && reason !== void 0 ? reason : null,
            },
        });
        if (updated.count === 0) {
            res.status(400).json({ message: "Transfer already processed (not REQUESTED)" });
            return;
        }
        yield createNotificationWithRecipients(prismaClient_1.default, {
            title: "Transfer Rejected",
            message: `Transfer rejected${reason ? `: ${reason}` : ""}`,
            ticketId: transfer.ticketId,
            createdById: user.employeeDbId,
            recipients: transfer.requestedById ? [transfer.requestedById] : [],
        });
        res.json({ message: "Transfer rejected" });
        return;
    }
    catch (err) {
        console.error("rejectTicketTransfer error:", err);
        res.status(500).json({ message: err.message || "Failed to reject transfer" });
        return;
    }
});
exports.rejectTicketTransfer = rejectTicketTransfer;
const completeTicketTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const transferId = Number(req.params.transferId);
        yield prismaClient_1.default.ticketTransferHistory.update({
            where: { id: transferId },
            data: { status: "COMPLETED" },
        });
        res.json({ message: "Transfer completed" });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to complete transfer" });
    }
});
exports.completeTicketTransfer = completeTicketTransfer;
const getTransferHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ticketId = Number(req.params.id);
    const history = yield prismaClient_1.default.ticketTransferHistory.findMany({
        where: { ticketId },
        orderBy: { createdAt: "desc" },
        include: {
            fromDepartment: true,
            toDepartment: true,
            vendor: true,
            requestedBy: true,
            approvedBy: true,
        },
    });
    res.json(history);
});
exports.getTransferHistory = getTransferHistory;
function createNotificationWithRecipients(tx, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const notif = yield tx.notification.create({
            data: {
                title: data.title,
                message: data.message,
                ticketId: data.ticketId,
                assetId: data.assetId,
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
// GET /api/tickets/my-assigned
const getMyAssignedTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId)) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where: { assignedToId: employeeId },
            include: { asset: true, department: true, assignedTo: true, raisedBy: true },
            orderBy: { updatedAt: "desc" },
        });
        res.json(tickets);
    }
    catch (e) {
        res.status(500).json({ message: "Failed to fetch assigned tickets", error: e.message });
    }
});
exports.getMyAssignedTickets = getMyAssignedTickets;
// GET /api/tickets/my-raised
const getMyRaisedTickets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId)) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const employeeId = req.user.employeeDbId;
        const tickets = yield prismaClient_1.default.ticket.findMany({
            where: { raisedById: employeeId },
            include: { asset: true, department: true, assignedTo: true, raisedBy: true },
            orderBy: { updatedAt: "desc" },
        });
        res.json(tickets);
    }
    catch (e) {
        res.status(500).json({ message: "Failed to fetch raised tickets", error: e.message });
    }
});
exports.getMyRaisedTickets = getMyRaisedTickets;
function requireAssignedTo(user, ticketId) {
    return __awaiter(this, void 0, void 0, function* () {
        const ticket = yield prismaClient_1.default.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket)
            throw new Error("Ticket not found");
        if (ticket.assignedToId !== user.employeeDbId) {
            throw new Error("Only assigned person can perform this action");
        }
        return ticket;
    });
}
function requireRaisedBy(user, ticketId) {
    return __awaiter(this, void 0, void 0, function* () {
        const ticket = yield prismaClient_1.default.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket)
            throw new Error("Ticket not found");
        if (ticket.raisedById !== user.employeeDbId) {
            throw new Error("Only raised person can perform this action");
        }
        return ticket;
    });
}
function ensureStatus(ticket, allowed) {
    if (!allowed.includes(ticket.status)) {
        throw new Error(`Invalid status transition from ${ticket.status}`);
    }
}
const startWork = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const ticket = yield requireAssignedTo(user, ticketId);
        ensureStatus(ticket, ["ASSIGNED", "ON_HOLD"]);
        const upd = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: { status: "IN_PROGRESS" },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "IN_PROGRESS",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: user.employeeDbId,
                note: "Work started",
            });
            return u;
        }));
        res.json(upd);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to start work" });
    }
});
exports.startWork = startWork;
const holdTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const note = String(req.body.note || "").trim();
        const ticket = yield requireAssignedTo(user, ticketId);
        ensureStatus(ticket, ["ASSIGNED", "IN_PROGRESS"]);
        const upd = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: { status: "ON_HOLD" },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "ON_HOLD",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: user.employeeDbId,
                note: note || "On hold",
            });
            return u;
        }));
        res.json(upd);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to hold ticket" });
    }
});
exports.holdTicket = holdTicket;
// export const resolveTicket = async (req: any, res: Response) => {
//   try {
//     const user = mustUser(req);
//     const ticketId = Number(req.params.id);
//     const note = String(req.body.note || "").trim();
//     const ticket = await requireAssignedTo(user, ticketId);
//     ensureStatus(ticket, ["IN_PROGRESS", "ON_HOLD", "ASSIGNED"]);
//     const upd = await prisma.$transaction(async (tx) => {
//       const u = await tx.ticket.update({
//         where: { id: ticketId },
//         data: {
//           status: "RESOLVED",
//           slaResolvedAt: new Date(),
//         },
//       });
//       await createStatusHistory(tx, {
//         ticketDbId: ticketId,
//         status: "RESOLVED",
//         changedBy: user.employeeID ?? user.name ?? "system",
//         changedById: user.employeeDbId,
//         note: note || "Resolved",
//       });
//       return u;
//     });
//     res.json(upd);
//   } catch (e: any) {
//     res.status(403).json({ message: e.message || "Failed to resolve" });
//   }
// };
// GET /api/tickets/transfers/pending
const resolveTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const note = String(req.body.note || "").trim();
        const ticket = yield requireAssetOrTicketDeptHod(user, ticketId);
        ensureStatus(ticket, ["WORK_COMPLETED"]);
        const metricsTicket = yield prismaClient_1.default.ticket.findUnique({
            where: { id: ticketId }
        });
        if (!metricsTicket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        const now = new Date();
        const slaMs = toMs(metricsTicket.slaExpectedValue, metricsTicket.slaExpectedUnit);
        const resolvedTatMs = Math.max(0, now.getTime() - metricsTicket.createdAt.getTime());
        const breached = slaMs > 0 ? resolvedTatMs > slaMs : null;
        const upd = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: {
                    status: "RESOLVED",
                    slaResolvedAt: now,
                    slaBreached: breached,
                    closureRemarks: note || null,
                    approvedBy: user.name || user.employeeID || "HOD",
                },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "RESOLVED",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: user.employeeDbId,
                note: note || "Resolved by HOD after review",
            });
            return u;
        }));
        res.json(upd);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to resolve" });
    }
});
exports.resolveTicket = resolveTicket;
const getPendingTransferApprovals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const me = yield prismaClient_1.default.employee.findUnique({
            where: { id: user.employeeDbId },
            select: { departmentId: true, role: true },
        });
        if (!(me === null || me === void 0 ? void 0 : me.departmentId) || me.role !== "HOD") {
            res.json([]);
            return;
        }
        const rows = yield prismaClient_1.default.ticketTransferHistory.findMany({
            where: { status: "REQUESTED", toDepartmentId: me.departmentId },
            orderBy: { createdAt: "desc" },
            include: {
                ticket: { include: { asset: true, department: true, raisedBy: true, assignedTo: true } },
                fromDepartment: true,
                toDepartment: true,
                requestedBy: true,
            },
        });
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ message: "Failed to fetch pending transfers", error: e.message });
    }
});
exports.getPendingTransferApprovals = getPendingTransferApprovals;
const completeTicketWork = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const note = String(req.body.note || "").trim();
        const rootCause = String(req.body.rootCause || "").trim() || null;
        const resolutionSummary = String(req.body.resolutionSummary || "").trim() || null;
        if (!note) {
            res.status(400).json({ message: "Completion note required" });
            return;
        }
        const ticket = yield requireAssignedTo(user, ticketId);
        ensureStatus(ticket, ["IN_PROGRESS", "ON_HOLD"]);
        const upd = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: {
                    status: "WORK_COMPLETED",
                    closureRemarks: note,
                    rootCause: rootCause !== null && rootCause !== void 0 ? rootCause : undefined,
                    resolutionSummary: resolutionSummary !== null && resolutionSummary !== void 0 ? resolutionSummary : undefined,
                },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: "WORK_COMPLETED",
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: user.employeeDbId,
                note,
            });
            return u;
        }));
        res.json(upd);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to mark work completed" });
    }
});
exports.completeTicketWork = completeTicketWork;
// POST /api/tickets/:id/collection-note
// Ticket raiser records that supervisor collected the asset
const addCollectionNote = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const ticketId = Number(req.params.id);
        const ticket = yield prismaClient_1.default.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) {
            res.status(404).json({ message: "Ticket not found" });
            return;
        }
        // Only the raiser can log collection
        if (ticket.raisedById !== user.employeeDbId) {
            res.status(403).json({ message: "Only the ticket raiser can log collection" });
            return;
        }
        const { collectionNotes, collectionHandoverRemarks, collectedById } = req.body;
        const updated = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const u = yield tx.ticket.update({
                where: { id: ticketId },
                data: {
                    collectionNotes: collectionNotes !== null && collectionNotes !== void 0 ? collectionNotes : null,
                    collectionHandoverRemarks: collectionHandoverRemarks !== null && collectionHandoverRemarks !== void 0 ? collectionHandoverRemarks : null,
                    collectedAt: new Date(),
                    collectedById: collectedById ? Number(collectedById) : null,
                },
            });
            yield createStatusHistory(tx, {
                ticketDbId: ticketId,
                status: ticket.status,
                changedBy: (_b = (_a = user.employeeID) !== null && _a !== void 0 ? _a : user.name) !== null && _b !== void 0 ? _b : "system",
                changedById: user.employeeDbId,
                note: collectionNotes || "Asset collection logged by raiser",
            });
            return u;
        }));
        res.json(updated);
    }
    catch (e) {
        res.status(400).json({ message: e.message || "Failed to log collection note" });
    }
});
exports.addCollectionNote = addCollectionNote;

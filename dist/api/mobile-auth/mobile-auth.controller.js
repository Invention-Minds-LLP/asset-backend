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
exports.getMobileProfile = exports.mobileRaiseTicket = exports.getMobileAssetList = exports.getMobileDashboard = exports.mobileLogin = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";
// Mobile Login — returns token + user profile + assigned assets summary
const mobileLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        const { employeeId, password, deviceId, deviceType, pushToken } = req.body;
        if (!employeeId || !password) {
            res.status(400).json({ message: "Employee ID and password are required" });
            return;
        }
        const user = yield prismaClient_1.default.user.findUnique({
            where: { employeeID: employeeId },
            include: {
                employee: {
                    include: {
                        department: { select: { id: true, name: true } },
                    },
                },
            },
        });
        if (!user) {
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        const isValid = yield bcrypt_1.default.compare(password, user.passwordHash);
        if (!isValid) {
            // Log failed attempt
            yield prismaClient_1.default.loginHistory.create({
                data: { userId: user.id, success: false, ipAddress: req.ip, userAgent: req.headers["user-agent"] || "mobile" },
            });
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        // Generate token
        const token = jsonwebtoken_1.default.sign({
            userId: user.id,
            employeeID: user.employeeID,
            employeeDbId: (_a = user.employee) === null || _a === void 0 ? void 0 : _a.id,
            role: user.role,
            name: (_b = user.employee) === null || _b === void 0 ? void 0 : _b.name,
            departmentId: (_c = user.employee) === null || _c === void 0 ? void 0 : _c.departmentId,
        }, JWT_SECRET, { expiresIn: "30d" } // Mobile tokens last longer
        );
        // Update last login
        yield prismaClient_1.default.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        // Log successful login
        yield prismaClient_1.default.loginHistory.create({
            data: { userId: user.id, success: true, ipAddress: req.ip, userAgent: `mobile-${deviceType || "unknown"}` },
        });
        // Get summary counts for the user
        const employeeDbId = (_d = user.employee) === null || _d === void 0 ? void 0 : _d.id;
        const departmentId = (_e = user.employee) === null || _e === void 0 ? void 0 : _e.departmentId;
        const [myAssetsCount, myTicketsCount, pendingAckCount, unreadNotifs] = yield Promise.all([
            employeeDbId ? prismaClient_1.default.asset.count({ where: { allottedToId: employeeDbId } }) : Promise.resolve(0),
            employeeDbId ? prismaClient_1.default.ticket.count({ where: { raisedById: employeeDbId, status: { notIn: ["CLOSED", "RESOLVED"] } } }) : Promise.resolve(0),
            employeeDbId ? prismaClient_1.default.assetAssignment.count({ where: { assignedToId: employeeDbId, status: "PENDING", isActive: true } }) : Promise.resolve(0),
            employeeDbId ? prismaClient_1.default.notificationRecipient.count({ where: { employeeId: employeeDbId, isRead: false } }) : Promise.resolve(0),
        ]);
        res.json({
            token,
            user: {
                id: user.id,
                employeeID: user.employeeID,
                employeeDbId: (_f = user.employee) === null || _f === void 0 ? void 0 : _f.id,
                name: (_g = user.employee) === null || _g === void 0 ? void 0 : _g.name,
                email: (_h = user.employee) === null || _h === void 0 ? void 0 : _h.email,
                phone: (_j = user.employee) === null || _j === void 0 ? void 0 : _j.phone,
                designation: (_k = user.employee) === null || _k === void 0 ? void 0 : _k.designation,
                role: user.role,
                departmentId: (_l = user.employee) === null || _l === void 0 ? void 0 : _l.departmentId,
                departmentName: (_o = (_m = user.employee) === null || _m === void 0 ? void 0 : _m.department) === null || _o === void 0 ? void 0 : _o.name,
            },
            summary: {
                myAssets: myAssetsCount,
                openTickets: myTicketsCount,
                pendingAcknowledgements: pendingAckCount,
                unreadNotifications: unreadNotifs,
            },
        });
    }
    catch (error) {
        console.error("mobileLogin error:", error);
        res.status(500).json({ message: "Login failed" });
    }
});
exports.mobileLogin = mobileLogin;
// Get mobile dashboard data for current user
const getMobileDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const employeeDbId = user === null || user === void 0 ? void 0 : user.employeeDbId;
        if (!employeeDbId) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        // My assets
        const myAssets = yield prismaClient_1.default.asset.findMany({
            where: { allottedToId: employeeDbId },
            select: {
                id: true, assetId: true, assetName: true, status: true, assetPhoto: true,
                currentLocation: true, workingCondition: true,
                assetCategory: { select: { name: true } },
                department: { select: { name: true } },
            },
            orderBy: { assetName: "asc" },
            take: 50,
        });
        // My recent tickets
        const myTickets = yield prismaClient_1.default.ticket.findMany({
            where: { raisedById: employeeDbId },
            select: {
                id: true, ticketId: true, issueType: true, priority: true, status: true,
                createdAt: true,
                asset: { select: { assetId: true, assetName: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
        });
        // Pending acknowledgements
        const pendingAcks = yield prismaClient_1.default.assetAssignment.findMany({
            where: { assignedToId: employeeDbId, status: "PENDING", isActive: true },
            select: {
                id: true, assignedAt: true,
                asset: { select: { id: true, assetId: true, assetName: true, assetPhoto: true } },
            },
            orderBy: { assignedAt: "desc" },
        });
        // Recent notifications
        const notifications = yield prismaClient_1.default.notificationRecipient.findMany({
            where: { employeeId: employeeDbId },
            include: {
                notification: {
                    select: { id: true, type: true, title: true, message: true, createdAt: true },
                },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
        });
        res.json({
            myAssets,
            myTickets,
            pendingAcknowledgements: pendingAcks,
            notifications: notifications.map(n => ({
                id: n.notification.id,
                recipientId: n.id,
                type: n.notification.type,
                title: n.notification.title,
                message: n.notification.message,
                isRead: n.isRead,
                createdAt: n.notification.createdAt,
            })),
        });
    }
    catch (error) {
        console.error("getMobileDashboard error:", error);
        res.status(500).json({ message: "Failed to load dashboard" });
    }
});
exports.getMobileDashboard = getMobileDashboard;
// Get all assets for ticket creation (same as web — no role filter)
const getMobileAssetList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assets = yield prismaClient_1.default.asset.findMany({
            where: { status: { notIn: ["DISPOSED", "SCRAPPED"] } },
            select: {
                id: true, assetId: true, assetName: true, serialNumber: true,
                currentLocation: true, status: true,
                department: { select: { name: true } },
                assetCategory: { select: { name: true } },
            },
            orderBy: { assetName: "asc" },
        });
        res.json(assets);
    }
    catch (error) {
        res.status(500).json({ message: "Failed to load assets" });
    }
});
exports.getMobileAssetList = getMobileAssetList;
// Quick raise ticket from mobile
const mobileRaiseTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!(user === null || user === void 0 ? void 0 : user.employeeDbId)) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const { assetId, issueType, description, priority, location, photoUrl } = req.body;
        if (!assetId || !issueType || !description || !location) {
            res.status(400).json({ message: "assetId, issueType, description, and location are required" });
            return;
        }
        const asset = yield prismaClient_1.default.asset.findUnique({
            where: { id: Number(assetId) },
            select: { id: true, assetId: true, departmentId: true },
        });
        if (!asset) {
            res.status(404).json({ message: "Asset not found" });
            return;
        }
        // Generate ticket ID
        const now = new Date();
        const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyEnd = fyStart + 1;
        const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;
        const prefix = `TKT-${fyStr}-`;
        const latestTicket = yield prismaClient_1.default.ticket.findFirst({
            where: { ticketId: { startsWith: prefix } },
            orderBy: { id: "desc" },
        });
        let seq = 1;
        if (latestTicket) {
            const parts = latestTicket.ticketId.split("-");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last))
                seq = last + 1;
        }
        const ticketId = `${prefix}${seq.toString().padStart(5, "0")}`;
        const ticket = yield prismaClient_1.default.ticket.create({
            data: {
                ticketId,
                assetId: asset.id,
                departmentId: asset.departmentId || 1,
                raisedById: user.employeeDbId,
                issueType,
                detailedDesc: description,
                priority: priority || "MEDIUM",
                location,
                photoOfIssue: photoUrl || null,
                status: "OPEN",
                workCategory: "BREAKDOWN",
                createdById: user.employeeDbId,
            },
            include: {
                asset: { select: { assetId: true, assetName: true } },
            },
        });
        // Update asset status
        yield prismaClient_1.default.asset.update({
            where: { id: asset.id },
            data: { status: "UNDER_OBSERVATION" },
        });
        res.status(201).json(ticket);
    }
    catch (error) {
        console.error("mobileRaiseTicket error:", error);
        res.status(500).json({ message: "Failed to create ticket" });
    }
});
exports.mobileRaiseTicket = mobileRaiseTicket;
// Get user profile
const getMobileProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const employee = yield prismaClient_1.default.employee.findUnique({
            where: { id: user.employeeDbId },
            include: {
                department: { select: { name: true } },
            },
        });
        if (!employee) {
            res.status(404).json({ message: "Employee not found" });
            return;
        }
        res.json(Object.assign(Object.assign({}, employee), { role: user.role }));
    }
    catch (error) {
        res.status(500).json({ message: "Failed to load profile" });
    }
});
exports.getMobileProfile = getMobileProfile;

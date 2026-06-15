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
exports.completeMyAudit = exports.verifyMyAuditItem = exports.startMyAudit = exports.getMyAuditNextItem = exports.getMyAuditFloorMap = exports.getMyAuditById = exports.listMyAudits = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const auditMap_1 = require("../../utilis/auditMap");
// External auditor's scoped view onto audits. Every endpoint must funnel
// through requireAuditAccess() before reading/writing audit data — that's
// the one place to audit for scope leaks.
//
// Scope: an external auditor sees an audit iff their email appears on an
// AssetAuditor row (type=EXTERNAL) for that audit. AssetAuditor stores the
// email as a denormalized snapshot taken at audit-creation time, so a later
// rename in the ExternalAuditor master doesn't widen or narrow access.
// Returns null if the auditor has no access to the audit; otherwise returns
// the audit. Centralized here so every scoped endpoint shares one rule.
function requireAuditAccess(req, auditId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!Number.isFinite(auditId) || auditId <= 0)
            return null;
        const email = (_a = req.externalAuditor) === null || _a === void 0 ? void 0 : _a.email;
        if (!email)
            return null;
        const audit = yield prismaClient_1.default.assetAudit.findFirst({
            where: {
                id: auditId,
                auditors: { some: { type: "EXTERNAL", email } },
            },
        });
        return audit;
    });
}
// GET /api/mobile/external/audits
// Lists audits where this external auditor is assigned.
const listMyAudits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const email = (_a = req.externalAuditor) === null || _a === void 0 ? void 0 : _a.email;
        if (!email) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const audits = yield prismaClient_1.default.assetAudit.findMany({
            where: {
                auditors: { some: { type: "EXTERNAL", email } },
            },
            include: { auditors: true },
            orderBy: { createdAt: "desc" },
        });
        res.json({ data: audits });
    }
    catch (error) {
        console.error("external listMyAudits error:", error);
        res.status(500).json({ message: "Failed to load audits" });
    }
});
exports.listMyAudits = listMyAudits;
// GET /api/mobile/external/audits/:id
// Returns one audit + its items (asset detail joined) — only if assigned.
const getMyAuditById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const auditId = Number(req.params.id);
        const access = yield requireAuditAccess(req, auditId);
        if (!access) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        const audit = yield prismaClient_1.default.assetAudit.findUnique({
            where: { id: auditId },
            include: {
                items: { include: { asset: true } },
                auditors: true,
            },
        });
        res.json({ data: audit });
    }
    catch (error) {
        console.error("external getMyAuditById error:", error);
        res.status(500).json({ message: "Failed to load audit" });
    }
});
exports.getMyAuditById = getMyAuditById;
// GET /api/external-audit/audits/:id/floor-map — only if assigned.
const getMyAuditFloorMap = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const auditId = Number(req.params.id);
        const access = yield requireAuditAccess(req, auditId);
        if (!access) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        const result = yield (0, auditMap_1.buildAuditMap)(auditId);
        if (!result) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        const { audit, plan, placed, unplaced } = result;
        res.json({
            data: {
                auditId: audit.id,
                auditName: audit.auditName,
                status: audit.status,
                floor: (_a = audit.floor) !== null && _a !== void 0 ? _a : null,
                block: (_b = audit.block) !== null && _b !== void 0 ? _b : null,
                plan,
                placed,
                unplaced,
            },
        });
    }
    catch (error) {
        console.error("external getMyAuditFloorMap error:", error);
        res.status(500).json({ message: "Failed to load floor map" });
    }
});
exports.getMyAuditFloorMap = getMyAuditFloorMap;
// GET /api/external-audit/audits/:id/next-item?fromItemId= — only if assigned.
const getMyAuditNextItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const auditId = Number(req.params.id);
        const access = yield requireAuditAccess(req, auditId);
        if (!access) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        const result = yield (0, auditMap_1.buildAuditMap)(auditId);
        if (!result) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        const fromItemId = req.query.fromItemId ? Number(req.query.fromItemId) : null;
        res.json({ data: (0, auditMap_1.computeNextItem)(result.plan, result.placed, fromItemId) });
    }
    catch (error) {
        console.error("external getMyAuditNextItem error:", error);
        res.status(500).json({ message: "Failed to compute next item" });
    }
});
exports.getMyAuditNextItem = getMyAuditNextItem;
// PUT /api/mobile/external/audits/:id/start
const startMyAudit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const auditId = Number(req.params.id);
        const access = yield requireAuditAccess(req, auditId);
        if (!access) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        if (access.status !== "PLANNED") {
            res.status(400).json({ message: "Audit must be in PLANNED status to start" });
            return;
        }
        const updated = yield prismaClient_1.default.assetAudit.update({
            where: { id: auditId },
            data: { status: "IN_PROGRESS" },
        });
        res.json({ data: updated, message: "Audit started" });
    }
    catch (error) {
        console.error("external startMyAudit error:", error);
        res.status(500).json({ message: "Failed to start audit" });
    }
});
exports.startMyAudit = startMyAudit;
// PUT /api/mobile/external/audit-items/:itemId/verify
// External auditors verify items in audits they're assigned to. Same body /
// status semantics as the internal verifyItem. verifiedById stays null on
// these rows — there's no schema column today for verifiedByExternalAuditorId
// (worth a future schema add for full audit trail).
const verifyMyAuditItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId) || itemId <= 0) {
            res.status(400).json({ message: "Invalid item id" });
            return;
        }
        const { status, locationMatch, conditionMatch, actualLocation, actualCondition, remarks, } = req.body || {};
        if (!status || !["VERIFIED", "MISSING", "MISMATCH"].includes(status)) {
            res.status(400).json({ message: "status must be one of VERIFIED, MISSING, or MISMATCH" });
            return;
        }
        const item = yield prismaClient_1.default.assetAuditItem.findUnique({
            where: { id: itemId },
            select: { id: true, auditId: true },
        });
        if (!item) {
            res.status(404).json({ message: "Audit item not found" });
            return;
        }
        // Scope-gate: the item's audit must be one this auditor is assigned to.
        const access = yield requireAuditAccess(req, item.auditId);
        if (!access) {
            res.status(404).json({ message: "Audit item not found" });
            return;
        }
        const updated = yield prismaClient_1.default.assetAuditItem.update({
            where: { id: itemId },
            data: {
                status,
                scannedAt: new Date(),
                locationMatch: locationMatch != null ? locationMatch : null,
                conditionMatch: conditionMatch != null ? conditionMatch : null,
                actualLocation: actualLocation || null,
                actualCondition: actualCondition || null,
                remarks: remarks || null,
                // verifiedById stays null — external auditors aren't Users.
                // verifiedByExternalAuditorId carries the attribution instead.
                verifiedByExternalAuditorId: (_b = (_a = req.externalAuditor) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            },
        });
        res.json({ data: updated, message: "Audit item verified" });
    }
    catch (error) {
        console.error("external verifyMyAuditItem error:", error);
        res.status(500).json({ message: "Failed to verify item" });
    }
});
exports.verifyMyAuditItem = verifyMyAuditItem;
// PUT /api/mobile/external/audits/:id/complete
const completeMyAudit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const auditId = Number(req.params.id);
        const access = yield requireAuditAccess(req, auditId);
        if (!access) {
            res.status(404).json({ message: "Audit not found" });
            return;
        }
        if (access.status !== "IN_PROGRESS") {
            res.status(400).json({ message: "Audit must be in IN_PROGRESS status to complete" });
            return;
        }
        const items = yield prismaClient_1.default.assetAuditItem.findMany({
            where: { auditId },
        });
        const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
        const missingCount = items.filter((i) => i.status === "MISSING").length;
        const mismatchCount = items.filter((i) => i.status === "MISMATCH").length;
        const updated = yield prismaClient_1.default.assetAudit.update({
            where: { id: auditId },
            data: {
                status: "COMPLETED",
                completedAt: new Date(),
                verifiedCount,
                missingCount,
                mismatchCount,
            },
        });
        res.json({ data: updated, message: "Audit completed" });
    }
    catch (error) {
        console.error("external completeMyAudit error:", error);
        res.status(500).json({ message: "Failed to complete audit" });
    }
});
exports.completeMyAudit = completeMyAudit;

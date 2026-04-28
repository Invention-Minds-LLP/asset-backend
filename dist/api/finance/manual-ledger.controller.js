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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listManualLedger = listManualLedger;
exports.createManualLedger = createManualLedger;
exports.deleteManualLedger = deleteManualLedger;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function nextEntryNo() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const prefix = `MLE-${fy}-`;
        const last = yield prisma.manualLedgerEntry.findFirst({ where: { entryNo: { startsWith: prefix } }, orderBy: { entryNo: "desc" } });
        const seq = last ? parseInt(last.entryNo.split("-").pop() || "0") + 1 : 1;
        return `${prefix}${String(seq).padStart(4, "0")}`;
    });
}
// GET /api/finance/manual-ledger
function listManualLedger(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { from, to } = req.query;
        const where = {};
        if (from || to)
            where.entryDate = Object.assign(Object.assign({}, (from ? { gte: new Date(from) } : {})), (to ? { lte: new Date(to) } : {}));
        try {
            const entries = yield prisma.manualLedgerEntry.findMany({
                where,
                include: { createdBy: { select: { id: true, name: true } } },
                orderBy: { entryDate: "desc" },
            });
            res.json(entries);
        }
        catch (err) {
            res.status(500).json({ error: "Failed to load manual ledger" });
        }
    });
}
// POST /api/finance/manual-ledger
function createManualLedger(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const { entryDate, narration, amount, entryType, referenceNo, attachmentUrl } = req.body;
        if (!entryDate || !narration || !amount || !entryType) {
            res.status(400).json({ error: "entryDate, narration, amount, entryType are required" });
            return;
        }
        try {
            const entryNo = yield nextEntryNo();
            const entry = yield prisma.manualLedgerEntry.create({
                data: { entryNo, entryDate: new Date(entryDate), narration, amount, entryType, referenceNo: referenceNo || null, attachmentUrl: attachmentUrl || null, createdById: req.user.employeeDbId },
                include: { createdBy: { select: { id: true, name: true } } },
            });
            res.status(201).json(entry);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to create entry" });
        }
    });
}
// DELETE /api/finance/manual-ledger/:id
function deleteManualLedger(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        try {
            yield prisma.manualLedgerEntry.delete({ where: { id: Number(req.params.id) } });
            res.json({ message: "Deleted" });
        }
        catch (err) {
            res.status(500).json({ error: "Failed to delete entry" });
        }
    });
}

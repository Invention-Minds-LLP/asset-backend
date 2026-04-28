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
exports.listExportBatches = listExportBatches;
exports.createExportBatch = createExportBatch;
exports.downloadExportBatch = downloadExportBatch;
exports.getChartOfAccounts = getChartOfAccounts;
exports.updateExternalCodes = updateExternalCodes;
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
const prisma = new client_1.PrismaClient();
function nextBatchNo() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const prefix = `EXP-${fy}-`;
        const last = yield prisma.exportBatch.findFirst({ where: { batchNo: { startsWith: prefix } }, orderBy: { batchNo: "desc" } });
        const seq = last ? parseInt(last.batchNo.split("-").pop() || "0") + 1 : 1;
        return `${prefix}${String(seq).padStart(3, "0")}`;
    });
}
// GET /api/finance/export-batches
function listExportBatches(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const batches = yield prisma.exportBatch.findMany({
                include: { createdBy: { select: { id: true, name: true } }, _count: { select: { items: true } } },
                orderBy: { createdAt: "desc" },
                take: 50,
            });
            res.json(batches);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load export batches" });
        }
    });
}
// POST /api/finance/export-batches
function createExportBatch(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const { from, to, exportTarget } = req.body;
        if (!from || !to || !exportTarget) {
            res.status(400).json({ error: "from, to, exportTarget required" });
            return;
        }
        try {
            const vouchers = yield prisma.financeVoucher.findMany({
                where: { status: "POSTED", voucherDate: { gte: new Date(from), lte: new Date(to) } },
                select: { id: true, totalDebit: true },
            });
            if (!vouchers.length) {
                res.status(400).json({ error: "No posted vouchers in this date range" });
                return;
            }
            const batchNo = yield nextBatchNo();
            const totalAmount = vouchers.reduce((s, v) => s + Number(v.totalDebit), 0);
            const batch = yield prisma.exportBatch.create({
                data: {
                    batchNo,
                    exportTarget,
                    fromDate: new Date(from),
                    toDate: new Date(to),
                    totalVouchers: vouchers.length,
                    totalAmount,
                    status: "PENDING",
                    createdById: req.user.employeeDbId,
                    items: { create: vouchers.map((v) => ({ voucherId: v.id })) },
                },
                include: { _count: { select: { items: true } } },
            });
            res.status(201).json(batch);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to create export batch" });
        }
    });
}
// GET /api/finance/export-batches/:id/download
function downloadExportBatch(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const batchId = Number(req.params.id);
        try {
            const batch = yield prisma.exportBatch.findUnique({
                where: { id: batchId },
                include: {
                    items: {
                        include: {
                            voucher: {
                                include: {
                                    lines: { include: { account: true, costCentre: true } },
                                    department: true,
                                },
                            },
                        },
                    },
                },
            });
            if (!batch) {
                res.status(404).json({ error: "Batch not found" });
                return;
            }
            yield prisma.exportBatch.update({ where: { id: batchId }, data: { status: "PROCESSING" } });
            if (batch.exportTarget === "TALLY_PRIME_XML" || batch.exportTarget === "TALLY_ERP9_CSV") {
                const xml = generateTallyXML(batch);
                yield prisma.exportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
                res.setHeader("Content-Type", "application/xml");
                res.setHeader("Content-Disposition", `attachment; filename="${batch.batchNo}.xml"`);
                res.send(xml);
                return;
            }
            if (batch.exportTarget === "SAP_CSV") {
                const csv = generateSAPCSV(batch);
                yield prisma.exportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", `attachment; filename="${batch.batchNo}-SAP.csv"`);
                res.send(csv);
                return;
            }
            if (batch.exportTarget === "ZOHO_BOOKS") {
                const csv = generateZohoCSV(batch);
                yield prisma.exportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", `attachment; filename="${batch.batchNo}-Zoho.csv"`);
                res.send(csv);
                return;
            }
            // Default: Excel generic
            const workbook = yield generateExcelExport(batch);
            yield prisma.exportBatch.update({ where: { id: batchId }, data: { status: "DONE" } });
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename="${batch.batchNo}.xlsx"`);
            const buffer = yield workbook.xlsx.writeBuffer();
            res.send(buffer);
        }
        catch (err) {
            console.error(err);
            yield prisma.exportBatch.update({ where: { id: batchId }, data: { status: "FAILED", errorLog: String(err.message) } }).catch(() => { });
            res.status(500).json({ error: "Export failed" });
        }
    });
}
// ─── Tally Prime XML ─────────────────────────────────────────────────────────
function generateTallyXML(batch) {
    const fmt = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}${m}${day}`;
    };
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const vouchers = batch.items.map((item) => {
        const v = item.voucher;
        const drLines = v.lines.filter((l) => Number(l.debit) > 0);
        const crLines = v.lines.filter((l) => Number(l.credit) > 0);
        const allEntries = [
            ...drLines.map((l) => {
                var _a, _b;
                return `<ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${esc(((_a = l.account) === null || _a === void 0 ? void 0 : _a.tallyLedger) || ((_b = l.account) === null || _b === void 0 ? void 0 : _b.name))}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${Number(l.debit).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
            }),
            ...crLines.map((l) => {
                var _a, _b;
                return `<ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${esc(((_a = l.account) === null || _a === void 0 ? void 0 : _a.tallyLedger) || ((_b = l.account) === null || _b === void 0 ? void 0 : _b.name))}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${Number(l.credit).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
            }),
        ].join("\n");
        return `<VOUCHER VCHTYPE="Journal" ACTION="Create">
      <DATE>${fmt(new Date(v.voucherDate))}</DATE>
      <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${esc(v.voucherNo)}</VOUCHERNUMBER>
      <NARRATION>${esc(v.narration || "")}</NARRATION>
      ${allEntries}
    </VOUCHER>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>&#x04;</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          ${vouchers}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}
// ─── SAP CSV ─────────────────────────────────────────────────────────────────
function generateSAPCSV(batch) {
    var _a, _b, _c, _d;
    const rows = ["DocDate,DocType,PostKey,Account,Amount,Narration,Reference"];
    for (const item of batch.items) {
        const v = item.voucher;
        const date = new Date(v.voucherDate).toLocaleDateString("en-IN");
        for (const line of v.lines) {
            if (Number(line.debit) > 0) {
                rows.push(`${date},SA,40,${((_a = line.account) === null || _a === void 0 ? void 0 : _a.sapGlCode) || ((_b = line.account) === null || _b === void 0 ? void 0 : _b.code)},${Number(line.debit).toFixed(2)},"${line.narration || v.narration || ""}",${v.voucherNo}`);
            }
            if (Number(line.credit) > 0) {
                rows.push(`${date},SA,50,${((_c = line.account) === null || _c === void 0 ? void 0 : _c.sapGlCode) || ((_d = line.account) === null || _d === void 0 ? void 0 : _d.code)},${Number(line.credit).toFixed(2)},"${line.narration || v.narration || ""}",${v.voucherNo}`);
            }
        }
    }
    return rows.join("\n");
}
// ─── Zoho Books CSV ───────────────────────────────────────────────────────────
function generateZohoCSV(batch) {
    var _a, _b, _c;
    const rows = ["Date,JournalNo,Narration,Account,Account Type,Debit,Credit,Description"];
    for (const item of batch.items) {
        const v = item.voucher;
        const date = new Date(v.voucherDate).toLocaleDateString("en-IN");
        for (const line of v.lines) {
            rows.push(`${date},${v.voucherNo},"${v.narration || ""}","${((_a = line.account) === null || _a === void 0 ? void 0 : _a.zohoAccount) || ((_b = line.account) === null || _b === void 0 ? void 0 : _b.name)}","${(_c = line.account) === null || _c === void 0 ? void 0 : _c.type}",${Number(line.debit).toFixed(2)},${Number(line.credit).toFixed(2)},"${line.narration || ""}"`);
        }
    }
    return rows.join("\n");
}
// ─── Excel Export ─────────────────────────────────────────────────────────────
function generateExcelExport(batch) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const wb = new exceljs_1.default.Workbook();
        const ws = wb.addWorksheet("Vouchers");
        ws.columns = [
            { header: "Voucher No", key: "voucherNo", width: 18 },
            { header: "Date", key: "date", width: 14 },
            { header: "Narration", key: "narration", width: 30 },
            { header: "Account Code", key: "code", width: 14 },
            { header: "Account Name", key: "account", width: 28 },
            { header: "Debit", key: "debit", width: 14 },
            { header: "Credit", key: "credit", width: 14 },
            { header: "Cost Centre", key: "costCentre", width: 18 },
        ];
        const hRow = ws.getRow(1);
        hRow.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } };
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.alignment = { horizontal: "center" };
        });
        for (const item of batch.items) {
            const v = item.voucher;
            for (const line of v.lines) {
                ws.addRow({
                    voucherNo: v.voucherNo,
                    date: new Date(v.voucherDate).toLocaleDateString("en-IN"),
                    narration: v.narration || "",
                    code: ((_a = line.account) === null || _a === void 0 ? void 0 : _a.code) || "",
                    account: ((_b = line.account) === null || _b === void 0 ? void 0 : _b.name) || "",
                    debit: Number(line.debit) || "",
                    credit: Number(line.credit) || "",
                    costCentre: ((_c = line.costCentre) === null || _c === void 0 ? void 0 : _c.name) || "",
                });
            }
        }
        return wb;
    });
}
// GET /api/finance/chart-of-accounts
function getChartOfAccounts(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const accounts = yield prisma.chartOfAccount.findMany({
                where: { isActive: true },
                select: { id: true, code: true, name: true, type: true, subType: true, tallyLedger: true, sapGlCode: true, zohoAccount: true },
                orderBy: { code: "asc" },
            });
            res.json(accounts);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to load chart of accounts" });
        }
    });
}
// PUT /api/finance/chart-of-accounts/:id/external-codes
function updateExternalCodes(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!req.user || req.user.role !== "FINANCE") {
            res.status(403).json({ error: "FINANCE role required" });
            return;
        }
        const { tallyLedger, sapGlCode, zohoAccount } = req.body;
        try {
            const account = yield prisma.chartOfAccount.update({
                where: { id: Number(req.params.id) },
                data: { tallyLedger: tallyLedger || null, sapGlCode: sapGlCode || null, zohoAccount: zohoAccount || null },
            });
            res.json(account);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to update external codes" });
        }
    });
}

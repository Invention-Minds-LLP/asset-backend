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
exports.getRunPdf = exports.getRunById = exports.getRunsByAsset = exports.submitChecklistRun = exports.createChecklistRun = exports.getTemplates = exports.addChecklistItems = exports.createTemplate = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
function mustUser(req) {
    var _a;
    if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId))
        throw new Error("Unauthorized");
    return req.user;
}
/** =========================
 * 1. Create Checklist Template
 * ========================= */
const createTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        mustUser(req);
        const { name, description, assetCategoryId, assetId } = req.body;
        if (!name) {
            res.status(400).json({ message: "name required" });
            return;
        }
        const template = yield prismaClient_1.default.preventiveChecklistTemplate.create({
            data: {
                name,
                description,
                assetCategoryId: assetCategoryId !== null && assetCategoryId !== void 0 ? assetCategoryId : null,
                assetId: assetId !== null && assetId !== void 0 ? assetId : null,
            },
        });
        res.status(201).json(template);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createTemplate = createTemplate;
/** =========================
 * 2. Add Items to Template
 * ========================= */
const addChecklistItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        mustUser(req);
        const templateId = Number(req.params.templateId);
        const { items } = req.body;
        /**
         * items = [
         *   { title: "Check battery", description: "...", sortOrder: 1 },
         * ]
         */
        if (!items || !Array.isArray(items)) {
            res.status(400).json({ message: "items array required" });
            return;
        }
        const created = yield prismaClient_1.default.$transaction(items.map((item, index) => {
            var _a, _b;
            return prismaClient_1.default.preventiveChecklistItem.create({
                data: {
                    templateId,
                    title: item.title,
                    description: item.description,
                    sortOrder: (_a = item.sortOrder) !== null && _a !== void 0 ? _a : index,
                    isRequired: (_b = item.isRequired) !== null && _b !== void 0 ? _b : true,
                },
            });
        }));
        res.json(created);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.addChecklistItems = addChecklistItems;
/** =========================
 * 3. Get Templates
 * ========================= */
const getTemplates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = yield prismaClient_1.default.preventiveChecklistTemplate.findMany({
        include: {
            items: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
    res.json(data);
});
exports.getTemplates = getTemplates;
/** =========================
 * 4. Create Checklist Run (Assign to Asset)
 * ========================= */
const createChecklistRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const { assetId, templateId, scheduledDue } = req.body;
        if (!assetId || !templateId || !scheduledDue) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        const run = yield prismaClient_1.default.preventiveChecklistRun.create({
            data: {
                assetId,
                templateId,
                scheduledDue: new Date(scheduledDue),
                status: "DUE",
                createdAt: new Date(),
            },
        });
        res.status(201).json(run);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.createChecklistRun = createChecklistRun;
/** =========================
 * 5. Submit Checklist Results
 * ========================= */
const submitChecklistRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = mustUser(req);
        const runId = Number(req.params.runId);
        const { results } = req.body;
        /**
         * results = [
         *   { itemId: 1, result: "PASS", remarks: "...", photoProof: "url" }
         * ]
         */
        if (!results || !Array.isArray(results)) {
            res.status(400).json({ message: "results array required" });
            return;
        }
        const run = yield prismaClient_1.default.preventiveChecklistRun.findUnique({
            where: { id: runId },
        });
        if (!run) {
            res.status(404).json({ message: "Run not found" });
            return;
        }
        const updated = yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            // 1️⃣ Save results
            for (const r of results) {
                yield tx.preventiveChecklistResultRow.create({
                    data: {
                        runId,
                        itemId: r.itemId,
                        result: r.result,
                        remarks: (_a = r.remarks) !== null && _a !== void 0 ? _a : null,
                        photoProof: (_b = r.photoProof) !== null && _b !== void 0 ? _b : null,
                    },
                });
            }
            // 2️⃣ Update run status
            const updatedRun = yield tx.preventiveChecklistRun.update({
                where: { id: runId },
                data: {
                    status: "COMPLETED",
                    performedAt: new Date(),
                    performedById: user.employeeDbId,
                },
            });
            return updatedRun;
        }));
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.submitChecklistRun = submitChecklistRun;
/** =========================
 * 6. Get Runs by Asset
 * ========================= */
const getRunsByAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const assetId = Number(req.params.assetId);
    const runs = yield prismaClient_1.default.preventiveChecklistRun.findMany({
        where: { assetId },
        include: {
            template: true,
            results: {
                include: {
                    item: true,
                },
            },
        },
        orderBy: { scheduledDue: "desc" },
    });
    res.json(runs);
});
exports.getRunsByAsset = getRunsByAsset;
/** =========================
 * 7. Get Single Run
 * ========================= */
const getRunById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    const run = yield prismaClient_1.default.preventiveChecklistRun.findUnique({
        where: { id },
        include: {
            template: {
                include: { items: true },
            },
            results: true,
        },
    });
    if (!run) {
        res.status(404).json({ message: "Run not found" });
        return;
    }
    res.json(run);
});
exports.getRunById = getRunById;
/** =========================
 * 8. Get Run as printable HTML (PDF)
 * ========================= */
const getRunPdf = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const runId = Number(req.params.runId);
        const run = yield prismaClient_1.default.preventiveChecklistRun.findUnique({
            where: { id: runId },
            include: {
                template: { include: { items: { orderBy: { sortOrder: "asc" } } } },
                results: { include: { item: true } },
                asset: { select: { assetId: true, assetName: true, serialNumber: true, department: { select: { name: true } }, assetCategory: { select: { name: true } } } },
                performedBy: { select: { name: true, employeeID: true } },
            },
        });
        if (!run) {
            res.status(404).json({ message: "Run not found" });
            return;
        }
        // Build result map
        const resultMap = new Map(run.results.map(r => [r.itemId, r]));
        // Generate professional HTML
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PM Checklist — ${run.template.name}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 15px; margin-bottom: 20px; }
  .header-left h1 { font-size: 18px; color: #2563eb; margin-bottom: 4px; }
  .header-left p { font-size: 11px; color: #666; }
  .header-right { text-align: right; font-size: 11px; color: #666; }
  .header-right strong { color: #1a1a1a; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 16px; margin-bottom: 20px; padding: 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
  .info-item { font-size: 11px; }
  .info-item .label { color: #64748b; font-weight: 500; }
  .info-item .value { font-weight: 600; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 10px; text-align: left; border: 1px solid #e2e8f0; }
  td { padding: 8px 10px; border: 1px solid #e2e8f0; font-size: 11px; vertical-align: top; }
  tr:nth-child(even) { background: #fafbfc; }
  .result-pass { color: #16a34a; font-weight: 700; }
  .result-fail { color: #dc2626; font-weight: 700; }
  .result-na { color: #94a3b8; }
  .summary { display: flex; gap: 20px; padding: 12px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; margin-bottom: 20px; }
  .summary-item { text-align: center; }
  .summary-item .num { font-size: 20px; font-weight: 700; }
  .summary-item .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; }
  .summary-pass .num { color: #16a34a; }
  .summary-fail .num { color: #dc2626; }
  .summary-na .num { color: #94a3b8; }
  .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
  .signature-area { margin-top: 40px; display: flex; justify-content: space-between; }
  .signature-box { width: 200px; text-align: center; padding-top: 40px; border-top: 1px solid #333; font-size: 11px; }
  .print-btn { position: fixed; top: 10px; right: 10px; padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; z-index: 100; }
  .print-btn:hover { background: #1d4ed8; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

<div class="header">
  <div class="header-left">
    <h1>Preventive Maintenance Checklist</h1>
    <p>${run.template.name}${run.template.description ? ' — ' + run.template.description : ''}</p>
  </div>
  <div class="header-right">
    <div><strong>Run #${run.id}</strong></div>
    <div>Status: <strong>${run.status}</strong></div>
    <div>Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-item"><span class="label">Asset ID:</span> <span class="value">${((_a = run.asset) === null || _a === void 0 ? void 0 : _a.assetId) || '—'}</span></div>
  <div class="info-item"><span class="label">Asset Name:</span> <span class="value">${((_b = run.asset) === null || _b === void 0 ? void 0 : _b.assetName) || '—'}</span></div>
  <div class="info-item"><span class="label">Serial Number:</span> <span class="value">${((_c = run.asset) === null || _c === void 0 ? void 0 : _c.serialNumber) || '—'}</span></div>
  <div class="info-item"><span class="label">Category:</span> <span class="value">${((_e = (_d = run.asset) === null || _d === void 0 ? void 0 : _d.assetCategory) === null || _e === void 0 ? void 0 : _e.name) || '—'}</span></div>
  <div class="info-item"><span class="label">Department:</span> <span class="value">${((_g = (_f = run.asset) === null || _f === void 0 ? void 0 : _f.department) === null || _g === void 0 ? void 0 : _g.name) || '—'}</span></div>
  <div class="info-item"><span class="label">Scheduled Due:</span> <span class="value">${run.scheduledDue ? new Date(run.scheduledDue).toLocaleDateString('en-IN') : '—'}</span></div>
  <div class="info-item"><span class="label">Performed At:</span> <span class="value">${run.performedAt ? new Date(run.performedAt).toLocaleDateString('en-IN') : '—'}</span></div>
  <div class="info-item"><span class="label">Performed By:</span> <span class="value">${((_h = run.performedBy) === null || _h === void 0 ? void 0 : _h.name) || '—'} ${((_j = run.performedBy) === null || _j === void 0 ? void 0 : _j.employeeID) ? '(' + run.performedBy.employeeID + ')' : ''}</span></div>
</div>

<div class="summary">
  <div class="summary-item summary-pass"><div class="num">${run.results.filter(r => r.result === 'PASS').length}</div><div class="lbl">Pass</div></div>
  <div class="summary-item summary-fail"><div class="num">${run.results.filter(r => r.result === 'FAIL').length}</div><div class="lbl">Fail</div></div>
  <div class="summary-item summary-na"><div class="num">${run.results.filter(r => r.result === 'NA').length}</div><div class="lbl">N/A</div></div>
  <div class="summary-item"><div class="num">${run.template.items.length}</div><div class="lbl">Total Items</div></div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:40px">#</th>
      <th>Check Item</th>
      <th style="width:70px">Required</th>
      <th style="width:70px">Result</th>
      <th>Remarks</th>
    </tr>
  </thead>
  <tbody>
    ${run.template.items.map((item, idx) => {
            const result = resultMap.get(item.id);
            const resultClass = (result === null || result === void 0 ? void 0 : result.result) === 'PASS' ? 'result-pass' : (result === null || result === void 0 ? void 0 : result.result) === 'FAIL' ? 'result-fail' : 'result-na';
            return `<tr>
        <td>${idx + 1}</td>
        <td><strong>${item.title}</strong>${item.description ? '<br><span style="color:#64748b;font-size:10px">' + item.description + '</span>' : ''}</td>
        <td>${item.isRequired ? 'Yes' : 'No'}</td>
        <td class="${resultClass}">${(result === null || result === void 0 ? void 0 : result.result) || 'Not Done'}</td>
        <td>${(result === null || result === void 0 ? void 0 : result.remarks) || '—'}</td>
      </tr>`;
        }).join('\n')}
  </tbody>
</table>

<div class="signature-area">
  <div class="signature-box">Performed By</div>
  <div class="signature-box">Verified By</div>
  <div class="signature-box">Approved By</div>
</div>

<div class="footer">
  <span>Smart Assets — Preventive Maintenance Report</span>
  <span>Confidential</span>
</div>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    }
    catch (e) {
        res.status(500).json({ message: e.message });
    }
});
exports.getRunPdf = getRunPdf;

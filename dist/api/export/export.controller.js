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
exports.exportReport = void 0;
const xlsx_1 = __importDefault(require("xlsx"));
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ───────────────────────────────────────────────────────────────────────────
// Formatters
// ───────────────────────────────────────────────────────────────────────────
const fmt = (d) => d ? new Date(d).toISOString().split("T")[0] : "";
const fmtT = (d) => d ? new Date(d).toISOString().replace("T", " ").split(".")[0] : "";
const num = (v) => {
    if (v === null || v === undefined)
        return 0;
    if (typeof v === "number")
        return v;
    if (typeof v === "string")
        return Number(v) || 0;
    if (typeof v.toNumber === "function")
        return v.toNumber();
    return Number(v) || 0;
};
// Amounts are emitted as real numbers (not pre-formatted strings) so Excel
// SUM/pivots work; columns whose header contains "₹" get CURRENCY_FORMAT
// applied in buildSheet().
const money = (v) => Number(num(v).toFixed(2));
const MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const monthName = (m) => { var _a; return m ? ((_a = MONTH_NAMES[m]) !== null && _a !== void 0 ? _a : String(m)) : ""; };
const yn = (v) => (v === true ? "Yes" : v === false ? "No" : "");
// ───────────────────────────────────────────────────────────────────────────
// Indian Financial Year helpers
//   "2025-26" → { start: 2025-04-01, end: 2026-03-31 }
// ───────────────────────────────────────────────────────────────────────────
function parseFinancialYear(fy) {
    if (!fy)
        return null;
    const m = fy.match(/^(\d{4})[-/](\d{2,4})$/);
    if (!m)
        return null;
    const startYear = Number(m[1]);
    return {
        start: new Date(startYear, 3, 1), // 1 April
        end: new Date(startYear + 1, 2, 31, 23, 59, 59), // 31 March
    };
}
function fyLabelFromDate(d) {
    if (!d)
        return "";
    const dt = new Date(d);
    const y = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
    return `FY${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
function parseFilters(req) {
    var _a, _b;
    const q = req.query;
    const start = q.startDate ? new Date(String(q.startDate)) : null;
    const end = q.endDate ? new Date(String(q.endDate)) : null;
    if (end)
        end.setHours(23, 59, 59, 999);
    const fy = q.financialYear ? parseFinancialYear(String(q.financialYear)) : null;
    return {
        start,
        end,
        year: q.year ? Number(q.year) : null,
        month: q.month ? Number(q.month) : null,
        fyStart: (_a = fy === null || fy === void 0 ? void 0 : fy.start) !== null && _a !== void 0 ? _a : null,
        fyEnd: (_b = fy === null || fy === void 0 ? void 0 : fy.end) !== null && _b !== void 0 ? _b : null,
        fyLabel: q.financialYear ? String(q.financialYear) : null,
        assetCategoryId: q.assetCategoryId ? Number(q.assetCategoryId) : null,
        departmentId: q.departmentId ? Number(q.departmentId) : null,
        branchId: q.branchId ? Number(q.branchId) : null,
        vendorId: q.vendorId ? Number(q.vendorId) : null,
        assetType: q.assetType ? String(q.assetType) : null,
    };
}
// Build a Prisma `where` date range on the given field name from filters
function dateRangeOn(f) {
    // Priority: financialYear > year+month > startDate/endDate
    if (f.fyStart && f.fyEnd)
        return { gte: f.fyStart, lte: f.fyEnd };
    if (f.year && f.month) {
        const start = new Date(f.year, f.month - 1, 1);
        const end = new Date(f.year, f.month, 0, 23, 59, 59);
        return { gte: start, lte: end };
    }
    if (f.year) {
        return { gte: new Date(f.year, 0, 1), lte: new Date(f.year, 11, 31, 23, 59, 59) };
    }
    if (f.start && f.end)
        return { gte: f.start, lte: f.end };
    if (f.start)
        return { gte: f.start };
    if (f.end)
        return { lte: f.end };
    return undefined;
}
const CURRENCY_FORMAT = "#,##0.00";
// Column indexes whose header marks an amount column (contains "₹").
function currencyCols(headers) {
    return headers.map((h, i) => (h.includes("₹") ? i : -1)).filter(i => i >= 0);
}
// Shared sheet builder:
//   • cells in ₹-columns become typed numbers with CURRENCY_FORMAT so Excel
//     SUM / pivot tables work;
//   • when `total` is set, appends a blank spacer + TOTAL row summing every
//     ₹-column (non-numeric cells like "Unlimited" are ignored).
function buildSheet(headers, rows, total) {
    const curCols = currencyCols(headers);
    const dataRows = [...rows];
    if (total && curCols.length && rows.length) {
        const sums = new Map();
        for (const c of curCols) {
            let s = 0;
            for (const r of rows) {
                const v = r[c];
                if (typeof v === "number")
                    s += v;
            }
            sums.set(c, Number(s.toFixed(2)));
        }
        dataRows.push(new Array(headers.length).fill(""));
        dataRows.push(headers.map((_, i) => (i === 0 ? "TOTAL" : sums.has(i) ? sums.get(i) : "")));
    }
    const ws = xlsx_1.default.utils.aoa_to_sheet([headers, ...dataRows]);
    for (let r = 1; r <= dataRows.length; r++) {
        for (const c of curCols) {
            const cell = ws[xlsx_1.default.utils.encode_cell({ r, c })];
            if (cell && typeof cell.v === "number") {
                cell.t = "n";
                cell.z = CURRENCY_FORMAT;
            }
        }
    }
    return ws;
}
function sendExcel(res, filename, headers, rows, opts = {}) {
    const wb = xlsx_1.default.utils.book_new();
    const ws = buildSheet(headers, rows, opts.total);
    xlsx_1.default.utils.book_append_sheet(wb, ws, "Data");
    const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
}
// Numeric-aware export — keeps amount cells as real numbers (not strings) so SUM/
// pivot tables work, and applies an Indian-currency format string to the listed
// column indexes. Optional `colWidths` controls column widths in "wch" units.
function sendExcelTyped(res, filename, headers, rows, numericColIndexes = [], numberFormat = "#,##0.00", colWidths) {
    const wb = xlsx_1.default.utils.book_new();
    const ws = xlsx_1.default.utils.aoa_to_sheet([headers, ...rows]);
    const numericSet = new Set(numericColIndexes);
    // Row index 0 is the header. Data rows start at 1.
    for (let r = 1; r <= rows.length; r++) {
        for (const c of numericSet) {
            const ref = xlsx_1.default.utils.encode_cell({ r, c });
            const cell = ws[ref];
            if (cell && typeof cell.v === "number") {
                cell.t = "n";
                cell.z = numberFormat;
            }
        }
    }
    if (colWidths && colWidths.length) {
        ws["!cols"] = colWidths.map(w => ({ wch: w }));
    }
    xlsx_1.default.utils.book_append_sheet(wb, ws, "Data");
    const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
}
function sendMultiSheetExcel(res, filename, sheets) {
    const wb = xlsx_1.default.utils.book_new();
    for (const sheet of sheets) {
        const safeName = sheet.name.slice(0, 31); // Excel limit
        const ws = buildSheet(sheet.headers, sheet.rows, sheet.total);
        xlsx_1.default.utils.book_append_sheet(wb, ws, safeName);
    }
    const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
}
// ───────────────────────────────────────────────────────────────────────────
// Lookup maps — load once per request, used to resolve IDs to names
// ───────────────────────────────────────────────────────────────────────────
function getEmployeeMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prismaClient_1.default.employee.findMany({ select: { id: true, name: true, employeeID: true } });
        return new Map(rows.map(r => [r.id, `${r.name}${r.employeeID ? ` (${r.employeeID})` : ""}`]));
    });
}
function getDepartmentMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prismaClient_1.default.department.findMany({ select: { id: true, name: true } });
        return new Map(rows.map(r => [r.id, r.name]));
    });
}
function getBranchMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prismaClient_1.default.branch.findMany({ select: { id: true, name: true } });
        return new Map(rows.map(r => [r.id, r.name]));
    });
}
function getCategoryMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prismaClient_1.default.assetCategory.findMany({ select: { id: true, name: true } });
        return new Map(rows.map(r => [r.id, r.name]));
    });
}
function getVendorMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prismaClient_1.default.vendor.findMany({ select: { id: true, name: true } });
        return new Map(rows.map(r => [r.id, r.name]));
    });
}
// ───────────────────────────────────────────────────────────────────────────
// MAIN DISPATCHER
// ───────────────────────────────────────────────────────────────────────────
const exportReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16;
    const report = req.params.report;
    const f = parseFilters(req);
    try {
        switch (report) {
            // ═══════════════════════════════════════════════════════════════════
            // GROUP A — STATUTORY & AUDIT PACK
            // ═══════════════════════════════════════════════════════════════════
            // A1 — Companies Act Schedule II FA Register (category-wise)
            case "schedule-ii-fa-register": {
                const where = {};
                if (f.assetCategoryId)
                    where.assetCategoryId = f.assetCategoryId;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                if (f.branchId)
                    where.branchId = f.branchId;
                const [assets, categories, depLogs] = yield Promise.all([
                    prismaClient_1.default.asset.findMany({
                        where,
                        include: { assetCategory: true, depreciation: true },
                    }),
                    prismaClient_1.default.assetCategory.findMany({ select: { id: true, name: true } }),
                    f.fyStart && f.fyEnd
                        ? prismaClient_1.default.depreciationLog.findMany({
                            where: { periodStart: { gte: f.fyStart }, periodEnd: { lte: f.fyEnd } },
                        })
                        : prismaClient_1.default.depreciationLog.findMany(),
                ]);
                const depByAsset = new Map();
                for (const l of depLogs)
                    depByAsset.set(l.assetId, (depByAsset.get(l.assetId) || 0) + num(l.depreciationAmount));
                // Aggregate per category
                const agg = new Map();
                for (const c of categories) {
                    agg.set(c.id, {
                        name: c.name,
                        openingGross: 0, additions: 0, deletions: 0, closingGross: 0,
                        openingAcc: 0, depForPeriod: 0, closingAcc: 0, netBlock: 0,
                        count: 0,
                    });
                }
                for (const a of assets) {
                    const row = agg.get(a.assetCategoryId);
                    if (!row)
                        continue;
                    const cost = num((_b = (_a = a.purchaseCost) !== null && _a !== void 0 ? _a : a.estimatedValue) !== null && _b !== void 0 ? _b : 0);
                    const accDep = num((_d = (_c = a.depreciation) === null || _c === void 0 ? void 0 : _c.accumulatedDepreciation) !== null && _d !== void 0 ? _d : 0);
                    const bv = num((_f = (_e = a.depreciation) === null || _e === void 0 ? void 0 : _e.currentBookValue) !== null && _f !== void 0 ? _f : (cost - accDep));
                    const isAdditionInFy = f.fyStart && a.purchaseDate && new Date(a.purchaseDate) >= f.fyStart;
                    const isDisposed = ["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());
                    row.closingGross += cost;
                    if (isAdditionInFy)
                        row.additions += cost;
                    else
                        row.openingGross += cost;
                    if (isDisposed)
                        row.deletions += cost;
                    row.closingAcc += accDep;
                    row.depForPeriod += depByAsset.get(a.id) || 0;
                    row.openingAcc += Math.max(0, accDep - (depByAsset.get(a.id) || 0));
                    row.netBlock += bv;
                    row.count += 1;
                }
                const headers = [
                    "Category", "No. of Assets",
                    "Opening Gross Block (₹)", "Additions (₹)", "Deletions (₹)", "Closing Gross Block (₹)",
                    "Opening Accumulated Depreciation (₹)", "Depreciation for the Period (₹)", "Closing Accumulated Depreciation (₹)",
                    "Net Block (₹)",
                ];
                const rows = Array.from(agg.values())
                    .filter(r => r.count > 0)
                    .map(r => [
                    r.name, r.count,
                    money(r.openingGross), money(r.additions), money(r.deletions), money(r.closingGross),
                    money(r.openingAcc), money(r.depForPeriod), money(r.closingAcc), money(r.netBlock),
                ]);
                return sendExcel(res, `Schedule_II_FA_Register${f.fyLabel ? `_${f.fyLabel}` : ""}`, headers, rows, { total: true });
            }
            // A2 — IT Act FA Register (asset-wise, with depreciation method/rate)
            case "it-act-fa-register": {
                const where = {};
                if (f.assetCategoryId)
                    where.assetCategoryId = f.assetCategoryId;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                const assets = yield prismaClient_1.default.asset.findMany({
                    where,
                    include: { assetCategory: true, department: true, depreciation: true, vendor: true },
                });
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Department", "Location",
                    "Purchase Date", "Purchase Cost (₹)", "Vendor",
                    "Depreciation Method", "Depreciation Rate (%)", "Expected Life (Years)",
                    "Accumulated Depreciation (₹)", "Current Book Value (₹)", "Status",
                ];
                const rows = assets.map((a) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
                    return [
                        a.assetId, a.assetName,
                        (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = a.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        (_e = a.currentLocation) !== null && _e !== void 0 ? _e : "",
                        fmt(a.purchaseDate), money(a.purchaseCost),
                        (_g = (_f = a.vendor) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_j = (_h = a.depreciation) === null || _h === void 0 ? void 0 : _h.depreciationMethod) !== null && _j !== void 0 ? _j : "",
                        num((_k = a.depreciation) === null || _k === void 0 ? void 0 : _k.depreciationRate).toFixed(2),
                        (_m = (_l = a.depreciation) === null || _l === void 0 ? void 0 : _l.expectedLifeYears) !== null && _m !== void 0 ? _m : "",
                        money((_o = a.depreciation) === null || _o === void 0 ? void 0 : _o.accumulatedDepreciation),
                        money((_p = a.depreciation) === null || _p === void 0 ? void 0 : _p.currentBookValue),
                        (_q = a.status) !== null && _q !== void 0 ? _q : "",
                    ];
                });
                return sendExcel(res, "IT_Act_FA_Register", headers, rows, { total: true });
            }
            // A2.1 / A2.2 — CFO Fixed Asset Register (Tally-style 24-column, per-asset).
            //
            // Two report keys share the same compute path; they differ ONLY in whether
            // zero-activity rows are dropped:
            //   • cfo-fixed-asset-register          → Full register (Schedule II / year-end).
            //                                         Includes every legacy asset still on books.
            //   • cfo-fixed-asset-register-activity → Activity-only. Drops rows where
            //                                         Additions/Deletions/Period Dep/Acc Dep
            //                                         on Disposals are all zero in the window.
            //
            // Filter priority (highest specificity wins):
            //   1. ?startDate= and ?endDate=  → exact range, clamped to FY edges
            //   2. ?month=1..12               → that one month inside the FY
            //   3. ?financialYear=YYYY-YY     → whole FY
            //   4. (nothing)                   → current FY, whole year
            //
            // Other shared characteristics:
            //   • Gross "Net Change" is split → Additions | Deletions.
            //   • Dep   "Net Change" is split → Period Depreciation | Acc Dep on Disposals.
            //   • Amount cells are Numbers with #,##0.00 format so Excel SUM/pivots work.
            //   • Grand-total row appended at the bottom.
            case "cfo-fixed-asset-register":
            case "cfo-fixed-asset-register-activity": {
                const activityOnly = report === "cfo-fixed-asset-register-activity";
                // Default FY = current Indian FY if none supplied
                let fyStart = f.fyStart;
                let fyEnd = f.fyEnd;
                if (!fyStart || !fyEnd) {
                    const now = new Date();
                    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                    fyStart = new Date(startYear, 3, 1);
                    fyEnd = new Date(startYear + 1, 2, 31, 23, 59, 59);
                }
                const fyLabel = (_g = f.fyLabel) !== null && _g !== void 0 ? _g : `${fyStart.getFullYear()}-${String((fyStart.getFullYear() + 1) % 100).padStart(2, "0")}`;
                // ── Resolve the reporting window via the priority above ────────────
                const clampDown = (d) => d < fyStart ? fyStart : d > fyEnd ? fyEnd : d;
                let winStart;
                let winEnd;
                let periodKind;
                if (f.start && f.end) {
                    winStart = clampDown(new Date(f.start));
                    winEnd = clampDown(new Date(f.end));
                    periodKind = "range";
                }
                else if (f.month && f.month >= 1 && f.month <= 12) {
                    // Apr-Dec belong to FY's starting calendar year; Jan-Mar to the next.
                    const yr = f.month >= 4 ? fyStart.getFullYear() : fyStart.getFullYear() + 1;
                    winStart = new Date(yr, f.month - 1, 1);
                    winEnd = new Date(yr, f.month, 0, 23, 59, 59); // day 0 of next month = last day of this one
                    periodKind = "month";
                }
                else {
                    winStart = fyStart;
                    winEnd = fyEnd;
                    periodKind = "fullYear";
                }
                // ── Filename suffix that reflects exactly what was filtered ────────
                const monthShort = (d) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
                let periodLabel;
                if (periodKind === "range") {
                    periodLabel = `${monthShort(winStart)}${winStart.getDate().toString().padStart(2, "0")}-${monthShort(winEnd)}${winEnd.getDate().toString().padStart(2, "0")}`;
                }
                else if (periodKind === "month") {
                    periodLabel = `${monthShort(winStart)}${winStart.getFullYear()}`;
                }
                else {
                    periodLabel = "FullYear";
                }
                const assets = yield prismaClient_1.default.asset.findMany({
                    where: Object.assign(Object.assign({}, (f.assetCategoryId ? { assetCategoryId: f.assetCategoryId } : {})), { OR: [
                            { purchaseDate: { lte: winEnd } },
                            { donationDate: { lte: winEnd } },
                        ] }),
                    select: {
                        id: true,
                        assetId: true,
                        assetName: true,
                        currentLocation: true,
                        serialNumber: true,
                        invoiceNumber: true,
                        purchaseVoucherNo: true,
                        purchaseCost: true,
                        purchaseDate: true,
                        donationDate: true,
                        estimatedValue: true,
                        modeOfProcurement: true,
                        disposalDate: true,
                        status: true,
                        vendor: { select: { name: true } },
                        assetCategory: {
                            select: {
                                name: true,
                                glMapping: {
                                    select: {
                                        fixedAssetAccount: { select: { code: true, name: true } },
                                        accDepAccount: { select: { code: true, name: true } },
                                    },
                                },
                            },
                        },
                        depreciation: {
                            select: {
                                depreciationMethod: true,
                                depreciationRate: true,
                                expectedLifeYears: true,
                                depreciationStart: true,
                            },
                        },
                    },
                    orderBy: [{ assetCategory: { name: "asc" } }, { purchaseDate: "asc" }, { id: "asc" }],
                });
                const allLogs = yield prismaClient_1.default.depreciationLog.findMany({
                    where: {
                        assetId: { in: assets.map(a => a.id) },
                        periodEnd: { lte: winEnd },
                    },
                    select: { assetId: true, periodEnd: true, depreciationAmount: true },
                });
                const logsByAsset = new Map();
                for (const l of allLogs) {
                    const arr = (_h = logsByAsset.get(l.assetId)) !== null && _h !== void 0 ? _h : [];
                    arr.push(l);
                    logsByAsset.set(l.assetId, arr);
                }
                const methodLabel = (m) => {
                    if (m === "SL")
                        return "Straight-Line";
                    if (m === "DB")
                        return "Diminishing Balance";
                    return m || "";
                };
                const headers = [
                    "No.", // 0
                    "Asset ID", // 1
                    "Description", // 2
                    "Category", // 3
                    "Location", // 4
                    "Last Acquisition Cost Date", // 5
                    "Last Depreciation Date", // 6
                    "Acquisition Cost before Starting Date", // 7   ← opening gross
                    "Additions during Period", // 8
                    "Deletions during Period", // 9
                    "Acquisition Cost at Ending Date", // 10  ← closing gross
                    "Depreciation before Starting Date", // 11  ← opening dep
                    "Depreciation for the Period", // 12
                    "Acc. Depreciation on Disposals", // 13
                    "Depreciation at Ending Date", // 14  ← closing dep
                    "Book Value before Starting Date", // 15
                    "Book Value Net Change", // 16
                    "Book Value at Ending Date", // 17
                    "Acquisition Cost Account", // 18
                    "Accum. Depreciation Account", // 19
                    "Depreciation Starting Date", // 20
                    "Depreciation Ending Date", // 21
                    "Useful Life (Years)", // 22
                    "Depreciation Method", // 23
                    "Straight-Line %", // 24
                    "Bill Number", // 25
                    "Vendor Name", // 26
                ];
                // Columns whose cells should be numeric & currency-formatted in Excel.
                const numericCols = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
                // Column widths (wch units ≈ characters) — keeps the wide register readable.
                const colWidths = [
                    6, 14, 40, 20, 18, 14, 14, 18, 16, 16, 18, 18, 18, 18,
                    18, 18, 18, 18, 26, 26, 14, 14, 8, 18, 12, 16, 26,
                ];
                const rows = [];
                let no = 0;
                const totals = {
                    opGross: 0, additions: 0, deletions: 0, clGross: 0,
                    opDep: 0, periodDep: 0, accDepOnDisp: 0, clDep: 0,
                    opBv: 0, bvNet: 0, clBv: 0,
                };
                for (const a of assets) {
                    const cost = num((_k = (_j = a.purchaseCost) !== null && _j !== void 0 ? _j : a.estimatedValue) !== null && _k !== void 0 ? _k : 0);
                    const acqRaw = (_l = a.purchaseDate) !== null && _l !== void 0 ? _l : a.donationDate;
                    const acq = acqRaw ? new Date(acqRaw) : null;
                    const disp = a.disposalDate ? new Date(a.disposalDate) : null;
                    const acquiredBeforeWin = acq && acq < winStart;
                    const acquiredInWin = acq && acq >= winStart && acq <= winEnd;
                    const disposedBeforeWin = disp && disp < winStart;
                    const disposedInWin = disp && disp >= winStart && disp <= winEnd;
                    // ── Gross block math ────────────────────────────────────────────
                    // Opening: on the books at winStart.
                    const acqOpening = (acquiredBeforeWin && !disposedBeforeWin) ? cost : 0;
                    // Additions: capitalised during the window.
                    const additions = acquiredInWin ? cost : 0;
                    // Deletions: written off during the window.
                    const deletions = disposedInWin ? cost : 0;
                    // Closing: on the books at winEnd (acquired by then, not disposed before/in window).
                    const acqClosing = (acq && acq <= winEnd && (!disp || disp > winEnd)) ? cost : 0;
                    // ── Depreciation math ───────────────────────────────────────────
                    // depOpening    = Σ logs with periodEnd < winStart
                    // periodDep     = Σ logs with winStart ≤ periodEnd ≤ winEnd
                    //                 (for assets NOT disposed before/in window — i.e.
                    //                 logs that survive the disposal write-off below)
                    // accDepOnDisp  = for assets disposed in window, the Σ of ALL logs
                    //                 up to their disposal date (= the acc dep eliminated
                    //                 from books). Carved out of periodDep so the column
                    //                 math reconciles: depClosing = depOpening + periodDep
                    //                 − accDepOnDisp.
                    let depOpening = 0;
                    let depUpToWinEnd = 0; // Σ logs with periodEnd ≤ winEnd
                    let depUpToDisposal = 0; // Σ logs with periodEnd ≤ disposalDate
                    let lastDepDate = null;
                    for (const l of (_m = logsByAsset.get(a.id)) !== null && _m !== void 0 ? _m : []) {
                        const amt = num(l.depreciationAmount);
                        const pe = new Date(l.periodEnd);
                        if (pe < winStart)
                            depOpening += amt;
                        if (pe <= winEnd)
                            depUpToWinEnd += amt;
                        if (disp && pe <= disp)
                            depUpToDisposal += amt;
                        if (!lastDepDate || pe > lastDepDate)
                            lastDepDate = pe;
                    }
                    const accDepOnDisp = disposedInWin ? depUpToDisposal : 0;
                    // Period dep that stays on books = total dep within window minus what
                    // was eliminated on disposal. (depUpToWinEnd − depOpening) is the
                    // raw within-window dep; subtract the disposal-eliminated portion
                    // that falls inside the window.
                    const rawPeriodDep = depUpToWinEnd - depOpening;
                    const periodDep = Math.max(0, rawPeriodDep - accDepOnDisp);
                    const depClosing = depOpening + periodDep - accDepOnDisp;
                    // ── Book value (derived) ────────────────────────────────────────
                    const bvOpening = acqOpening - depOpening;
                    const bvClosing = acqClosing - depClosing;
                    const bvNet = bvClosing - bvOpening;
                    // Activity-only mode drops rows with no movement in the window
                    // (additions/deletions/period dep/disposal dep all zero). The full
                    // register additionally drops rows that have no balance at all on
                    // either side of the window — those are pre-FY disposals that aren't
                    // relevant to any FA register.
                    const noActivity = additions === 0 && deletions === 0 &&
                        periodDep === 0 && accDepOnDisp === 0;
                    const noBalance = acqOpening === 0 && acqClosing === 0;
                    if (activityOnly ? noActivity : (noActivity && noBalance))
                        continue;
                    const gl = (_o = a.assetCategory) === null || _o === void 0 ? void 0 : _o.glMapping;
                    const acqAccount = (gl === null || gl === void 0 ? void 0 : gl.fixedAssetAccount)
                        ? `${gl.fixedAssetAccount.code} - ${gl.fixedAssetAccount.name}` : "";
                    const accDepAccount = (gl === null || gl === void 0 ? void 0 : gl.accDepAccount)
                        ? `${gl.accDepAccount.code} - ${gl.accDepAccount.name}` : "";
                    const dep = a.depreciation;
                    const depStart = (dep === null || dep === void 0 ? void 0 : dep.depreciationStart) ? new Date(dep.depreciationStart) : acq;
                    let depEnd = null;
                    if (depStart && (dep === null || dep === void 0 ? void 0 : dep.expectedLifeYears)) {
                        depEnd = new Date(depStart);
                        depEnd.setFullYear(depEnd.getFullYear() + dep.expectedLifeYears);
                    }
                    no += 1;
                    rows.push([
                        no,
                        a.assetId,
                        a.assetName,
                        (_q = (_p = a.assetCategory) === null || _p === void 0 ? void 0 : _p.name) !== null && _q !== void 0 ? _q : "",
                        (_r = a.currentLocation) !== null && _r !== void 0 ? _r : "",
                        fmt(acq),
                        fmt(lastDepDate),
                        acqOpening,
                        additions,
                        deletions,
                        acqClosing,
                        depOpening,
                        periodDep,
                        accDepOnDisp,
                        depClosing,
                        bvOpening,
                        bvNet,
                        bvClosing,
                        acqAccount,
                        accDepAccount,
                        fmt(depStart),
                        fmt(depEnd),
                        (_s = dep === null || dep === void 0 ? void 0 : dep.expectedLifeYears) !== null && _s !== void 0 ? _s : "",
                        methodLabel(dep === null || dep === void 0 ? void 0 : dep.depreciationMethod),
                        (dep === null || dep === void 0 ? void 0 : dep.depreciationRate) ? num(dep.depreciationRate) : "",
                        a.purchaseVoucherNo || a.invoiceNumber || "",
                        ((_t = a.vendor) === null || _t === void 0 ? void 0 : _t.name) || "",
                    ]);
                    totals.opGross += acqOpening;
                    totals.additions += additions;
                    totals.deletions += deletions;
                    totals.clGross += acqClosing;
                    totals.opDep += depOpening;
                    totals.periodDep += periodDep;
                    totals.accDepOnDisp += accDepOnDisp;
                    totals.clDep += depClosing;
                    totals.opBv += bvOpening;
                    totals.bvNet += bvNet;
                    totals.clBv += bvClosing;
                }
                // Blank spacer + grand-total row (xlsx CE can't bold cells; we make the
                // label uppercase so it's still visually distinct).
                rows.push(new Array(27).fill(""));
                rows.push([
                    "",
                    "", // Asset ID column
                    `TOTAL (${no} assets)`,
                    "", // Category column
                    "", // Location column
                    "", // Last Acq Date
                    "", // Last Dep Date
                    totals.opGross,
                    totals.additions,
                    totals.deletions,
                    totals.clGross,
                    totals.opDep,
                    totals.periodDep,
                    totals.accDepOnDisp,
                    totals.clDep,
                    totals.opBv,
                    totals.bvNet,
                    totals.clBv,
                    "", "", "", "", "", "", "", "", "",
                ]);
                const modeSuffix = activityOnly ? "_ActivityOnly" : "_Full";
                const filename = `CFO_Fixed_Asset_Register_FY${fyLabel}_${periodLabel}${modeSuffix}`;
                return sendExcelTyped(res, filename, headers, rows, numericCols, "#,##0.00", colWidths);
            }
            // A3 — Block of Assets schedule (group by IT-Act rate brackets)
            case "block-of-assets-schedule": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true, depreciation: true },
                });
                const blocks = new Map();
                const ensureBlock = (rate) => {
                    if (!blocks.has(rate))
                        blocks.set(rate, { rate, label: `${rate}% Block`, gross: 0, accDep: 0, bv: 0, count: 0 });
                    return blocks.get(rate);
                };
                for (const a of assets) {
                    if (!a.depreciation)
                        continue;
                    const rate = Math.round(num(a.depreciation.depreciationRate));
                    const blk = ensureBlock(rate);
                    blk.gross += num(a.purchaseCost);
                    blk.accDep += num(a.depreciation.accumulatedDepreciation);
                    blk.bv += num((_u = a.depreciation.currentBookValue) !== null && _u !== void 0 ? _u : (num(a.purchaseCost) - num(a.depreciation.accumulatedDepreciation)));
                    blk.count += 1;
                }
                const headers = ["Block (Depreciation Rate)", "No. of Assets", "Gross Block (₹)", "Accumulated Depreciation (₹)", "Net Block / WDV (₹)"];
                const rows = Array.from(blocks.values())
                    .sort((a, b) => a.rate - b.rate)
                    .map(b => [b.label, b.count, money(b.gross), money(b.accDep), money(b.bv)]);
                return sendExcel(res, "Block_of_Assets_Schedule", headers, rows, { total: true });
            }
            // A4 — Year-End FA Register Snapshot (every asset, full detail)
            case "year-end-fa-snapshot": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true, department: true, depreciation: true, vendor: true },
                    orderBy: { assetId: "asc" },
                });
                const headers = [
                    "Asset ID", "Asset Name", "Serial No", "Category", "Asset Nature", "Asset Type",
                    "Department", "Location", "Vendor",
                    "Mode of Procurement", "Purchase Date", "Purchase Cost (₹)",
                    "Invoice No", "GRN No", "PO No",
                    "Depreciation Method", "Rate (%)", "Useful Life (Yrs)",
                    "Accumulated Depreciation (₹)", "Net Book Value (₹)",
                    "Status", "Physical Condition", "Created On",
                ];
                const rows = assets.map((a) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
                    return [
                        a.assetId, a.assetName,
                        (_a = a.serialNumber) !== null && _a !== void 0 ? _a : "",
                        (_c = (_b = a.assetCategory) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "",
                        (_d = a.assetNature) !== null && _d !== void 0 ? _d : "",
                        (_e = a.assetType) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = a.department) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_h = a.currentLocation) !== null && _h !== void 0 ? _h : "",
                        (_k = (_j = a.vendor) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        (_l = a.modeOfProcurement) !== null && _l !== void 0 ? _l : "",
                        fmt(a.purchaseDate), money(a.purchaseCost),
                        (_m = a.invoiceNumber) !== null && _m !== void 0 ? _m : "",
                        (_o = a.grnNumber) !== null && _o !== void 0 ? _o : "",
                        (_p = a.purchaseOrderNo) !== null && _p !== void 0 ? _p : "",
                        (_r = (_q = a.depreciation) === null || _q === void 0 ? void 0 : _q.depreciationMethod) !== null && _r !== void 0 ? _r : "",
                        num((_s = a.depreciation) === null || _s === void 0 ? void 0 : _s.depreciationRate).toFixed(2),
                        (_u = (_t = a.depreciation) === null || _t === void 0 ? void 0 : _t.expectedLifeYears) !== null && _u !== void 0 ? _u : "",
                        money((_v = a.depreciation) === null || _v === void 0 ? void 0 : _v.accumulatedDepreciation),
                        money((_w = a.depreciation) === null || _w === void 0 ? void 0 : _w.currentBookValue),
                        (_x = a.status) !== null && _x !== void 0 ? _x : "",
                        (_y = a.physicalCondition) !== null && _y !== void 0 ? _y : "",
                        fmt(a.createdAt),
                    ];
                });
                return sendExcel(res, "Year_End_FA_Snapshot", headers, rows, { total: true });
            }
            // A5 — Pre-Audit Reconciliation
            // System (Smart Assets) vs Books (GL) vs Audit (auditor's FA register).
            // Each row is one scope (asset / category / pool) at a snapshot date,
            // showing the gross block / acc-dep / net-block from all three sources
            // and the variances between them.
            case "pre-audit-reconciliation": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.asOfDate = dr;
                const snaps = yield prismaClient_1.default.reconciliationSnapshot.findMany({
                    where,
                    include: { resolvedBy: true, createdBy: true },
                    orderBy: { asOfDate: "desc" },
                });
                const headers = [
                    "As-of Date", "Scope", "Scope Label", "Status", "Variance Flagged",
                    "System Gross Block (₹)", "System Acc. Dep (₹)", "System Net Block (₹)",
                    "Books Gross Block (₹)", "Books Acc. Dep (₹)", "Books Net Block (₹)",
                    "Audit Gross Block (₹)", "Audit Acc. Dep (₹)", "Audit Net Block (₹)",
                    "Variance vs Books (₹)", "Variance % vs Books",
                    "Variance vs Audit (₹)", "Variance % vs Audit",
                    "Resolution Notes", "Resolved By", "Resolved On",
                    "Created By", "Created On",
                ];
                const rows = snaps.map(s => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        fmt(s.asOfDate),
                        (_a = s.scope) !== null && _a !== void 0 ? _a : "",
                        (_b = s.scopeLabel) !== null && _b !== void 0 ? _b : "",
                        (_c = s.status) !== null && _c !== void 0 ? _c : "",
                        yn(s.varianceFlagged),
                        money(s.systemGrossBlock), money(s.systemAccDep), money(s.systemNetBlock),
                        money(s.booksGrossBlock), money(s.booksAccDep), money(s.booksNetBlock),
                        money(s.auditGrossBlock), money(s.auditAccDep), money(s.auditNetBlock),
                        money(s.varianceVsBooks), num(s.variancePctVsBooks).toFixed(2),
                        money(s.varianceVsAudit), num(s.variancePctVsAudit).toFixed(2),
                        (_d = s.resolutionNotes) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = s.resolvedBy) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        fmt(s.resolvedAt),
                        (_h = (_g = s.createdBy) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        fmt(s.createdAt),
                    ];
                });
                return sendExcel(res, "Pre_Audit_Reconciliation", headers, rows, { total: true });
            }
            // A6 — Auditor's Working Paper Pack (multi-sheet bundle)
            case "auditor-working-paper-pack": {
                const where = {};
                if (f.fyStart)
                    where.purchaseDate = { gte: f.fyStart, lte: (_v = f.fyEnd) !== null && _v !== void 0 ? _v : undefined };
                const [assets, depLogs, additions, disposals, vendorBalances] = yield Promise.all([
                    prismaClient_1.default.asset.findMany({ include: { assetCategory: true, depreciation: true } }),
                    prismaClient_1.default.depreciationLog.findMany({
                        where: f.fyStart && f.fyEnd ? { periodStart: { gte: f.fyStart }, periodEnd: { lte: f.fyEnd } } : {},
                        include: { asset: { select: { assetId: true, assetName: true } } },
                        orderBy: { periodEnd: "desc" },
                    }),
                    prismaClient_1.default.asset.findMany({ where, include: { assetCategory: true, vendor: true } }),
                    prismaClient_1.default.assetDisposal.findMany({
                        where: f.fyStart && f.fyEnd ? { createdAt: { gte: f.fyStart, lte: f.fyEnd } } : {},
                        include: { asset: { select: { assetId: true, assetName: true } } },
                    }),
                    prismaClient_1.default.vendor.findMany({ where: { isActive: true } }),
                ]);
                const sheets = [
                    {
                        name: "Asset Register",
                        total: true,
                        headers: ["Asset ID", "Asset Name", "Category", "Purchase Date", "Purchase Cost (₹)", "Acc. Depreciation (₹)", "Net Book Value (₹)", "Status"],
                        rows: assets.map((a) => {
                            var _a, _b, _c, _d, _e;
                            return [
                                a.assetId, a.assetName,
                                (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                                fmt(a.purchaseDate), money(a.purchaseCost),
                                money((_c = a.depreciation) === null || _c === void 0 ? void 0 : _c.accumulatedDepreciation), money((_d = a.depreciation) === null || _d === void 0 ? void 0 : _d.currentBookValue),
                                (_e = a.status) !== null && _e !== void 0 ? _e : "",
                            ];
                        }),
                    },
                    {
                        name: "Depreciation Log",
                        total: true,
                        headers: ["Asset ID", "Asset Name", "Period Start", "Period End", "FY", "Depreciation (₹)", "Book Value After (₹)"],
                        rows: depLogs.map((l) => {
                            var _a, _b, _c, _d, _e;
                            return [
                                (_b = (_a = l.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                                (_d = (_c = l.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                                fmt(l.periodStart), fmt(l.periodEnd),
                                (_e = l.fyLabel) !== null && _e !== void 0 ? _e : "",
                                money(l.depreciationAmount), money(l.bookValueAfter),
                            ];
                        }),
                    },
                    {
                        name: "Additions (Period)",
                        total: true,
                        headers: ["Asset ID", "Asset Name", "Category", "Vendor", "Purchase Date", "Cost (₹)", "Invoice No"],
                        rows: additions.map((a) => {
                            var _a, _b, _c, _d, _e;
                            return [
                                a.assetId, a.assetName,
                                (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                                (_d = (_c = a.vendor) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                                fmt(a.purchaseDate), money(a.purchaseCost),
                                (_e = a.invoiceNumber) !== null && _e !== void 0 ? _e : "",
                            ];
                        }),
                    },
                    {
                        name: "Disposals (Period)",
                        total: true,
                        headers: ["Asset ID", "Asset Name", "Disposal Type", "Status", "Sale Value (₹)", "Book Value (₹)", "Gain/Loss (₹)", "Date"],
                        rows: disposals.map((d) => {
                            var _a, _b, _c, _d;
                            return [
                                (_b = (_a = d.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                                (_d = (_c = d.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                                d.disposalType, d.status, money(d.actualSaleValue), money(d.bookValueAtDisposal), money(d.netGainLoss),
                                fmt(d.createdAt),
                            ];
                        }),
                    },
                    {
                        name: "Active Vendors",
                        headers: ["Vendor", "GST No", "PAN", "Contact", "Email", "City", "State"],
                        rows: vendorBalances.map((v) => {
                            var _a, _b, _c, _d, _e, _f;
                            return [
                                v.name,
                                (_a = v.gstNumber) !== null && _a !== void 0 ? _a : "",
                                (_b = v.panNumber) !== null && _b !== void 0 ? _b : "",
                                (_c = v.contact) !== null && _c !== void 0 ? _c : "",
                                (_d = v.email) !== null && _d !== void 0 ? _d : "",
                                (_e = v.city) !== null && _e !== void 0 ? _e : "",
                                (_f = v.state) !== null && _f !== void 0 ? _f : "",
                            ];
                        }),
                    },
                ];
                return sendMultiSheetExcel(res, `Auditor_Working_Paper_Pack${f.fyLabel ? `_${f.fyLabel}` : ""}`, sheets);
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP B — DEPRECIATION & FA MOVEMENT
            // ═══════════════════════════════════════════════════════════════════
            // B1 — Depreciation Log (by FY)
            case "depreciation-log": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.periodEnd = dr;
                if (f.fyLabel)
                    where.fyLabel = f.fyLabel.startsWith("FY") ? f.fyLabel : `FY${f.fyLabel}`;
                const logs = yield prismaClient_1.default.depreciationLog.findMany({
                    where,
                    include: { asset: { include: { assetCategory: true, department: true } }, doneBy: true, batchRun: true },
                    orderBy: { periodEnd: "desc" },
                });
                const headers = [
                    "FY", "Period Start", "Period End", "Asset ID", "Asset Name", "Category", "Department",
                    "Opening WDV (₹)", "Additions (₹)", "Dep on Opening (₹)", "Dep on Additions (₹)",
                    "Total Depreciation (₹)", "Book Value After (₹)",
                    "Effective Rate (%)", "Half-Year Applied", "First FY", "Batch Run", "Done By",
                ];
                const rows = logs.map((l) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
                    return [
                        (_a = l.fyLabel) !== null && _a !== void 0 ? _a : "",
                        fmt(l.periodStart), fmt(l.periodEnd),
                        (_c = (_b = l.asset) === null || _b === void 0 ? void 0 : _b.assetId) !== null && _c !== void 0 ? _c : "",
                        (_e = (_d = l.asset) === null || _d === void 0 ? void 0 : _d.assetName) !== null && _e !== void 0 ? _e : "",
                        (_h = (_g = (_f = l.asset) === null || _f === void 0 ? void 0 : _f.assetCategory) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        (_l = (_k = (_j = l.asset) === null || _j === void 0 ? void 0 : _j.department) === null || _k === void 0 ? void 0 : _k.name) !== null && _l !== void 0 ? _l : "",
                        money(l.openingWdv), money(l.additionsAmount),
                        money(l.depOnOpening), money(l.depOnAdditions),
                        money(l.depreciationAmount), money(l.bookValueAfter),
                        num(l.effectiveRate).toFixed(4),
                        yn(l.halfYearApplied), yn(l.isFirstFY),
                        (_o = (_m = l.batchRun) === null || _m === void 0 ? void 0 : _m.runNumber) !== null && _o !== void 0 ? _o : "",
                        (_q = (_p = l.doneBy) === null || _p === void 0 ? void 0 : _p.name) !== null && _q !== void 0 ? _q : "",
                    ];
                });
                return sendExcel(res, `Depreciation_Log${f.fyLabel ? `_${f.fyLabel}` : ""}`, headers, rows, { total: true });
            }
            // B2 — Asset Additions Register
            case "asset-additions": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.purchaseDate = dr;
                if (f.assetCategoryId)
                    where.assetCategoryId = f.assetCategoryId;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                if (f.branchId)
                    where.branchId = f.branchId;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                const assets = yield prismaClient_1.default.asset.findMany({
                    where,
                    include: { assetCategory: true, department: true, vendor: true },
                    orderBy: { purchaseDate: "desc" },
                });
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Asset Type", "Department", "Location", "Vendor",
                    "Mode of Procurement", "Purchase Date", "Purchase Cost (₹)",
                    "Invoice No", "GRN No", "PO No",
                ];
                const rows = assets.map((a) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
                    return [
                        a.assetId, a.assetName,
                        (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_c = a.assetType) !== null && _c !== void 0 ? _c : "",
                        (_e = (_d = a.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        (_f = a.currentLocation) !== null && _f !== void 0 ? _f : "",
                        (_h = (_g = a.vendor) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        (_j = a.modeOfProcurement) !== null && _j !== void 0 ? _j : "",
                        fmt(a.purchaseDate), money(a.purchaseCost),
                        (_k = a.invoiceNumber) !== null && _k !== void 0 ? _k : "",
                        (_l = a.grnNumber) !== null && _l !== void 0 ? _l : "",
                        (_m = a.purchaseOrderNo) !== null && _m !== void 0 ? _m : "",
                    ];
                });
                return sendExcel(res, "Asset_Additions", headers, rows, { total: true });
            }
            // B3 — Asset Retirements & Disposals (with gain/loss)
            case "asset-retirements": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                const disposals = yield prismaClient_1.default.assetDisposal.findMany({
                    where,
                    include: { asset: { include: { assetCategory: true, department: true } } },
                    orderBy: { createdAt: "desc" },
                });
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Department",
                    "Disposal Type", "Status", "Reason",
                    "Estimated Scrap (₹)", "Sale Value (₹)", "Book Value at Disposal (₹)", "Net Gain/Loss (₹)",
                    "Buyer", "Buyer Contact", "Requested On", "Approved On", "Completed On",
                ];
                const rows = disposals.map((d) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
                    return [
                        (_b = (_a = d.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = d.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_g = (_f = (_e = d.asset) === null || _e === void 0 ? void 0 : _e.assetCategory) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_k = (_j = (_h = d.asset) === null || _h === void 0 ? void 0 : _h.department) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        d.disposalType, d.status,
                        (_l = d.reason) !== null && _l !== void 0 ? _l : "",
                        money(d.estimatedScrapValue), money(d.actualSaleValue),
                        money(d.bookValueAtDisposal), money(d.netGainLoss),
                        (_m = d.buyerName) !== null && _m !== void 0 ? _m : "",
                        (_o = d.buyerContact) !== null && _o !== void 0 ? _o : "",
                        fmt(d.createdAt), fmt(d.committeeApprovalDate), fmt(d.completedAt),
                    ];
                });
                return sendExcel(res, "Asset_Retirements", headers, rows, { total: true });
            }
            // B4 — Net Block Movement by Category
            case "net-block-movement": {
                const categories = yield prismaClient_1.default.assetCategory.findMany({ select: { id: true, name: true } });
                const assets = yield prismaClient_1.default.asset.findMany({ include: { depreciation: true } });
                const agg = new Map();
                for (const c of categories)
                    agg.set(c.id, { name: c.name, count: 0, gross: 0, accDep: 0, netBlock: 0 });
                for (const a of assets) {
                    const row = agg.get(a.assetCategoryId);
                    if (!row)
                        continue;
                    row.count++;
                    row.gross += num(a.purchaseCost);
                    row.accDep += num((_w = a.depreciation) === null || _w === void 0 ? void 0 : _w.accumulatedDepreciation);
                    row.netBlock += num((_x = a.depreciation) === null || _x === void 0 ? void 0 : _x.currentBookValue);
                }
                const headers = ["Category", "No. of Assets", "Gross Block (₹)", "Accumulated Depreciation (₹)", "Net Block (₹)"];
                const rows = Array.from(agg.values())
                    .filter(r => r.count > 0)
                    .map(r => [r.name, r.count, money(r.gross), money(r.accDep), money(r.netBlock)]);
                return sendExcel(res, "Net_Block_Movement_by_Category", headers, rows, { total: true });
            }
            // B5 — Fully Depreciated, Still-In-Use
            case "fully-depreciated-in-use": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true, department: true, depreciation: true },
                });
                const filtered = assets.filter(a => {
                    if (!a.depreciation)
                        return false;
                    const bv = num(a.depreciation.currentBookValue);
                    const salvage = num(a.depreciation.salvageValue);
                    const stillInUse = !["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());
                    return bv <= salvage && stillInUse;
                });
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Department",
                    "Purchase Date", "Purchase Cost (₹)", "Acc. Depreciation (₹)", "Net Book Value (₹)", "Salvage Value (₹)",
                    "Status",
                ];
                const rows = filtered.map((a) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        a.assetId, a.assetName,
                        (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = a.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        fmt(a.purchaseDate), money(a.purchaseCost),
                        money((_e = a.depreciation) === null || _e === void 0 ? void 0 : _e.accumulatedDepreciation), money((_f = a.depreciation) === null || _f === void 0 ? void 0 : _f.currentBookValue),
                        money((_g = a.depreciation) === null || _g === void 0 ? void 0 : _g.salvageValue),
                        (_h = a.status) !== null && _h !== void 0 ? _h : "",
                    ];
                });
                return sendExcel(res, "Fully_Depreciated_In_Use", headers, rows, { total: true });
            }
            // B6 — FA Schedule from Asset Pool (FY + Category)
            case "fa-schedule-pool": {
                const where = {};
                if (f.assetCategoryId)
                    where.categoryId = f.assetCategoryId;
                if (f.fyLabel)
                    where.financialYear = f.fyLabel.startsWith("FY") ? f.fyLabel : `FY${f.fyLabel}`;
                const pools = yield prismaClient_1.default.assetPool.findMany({
                    where,
                    include: { category: true, department: true, depreciationSchedules: true },
                    orderBy: { financialYear: "asc" },
                });
                const headers = [
                    "Pool Code", "FY", "Category", "Department",
                    "Original Quantity", "Total Pool Cost (₹)", "Status", "Description",
                ];
                const rows = pools.map((p) => {
                    var _a, _b, _c, _d, _e;
                    return [
                        p.poolCode, p.financialYear,
                        (_b = (_a = p.category) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = p.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        p.originalQuantity, money(p.totalPoolCost), p.status,
                        (_e = p.description) !== null && _e !== void 0 ? _e : "",
                    ];
                });
                return sendExcel(res, "FA_Schedule_Pool", headers, rows, { total: true });
            }
            // B7 — Useful Life Remaining
            case "useful-life-remaining": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true, depreciation: true },
                });
                const now = new Date();
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Purchase Date",
                    "Expected Life (Years)", "Years Elapsed", "Years Remaining",
                    "Purchase Cost (₹)", "Net Book Value (₹)",
                ];
                const rows = assets
                    .filter(a => a.depreciation && a.depreciation.expectedLifeYears)
                    .map(a => {
                    var _a, _b, _c, _d;
                    const start = (_b = (_a = a.depreciation.depreciationStart) !== null && _a !== void 0 ? _a : a.purchaseDate) !== null && _b !== void 0 ? _b : a.createdAt;
                    const elapsed = start ? (now.getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 365.25) : 0;
                    const remaining = Math.max(0, a.depreciation.expectedLifeYears - elapsed);
                    return [
                        a.assetId, a.assetName,
                        (_d = (_c = a.assetCategory) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        fmt(a.purchaseDate), a.depreciation.expectedLifeYears,
                        elapsed.toFixed(2), remaining.toFixed(2),
                        money(a.purchaseCost), money(a.depreciation.currentBookValue),
                    ];
                });
                return sendExcel(res, "Useful_Life_Remaining", headers, rows, { total: true });
            }
            // B8 — Half-Year Convention Applied
            case "half-year-applied": {
                const where = { halfYearApplied: true };
                const dr = dateRangeOn(f);
                if (dr)
                    where.periodEnd = dr;
                const logs = yield prismaClient_1.default.depreciationLog.findMany({
                    where,
                    include: { asset: { include: { assetCategory: true } } },
                });
                const headers = ["Asset ID", "Asset Name", "Category", "FY", "Purchase/Addition (₹)", "Effective Rate (%)", "Depreciation (₹)"];
                const rows = logs.map((l) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = l.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = l.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_g = (_f = (_e = l.asset) === null || _e === void 0 ? void 0 : _e.assetCategory) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_h = l.fyLabel) !== null && _h !== void 0 ? _h : "",
                        money(l.additionsAmount),
                        num(l.effectiveRate).toFixed(4), money(l.depreciationAmount),
                    ];
                });
                return sendExcel(res, "Half_Year_Convention_Applied", headers, rows, { total: true });
            }
            // B9 — Depreciation Method Summary
            case "depreciation-method-summary": {
                const deps = yield prismaClient_1.default.assetDepreciation.findMany({ include: { asset: true } });
                const agg = new Map();
                for (const d of deps) {
                    const m = d.depreciationMethod || "OTHER";
                    if (!agg.has(m))
                        agg.set(m, { count: 0, gross: 0, accDep: 0, netBlock: 0 });
                    const a = agg.get(m);
                    a.count++;
                    a.gross += num((_y = d.asset) === null || _y === void 0 ? void 0 : _y.purchaseCost);
                    a.accDep += num(d.accumulatedDepreciation);
                    a.netBlock += num(d.currentBookValue);
                }
                const headers = ["Depreciation Method", "No. of Assets", "Gross Block (₹)", "Accumulated Depreciation (₹)", "Net Block (₹)"];
                const rows = Array.from(agg.entries()).map(([m, v]) => [m, v.count, money(v.gross), money(v.accDep), money(v.netBlock)]);
                return sendExcel(res, "Depreciation_Method_Summary", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP C — TAX & GST
            // ═══════════════════════════════════════════════════════════════════
            // C1 — GST on Asset Purchases (from PO + Service Invoice GST data)
            case "gst-on-asset-purchases": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.poDate = dr;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                const pos = yield prismaClient_1.default.purchaseOrder.findMany({
                    where,
                    include: { vendor: true, department: true, lines: true },
                    orderBy: { poDate: "desc" },
                });
                const headers = [
                    "PO Number", "PO Date", "Vendor", "GST No (Vendor)", "Department", "Status",
                    "Subtotal (₹)", "Tax Amount (₹)", "Total Amount (₹)",
                    "HSN Codes", "Line Items",
                ];
                const rows = pos.map((p) => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        p.poNumber, fmt(p.poDate),
                        (_b = (_a = p.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = p.vendor) === null || _c === void 0 ? void 0 : _c.gstNumber) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = p.department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        p.status,
                        money(p.subtotal), money(p.taxAmount), money(p.totalAmount),
                        (p.lines || []).map((l) => l.hsnCode).filter(Boolean).join(", "),
                        (p.lines || []).length,
                    ];
                });
                return sendExcel(res, "GST_on_Asset_Purchases", headers, rows, { total: true });
            }
            // C2 — Capital Goods ITC Register (5-year amortisation per GST rules)
            case "capital-goods-itc-register": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.poDate = dr;
                const pos = yield prismaClient_1.default.purchaseOrder.findMany({
                    where: Object.assign(Object.assign({}, where), { status: { in: ["FULLY_RECEIVED", "PARTIALLY_RECEIVED", "CLOSED"] } }),
                    include: { vendor: true },
                });
                const headers = [
                    "PO Number", "PO Date", "Vendor", "GST No",
                    "Tax / ITC Amount (₹)", "Monthly Amortisation @60 months (₹)", "Yearly ITC Claimable (₹)",
                    "FY",
                ];
                const rows = pos.map((p) => {
                    var _a, _b, _c, _d;
                    const tax = num(p.taxAmount);
                    const monthly = tax / 60;
                    const yearly = monthly * 12;
                    return [
                        p.poNumber, fmt(p.poDate),
                        (_b = (_a = p.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = p.vendor) === null || _c === void 0 ? void 0 : _c.gstNumber) !== null && _d !== void 0 ? _d : "",
                        money(tax), money(monthly), money(yearly), fyLabelFromDate(p.poDate),
                    ];
                });
                return sendExcel(res, "Capital_Goods_ITC_Register", headers, rows, { total: true });
            }
            // C3 — TDS on Capital Purchases (from Service Invoice)
            case "tds-on-capital-purchases": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.invoiceDate = dr;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                const invs = yield prismaClient_1.default.serviceInvoice.findMany({
                    where,
                    include: { vendor: true, asset: true },
                    orderBy: { invoiceDate: "desc" },
                });
                const headers = [
                    "Invoice No", "Invoice Date", "Vendor", "GST No (Vendor)", "PAN",
                    "Asset", "Net Amount (₹)", "GST (%)", "GST Amount (₹)", "TDS Amount (₹)", "Payable (₹)",
                ];
                const rows = invs.map((i) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        i.invoiceNo, fmt(i.invoiceDate),
                        (_b = (_a = i.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = i.vendor) === null || _c === void 0 ? void 0 : _c.gstNumber) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = i.vendor) === null || _e === void 0 ? void 0 : _e.panNumber) !== null && _f !== void 0 ? _f : "",
                        (_h = (_g = i.asset) === null || _g === void 0 ? void 0 : _g.assetId) !== null && _h !== void 0 ? _h : "",
                        money(i.netAmount),
                        num(i.gstPct).toFixed(2), money(i.gstAmount), money(i.tdsAmount), money(i.payableAmount),
                    ];
                });
                return sendExcel(res, "TDS_on_Capital_Purchases", headers, rows, { total: true });
            }
            // C4 — Vendor TDS Deductions Summary
            case "vendor-tds-deductions": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.invoiceDate = dr;
                const invs = yield prismaClient_1.default.serviceInvoice.findMany({
                    where,
                    include: { vendor: true },
                });
                const agg = new Map();
                for (const i of invs) {
                    if (!i.vendorId)
                        continue;
                    if (!agg.has(i.vendorId))
                        agg.set(i.vendorId, {
                            name: (_0 = (_z = i.vendor) === null || _z === void 0 ? void 0 : _z.name) !== null && _0 !== void 0 ? _0 : "",
                            gst: (_2 = (_1 = i.vendor) === null || _1 === void 0 ? void 0 : _1.gstNumber) !== null && _2 !== void 0 ? _2 : "",
                            pan: (_4 = (_3 = i.vendor) === null || _3 === void 0 ? void 0 : _3.panNumber) !== null && _4 !== void 0 ? _4 : "",
                            tds: 0, net: 0, count: 0,
                        });
                    const a = agg.get(i.vendorId);
                    a.tds += num(i.tdsAmount);
                    a.net += num(i.netAmount);
                    a.count++;
                }
                const headers = ["Vendor", "GST No", "PAN", "No. of Invoices", "Net Billed (₹)", "TDS Deducted (₹)"];
                const rows = Array.from(agg.values()).map(v => [v.name, v.gst, v.pan, v.count, money(v.net), money(v.tds)]);
                return sendExcel(res, "Vendor_TDS_Deductions", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP D — VOUCHERS & LEDGER
            // ═══════════════════════════════════════════════════════════════════
            // D1 — Journal Entries (with lines as sub-sheet)
            case "journal-entries": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.entryDate = dr;
                const entries = yield prismaClient_1.default.journalEntry.findMany({
                    where,
                    include: {
                        lines: { include: { debitAccount: true, creditAccount: true } },
                        createdBy: true,
                        purchaseVoucher: true,
                        paymentVoucher: true,
                    },
                    orderBy: { entryDate: "desc" },
                });
                const masterHeaders = [
                    "Entry No", "Entry Date", "FY", "Narration", "Auto-Generated",
                    "Total Amount (₹)", "Linked PV", "Linked Payment", "Created By", "Created On",
                ];
                const masterRows = entries.map((e) => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        e.entryNo, fmt(e.entryDate), fyLabelFromDate(e.entryDate),
                        (_a = e.narration) !== null && _a !== void 0 ? _a : "",
                        yn(e.isAutoGenerated),
                        money(e.totalAmount),
                        (_c = (_b = e.purchaseVoucher) === null || _b === void 0 ? void 0 : _b.voucherNo) !== null && _c !== void 0 ? _c : "",
                        (_e = (_d = e.paymentVoucher) === null || _d === void 0 ? void 0 : _d.voucherNo) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = e.createdBy) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        fmt(e.createdAt),
                    ];
                });
                const lineHeaders = ["Entry No", "Entry Date", "Debit Account", "Credit Account", "Amount (₹)", "Narration"];
                const lineRows = entries.flatMap((e) => (e.lines || []).map((l) => {
                    var _a;
                    return [
                        e.entryNo, fmt(e.entryDate),
                        l.debitAccount ? `${l.debitAccount.code} - ${l.debitAccount.name}` : "",
                        l.creditAccount ? `${l.creditAccount.code} - ${l.creditAccount.name}` : "",
                        money(l.amount),
                        (_a = l.narration) !== null && _a !== void 0 ? _a : "",
                    ];
                }));
                return sendMultiSheetExcel(res, "Journal_Entries", [
                    { name: "Entries", headers: masterHeaders, rows: masterRows, total: true },
                    { name: "Lines", headers: lineHeaders, rows: lineRows, total: true },
                ]);
            }
            // D2 — Payment Vouchers
            case "payment-vouchers": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.voucherDate = dr;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                const pvs = yield prismaClient_1.default.paymentVoucher.findMany({
                    where,
                    include: { vendor: true, purchaseVoucher: true, approvedBy: true },
                    orderBy: { voucherDate: "desc" },
                });
                const headers = [
                    "Voucher No", "Voucher Date", "Amount (₹)", "Payment Mode",
                    "Bank Name", "Bank Reference", "Vendor", "Linked PV",
                    "Status", "Approved By", "Approved On", "Narration",
                ];
                const rows = pvs.map((v) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return [
                        v.voucherNo, fmt(v.voucherDate), money(v.amount),
                        v.paymentMode,
                        (_a = v.bankName) !== null && _a !== void 0 ? _a : "",
                        (_b = v.bankReference) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = v.vendor) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = v.purchaseVoucher) === null || _e === void 0 ? void 0 : _e.voucherNo) !== null && _f !== void 0 ? _f : "",
                        v.status,
                        (_h = (_g = v.approvedBy) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        fmt(v.approvedAt),
                        (_j = v.narration) !== null && _j !== void 0 ? _j : "",
                    ];
                });
                return sendExcel(res, "Payment_Vouchers", headers, rows, { total: true });
            }
            // D3 — Purchase Vouchers
            case "purchase-vouchers": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.voucherDate = dr;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                const pvs = yield prismaClient_1.default.purchaseVoucher.findMany({
                    where,
                    include: { vendor: true, asset: true, goodsReceipt: true },
                    orderBy: { voucherDate: "desc" },
                });
                const headers = [
                    "Voucher No", "Voucher Date", "Amount (₹)", "Vendor",
                    "Asset", "Linked GRN", "Status", "Narration",
                ];
                const rows = pvs.map((v) => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        v.voucherNo, fmt(v.voucherDate), money(v.amount),
                        (_b = (_a = v.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = v.asset) === null || _c === void 0 ? void 0 : _c.assetId) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = v.goodsReceipt) === null || _e === void 0 ? void 0 : _e.grnNumber) !== null && _f !== void 0 ? _f : "",
                        v.status,
                        (_g = v.narration) !== null && _g !== void 0 ? _g : "",
                    ];
                });
                return sendExcel(res, "Purchase_Vouchers", headers, rows, { total: true });
            }
            // D4 — Chart of Accounts
            case "chart-of-accounts": {
                const coa = yield prismaClient_1.default.chartOfAccount.findMany({
                    include: { parent: true },
                    orderBy: { code: "asc" },
                });
                const headers = ["Code", "Name", "Type", "Sub-Type", "Parent Account", "Active", "Description", "Created On"];
                const rows = coa.map((c) => {
                    var _a, _b;
                    return [
                        c.code, c.name, c.type,
                        (_a = c.subType) !== null && _a !== void 0 ? _a : "",
                        c.parent ? `${c.parent.code} - ${c.parent.name}` : "",
                        yn(c.isActive),
                        (_b = c.description) !== null && _b !== void 0 ? _b : "",
                        fmt(c.createdAt),
                    ];
                });
                return sendExcel(res, "Chart_of_Accounts", headers, rows);
            }
            // D5 — Trial Balance for FA Accounts
            case "trial-balance-fa": {
                const accounts = yield prismaClient_1.default.chartOfAccount.findMany({
                    where: { OR: [{ subType: "Fixed Asset" }, { type: "ASSET" }] },
                    include: { debitLines: true, creditLines: true },
                });
                const headers = ["Code", "Account Name", "Type", "Sub-Type", "Total Debit (₹)", "Total Credit (₹)", "Net Balance (₹)"];
                const rows = accounts.map((a) => {
                    var _a, _b, _c;
                    const debit = ((_a = a.debitLines) !== null && _a !== void 0 ? _a : []).reduce((s, l) => s + num(l.amount), 0);
                    const credit = ((_b = a.creditLines) !== null && _b !== void 0 ? _b : []).reduce((s, l) => s + num(l.amount), 0);
                    return [a.code, a.name, a.type, (_c = a.subType) !== null && _c !== void 0 ? _c : "", money(debit), money(credit), money(debit - credit)];
                });
                return sendExcel(res, "Trial_Balance_FA", headers, rows, { total: true });
            }
            // D6 — Asset GL Mapping
            case "gl-mapping": {
                const maps = yield prismaClient_1.default.assetGLMapping.findMany({
                    include: { glFixedAsset: true, glAccDep: true, category: true },
                }).catch(() => []);
                const headers = ["Category", "Fixed Asset GL", "Accumulated Depreciation GL", "Active"];
                const rows = maps.map((m) => {
                    var _a, _b, _c;
                    return [
                        (_b = (_a = m.category) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        m.glFixedAsset ? `${m.glFixedAsset.code} - ${m.glFixedAsset.name}` : "",
                        m.glAccDep ? `${m.glAccDep.code} - ${m.glAccDep.name}` : "",
                        yn((_c = m.isActive) !== null && _c !== void 0 ? _c : true),
                    ];
                });
                return sendExcel(res, "GL_Mapping", headers, rows);
            }
            // D7 — Manual Ledger Entries
            case "manual-ledger": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.entryDate = dr;
                const entries = yield prismaClient_1.default.manualLedgerEntry.findMany({
                    where,
                    orderBy: { entryDate: "desc" },
                });
                const headers = ["Entry No", "Entry Date", "Account", "Type", "Amount (₹)", "Narration", "Created On"];
                const rows = entries.map((e) => {
                    var _a, _b, _c, _d, _e;
                    return [
                        (_a = e.entryNo) !== null && _a !== void 0 ? _a : e.id,
                        fmt(e.entryDate),
                        (_c = (_b = e.accountName) !== null && _b !== void 0 ? _b : e.account) !== null && _c !== void 0 ? _c : "",
                        (_d = e.type) !== null && _d !== void 0 ? _d : "",
                        money(e.amount),
                        (_e = e.narration) !== null && _e !== void 0 ? _e : "",
                        fmt(e.createdAt),
                    ];
                });
                return sendExcel(res, "Manual_Ledger", headers, rows, { total: true });
            }
            // D8 — Sub-Ledger by Asset (depreciation log + cost allocations)
            case "sub-ledger-by-asset": {
                const where = {};
                if (f.assetCategoryId)
                    where.assetCategoryId = f.assetCategoryId;
                const assets = yield prismaClient_1.default.asset.findMany({
                    where,
                    include: {
                        assetCategory: true,
                        depreciation: true,
                        depreciationLogs: { orderBy: { periodEnd: "desc" }, take: 12 },
                        costAllocations: true,
                    },
                });
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Purchase Cost (₹)",
                    "Total Depreciation Posted (₹)", "Total Cost Allocations (₹)", "Net Book Value (₹)",
                    "Last Depreciation Period",
                ];
                const rows = assets.map(a => {
                    var _a, _b, _c, _d, _e;
                    const dep = (a.depreciationLogs || []).reduce((s, l) => s + num(l.depreciationAmount), 0);
                    const cost = (a.costAllocations || []).reduce((s, l) => s + num(l.amount), 0);
                    const lastPeriod = (_b = (_a = a.depreciationLogs) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.periodEnd;
                    return [
                        a.assetId, a.assetName,
                        (_d = (_c = a.assetCategory) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        money(a.purchaseCost), money(dep), money(cost),
                        money((_e = a.depreciation) === null || _e === void 0 ? void 0 : _e.currentBookValue),
                        fmt(lastPeriod),
                    ];
                });
                return sendExcel(res, "Sub_Ledger_by_Asset", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP E — CAPEX & COST
            // ═══════════════════════════════════════════════════════════════════
            // E1 — Capex Budget vs Actual
            case "capex-budget-vs-actual": {
                const where = {};
                if (f.year)
                    where.fiscalYear = f.year;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                const rows0 = yield prismaClient_1.default.capexBudget.findMany({
                    where,
                    include: { department: true, category: true, createdBy: true },
                    orderBy: { fiscalYear: "desc" },
                });
                const headers = [
                    "Fiscal Year", "Department", "Category",
                    "Budget (₹)", "Actual (₹)", "Variance (₹)", "Utilisation (%)",
                    "Created By", "Notes",
                ];
                const rows = rows0.map((r) => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    const budget = num(r.budgetAmount);
                    const actual = num(r.actualAmount);
                    const variance = budget - actual;
                    const util = budget > 0 ? (actual / budget) * 100 : 0;
                    return [
                        r.fiscalYear,
                        (_b = (_a = r.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "All",
                        (_d = (_c = r.category) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "All",
                        money(budget), money(actual), money(variance), util.toFixed(2),
                        (_f = (_e = r.createdBy) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        (_g = r.notes) !== null && _g !== void 0 ? _g : "",
                    ];
                });
                return sendExcel(res, "Capex_Budget_vs_Actual", headers, rows, { total: true });
            }
            // E2 — Cost per Asset (Total Cost of Ownership)
            case "cost-per-asset-tco": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: {
                        assetCategory: true,
                        depreciation: true,
                        costAllocations: true,
                        insurance: true,
                        serviceContracts: true,
                    },
                });
                const headers = [
                    "Asset ID", "Asset Name", "Category",
                    "Purchase Cost (₹)", "Maintenance & Allocations (₹)",
                    "Insurance Premium (₹)", "AMC Cost (₹)",
                    "Total Cost of Ownership (₹)", "Net Book Value (₹)",
                ];
                const rows = assets.map(a => {
                    var _a, _b, _c;
                    const alloc = (a.costAllocations || []).reduce((s, l) => s + num(l.amount), 0);
                    const ins = (a.insurance || []).reduce((s, l) => s + num(l.premiumAmount), 0);
                    const amc = (a.serviceContracts || []).reduce((s, l) => { var _a, _b; return s + num((_b = (_a = l.contractValue) !== null && _a !== void 0 ? _a : l.value) !== null && _b !== void 0 ? _b : 0); }, 0);
                    const tco = num(a.purchaseCost) + alloc + ins + amc;
                    return [
                        a.assetId, a.assetName,
                        (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        money(a.purchaseCost), money(alloc), money(ins), money(amc),
                        money(tco), money((_c = a.depreciation) === null || _c === void 0 ? void 0 : _c.currentBookValue),
                    ];
                });
                return sendExcel(res, "Cost_per_Asset_TCO", headers, rows, { total: true });
            }
            // E3 — Maintenance Spend by Department / Category
            case "maintenance-spend": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.entryDate = dr;
                const allocs = yield prismaClient_1.default.assetCostAllocation.findMany({
                    where,
                    include: { asset: { include: { assetCategory: true, department: true } } },
                });
                const agg = new Map();
                for (const c of allocs) {
                    const dept = (_7 = (_6 = (_5 = c.asset) === null || _5 === void 0 ? void 0 : _5.department) === null || _6 === void 0 ? void 0 : _6.name) !== null && _7 !== void 0 ? _7 : "Unassigned";
                    const cat = (_10 = (_9 = (_8 = c.asset) === null || _8 === void 0 ? void 0 : _8.assetCategory) === null || _9 === void 0 ? void 0 : _9.name) !== null && _10 !== void 0 ? _10 : "Unassigned";
                    const key = `${dept}||${cat}`;
                    if (!agg.has(key))
                        agg.set(key, { department: dept, category: cat, cost: 0, count: 0 });
                    const e = agg.get(key);
                    e.cost += num(c.amount);
                    e.count++;
                }
                const headers = ["Department", "Category", "Entries", "Total Spend (₹)"];
                const rows = Array.from(agg.values())
                    .sort((a, b) => b.cost - a.cost)
                    .map(v => [v.department, v.category, v.count, money(v.cost)]);
                return sendExcel(res, "Maintenance_Spend", headers, rows, { total: true });
            }
            // E4 — Capex vs Opex Split
            case "capex-vs-opex": {
                const where = {};
                if (f.year) {
                    where.purchaseDate = {
                        gte: new Date(f.year, 3, 1),
                        lte: new Date(f.year + 1, 2, 31, 23, 59, 59),
                    };
                }
                const [assets, allocations] = yield Promise.all([
                    prismaClient_1.default.asset.findMany({ where, select: { purchaseCost: true, assetNature: true } }),
                    prismaClient_1.default.assetCostAllocation.findMany({
                        where: dateRangeOn(f) ? { entryDate: dateRangeOn(f) } : {},
                        select: { amount: true },
                    }),
                ]);
                const capex = assets.reduce((s, a) => s + num(a.purchaseCost), 0);
                const opex = allocations.reduce((s, a) => s + num(a.amount), 0);
                const headers = ["Category", "Amount (₹)", "Share (%)"];
                const total = capex + opex || 1;
                const rows = [
                    ["Capex (Asset Purchases)", money(capex), ((capex / total) * 100).toFixed(2)],
                    ["Opex (Cost Allocations)", money(opex), ((opex / total) * 100).toFixed(2)],
                    ["Total", money(capex + opex), "100.00"],
                ];
                return sendExcel(res, "Capex_vs_Opex", headers, rows);
            }
            // E5 — Top Vendors by Spend (per FY)
            case "top-vendors-by-spend": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.poDate = dr;
                const pos = yield prismaClient_1.default.purchaseOrder.findMany({ where, include: { vendor: true } });
                const agg = new Map();
                for (const p of pos) {
                    if (!p.vendorId)
                        continue;
                    if (!agg.has(p.vendorId))
                        agg.set(p.vendorId, { name: (_12 = (_11 = p.vendor) === null || _11 === void 0 ? void 0 : _11.name) !== null && _12 !== void 0 ? _12 : "", gst: (_14 = (_13 = p.vendor) === null || _13 === void 0 ? void 0 : _13.gstNumber) !== null && _14 !== void 0 ? _14 : "", pos: 0, value: 0 });
                    const e = agg.get(p.vendorId);
                    e.pos++;
                    e.value += num(p.totalAmount);
                }
                const headers = ["Vendor", "GST No", "PO Count", "Total PO Value (₹)"];
                const rows = Array.from(agg.values())
                    .sort((a, b) => b.value - a.value)
                    .map(v => [v.name, v.gst, v.pos, money(v.value)]);
                return sendExcel(res, "Top_Vendors_by_Spend", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP F — PROCUREMENT & STORE
            // ═══════════════════════════════════════════════════════════════════
            // F1 — Purchase Orders (multi-sheet: PO + lines + linked GRNs)
            case "purchase-orders": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.poDate = dr;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                const pos = yield prismaClient_1.default.purchaseOrder.findMany({
                    where,
                    include: {
                        vendor: true, department: true, indent: true,
                        lines: { include: { store: true } },
                        goodsReceipts: { include: { vendor: true } },
                    },
                    orderBy: { poDate: "desc" },
                });
                const masterHeaders = [
                    "PO Number", "PO Date", "FY", "Vendor", "GST No", "Department", "Indent",
                    "Status", "Subtotal (₹)", "Tax (₹)", "Total (₹)", "Line Count",
                ];
                const masterRows = pos.map((p) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        p.poNumber, fmt(p.poDate), fyLabelFromDate(p.poDate),
                        (_b = (_a = p.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = p.vendor) === null || _c === void 0 ? void 0 : _c.gstNumber) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = p.department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        (_h = (_g = p.indent) === null || _g === void 0 ? void 0 : _g.indentNumber) !== null && _h !== void 0 ? _h : "",
                        p.status, money(p.subtotal), money(p.taxAmount), money(p.totalAmount),
                        (p.lines || []).length,
                    ];
                });
                const lineHeaders = [
                    "PO Number", "Line #", "Item Type", "Description",
                    "HSN", "Store", "Quantity", "Unit Price (₹)", "Tax %", "Line Total (₹)",
                    "Received Qty", "Pending Qty",
                ];
                const lineRows = pos.flatMap((p) => (p.lines || []).map((l) => {
                    var _a, _b, _c, _d;
                    return [
                        p.poNumber, l.lineNumber, l.itemType, l.description,
                        (_a = l.hsnCode) !== null && _a !== void 0 ? _a : "",
                        (_c = (_b = l.store) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "",
                        l.quantity, money(l.unitPrice), num(l.taxPercent).toFixed(2), money(l.lineTotal),
                        l.receivedQty,
                        (_d = l.pendingQty) !== null && _d !== void 0 ? _d : "",
                    ];
                }));
                const grnHeaders = ["PO Number", "GRN Number", "GRN Date", "Vendor", "Status", "Delivery Date"];
                const grnRows = pos.flatMap((p) => (p.goodsReceipts || []).map((g) => {
                    var _a, _b;
                    return [
                        p.poNumber, g.grnNumber, fmt(g.grnDate),
                        (_b = (_a = g.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        g.status, fmt(g.deliveryDate),
                    ];
                }));
                return sendMultiSheetExcel(res, "Purchase_Orders", [
                    { name: "POs", headers: masterHeaders, rows: masterRows, total: true },
                    { name: "Lines", headers: lineHeaders, rows: lineRows, total: true },
                    { name: "GRNs", headers: grnHeaders, rows: grnRows },
                ]);
            }
            // F2 — Goods Receipt Notes
            case "goods-receipts": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.grnDate = dr;
                if (f.vendorId)
                    where.vendorId = f.vendorId;
                const grs = yield prismaClient_1.default.goodsReceipt.findMany({
                    where,
                    include: { vendor: true, purchaseOrder: true, lines: true },
                    orderBy: { grnDate: "desc" },
                });
                const headers = [
                    "GRN Number", "GRN Date", "PO Number", "Vendor", "Status",
                    "Delivery Challan No", "Delivery Date", "Inspection Remarks", "Line Count",
                ];
                const rows = grs.map((g) => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        g.grnNumber, fmt(g.grnDate),
                        (_b = (_a = g.purchaseOrder) === null || _a === void 0 ? void 0 : _a.poNumber) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = g.vendor) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        g.status,
                        (_e = g.deliveryChallanNo) !== null && _e !== void 0 ? _e : "",
                        fmt(g.deliveryDate),
                        (_f = g.inspectionRemarks) !== null && _f !== void 0 ? _f : "",
                        (g.lines || []).length,
                    ];
                });
                return sendExcel(res, "Goods_Receipts", headers, rows);
            }
            // F3 — Material Requests
            case "material-requests": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                const reqs = yield prismaClient_1.default.materialRequest.findMany({
                    where,
                    include: { ticket: { include: { asset: true, raisedBy: true } }, approvedBy: true },
                    orderBy: { createdAt: "desc" },
                });
                const headers = [
                    "Ticket ID", "Asset", "Raised By", "Item Type", "Description",
                    "Quantity", "Estimated Cost (₹)", "Status",
                    "Approved By", "Approved On", "Expected Delivery", "Created On",
                ];
                const rows = reqs.map((r) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                    return [
                        (_b = (_a = r.ticket) === null || _a === void 0 ? void 0 : _a.ticketId) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = r.ticket) === null || _c === void 0 ? void 0 : _c.asset) === null || _d === void 0 ? void 0 : _d.assetName) !== null && _e !== void 0 ? _e : "",
                        (_h = (_g = (_f = r.ticket) === null || _f === void 0 ? void 0 : _f.raisedBy) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        r.itemType, r.description, num(r.quantity),
                        money(r.estimatedCost), r.status,
                        (_k = (_j = r.approvedBy) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        fmt(r.approvedAt),
                        fmt(r.expectedDelivery), fmt(r.createdAt),
                    ];
                });
                return sendExcel(res, "Material_Requests", headers, rows, { total: true });
            }
            // F4 — Asset Indents
            case "asset-indents": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                if (f.assetCategoryId)
                    where.assetCategoryId = f.assetCategoryId;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                const indents = yield prismaClient_1.default.assetIndent.findMany({
                    where,
                    include: { raisedBy: true, department: true, assetCategory: true },
                    orderBy: { createdAt: "desc" },
                });
                const headers = [
                    "Indent No", "Raised By", "Department", "Category",
                    "Asset Name", "Quantity", "Urgency",
                    "Estimated Budget (₹)", "Required By", "Specifications", "Status", "Created On",
                ];
                const rows = indents.map((i) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        i.indentNumber,
                        (_b = (_a = i.raisedBy) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = i.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = i.assetCategory) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        i.assetName, i.quantity, i.urgency,
                        money(i.estimatedBudget), fmt(i.requiredByDate),
                        (_g = i.specifications) !== null && _g !== void 0 ? _g : "",
                        (_h = i.status) !== null && _h !== void 0 ? _h : "",
                        fmt(i.createdAt),
                    ];
                });
                return sendExcel(res, "Asset_Indents", headers, rows, { total: true });
            }
            // F5 — Store Stock Position
            case "store-stock-position": {
                const stock = yield prismaClient_1.default.storeStockPosition.findMany({
                    include: { store: true, sparePart: true, consumable: true },
                });
                const headers = [
                    "Store", "Item Type", "Item Name", "Current Qty",
                    "Reorder Level", "Status",
                ];
                const rows = stock.map(s => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    const itemName = (_d = (_b = (_a = s.sparePart) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : (_c = s.consumable) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "";
                    const itemType = s.sparePart ? "Spare Part" : s.consumable ? "Consumable" : "";
                    const current = num(s.currentQty);
                    const reorder = num(s.reorderLevel);
                    const status = reorder > 0 && current <= reorder ? "LOW STOCK" : "OK";
                    return [(_f = (_e = s.store) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "", itemType, itemName, current, (_g = s.reorderLevel) !== null && _g !== void 0 ? _g : "", status];
                });
                return sendExcel(res, "Store_Stock_Position", headers, rows);
            }
            // F6 — Inventory Ageing (consumable batches by expiry)
            case "inventory-ageing": {
                const batches = yield prismaClient_1.default.consumableBatch.findMany({
                    include: { consumable: true },
                    orderBy: { expiryDate: "asc" },
                }).catch(() => []);
                const now = new Date();
                const headers = ["Consumable", "Batch No", "Qty", "Expiry Date", "Days to Expiry", "Status"];
                const rows = batches.map((b) => {
                    var _a, _b, _c;
                    const daysToExpiry = b.expiryDate
                        ? Math.floor((new Date(b.expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        : null;
                    const status = daysToExpiry === null ? "" : daysToExpiry < 0 ? "EXPIRED" : daysToExpiry <= 30 ? "EXPIRING SOON" : "OK";
                    return [(_b = (_a = b.consumable) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "", (_c = b.batchNo) !== null && _c !== void 0 ? _c : "", num(b.quantity), fmt(b.expiryDate), daysToExpiry !== null && daysToExpiry !== void 0 ? daysToExpiry : "", status];
                });
                return sendExcel(res, "Inventory_Ageing", headers, rows);
            }
            // F7 — Slow / Non-Moving Spares (no usage in last 6 months)
            case "slow-moving-spares": {
                const sixMoAgo = new Date();
                sixMoAgo.setMonth(sixMoAgo.getMonth() - 6);
                const spares = yield prismaClient_1.default.sparePart.findMany({
                    include: { usages: { where: { createdAt: { gte: sixMoAgo } } } },
                });
                const headers = ["Spare Part", "Stock Qty", "Reorder Level", "Cost (₹)", "Usage (6 mo)", "Status"];
                const rows = spares
                    .map(s => {
                    var _a, _b;
                    const usage = (s.usages || []).length;
                    return [s.name, (_a = s.stockQuantity) !== null && _a !== void 0 ? _a : "", (_b = s.reorderLevel) !== null && _b !== void 0 ? _b : "", money(s.cost), usage, usage === 0 ? "NON-MOVING" : usage <= 2 ? "SLOW" : "MOVING"];
                })
                    .filter(r => r[5] !== "MOVING");
                return sendExcel(res, "Slow_Moving_Spares", headers, rows, { total: true });
            }
            // F8 — Reorder List
            case "reorder-list": {
                const stock = yield prismaClient_1.default.storeStockPosition.findMany({
                    where: { reorderLevel: { not: null } },
                    include: { store: true, sparePart: true, consumable: true },
                });
                const low = stock.filter(s => num(s.currentQty) <= num(s.reorderLevel));
                const headers = ["Store", "Item Type", "Item Name", "Current Qty", "Reorder Level", "Shortfall"];
                const rows = low.map(s => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        (_b = (_a = s.store) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        s.sparePart ? "Spare Part" : "Consumable",
                        (_f = (_d = (_c = s.sparePart) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : (_e = s.consumable) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        num(s.currentQty), num(s.reorderLevel),
                        num(s.reorderLevel) - num(s.currentQty),
                    ];
                });
                return sendExcel(res, "Reorder_List", headers, rows);
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP G — VENDOR ANALYTICS
            // ═══════════════════════════════════════════════════════════════════
            // G1 — Vendor Master
            case "vendor-master": {
                const vendors = yield prismaClient_1.default.vendor.findMany({ orderBy: { name: "asc" } });
                const headers = [
                    "Vendor", "Contact Person", "Phone", "Alternate Phone", "Email",
                    "Address", "City", "State", "Pincode",
                    "GST No", "PAN", "Vendor Type", "Rating", "Active",
                    "Bank Name", "Bank Account", "IFSC",
                ];
                const rows = vendors.map((v) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
                    return [
                        v.name,
                        (_a = v.contactPerson) !== null && _a !== void 0 ? _a : "",
                        v.contact,
                        (_b = v.alternatePhone) !== null && _b !== void 0 ? _b : "",
                        (_c = v.email) !== null && _c !== void 0 ? _c : "",
                        (_d = v.address) !== null && _d !== void 0 ? _d : "",
                        (_e = v.city) !== null && _e !== void 0 ? _e : "",
                        (_f = v.state) !== null && _f !== void 0 ? _f : "",
                        (_g = v.pincode) !== null && _g !== void 0 ? _g : "",
                        (_h = v.gstNumber) !== null && _h !== void 0 ? _h : "",
                        (_j = v.panNumber) !== null && _j !== void 0 ? _j : "",
                        (_k = v.vendorType) !== null && _k !== void 0 ? _k : "",
                        (_l = v.rating) !== null && _l !== void 0 ? _l : "",
                        yn(v.isActive),
                        (_m = v.bankName) !== null && _m !== void 0 ? _m : "",
                        (_o = v.bankAccount) !== null && _o !== void 0 ? _o : "",
                        (_p = v.bankIfsc) !== null && _p !== void 0 ? _p : "",
                    ];
                });
                return sendExcel(res, "Vendor_Master", headers, rows);
            }
            // G2 — Vendor Performance
            case "vendor-performance": {
                const perf = yield prismaClient_1.default.vendorPerformanceMetric.findMany({
                    include: { vendor: true },
                }).catch(() => __awaiter(void 0, void 0, void 0, function* () {
                    // fallback: compute basic metrics from POs + GRs
                    const vs = yield prismaClient_1.default.vendor.findMany({ include: { purchaseOrders: { include: { goodsReceipts: true } } } });
                    return vs.map(v => {
                        var _a, _b, _c, _d;
                        return ({
                            vendor: v,
                            totalPOs: (_b = (_a = v.purchaseOrders) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
                            grns: (_d = (_c = v.purchaseOrders) === null || _c === void 0 ? void 0 : _c.reduce((s, p) => { var _a, _b; return s + ((_b = (_a = p.goodsReceipts) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0); }, 0)) !== null && _d !== void 0 ? _d : 0,
                            rating: v.rating,
                        });
                    });
                }));
                const headers = ["Vendor", "GST No", "Rating", "Total POs", "GRNs", "On-Time %", "Defect %"];
                const rows = perf.map((p) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
                    return [
                        (_b = (_a = p.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = p.vendor) === null || _c === void 0 ? void 0 : _c.gstNumber) !== null && _d !== void 0 ? _d : "",
                        (_g = (_e = p.rating) !== null && _e !== void 0 ? _e : (_f = p.vendor) === null || _f === void 0 ? void 0 : _f.rating) !== null && _g !== void 0 ? _g : "",
                        (_h = p.totalPOs) !== null && _h !== void 0 ? _h : "",
                        (_j = p.grns) !== null && _j !== void 0 ? _j : "",
                        (_m = (_l = (_k = p.onTimePct) === null || _k === void 0 ? void 0 : _k.toFixed) === null || _l === void 0 ? void 0 : _l.call(_k, 2)) !== null && _m !== void 0 ? _m : "",
                        (_q = (_p = (_o = p.defectPct) === null || _o === void 0 ? void 0 : _o.toFixed) === null || _p === void 0 ? void 0 : _p.call(_o, 2)) !== null && _q !== void 0 ? _q : "",
                    ];
                });
                return sendExcel(res, "Vendor_Performance", headers, rows);
            }
            // G3 — Vendor Outstanding (PO raised vs invoiced vs paid)
            case "vendor-outstanding": {
                const vendors = yield prismaClient_1.default.vendor.findMany({
                    include: {
                        purchaseOrders: { select: { totalAmount: true } },
                    },
                });
                const purchaseVouchers = yield prismaClient_1.default.purchaseVoucher.findMany({ select: { vendorId: true, amount: true } });
                const paymentVouchers = yield prismaClient_1.default.paymentVoucher.findMany({ select: { vendorId: true, amount: true, status: true } });
                const pvByVendor = new Map();
                for (const pv of purchaseVouchers) {
                    if (pv.vendorId)
                        pvByVendor.set(pv.vendorId, (pvByVendor.get(pv.vendorId) || 0) + num(pv.amount));
                }
                const paidByVendor = new Map();
                for (const pmt of paymentVouchers) {
                    if (pmt.vendorId && pmt.status === "APPROVED") {
                        paidByVendor.set(pmt.vendorId, (paidByVendor.get(pmt.vendorId) || 0) + num(pmt.amount));
                    }
                }
                const headers = ["Vendor", "GST No", "PO Value (₹)", "Invoiced (₹)", "Paid (₹)", "Outstanding (₹)"];
                const rows = vendors.map(v => {
                    var _a;
                    const poVal = (v.purchaseOrders || []).reduce((s, p) => s + num(p.totalAmount), 0);
                    const inv = pvByVendor.get(v.id) || 0;
                    const paid = paidByVendor.get(v.id) || 0;
                    return [v.name, (_a = v.gstNumber) !== null && _a !== void 0 ? _a : "", money(poVal), money(inv), money(paid), money(inv - paid)];
                });
                return sendExcel(res, "Vendor_Outstanding", headers, rows, { total: true });
            }
            // G4 — Price Variance (PO rate vs Invoice rate)
            case "price-variance": {
                const invoices = yield prismaClient_1.default.serviceInvoice.findMany({
                    where: dateRangeOn(f) ? { invoiceDate: dateRangeOn(f) } : {},
                    include: { vendor: true, asset: true },
                });
                const headers = ["Invoice No", "Invoice Date", "Vendor", "Asset", "Invoice Amount (₹)", "Net (₹)", "GST (₹)"];
                const rows = invoices.map((i) => {
                    var _a, _b, _c, _d, _e;
                    return [
                        i.invoiceNo, fmt(i.invoiceDate),
                        (_b = (_a = i.vendor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = i.asset) === null || _c === void 0 ? void 0 : _c.assetId) !== null && _d !== void 0 ? _d : "",
                        money((_e = i.invoiceAmount) !== null && _e !== void 0 ? _e : i.netAmount), money(i.netAmount), money(i.gstAmount),
                    ];
                });
                return sendExcel(res, "Price_Variance", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP H — INSURANCE & CLAIMS
            // ═══════════════════════════════════════════════════════════════════
            // H1 — Insurance Policies (multi-sheet: policies + claims)
            case "insurance-policies": {
                const [policies, claims] = yield Promise.all([
                    prismaClient_1.default.assetInsurance.findMany({
                        include: { asset: { include: { assetCategory: true, department: true } }, vendor: true },
                    }),
                    prismaClient_1.default.insuranceClaim.findMany({
                        include: { insurance: { include: { asset: true } } },
                        orderBy: { createdAt: "desc" },
                    }),
                ]);
                const policyHeaders = [
                    "Policy No", "Asset", "Category", "Department", "Insurer",
                    "Policy Type", "Coverage Amount (₹)", "Premium (₹)",
                    "Start Date", "End Date", "Status", "Active",
                ];
                const policyRows = policies.map(p => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
                    return [
                        p.policyNumber,
                        (_b = (_a = p.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = p.asset) === null || _c === void 0 ? void 0 : _c.assetCategory) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        (_h = (_g = (_f = p.asset) === null || _f === void 0 ? void 0 : _f.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        (_l = (_k = (_j = p.vendor) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : p.insurerName) !== null && _l !== void 0 ? _l : "",
                        (_m = p.policyType) !== null && _m !== void 0 ? _m : "",
                        money(p.coverageAmount), money(p.premiumAmount),
                        fmt(p.startDate), fmt(p.endDate),
                        (_o = p.policyStatus) !== null && _o !== void 0 ? _o : "",
                        yn(p.isActive),
                    ];
                });
                const claimHeaders = [
                    "Claim No", "Policy No", "Asset", "Claim Date",
                    "Claim Amount (₹)", "Settled Amount (₹)", "Status", "Settled On", "Reason",
                ];
                const claimRows = claims.map(c => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        (_a = c.claimNumber) !== null && _a !== void 0 ? _a : c.id,
                        (_c = (_b = c.insurance) === null || _b === void 0 ? void 0 : _b.policyNumber) !== null && _c !== void 0 ? _c : "",
                        (_f = (_e = (_d = c.insurance) === null || _d === void 0 ? void 0 : _d.asset) === null || _e === void 0 ? void 0 : _e.assetName) !== null && _f !== void 0 ? _f : "",
                        fmt(c.claimDate),
                        money(c.claimAmount), money(c.settledAmount), c.status,
                        fmt(c.settledAt),
                        (_g = c.reason) !== null && _g !== void 0 ? _g : "",
                    ];
                });
                return sendMultiSheetExcel(res, "Insurance_Policies", [
                    { name: "Policies", headers: policyHeaders, rows: policyRows, total: true },
                    { name: "Claims", headers: claimHeaders, rows: claimRows, total: true },
                ]);
            }
            // H2 — Premium Paid by FY
            case "premium-paid-by-fy": {
                const policies = yield prismaClient_1.default.assetInsurance.findMany({ include: { asset: true } });
                const agg = new Map();
                for (const p of policies) {
                    const fy = fyLabelFromDate(p.startDate);
                    if (!agg.has(fy))
                        agg.set(fy, { count: 0, premium: 0, coverage: 0 });
                    const e = agg.get(fy);
                    e.count++;
                    e.premium += num(p.premiumAmount);
                    e.coverage += num(p.coverageAmount);
                }
                const headers = ["FY", "Policies", "Total Premium (₹)", "Total Coverage (₹)"];
                const rows = Array.from(agg.entries())
                    .sort()
                    .map(([fy, v]) => [fy, v.count, money(v.premium), money(v.coverage)]);
                return sendExcel(res, "Premium_Paid_by_FY", headers, rows, { total: true });
            }
            // H3 — Claims Raised vs Settled
            case "claims-raised-vs-settled": {
                const claims = yield prismaClient_1.default.insuranceClaim.findMany({
                    where: dateRangeOn(f) ? { createdAt: dateRangeOn(f) } : {},
                    include: { insurance: { include: { asset: true } } },
                });
                let raised = 0, settled = 0, pending = 0, rejected = 0;
                let raisedAmt = 0, settledAmt = 0;
                for (const c of claims) {
                    raised++;
                    raisedAmt += num(c.claimAmount);
                    const s = String(c.status || "").toUpperCase();
                    if (s === "SETTLED" || s === "APPROVED") {
                        settled++;
                        settledAmt += num(c.settledAmount);
                    }
                    else if (s === "REJECTED")
                        rejected++;
                    else
                        pending++;
                }
                const headers = ["Metric", "Count", "Amount (₹)"];
                const rows = [
                    ["Claims Raised", raised, money(raisedAmt)],
                    ["Claims Settled", settled, money(settledAmt)],
                    ["Claims Pending", pending, ""],
                    ["Claims Rejected", rejected, ""],
                ];
                return sendExcel(res, "Claims_Raised_vs_Settled", headers, rows);
            }
            // H4 — Pending Claims
            case "pending-claims": {
                const claims = yield prismaClient_1.default.insuranceClaim.findMany({
                    where: { status: { notIn: ["SETTLED", "APPROVED", "REJECTED", "CLOSED"] } },
                    include: { insurance: { include: { asset: { include: { assetCategory: true, department: true } } } } },
                });
                const headers = ["Claim No", "Policy No", "Asset", "Category", "Department", "Claim Date", "Claim Amount (₹)", "Status", "Days Pending"];
                const now = Date.now();
                const rows = claims.map(c => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
                    return [
                        (_a = c.claimNumber) !== null && _a !== void 0 ? _a : c.id,
                        (_c = (_b = c.insurance) === null || _b === void 0 ? void 0 : _b.policyNumber) !== null && _c !== void 0 ? _c : "",
                        (_f = (_e = (_d = c.insurance) === null || _d === void 0 ? void 0 : _d.asset) === null || _e === void 0 ? void 0 : _e.assetName) !== null && _f !== void 0 ? _f : "",
                        (_k = (_j = (_h = (_g = c.insurance) === null || _g === void 0 ? void 0 : _g.asset) === null || _h === void 0 ? void 0 : _h.assetCategory) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        (_p = (_o = (_m = (_l = c.insurance) === null || _l === void 0 ? void 0 : _l.asset) === null || _m === void 0 ? void 0 : _m.department) === null || _o === void 0 ? void 0 : _o.name) !== null && _p !== void 0 ? _p : "",
                        fmt(c.claimDate), money(c.claimAmount), c.status,
                        c.claimDate ? Math.floor((now - new Date(c.claimDate).getTime()) / (1000 * 60 * 60 * 24)) : "",
                    ];
                });
                return sendExcel(res, "Pending_Claims", headers, rows, { total: true });
            }
            // H5 — Insurance Coverage Gaps (assets without an active policy)
            case "insurance-coverage-gaps": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true, department: true, insurance: true },
                });
                const gaps = assets.filter(a => {
                    const active = (a.insurance || []).some((p) => p.isActive && (!p.endDate || new Date(p.endDate) >= new Date()));
                    const inService = !["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());
                    return inService && !active;
                });
                const headers = ["Asset ID", "Asset Name", "Category", "Department", "Purchase Cost (₹)", "Status"];
                const rows = gaps.map((a) => {
                    var _a, _b, _c, _d, _e;
                    return [
                        a.assetId, a.assetName,
                        (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = a.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        money(a.purchaseCost),
                        (_e = a.status) !== null && _e !== void 0 ? _e : "",
                    ];
                });
                return sendExcel(res, "Insurance_Coverage_Gaps", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP I — WARRANTY & SERVICE CONTRACTS
            // ═══════════════════════════════════════════════════════════════════
            // I1 — Warranties
            case "warranties": {
                const warranties = yield prismaClient_1.default.warranty.findMany({
                    include: { asset: { include: { assetCategory: true, department: true } }, vendor: true },
                });
                const now = new Date();
                const headers = [
                    "Asset ID", "Asset Name", "Category", "Department",
                    "Warranty Type", "Provider", "Reference",
                    "Warranty Start", "Warranty End", "Days to Expiry", "Status",
                    "Coverage Details", "Support Contact",
                ];
                const rows = warranties.map(w => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
                    const days = w.warrantyEnd
                        ? Math.floor((new Date(w.warrantyEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        : null;
                    const status = days === null ? "" : days < 0 ? "EXPIRED" : days <= 30 ? "EXPIRING SOON" : "ACTIVE";
                    return [
                        (_b = (_a = w.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = w.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_g = (_f = (_e = w.asset) === null || _e === void 0 ? void 0 : _e.assetCategory) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_k = (_j = (_h = w.asset) === null || _h === void 0 ? void 0 : _h.department) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        (_l = w.warrantyType) !== null && _l !== void 0 ? _l : "",
                        (_p = (_m = w.warrantyProvider) !== null && _m !== void 0 ? _m : (_o = w.vendor) === null || _o === void 0 ? void 0 : _o.name) !== null && _p !== void 0 ? _p : "",
                        (_q = w.warrantyReference) !== null && _q !== void 0 ? _q : "",
                        fmt(w.warrantyStart), fmt(w.warrantyEnd),
                        days !== null && days !== void 0 ? days : "",
                        status,
                        (_r = w.coverageDetails) !== null && _r !== void 0 ? _r : "",
                        (_s = w.supportContact) !== null && _s !== void 0 ? _s : "",
                    ];
                });
                return sendExcel(res, "Warranties", headers, rows);
            }
            // I2 — Service Contracts (AMC/CMC)
            case "service-contracts": {
                const contracts = yield prismaClient_1.default.serviceContract.findMany({
                    include: { asset: { include: { assetCategory: true, department: true } }, vendor: true },
                    orderBy: { endDate: "asc" },
                });
                const now = new Date();
                const headers = [
                    "Contract No", "Asset", "Category", "Department",
                    "Contract Type", "Vendor", "Status",
                    "Start Date", "End Date", "Days to Expiry",
                    "Contract Value (₹)", "Coverage", "Service Window",
                ];
                const rows = contracts.map(c => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
                    const days = c.endDate ? Math.floor((new Date(c.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
                    return [
                        (_a = c.contractNumber) !== null && _a !== void 0 ? _a : c.id,
                        (_c = (_b = c.asset) === null || _b === void 0 ? void 0 : _b.assetName) !== null && _c !== void 0 ? _c : "",
                        (_f = (_e = (_d = c.asset) === null || _d === void 0 ? void 0 : _d.assetCategory) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        (_j = (_h = (_g = c.asset) === null || _g === void 0 ? void 0 : _g.department) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "",
                        c.contractType,
                        (_l = (_k = c.vendor) === null || _k === void 0 ? void 0 : _k.name) !== null && _l !== void 0 ? _l : "",
                        c.status,
                        fmt(c.startDate), fmt(c.endDate),
                        days !== null && days !== void 0 ? days : "",
                        money((_m = c.contractValue) !== null && _m !== void 0 ? _m : c.value),
                        (_o = c.coverage) !== null && _o !== void 0 ? _o : "",
                        (_p = c.serviceWindow) !== null && _p !== void 0 ? _p : "",
                    ];
                });
                return sendExcel(res, "Service_Contracts", headers, rows, { total: true });
            }
            // I3 — Warranty Utilisation (claims raised vs expired unused)
            case "warranty-utilisation": {
                const warranties = yield prismaClient_1.default.warranty.findMany({
                    include: { asset: true },
                });
                let active = 0, expiredUnused = 0, expiredUsed = 0;
                for (const w of warranties) {
                    const expired = w.warrantyEnd && new Date(w.warrantyEnd) < new Date();
                    if (!expired)
                        active++;
                    else if (w.claimsCount && w.claimsCount > 0)
                        expiredUsed++;
                    else
                        expiredUnused++;
                }
                const total = warranties.length || 1;
                const headers = ["Status", "Count", "Share (%)"];
                const rows = [
                    ["Active", active, ((active / total) * 100).toFixed(2)],
                    ["Expired (used)", expiredUsed, ((expiredUsed / total) * 100).toFixed(2)],
                    ["Expired (unused)", expiredUnused, ((expiredUnused / total) * 100).toFixed(2)],
                ];
                return sendExcel(res, "Warranty_Utilisation", headers, rows);
            }
            // I4 — AMC Coverage Gaps
            case "amc-coverage-gaps": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true, department: true, serviceContracts: true },
                });
                const now = new Date();
                const gaps = assets.filter(a => {
                    const active = (a.serviceContracts || []).some((c) => c.status === "ACTIVE" && (!c.endDate || new Date(c.endDate) >= now));
                    const inService = !["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());
                    return inService && !active;
                });
                const headers = ["Asset ID", "Asset Name", "Category", "Department", "Purchase Cost (₹)", "Status"];
                const rows = gaps.map((a) => {
                    var _a, _b, _c, _d, _e;
                    return [
                        a.assetId, a.assetName,
                        (_b = (_a = a.assetCategory) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = a.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        money(a.purchaseCost),
                        (_e = a.status) !== null && _e !== void 0 ? _e : "",
                    ];
                });
                return sendExcel(res, "AMC_Coverage_Gaps", headers, rows, { total: true });
            }
            // I5 — AMC Renewal Cost Projection (contracts expiring in next 12 months)
            case "amc-renewal-projection": {
                const now = new Date();
                const oneYear = new Date();
                oneYear.setFullYear(oneYear.getFullYear() + 1);
                const contracts = yield prismaClient_1.default.serviceContract.findMany({
                    where: { status: "ACTIVE", endDate: { gte: now, lte: oneYear } },
                    include: { asset: { include: { assetCategory: true } }, vendor: true },
                    orderBy: { endDate: "asc" },
                });
                const headers = ["Asset", "Category", "Vendor", "Current Contract Value (₹)", "Expiry Date", "Renewal FY"];
                const rows = contracts.map(c => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = c.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = c.asset) === null || _c === void 0 ? void 0 : _c.assetCategory) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = c.vendor) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        money((_h = c.contractValue) !== null && _h !== void 0 ? _h : c.value), fmt(c.endDate), fyLabelFromDate(c.endDate),
                    ];
                });
                return sendExcel(res, "AMC_Renewal_Projection", headers, rows, { total: true });
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP J — ASSET MASTER & LIFECYCLE
            // ═══════════════════════════════════════════════════════════════════
            // J1 — Asset Master (multi-sheet: master + assignments + sub-assets + documents + maintenance)
            case "asset-master": {
                const where = {};
                if (f.assetCategoryId)
                    where.assetCategoryId = f.assetCategoryId;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                if (f.branchId)
                    where.branchId = f.branchId;
                if (f.assetType)
                    where.assetType = f.assetType;
                const [assets, assignments, subAssets, documents, maintHistory] = yield Promise.all([
                    prismaClient_1.default.asset.findMany({
                        where,
                        include: { assetCategory: true, department: true, vendor: true, depreciation: true },
                        orderBy: { assetId: "asc" },
                    }),
                    prismaClient_1.default.assetAssignment.findMany({
                        include: { asset: true, assignedTo: true, assignedBy: true },
                        orderBy: { createdAt: "desc" },
                    }),
                    prismaClient_1.default.subAsset.findMany({ include: { asset: true } }).catch(() => []),
                    prismaClient_1.default.document.findMany({ include: { asset: true } }).catch(() => []),
                    prismaClient_1.default.maintenanceHistory.findMany({
                        include: { asset: true },
                        orderBy: { actualDoneAt: "desc" },
                    }),
                ]);
                const masterHeaders = [
                    "Asset ID", "Asset Name", "Serial No", "Category", "Asset Type", "Asset Nature",
                    "Department", "Location", "Vendor",
                    "Purchase Date", "Purchase Cost (₹)", "Invoice No", "GRN No", "PO No",
                    "Mode of Procurement", "Manufacturer", "Model", "Status", "Physical Condition",
                    "Acc. Depreciation (₹)", "Net Book Value (₹)", "Created On",
                ];
                const masterRows = assets.map(a => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
                    return [
                        a.assetId, a.assetName,
                        (_a = a.serialNumber) !== null && _a !== void 0 ? _a : "",
                        (_c = (_b = a.assetCategory) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "",
                        (_d = a.assetType) !== null && _d !== void 0 ? _d : "",
                        (_e = a.assetNature) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = a.department) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_h = a.currentLocation) !== null && _h !== void 0 ? _h : "",
                        (_k = (_j = a.vendor) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        fmt(a.purchaseDate), money(a.purchaseCost),
                        (_l = a.invoiceNumber) !== null && _l !== void 0 ? _l : "",
                        (_m = a.grnNumber) !== null && _m !== void 0 ? _m : "",
                        (_o = a.purchaseOrderNo) !== null && _o !== void 0 ? _o : "",
                        (_p = a.modeOfProcurement) !== null && _p !== void 0 ? _p : "",
                        (_q = a.manufacturer) !== null && _q !== void 0 ? _q : "",
                        (_r = a.modelNumber) !== null && _r !== void 0 ? _r : "",
                        (_s = a.status) !== null && _s !== void 0 ? _s : "",
                        (_t = a.physicalCondition) !== null && _t !== void 0 ? _t : "",
                        money((_u = a.depreciation) === null || _u === void 0 ? void 0 : _u.accumulatedDepreciation), money((_v = a.depreciation) === null || _v === void 0 ? void 0 : _v.currentBookValue),
                        fmt(a.createdAt),
                    ];
                });
                const assignHeaders = ["Asset ID", "Asset Name", "Assigned To", "Assigned By", "Assignment Date", "Status", "Acknowledged On"];
                const assignRows = assignments.map(a => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = a.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = a.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = a.assignedTo) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        (_h = (_g = a.assignedBy) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        fmt(a.createdAt), a.status, fmt(a.acknowledgedAt),
                    ];
                });
                const subHeaders = ["Asset ID", "Asset Name", "Sub-Asset ID", "Sub-Asset Name", "Type", "Quantity"];
                const subRows = subAssets.map(s => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = s.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = s.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_e = s.subAssetId) !== null && _e !== void 0 ? _e : s.id,
                        (_f = s.name) !== null && _f !== void 0 ? _f : "",
                        (_g = s.type) !== null && _g !== void 0 ? _g : "",
                        (_h = s.quantity) !== null && _h !== void 0 ? _h : "",
                    ];
                });
                const docHeaders = ["Asset ID", "Asset Name", "Document Title", "Type", "File URL", "Uploaded On"];
                const docRows = documents.map(d => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                    return [
                        (_b = (_a = d.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = d.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = d.title) !== null && _e !== void 0 ? _e : d.fileName) !== null && _f !== void 0 ? _f : "",
                        (_h = (_g = d.type) !== null && _g !== void 0 ? _g : d.documentType) !== null && _h !== void 0 ? _h : "",
                        (_k = (_j = d.fileUrl) !== null && _j !== void 0 ? _j : d.filePath) !== null && _k !== void 0 ? _k : "",
                        fmt(d.createdAt),
                    ];
                });
                const mhHeaders = ["Asset ID", "Asset Name", "Performed By", "Performed On", "Service Type", "Total Cost (₹)"];
                const mhRows = maintHistory.map(m => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        (_b = (_a = m.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = m.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_e = m.performedBy) !== null && _e !== void 0 ? _e : "",
                        fmt(m.actualDoneAt),
                        (_f = m.serviceType) !== null && _f !== void 0 ? _f : "",
                        money((_g = m.totalCost) !== null && _g !== void 0 ? _g : m.serviceCost),
                    ];
                });
                return sendMultiSheetExcel(res, "Asset_Master", [
                    { name: "Master", headers: masterHeaders, rows: masterRows, total: true },
                    { name: "Assignments", headers: assignHeaders, rows: assignRows },
                    { name: "Sub-Assets", headers: subHeaders, rows: subRows },
                    { name: "Documents", headers: docHeaders, rows: docRows },
                    { name: "Maintenance History", headers: mhHeaders, rows: mhRows, total: true },
                ]);
            }
            // J2 — Asset Movement Log (transfers + gate passes consolidated)
            case "asset-movement-log": {
                const [transfers, gatePasses] = yield Promise.all([
                    prismaClient_1.default.assetTransferHistory.findMany({
                        include: { asset: true, fromDepartment: true, toDepartment: true },
                        orderBy: { createdAt: "desc" },
                    }),
                    prismaClient_1.default.gatePass.findMany({
                        include: { items: { include: { asset: true } }, requestedBy: true },
                        orderBy: { createdAt: "desc" },
                    }),
                ]);
                const tHeaders = ["Date", "Asset ID", "Asset Name", "From Department", "To Department", "Type", "Reason", "Status"];
                const tRows = transfers.map(t => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    return [
                        fmt(t.createdAt),
                        (_b = (_a = t.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = t.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = t.fromDepartment) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        (_h = (_g = t.toDepartment) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        (_j = t.transferType) !== null && _j !== void 0 ? _j : "TRANSFER",
                        (_k = t.reason) !== null && _k !== void 0 ? _k : "",
                        (_l = t.status) !== null && _l !== void 0 ? _l : "",
                    ];
                });
                const gHeaders = ["Date", "Gate Pass No", "Type", "Issued To", "Items", "Expected Return", "Status", "Requested By"];
                const gRows = gatePasses.map(g => {
                    var _a, _b, _c;
                    return [
                        fmt(g.createdAt), g.gatePassNo, g.type,
                        (_a = g.issuedTo) !== null && _a !== void 0 ? _a : "",
                        (g.items || []).map((i) => { var _a; return (_a = i.asset) === null || _a === void 0 ? void 0 : _a.assetName; }).filter(Boolean).join("; "),
                        fmt(g.expectedReturnDate), g.status,
                        (_c = (_b = g.requestedBy) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "",
                    ];
                });
                return sendMultiSheetExcel(res, "Asset_Movement_Log", [
                    { name: "Transfers", headers: tHeaders, rows: tRows },
                    { name: "Gate Passes", headers: gHeaders, rows: gRows },
                ]);
            }
            // J3 — Physical Audit Records
            case "physical-audit": {
                const audits = yield prismaClient_1.default.assetAudit.findMany({
                    include: { items: { include: { asset: true } } },
                    orderBy: { auditDate: "desc" },
                });
                const headers = [
                    "Audit Name", "Audit Date", "Status",
                    "Total Assets", "Verified", "Missing", "Mismatched",
                    "Completed On", "Remarks",
                ];
                const rows = audits.map((a) => {
                    var _a;
                    return [
                        a.auditName, fmt(a.auditDate), a.status,
                        a.totalAssets, a.verifiedCount, a.missingCount, a.mismatchCount,
                        fmt(a.completedAt),
                        (_a = a.remarks) !== null && _a !== void 0 ? _a : "",
                    ];
                });
                return sendExcel(res, "Physical_Audit", headers, rows);
            }
            // J4 — Asset Utilisation (assigned vs in-store vs idle)
            case "asset-utilisation": {
                const assets = yield prismaClient_1.default.asset.findMany({
                    include: { assetCategory: true },
                });
                const byCategory = new Map();
                for (const a of assets) {
                    const cat = (_16 = (_15 = a.assetCategory) === null || _15 === void 0 ? void 0 : _15.name) !== null && _16 !== void 0 ? _16 : "Uncategorised";
                    if (!byCategory.has(cat))
                        byCategory.set(cat, { total: 0, active: 0, inStore: 0, idle: 0, disposed: 0 });
                    const s = byCategory.get(cat);
                    s.total++;
                    const st = String(a.status || "").toUpperCase();
                    if (st === "ACTIVE")
                        s.active++;
                    else if (st === "IN_STORE")
                        s.inStore++;
                    else if (st === "DISPOSED")
                        s.disposed++;
                    else
                        s.idle++;
                }
                const headers = ["Category", "Total", "Active", "In Store", "Idle / Other", "Disposed", "Utilisation %"];
                const rows = Array.from(byCategory.entries()).map(([cat, s]) => [
                    cat, s.total, s.active, s.inStore, s.idle, s.disposed,
                    s.total > 0 ? ((s.active / s.total) * 100).toFixed(2) : "0.00",
                ]);
                return sendExcel(res, "Asset_Utilisation", headers, rows);
            }
            // J5 — Disposal & E-Waste (consolidated)
            case "disposal-ewaste": {
                const [disposals, ewaste] = yield Promise.all([
                    prismaClient_1.default.assetDisposal.findMany({
                        include: { asset: { include: { assetCategory: true, department: true } } },
                        orderBy: { createdAt: "desc" },
                    }),
                    prismaClient_1.default.eWasteRecord.findMany({
                        include: { asset: true },
                        orderBy: { createdAt: "desc" },
                    }),
                ]);
                const dHeaders = ["Asset ID", "Asset Name", "Category", "Department", "Disposal Type", "Status", "Sale Value (₹)", "Book Value (₹)", "Gain/Loss (₹)", "Date"];
                const dRows = disposals.map(d => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                    return [
                        (_b = (_a = d.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = d.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_g = (_f = (_e = d.asset) === null || _e === void 0 ? void 0 : _e.assetCategory) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_k = (_j = (_h = d.asset) === null || _h === void 0 ? void 0 : _h.department) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        d.disposalType, d.status, money(d.actualSaleValue),
                        money(d.bookValueAtDisposal), money(d.netGainLoss), fmt(d.createdAt),
                    ];
                });
                const eHeaders = ["E-Waste Ref", "Asset ID", "Asset Name", "Status", "Asset Condition", "Data Wiped", "Wipe Method", "Created On"];
                const eRows = ewaste.map(e => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        e.eWasteRefNo,
                        (_b = (_a = e.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = e.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        e.status,
                        (_e = e.assetCondition) !== null && _e !== void 0 ? _e : "",
                        yn(e.dataWiped),
                        (_f = e.dataWipeMethod) !== null && _f !== void 0 ? _f : "",
                        fmt(e.createdAt),
                    ];
                });
                return sendMultiSheetExcel(res, "Disposal_EWaste", [
                    { name: "Disposals", headers: dHeaders, rows: dRows, total: true },
                    { name: "E-Waste", headers: eHeaders, rows: eRows },
                ]);
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP K — MAINTENANCE, CALIBRATION & SLA
            // ═══════════════════════════════════════════════════════════════════
            // K1 — Repair Tickets
            case "tickets": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                if (f.departmentId)
                    where.departmentId = f.departmentId;
                const tickets = yield prismaClient_1.default.ticket.findMany({
                    where,
                    include: { asset: true, raisedBy: true, assignedTo: true, department: true },
                    orderBy: { createdAt: "desc" },
                });
                const headers = [
                    "Ticket ID", "Asset ID", "Asset Name", "Department",
                    "Issue Type", "Priority", "Status", "Raised By", "Assigned To",
                    "Created On", "Resolved On", "SLA Breached", "SLA Deadline",
                ];
                const rows = tickets.map(t => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
                    return [
                        t.ticketId,
                        (_b = (_a = t.asset) === null || _a === void 0 ? void 0 : _a.assetId) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = t.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_f = (_e = t.department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                        (_g = t.issueType) !== null && _g !== void 0 ? _g : "",
                        (_h = t.priority) !== null && _h !== void 0 ? _h : "",
                        t.status,
                        (_k = (_j = t.raisedBy) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : "",
                        (_m = (_l = t.assignedTo) === null || _l === void 0 ? void 0 : _l.name) !== null && _m !== void 0 ? _m : "",
                        fmt(t.createdAt), fmt(t.resolvedAt),
                        yn(t.slaBreached), `${(_o = t.slaExpectedValue) !== null && _o !== void 0 ? _o : ""} ${(_p = t.slaExpectedUnit) !== null && _p !== void 0 ? _p : ""}`,
                    ];
                });
                return sendExcel(res, "Repair_Tickets", headers, rows);
            }
            // K2 — Work Orders (multi-sheet: WO + WCC)
            case "work-orders": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                const wos = yield prismaClient_1.default.workOrder.findMany({
                    where,
                    include: { asset: true, assignedTo: true, vendor: true, wcc: true },
                    orderBy: { createdAt: "desc" },
                });
                const woHeaders = [
                    "WO Number", "Asset", "Job Type", "Assigned To", "Vendor",
                    "Status", "Scheduled Date", "Estimated Cost (₹)", "Actual Cost (₹)", "Created On",
                ];
                const woRows = wos.map(w => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return [
                        (_b = (_a = w.workOrderNumber) !== null && _a !== void 0 ? _a : w.woNumber) !== null && _b !== void 0 ? _b : w.id,
                        (_d = (_c = w.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        (_e = w.jobType) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = w.assignedTo) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_j = (_h = w.vendor) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "",
                        w.status, fmt(w.scheduledDate), money(w.estimatedCost), money(w.actualCost), fmt(w.createdAt),
                    ];
                });
                const wccHeaders = ["WO Number", "Completion Date", "Work Done", "Actual Cost (₹)", "Approved By"];
                const wccRows = wos.flatMap(w => (w.wcc ? [w.wcc] : []).map((c) => {
                    var _a, _b, _c, _d, _e;
                    return [
                        (_b = (_a = w.workOrderNumber) !== null && _a !== void 0 ? _a : w.woNumber) !== null && _b !== void 0 ? _b : w.id,
                        fmt(c.completionDate),
                        (_d = (_c = c.workDone) !== null && _c !== void 0 ? _c : c.description) !== null && _d !== void 0 ? _d : "",
                        money(c.actualCost),
                        (_e = c.approvedBy) !== null && _e !== void 0 ? _e : "",
                    ];
                }));
                return sendMultiSheetExcel(res, "Work_Orders", [
                    { name: "Work Orders", headers: woHeaders, rows: woRows, total: true },
                    { name: "WCCs", headers: wccHeaders, rows: wccRows, total: true },
                ]);
            }
            // K3 — Preventive Maintenance Schedules
            case "pm-schedules": {
                const schedules = yield prismaClient_1.default.maintenanceSchedule.findMany({
                    include: { asset: { include: { department: true } } },
                });
                const headers = ["Asset", "Department", "Schedule Type", "Frequency", "Next Due", "Last Performed", "Active"];
                const rows = schedules.map(s => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return [
                        (_b = (_a = s.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = s.asset) === null || _c === void 0 ? void 0 : _c.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        (_f = s.scheduleType) !== null && _f !== void 0 ? _f : "",
                        `${(_g = s.frequencyValue) !== null && _g !== void 0 ? _g : ""} ${(_h = s.frequencyUnit) !== null && _h !== void 0 ? _h : ""}`,
                        fmt(s.nextDueAt), fmt(s.lastPerformedAt), yn((_j = s.isActive) !== null && _j !== void 0 ? _j : true),
                    ];
                });
                return sendExcel(res, "PM_Schedules", headers, rows);
            }
            // K4 — PM Checklist Runs
            case "pm-runs": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.scheduledDue = dr;
                const runs = yield prismaClient_1.default.preventiveChecklistRun.findMany({
                    where,
                    include: { asset: true, template: true, performedBy: true },
                    orderBy: { scheduledDue: "desc" },
                });
                const headers = [
                    "Template", "Asset", "Scheduled Due", "Status",
                    "Performed On", "Performed By",
                ];
                const rows = runs.map(r => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        (_b = (_a = r.template) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = r.asset) === null || _c === void 0 ? void 0 : _c.assetName) !== null && _d !== void 0 ? _d : "",
                        fmt(r.scheduledDue), r.status,
                        fmt(r.performedAt),
                        (_f = (_e = r.performedBy) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
                    ];
                });
                return sendExcel(res, "PM_Runs", headers, rows);
            }
            // K5 — Calibration Schedules
            case "calibration-schedules": {
                const schedules = yield prismaClient_1.default.calibrationSchedule.findMany({
                    include: { asset: { include: { department: true } }, vendor: true },
                });
                const headers = ["Asset", "Department", "Frequency", "Next Due", "Last Calibrated", "Vendor", "Reminder Days", "Active"];
                const rows = schedules.map(s => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = s.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = s.asset) === null || _c === void 0 ? void 0 : _c.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        `${s.frequencyValue} ${s.frequencyUnit}`,
                        fmt(s.nextDueAt), fmt(s.lastCalibratedAt),
                        (_g = (_f = s.vendor) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_h = s.reminderDays) !== null && _h !== void 0 ? _h : "",
                        yn(s.isActive),
                    ];
                });
                return sendExcel(res, "Calibration_Schedules", headers, rows);
            }
            // K6 — Calibration History
            case "calibration-history": {
                const history = yield prismaClient_1.default.calibrationHistory.findMany({
                    include: { asset: true, performedBy: true },
                    orderBy: { calibratedAt: "desc" },
                }).catch(() => []);
                const headers = ["Asset", "Calibrated On", "Performed By", "Result", "Certificate", "Next Due", "Notes"];
                const rows = history.map(h => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = h.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        fmt(h.calibratedAt),
                        (_d = (_c = h.performedBy) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        (_e = h.result) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = h.certificateUrl) !== null && _f !== void 0 ? _f : h.certificateNumber) !== null && _g !== void 0 ? _g : "",
                        fmt(h.nextDueAt),
                        (_h = h.notes) !== null && _h !== void 0 ? _h : "",
                    ];
                });
                return sendExcel(res, "Calibration_History", headers, rows);
            }
            // K7 — Out-of-Calibration list (overdue)
            case "out-of-calibration": {
                const now = new Date();
                const schedules = yield prismaClient_1.default.calibrationSchedule.findMany({
                    where: { isActive: true, nextDueAt: { lt: now } },
                    include: { asset: { include: { department: true } }, vendor: true },
                });
                const headers = ["Asset", "Department", "Vendor", "Last Calibrated", "Was Due On", "Days Overdue"];
                const rows = schedules.map(s => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        (_b = (_a = s.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = s.asset) === null || _c === void 0 ? void 0 : _c.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = s.vendor) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        fmt(s.lastCalibratedAt), fmt(s.nextDueAt),
                        Math.floor((now.getTime() - new Date(s.nextDueAt).getTime()) / (1000 * 60 * 60 * 24)),
                    ];
                });
                return sendExcel(res, "Out_of_Calibration", headers, rows);
            }
            // K8 — SLA Breach Trend
            case "sla-breach-trend": {
                const where = { slaBreached: true };
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                const tickets = yield prismaClient_1.default.ticket.findMany({
                    where,
                    include: { asset: { include: { assetCategory: true, department: true } }, assignedTo: true },
                    orderBy: { createdAt: "desc" },
                });
                const headers = ["Ticket", "Asset", "Category", "Department", "Priority", "Assigned To", "Created On", "Resolved On", "SLA"];
                const rows = tickets.map(t => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
                    return [
                        t.ticketId,
                        (_b = (_a = t.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = t.asset) === null || _c === void 0 ? void 0 : _c.assetCategory) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        (_h = (_g = (_f = t.asset) === null || _f === void 0 ? void 0 : _f.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        (_j = t.priority) !== null && _j !== void 0 ? _j : "",
                        (_l = (_k = t.assignedTo) === null || _k === void 0 ? void 0 : _k.name) !== null && _l !== void 0 ? _l : "",
                        fmt(t.createdAt), fmt(t.resolvedAt),
                        `${(_m = t.slaExpectedValue) !== null && _m !== void 0 ? _m : ""} ${(_o = t.slaExpectedUnit) !== null && _o !== void 0 ? _o : ""}`,
                    ];
                });
                return sendExcel(res, "SLA_Breach_Trend", headers, rows);
            }
            // K9 — Escalation Log
            case "escalation-log": {
                const escalations = yield prismaClient_1.default.ticketEscalation.findMany({
                    include: { ticket: { include: { asset: true } }, escalatedTo: true },
                    orderBy: { createdAt: "desc" },
                }).catch(() => []);
                const headers = ["Ticket", "Asset", "Escalated To", "Level", "Reason", "Created On"];
                const rows = escalations.map(e => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return [
                        (_b = (_a = e.ticket) === null || _a === void 0 ? void 0 : _a.ticketId) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = e.ticket) === null || _c === void 0 ? void 0 : _c.asset) === null || _d === void 0 ? void 0 : _d.assetName) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = e.escalatedTo) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        (_h = e.level) !== null && _h !== void 0 ? _h : "",
                        (_j = e.reason) !== null && _j !== void 0 ? _j : "",
                        fmt(e.createdAt),
                    ];
                });
                return sendExcel(res, "Escalation_Log", headers, rows);
            }
            // K10 — Root Cause Analysis log
            case "rca-log": {
                const rcas = yield prismaClient_1.default.rootCauseAnalysis.findMany({
                    include: { ticket: { include: { asset: true } } },
                    orderBy: { createdAt: "desc" },
                }).catch(() => []);
                const headers = ["Ticket", "Asset", "Root Cause", "Corrective Action", "Preventive Action", "Created On"];
                const rows = rcas.map(r => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = r.ticket) === null || _a === void 0 ? void 0 : _a.ticketId) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = r.ticket) === null || _c === void 0 ? void 0 : _c.asset) === null || _d === void 0 ? void 0 : _d.assetName) !== null && _e !== void 0 ? _e : "",
                        (_f = r.rootCause) !== null && _f !== void 0 ? _f : "",
                        (_g = r.correctiveAction) !== null && _g !== void 0 ? _g : "",
                        (_h = r.preventiveAction) !== null && _h !== void 0 ? _h : "",
                        fmt(r.createdAt),
                    ];
                });
                return sendExcel(res, "RCA_Log", headers, rows);
            }
            // K11 — Decision Engine Recommendations
            case "decision-engine": {
                const logs = yield prismaClient_1.default.decisionEngineLog.findMany({
                    include: { asset: true },
                    orderBy: { createdAt: "desc" },
                }).catch(() => []);
                const headers = ["Asset", "Recommendation", "Reason", "Score", "Created On"];
                const rows = logs.map(l => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        (_b = (_a = l.asset) === null || _a === void 0 ? void 0 : _a.assetName) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = l.recommendation) !== null && _c !== void 0 ? _c : l.action) !== null && _d !== void 0 ? _d : "",
                        (_e = l.reason) !== null && _e !== void 0 ? _e : "",
                        (_f = l.score) !== null && _f !== void 0 ? _f : "",
                        fmt(l.createdAt),
                    ];
                });
                return sendExcel(res, "Decision_Engine_Log", headers, rows);
            }
            // ═══════════════════════════════════════════════════════════════════
            // GROUP L — HR & ADMIN AUDIT
            // ═══════════════════════════════════════════════════════════════════
            // L1 — Employees with Assigned Assets
            case "employees-with-assets": {
                const employees = yield prismaClient_1.default.employee.findMany({
                    include: {
                        department: true,
                        assignedAssets: { include: { asset: { include: { assetCategory: true } } } },
                    },
                    orderBy: { name: "asc" },
                });
                const headers = [
                    "Employee ID", "Name", "Department", "Role",
                    "Assets Count", "Asset List", "Email", "Active",
                ];
                const rows = employees.map(e => {
                    var _a, _b, _c, _d;
                    return [
                        e.employeeID, e.name,
                        (_b = (_a = e.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_c = e.role) !== null && _c !== void 0 ? _c : "",
                        (e.assignedAssets || []).length,
                        (e.assignedAssets || []).map((a) => { var _a; return (_a = a.asset) === null || _a === void 0 ? void 0 : _a.assetName; }).filter(Boolean).join("; "),
                        (_d = e.email) !== null && _d !== void 0 ? _d : "",
                        yn(e.isActive),
                    ];
                });
                return sendExcel(res, "Employees_with_Assets", headers, rows);
            }
            // L2 — Employee Exit Clearance
            case "employee-exits": {
                const exits = yield prismaClient_1.default.employeeExit.findMany({
                    include: { employee: { include: { department: true } }, exitAssets: { include: { asset: true } } },
                    orderBy: { exitDate: "desc" },
                });
                const headers = [
                    "Exit Number", "Employee", "Department", "Exit Type",
                    "Last Working Date", "Initiated On", "Status",
                    "Assigned", "Returned", "Pending",
                    "Pending Items",
                ];
                const rows = exits.map(e => {
                    var _a, _b, _c, _d, _e;
                    return [
                        e.exitNumber,
                        (_b = (_a = e.employee) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_e = (_d = (_c = e.employee) === null || _c === void 0 ? void 0 : _c.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "",
                        e.exitType, fmt(e.exitDate), fmt(e.initiatedDate), e.status,
                        e.totalAssetsAssigned, e.assetsReturned, e.assetsPending,
                        (e.exitAssets || []).filter((a) => a.status === "PENDING").map((a) => { var _a; return (_a = a.asset) === null || _a === void 0 ? void 0 : _a.assetName; }).filter(Boolean).join("; "),
                    ];
                });
                return sendExcel(res, "Employee_Exits", headers, rows);
            }
            // L3 — Login History
            case "login-history": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.attemptedAt = dr;
                const logs = yield prismaClient_1.default.loginHistory.findMany({
                    where,
                    include: { user: { include: { employee: true } } },
                    orderBy: { attemptedAt: "desc" },
                    take: 5000,
                });
                const headers = ["Employee", "User Name", "Role", "Attempted At", "Success", "IP Address", "User Agent"];
                const rows = logs.map(l => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    return [
                        (_c = (_b = (_a = l.user) === null || _a === void 0 ? void 0 : _a.employee) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "",
                        (_g = (_e = (_d = l.user) === null || _d === void 0 ? void 0 : _d.username) !== null && _e !== void 0 ? _e : (_f = l.user) === null || _f === void 0 ? void 0 : _f.employeeID) !== null && _g !== void 0 ? _g : "",
                        (_j = (_h = l.user) === null || _h === void 0 ? void 0 : _h.role) !== null && _j !== void 0 ? _j : "",
                        fmtT(l.attemptedAt), yn(l.success),
                        (_k = l.ipAddress) !== null && _k !== void 0 ? _k : "",
                        (_l = l.userAgent) !== null && _l !== void 0 ? _l : "",
                    ];
                });
                return sendExcel(res, "Login_History", headers, rows);
            }
            // L4 — Activity Audit Trail
            case "audit-trail": {
                const where = {};
                const dr = dateRangeOn(f);
                if (dr)
                    where.createdAt = dr;
                const logs = yield prismaClient_1.default.auditLog.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: 10000,
                });
                const headers = [
                    "Date / Time", "Entity Type", "Entity ID", "Action",
                    "Description", "Performed By", "IP Address",
                ];
                const rows = logs.map(l => {
                    var _a, _b, _c;
                    return [
                        fmtT(l.createdAt), l.entityType, l.entityId, l.action,
                        (_a = l.description) !== null && _a !== void 0 ? _a : "",
                        (_b = l.performedBy) !== null && _b !== void 0 ? _b : "",
                        (_c = l.ipAddress) !== null && _c !== void 0 ? _c : "",
                    ];
                });
                return sendExcel(res, "Audit_Trail", headers, rows);
            }
            // L5 — User Access Matrix
            case "user-access-matrix": {
                const users = yield prismaClient_1.default.user.findMany({
                    include: { employee: { include: { department: true } } },
                    orderBy: { id: "asc" },
                });
                const headers = ["User ID", "Employee ID", "Name", "Email", "Department", "Role", "Last Login", "Active"];
                const rows = users.map(u => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return [
                        u.id,
                        (_a = u.employeeID) !== null && _a !== void 0 ? _a : "",
                        (_c = (_b = u.employee) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "",
                        (_e = (_d = u.employee) === null || _d === void 0 ? void 0 : _d.email) !== null && _e !== void 0 ? _e : "",
                        (_h = (_g = (_f = u.employee) === null || _f === void 0 ? void 0 : _f.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
                        u.role, fmtT(u.lastLogin), yn((_j = u.isActive) !== null && _j !== void 0 ? _j : true),
                    ];
                });
                return sendExcel(res, "User_Access_Matrix", headers, rows);
            }
            // L6 — Module Access by Role
            case "module-access-by-role": {
                const perms = yield prismaClient_1.default.modulePermission.findMany({
                    include: { module: true, moduleItem: true, employee: true },
                });
                const headers = ["Module", "Module Item", "Role", "Employee", "Can Access", "Last Updated"];
                const rows = perms.map(p => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        (_b = (_a = p.module) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                        (_d = (_c = p.moduleItem) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
                        (_e = p.role) !== null && _e !== void 0 ? _e : "",
                        (_g = (_f = p.employee) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "",
                        yn(p.canAccess), fmt(p.updatedAt),
                    ];
                });
                return sendExcel(res, "Module_Access_by_Role", headers, rows);
            }
            // L7 — Approval Config Snapshot
            case "approval-config": {
                const cfg = yield prismaClient_1.default.approvalConfig.findMany({ orderBy: [{ module: "asc" }, { level: "asc" }] });
                const headers = ["Module", "Level", "Approver Role", "Min Amount (₹)", "Max Amount (₹)", "Active"];
                const rows = cfg.map(c => [
                    c.module, c.level, c.roleName,
                    money(c.minAmount), c.maxAmount === null ? "Unlimited" : money(c.maxAmount),
                    yn(c.isActive),
                ]);
                return sendExcel(res, "Approval_Config", headers, rows);
            }
            // ─────────────────────────────────────────────────────────────────
            default: {
                res.status(404).json({ error: `Unknown report: ${report}` });
                return;
            }
        }
    }
    catch (err) {
        console.error(`Export failed [${report}]:`, err);
        res.status(500).json({ error: "Export failed", details: err === null || err === void 0 ? void 0 : err.message });
    }
});
exports.exportReport = exportReport;

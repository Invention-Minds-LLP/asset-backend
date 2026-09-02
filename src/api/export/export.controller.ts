import { Request, Response } from "express";
import XLSX from "xlsx";
import prisma from "../../prismaClient";

// ───────────────────────────────────────────────────────────────────────────
// Formatters
// ───────────────────────────────────────────────────────────────────────────
const fmt = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().split("T")[0] : "";

const fmtT = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().replace("T", " ").split(".")[0] : "";

const num = (v: any): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v.toNumber === "function") return v.toNumber();
  return Number(v) || 0;
};

// Amounts are emitted as real numbers (not pre-formatted strings) so Excel
// SUM/pivots work; columns whose header contains "₹" get CURRENCY_FORMAT
// applied in buildSheet().
const money = (v: any): number => Number(num(v).toFixed(2));

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const monthName = (m: number | null | undefined): string =>
  m ? (MONTH_NAMES[m] ?? String(m)) : "";

const yn = (v: any): string => (v === true ? "Yes" : v === false ? "No" : "");

// ───────────────────────────────────────────────────────────────────────────
// Indian Financial Year helpers
//   "2025-26" → { start: 2025-04-01, end: 2026-03-31 }
// ───────────────────────────────────────────────────────────────────────────
function parseFinancialYear(fy?: string): { start: Date; end: Date } | null {
  if (!fy) return null;
  const m = fy.match(/^(\d{4})[-/](\d{2,4})$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  return {
    start: new Date(startYear, 3, 1),         // 1 April
    end:   new Date(startYear + 1, 2, 31, 23, 59, 59), // 31 March
  };
}
function fyLabelFromDate(d: Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const y = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
  return `FY${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Filter parsing — every report reads from this
// ───────────────────────────────────────────────────────────────────────────
interface ExportFilters {
  start: Date | null;
  end: Date | null;
  year: number | null;
  month: number | null;
  fyStart: Date | null;
  fyEnd: Date | null;
  fyLabel: string | null;
  assetCategoryId: number | null;
  departmentId: number | null;
  branchId: number | null;
  vendorId: number | null;
  assetType: string | null;
}
function parseFilters(req: Request): ExportFilters {
  const q = req.query;
  const start = q.startDate ? new Date(String(q.startDate)) : null;
  const end   = q.endDate   ? new Date(String(q.endDate))   : null;
  if (end) end.setHours(23, 59, 59, 999);
  const fy = q.financialYear ? parseFinancialYear(String(q.financialYear)) : null;
  return {
    start,
    end,
    year:            q.year  ? Number(q.year)  : null,
    month:           q.month ? Number(q.month) : null,
    fyStart:         fy?.start ?? null,
    fyEnd:           fy?.end ?? null,
    fyLabel:         q.financialYear ? String(q.financialYear) : null,
    assetCategoryId: q.assetCategoryId ? Number(q.assetCategoryId) : null,
    departmentId:    q.departmentId    ? Number(q.departmentId)    : null,
    branchId:        q.branchId        ? Number(q.branchId)        : null,
    vendorId:        q.vendorId        ? Number(q.vendorId)        : null,
    assetType:       q.assetType       ? String(q.assetType)       : null,
  };
}

// Build a Prisma `where` date range on the given field name from filters
function dateRangeOn(f: ExportFilters): { gte?: Date; lte?: Date } | undefined {
  // Priority: financialYear > year+month > startDate/endDate
  if (f.fyStart && f.fyEnd) return { gte: f.fyStart, lte: f.fyEnd };
  if (f.year && f.month) {
    const start = new Date(f.year, f.month - 1, 1);
    const end   = new Date(f.year, f.month, 0, 23, 59, 59);
    return { gte: start, lte: end };
  }
  if (f.year) {
    return { gte: new Date(f.year, 0, 1), lte: new Date(f.year, 11, 31, 23, 59, 59) };
  }
  if (f.start && f.end) return { gte: f.start, lte: f.end };
  if (f.start)          return { gte: f.start };
  if (f.end)            return { lte: f.end };
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Excel writers
// ───────────────────────────────────────────────────────────────────────────
type Row = (string | number | boolean | null | undefined)[];
type SheetData = { name: string; headers: string[]; rows: Row[]; total?: boolean };

const CURRENCY_FORMAT = "#,##0.00";

// Column indexes whose header marks an amount column (contains "₹").
function currencyCols(headers: string[]): number[] {
  return headers.map((h, i) => (h.includes("₹") ? i : -1)).filter(i => i >= 0);
}

// Shared sheet builder:
//   • cells in ₹-columns become typed numbers with CURRENCY_FORMAT so Excel
//     SUM / pivot tables work;
//   • when `total` is set, appends a blank spacer + TOTAL row summing every
//     ₹-column (non-numeric cells like "Unlimited" are ignored).
function buildSheet(headers: string[], rows: Row[], total?: boolean): XLSX.WorkSheet {
  const curCols = currencyCols(headers);
  const dataRows = [...rows];
  if (total && curCols.length && rows.length) {
    const sums = new Map<number, number>();
    for (const c of curCols) {
      let s = 0;
      for (const r of rows) {
        const v = r[c];
        if (typeof v === "number") s += v;
      }
      sums.set(c, Number(s.toFixed(2)));
    }
    dataRows.push(new Array(headers.length).fill(""));
    dataRows.push(headers.map((_, i) => (i === 0 ? "TOTAL" : sums.has(i) ? sums.get(i)! : "")));
  }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  for (let r = 1; r <= dataRows.length; r++) {
    for (const c of curCols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = CURRENCY_FORMAT;
      }
    }
  }
  return ws;
}

function sendExcel(
  res: Response,
  filename: string,
  headers: string[],
  rows: Row[],
  opts: { total?: boolean } = {},
): void {
  const wb = XLSX.utils.book_new();
  const ws = buildSheet(headers, rows, opts.total);
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}

// Numeric-aware export — keeps amount cells as real numbers (not strings) so SUM/
// pivot tables work, and applies an Indian-currency format string to the listed
// column indexes. Optional `colWidths` controls column widths in "wch" units.
function sendExcelTyped(
  res: Response,
  filename: string,
  headers: string[],
  rows: Row[],
  numericColIndexes: number[] = [],
  numberFormat = "#,##0.00",
  colWidths?: number[],
): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const numericSet = new Set(numericColIndexes);
  // Row index 0 is the header. Data rows start at 1.
  for (let r = 1; r <= rows.length; r++) {
    for (const c of numericSet) {
      const ref = XLSX.utils.encode_cell({ r, c });
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
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}

function sendMultiSheetExcel(res: Response, filename: string, sheets: SheetData[]): void {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const safeName = sheet.name.slice(0, 31); // Excel limit
    const ws = buildSheet(sheet.headers, sheet.rows, sheet.total);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}

// ───────────────────────────────────────────────────────────────────────────
// Lookup maps — load once per request, used to resolve IDs to names
// ───────────────────────────────────────────────────────────────────────────
async function getEmployeeMap(): Promise<Map<number, string>> {
  const rows = await prisma.employee.findMany({ select: { id: true, name: true, employeeID: true } });
  return new Map(rows.map(r => [r.id, `${r.name}${r.employeeID ? ` (${r.employeeID})` : ""}`]));
}
async function getDepartmentMap(): Promise<Map<number, string>> {
  const rows = await prisma.department.findMany({ select: { id: true, name: true } });
  return new Map(rows.map(r => [r.id, r.name]));
}
async function getBranchMap(): Promise<Map<number, string>> {
  const rows = await prisma.branch.findMany({ select: { id: true, name: true } });
  return new Map(rows.map(r => [r.id, r.name]));
}
async function getCategoryMap(): Promise<Map<number, string>> {
  const rows = await prisma.assetCategory.findMany({ select: { id: true, name: true } });
  return new Map(rows.map(r => [r.id, r.name]));
}
async function getVendorMap(): Promise<Map<number, string>> {
  const rows = await prisma.vendor.findMany({ select: { id: true, name: true } });
  return new Map(rows.map(r => [r.id, r.name]));
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN DISPATCHER
// ───────────────────────────────────────────────────────────────────────────
export const exportReport = async (req: Request, res: Response): Promise<void> => {
  const report = req.params.report;
  const f = parseFilters(req);

  try {
    switch (report) {

      // ═══════════════════════════════════════════════════════════════════
      // GROUP A — STATUTORY & AUDIT PACK
      // ═══════════════════════════════════════════════════════════════════

      // A1 — Companies Act Schedule II FA Register (category-wise)
      case "schedule-ii-fa-register": {
        const where: any = {};
        if (f.assetCategoryId) where.assetCategoryId = f.assetCategoryId;
        if (f.departmentId)    where.departmentId    = f.departmentId;
        if (f.branchId)        where.currentBranchId = f.branchId;

        const [assets, categories, depLogs] = await Promise.all([
          prisma.asset.findMany({
            where,
            include: { assetCategory: true, depreciation: true },
          }),
          prisma.assetCategory.findMany({ select: { id: true, name: true } }),
          f.fyStart && f.fyEnd
            ? prisma.depreciationLog.findMany({
                where: { periodStart: { gte: f.fyStart }, periodEnd: { lte: f.fyEnd } },
              })
            : prisma.depreciationLog.findMany(),
        ]);

        const depByAsset = new Map<number, number>();
        for (const l of depLogs) depByAsset.set(l.assetId, (depByAsset.get(l.assetId) || 0) + num(l.depreciationAmount));

        // Aggregate per category
        const agg = new Map<number, {
          name: string;
          openingGross: number; additions: number; deletions: number; closingGross: number;
          openingAcc: number; depForPeriod: number; closingAcc: number; netBlock: number;
          count: number;
        }>();
        for (const c of categories) {
          agg.set(c.id, {
            name: c.name,
            openingGross: 0, additions: 0, deletions: 0, closingGross: 0,
            openingAcc: 0, depForPeriod: 0, closingAcc: 0, netBlock: 0,
            count: 0,
          });
        }
        for (const a of assets as any[]) {
          const row = agg.get(a.assetCategoryId);
          if (!row) continue;
          const cost = num(a.purchaseCost ?? a.estimatedValue ?? 0);
          const accDep = num(a.depreciation?.accumulatedDepreciation ?? 0);
          const bv = num(a.depreciation?.currentBookValue ?? (cost - accDep));
          const isAdditionInFy = f.fyStart && a.purchaseDate && new Date(a.purchaseDate) >= f.fyStart;
          const isDisposed = ["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());

          row.closingGross += cost;
          if (isAdditionInFy) row.additions += cost;
          else                row.openingGross += cost;
          if (isDisposed)     row.deletions += cost;

          row.closingAcc    += accDep;
          row.depForPeriod  += depByAsset.get(a.id) || 0;
          row.openingAcc    += Math.max(0, accDep - (depByAsset.get(a.id) || 0));
          row.netBlock      += bv;
          row.count         += 1;
        }

        const headers = [
          "Category", "No. of Assets",
          "Opening Gross Block (₹)", "Additions (₹)", "Deletions (₹)", "Closing Gross Block (₹)",
          "Opening Accumulated Depreciation (₹)", "Depreciation for the Period (₹)", "Closing Accumulated Depreciation (₹)",
          "Net Block (₹)",
        ];
        const rows: Row[] = Array.from(agg.values())
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
        const where: any = {};
        if (f.assetCategoryId) where.assetCategoryId = f.assetCategoryId;
        if (f.departmentId)    where.departmentId    = f.departmentId;
        const assets = await prisma.asset.findMany({
          where,
          include: { assetCategory: true, department: true, depreciation: true, vendor: true },
        });
        const headers = [
          "Asset ID", "Asset Name", "Category", "Department", "Location",
          "Purchase Date", "Purchase Cost (₹)", "Vendor",
          "Depreciation Method", "Depreciation Rate (%)", "Expected Life (Years)",
          "Accumulated Depreciation (₹)", "Current Book Value (₹)", "Status",
        ];
        const rows: Row[] = assets.map((a: any) => [
          a.assetId, a.assetName,
          a.assetCategory?.name ?? "", a.department?.name ?? "", a.currentLocation ?? "",
          fmt(a.purchaseDate), money(a.purchaseCost),
          a.vendor?.name ?? "",
          a.depreciation?.depreciationMethod ?? "",
          num(a.depreciation?.depreciationRate).toFixed(2),
          a.depreciation?.expectedLifeYears ?? "",
          money(a.depreciation?.accumulatedDepreciation),
          money(a.depreciation?.currentBookValue),
          a.status ?? "",
        ]);
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
        let fyEnd   = f.fyEnd;
        if (!fyStart || !fyEnd) {
          const now = new Date();
          const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
          fyStart = new Date(startYear, 3, 1);
          fyEnd   = new Date(startYear + 1, 2, 31, 23, 59, 59);
        }
        const fyLabel = f.fyLabel ?? `${fyStart.getFullYear()}-${String((fyStart.getFullYear() + 1) % 100).padStart(2, "0")}`;

        // ── Resolve the reporting window via the priority above ────────────
        const clampDown = (d: Date) => d < fyStart! ? fyStart! : d > fyEnd! ? fyEnd! : d;
        let winStart: Date;
        let winEnd: Date;
        let periodKind: "range" | "month" | "fullYear";
        if (f.start && f.end) {
          winStart   = clampDown(new Date(f.start));
          winEnd     = clampDown(new Date(f.end));
          periodKind = "range";
        } else if (f.month && f.month >= 1 && f.month <= 12) {
          // Apr-Dec belong to FY's starting calendar year; Jan-Mar to the next.
          const yr = f.month >= 4 ? fyStart.getFullYear() : fyStart.getFullYear() + 1;
          winStart   = new Date(yr, f.month - 1, 1);
          winEnd     = new Date(yr, f.month, 0, 23, 59, 59);   // day 0 of next month = last day of this one
          periodKind = "month";
        } else {
          winStart   = fyStart;
          winEnd     = fyEnd;
          periodKind = "fullYear";
        }

        // ── Filename suffix that reflects exactly what was filtered ────────
        const monthShort = (d: Date) =>
          ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
        let periodLabel: string;
        if (periodKind === "range") {
          periodLabel = `${monthShort(winStart)}${winStart.getDate().toString().padStart(2,"0")}-${monthShort(winEnd)}${winEnd.getDate().toString().padStart(2,"0")}`;
        } else if (periodKind === "month") {
          periodLabel = `${monthShort(winStart)}${winStart.getFullYear()}`;
        } else {
          periodLabel = "FullYear";
        }

        const assets = await prisma.asset.findMany({
          where: {
            ...(f.assetCategoryId ? { assetCategoryId: f.assetCategoryId } : {}),
            // Top-level assets only — a sub-asset's cost is already contained in
            // its parent's purchaseCost, so listing both double-counts the
            // acquisition-cost totals. Matches getFixedAssetsSchedule.
            parentAssetId: null,
            OR: [
              { purchaseDate: { lte: winEnd } },
              { donationDate: { lte: winEnd } },
            ],
          },
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
                    accDepAccount:     { select: { code: true, name: true } },
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

        const allLogs = await prisma.depreciationLog.findMany({
          where: {
            assetId: { in: assets.map(a => a.id) },
            periodEnd: { lte: winEnd },
          },
          select: { assetId: true, periodEnd: true, depreciationAmount: true },
        });
        const logsByAsset = new Map<number, typeof allLogs>();
        for (const l of allLogs) {
          const arr = logsByAsset.get(l.assetId) ?? [];
          arr.push(l);
          logsByAsset.set(l.assetId, arr);
        }

        const methodLabel = (m: string | null | undefined) => {
          if (m === "SL") return "Straight-Line";
          if (m === "DB") return "Diminishing Balance";
          return m || "";
        };

        const headers = [
          "No.",                                       // 0
          "Asset ID",                                  // 1
          "Description",                               // 2
          "Category",                                  // 3
          "Location",                                  // 4
          "Last Acquisition Cost Date",                // 5
          "Last Depreciation Date",                    // 6
          "Acquisition Cost before Starting Date",     // 7   ← opening gross
          "Additions during Period",                   // 8
          "Deletions during Period",                   // 9
          "Acquisition Cost at Ending Date",           // 10  ← closing gross
          "Depreciation before Starting Date",         // 11  ← opening dep
          "Depreciation for the Period",               // 12
          "Acc. Depreciation on Disposals",            // 13
          "Depreciation at Ending Date",               // 14  ← closing dep
          "Book Value before Starting Date",           // 15
          "Book Value Net Change",                     // 16
          "Book Value at Ending Date",                 // 17
          "Acquisition Cost Account",                  // 18
          "Accum. Depreciation Account",               // 19
          "Depreciation Starting Date",                // 20
          "Depreciation Ending Date",                  // 21
          "Useful Life (Years)",                       // 22
          "Depreciation Method",                       // 23
          "Straight-Line %",                           // 24
          "Bill Number",                               // 25
          "Vendor Name",                               // 26
        ];
        // Columns whose cells should be numeric & currency-formatted in Excel.
        const numericCols = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
        // Column widths (wch units ≈ characters) — keeps the wide register readable.
        const colWidths = [
          6,  14, 40, 20, 18, 14, 14, 18, 16, 16, 18, 18, 18, 18,
          18, 18, 18, 18, 26, 26, 14, 14, 8,  18, 12, 16, 26,
        ];

        const rows: Row[] = [];
        let no = 0;
        const totals = {
          opGross: 0, additions: 0, deletions: 0, clGross: 0,
          opDep: 0,   periodDep: 0, accDepOnDisp: 0, clDep: 0,
          opBv: 0,    bvNet: 0,     clBv: 0,
        };

        for (const a of assets as any[]) {
          const cost = num(a.purchaseCost ?? a.estimatedValue ?? 0);
          const acqRaw = a.purchaseDate ?? a.donationDate;
          const acq = acqRaw ? new Date(acqRaw) : null;
          const disp = a.disposalDate ? new Date(a.disposalDate) : null;

          const acquiredBeforeWin = acq && acq < winStart;
          const acquiredInWin     = acq && acq >= winStart && acq <= winEnd;
          const disposedBeforeWin = disp && disp < winStart;
          const disposedInWin     = disp && disp >= winStart && disp <= winEnd;

          // ── Gross block math ────────────────────────────────────────────
          // Opening: on the books at winStart.
          const acqOpening = (acquiredBeforeWin && !disposedBeforeWin) ? cost : 0;
          // Additions: capitalised during the window.
          const additions  = acquiredInWin ? cost : 0;
          // Deletions: written off during the window.
          const deletions  = disposedInWin ? cost : 0;
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
          let depUpToWinEnd = 0;       // Σ logs with periodEnd ≤ winEnd
          let depUpToDisposal = 0;     // Σ logs with periodEnd ≤ disposalDate
          let lastDepDate: Date | null = null;
          for (const l of logsByAsset.get(a.id) ?? []) {
            const amt = num(l.depreciationAmount);
            const pe = new Date(l.periodEnd);
            if (pe < winStart) depOpening += amt;
            if (pe <= winEnd)  depUpToWinEnd += amt;
            if (disp && pe <= disp) depUpToDisposal += amt;
            if (!lastDepDate || pe > lastDepDate) lastDepDate = pe;
          }
          const accDepOnDisp = disposedInWin ? depUpToDisposal : 0;
          // Period dep that stays on books = total dep within window minus what
          // was eliminated on disposal. (depUpToWinEnd − depOpening) is the
          // raw within-window dep; subtract the disposal-eliminated portion
          // that falls inside the window.
          const rawPeriodDep = depUpToWinEnd - depOpening;
          const periodDep    = Math.max(0, rawPeriodDep - accDepOnDisp);
          const depClosing   = depOpening + periodDep - accDepOnDisp;

          // ── Book value (derived) ────────────────────────────────────────
          const bvOpening = acqOpening - depOpening;
          const bvClosing = acqClosing - depClosing;
          const bvNet     = bvClosing - bvOpening;

          // Activity-only mode drops rows with no movement in the window
          // (additions/deletions/period dep/disposal dep all zero). The full
          // register additionally drops rows that have no balance at all on
          // either side of the window — those are pre-FY disposals that aren't
          // relevant to any FA register.
          const noActivity =
            additions === 0 && deletions === 0 &&
            periodDep === 0 && accDepOnDisp === 0;
          const noBalance = acqOpening === 0 && acqClosing === 0;
          if (activityOnly ? noActivity : (noActivity && noBalance)) continue;

          const gl = a.assetCategory?.glMapping;
          const acqAccount = gl?.fixedAssetAccount
            ? `${gl.fixedAssetAccount.code} - ${gl.fixedAssetAccount.name}` : "";
          const accDepAccount = gl?.accDepAccount
            ? `${gl.accDepAccount.code} - ${gl.accDepAccount.name}` : "";

          const dep = a.depreciation;
          const depStart = dep?.depreciationStart ? new Date(dep.depreciationStart) : acq;
          let depEnd: Date | null = null;
          if (depStart && dep?.expectedLifeYears) {
            depEnd = new Date(depStart);
            depEnd.setFullYear(depEnd.getFullYear() + dep.expectedLifeYears);
          }

          no += 1;
          rows.push([
            no,
            a.assetId,
            a.assetName,
            a.assetCategory?.name ?? "",
            a.currentLocation ?? "",
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
            dep?.expectedLifeYears ?? "",
            methodLabel(dep?.depreciationMethod),
            dep?.depreciationRate ? num(dep.depreciationRate) : "",
            a.purchaseVoucherNo || a.invoiceNumber || "",
            a.vendor?.name || "",
          ]);

          totals.opGross      += acqOpening;
          totals.additions    += additions;
          totals.deletions    += deletions;
          totals.clGross      += acqClosing;
          totals.opDep        += depOpening;
          totals.periodDep    += periodDep;
          totals.accDepOnDisp += accDepOnDisp;
          totals.clDep        += depClosing;
          totals.opBv         += bvOpening;
          totals.bvNet        += bvNet;
          totals.clBv         += bvClosing;
        }

        // Blank spacer + grand-total row (xlsx CE can't bold cells; we make the
        // label uppercase so it's still visually distinct).
        rows.push(new Array(27).fill(""));
        rows.push([
          "",
          "",                          // Asset ID column
          `TOTAL (${no} assets)`,
          "",                          // Category column
          "",                          // Location column
          "",                          // Last Acq Date
          "",                          // Last Dep Date
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
        const assets = await prisma.asset.findMany({
          include: { assetCategory: true, depreciation: true },
        });
        type Block = { rate: number; label: string; gross: number; accDep: number; bv: number; count: number };
        const blocks = new Map<number, Block>();
        const ensureBlock = (rate: number): Block => {
          if (!blocks.has(rate)) blocks.set(rate, { rate, label: `${rate}% Block`, gross: 0, accDep: 0, bv: 0, count: 0 });
          return blocks.get(rate)!;
        };
        for (const a of assets as any[]) {
          if (!a.depreciation) continue;
          const rate = Math.round(num(a.depreciation.depreciationRate));
          const blk = ensureBlock(rate);
          blk.gross += num(a.purchaseCost);
          blk.accDep += num(a.depreciation.accumulatedDepreciation);
          blk.bv += num(a.depreciation.currentBookValue ?? (num(a.purchaseCost) - num(a.depreciation.accumulatedDepreciation)));
          blk.count += 1;
        }
        const headers = ["Block (Depreciation Rate)", "No. of Assets", "Gross Block (₹)", "Accumulated Depreciation (₹)", "Net Block / WDV (₹)"];
        const rows: Row[] = Array.from(blocks.values())
          .sort((a, b) => a.rate - b.rate)
          .map(b => [b.label, b.count, money(b.gross), money(b.accDep), money(b.bv)]);
        return sendExcel(res, "Block_of_Assets_Schedule", headers, rows, { total: true });
      }

      // A4 — Year-End FA Register Snapshot (every asset, full detail)
      case "year-end-fa-snapshot": {
        const assets = await prisma.asset.findMany({
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
        const rows: Row[] = assets.map((a: any) => [
          a.assetId, a.assetName, a.serialNumber ?? "",
          a.assetCategory?.name ?? "", a.assetNature ?? "", a.assetType ?? "",
          a.department?.name ?? "", a.currentLocation ?? "", a.vendor?.name ?? "",
          a.modeOfProcurement ?? "", fmt(a.purchaseDate), money(a.purchaseCost),
          a.invoiceNumber ?? "", a.grnNumber ?? "", a.purchaseOrderNo ?? "",
          a.depreciation?.depreciationMethod ?? "",
          num(a.depreciation?.depreciationRate).toFixed(2),
          a.depreciation?.expectedLifeYears ?? "",
          money(a.depreciation?.accumulatedDepreciation),
          money(a.depreciation?.currentBookValue),
          a.status ?? "", a.physicalCondition ?? "", fmt(a.createdAt),
        ]);
        return sendExcel(res, "Year_End_FA_Snapshot", headers, rows, { total: true });
      }

      // A5 — Pre-Audit Reconciliation
      // System (Smart Assets) vs Books (GL) vs Audit (auditor's FA register).
      // Each row is one scope (asset / category / pool) at a snapshot date,
      // showing the gross block / acc-dep / net-block from all three sources
      // and the variances between them.
      case "pre-audit-reconciliation": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.asOfDate = dr;
        const snaps = await prisma.reconciliationSnapshot.findMany({
          where,
          include: { resolvedBy: true, createdBy: true } as any,
          orderBy: { asOfDate: "desc" },
        });
        const headers = [
          "As-of Date", "Scope", "Scope Label", "Status", "Variance Flagged",
          "System Gross Block (₹)", "System Acc. Dep (₹)", "System Net Block (₹)",
          "Books Gross Block (₹)",  "Books Acc. Dep (₹)",  "Books Net Block (₹)",
          "Audit Gross Block (₹)",  "Audit Acc. Dep (₹)",  "Audit Net Block (₹)",
          "Variance vs Books (₹)",  "Variance % vs Books",
          "Variance vs Audit (₹)",  "Variance % vs Audit",
          "Resolution Notes", "Resolved By", "Resolved On",
          "Created By", "Created On",
        ];
        const rows: Row[] = (snaps as any[]).map(s => [
          fmt(s.asOfDate), s.scope ?? "", s.scopeLabel ?? "",
          s.status ?? "", yn(s.varianceFlagged),
          money(s.systemGrossBlock), money(s.systemAccDep), money(s.systemNetBlock),
          money(s.booksGrossBlock),  money(s.booksAccDep),  money(s.booksNetBlock),
          money(s.auditGrossBlock),  money(s.auditAccDep),  money(s.auditNetBlock),
          money(s.varianceVsBooks),  num(s.variancePctVsBooks).toFixed(2),
          money(s.varianceVsAudit),  num(s.variancePctVsAudit).toFixed(2),
          s.resolutionNotes ?? "",
          s.resolvedBy?.name ?? "", fmt(s.resolvedAt),
          s.createdBy?.name ?? "",  fmt(s.createdAt),
        ]);
        return sendExcel(res, "Pre_Audit_Reconciliation", headers, rows, { total: true });
      }

      // A6 — Auditor's Working Paper Pack (multi-sheet bundle)
      case "auditor-working-paper-pack": {
        const where: any = {};
        if (f.fyStart) where.purchaseDate = { gte: f.fyStart, lte: f.fyEnd ?? undefined };

        const [assets, depLogs, additions, disposals, vendorBalances] = await Promise.all([
          prisma.asset.findMany({ include: { assetCategory: true, depreciation: true } }),
          prisma.depreciationLog.findMany({
            where: f.fyStart && f.fyEnd ? { periodStart: { gte: f.fyStart }, periodEnd: { lte: f.fyEnd } } : {},
            include: { asset: { select: { assetId: true, assetName: true } } },
            orderBy: { periodEnd: "desc" },
          }),
          prisma.asset.findMany({ where, include: { assetCategory: true, vendor: true } }),
          prisma.assetDisposal.findMany({
            where: f.fyStart && f.fyEnd ? { createdAt: { gte: f.fyStart, lte: f.fyEnd } } : {},
            include: { asset: { select: { assetId: true, assetName: true } } },
          }),
          prisma.vendor.findMany({ where: { isActive: true } }),
        ]);

        const sheets: SheetData[] = [
          {
            name: "Asset Register",
            total: true,
            headers: ["Asset ID", "Asset Name", "Category", "Purchase Date", "Purchase Cost (₹)", "Acc. Depreciation (₹)", "Net Book Value (₹)", "Status"],
            rows: assets.map((a: any) => [
              a.assetId, a.assetName, a.assetCategory?.name ?? "",
              fmt(a.purchaseDate), money(a.purchaseCost),
              money(a.depreciation?.accumulatedDepreciation), money(a.depreciation?.currentBookValue),
              a.status ?? "",
            ]),
          },
          {
            name: "Depreciation Log",
            total: true,
            headers: ["Asset ID", "Asset Name", "Period Start", "Period End", "FY", "Depreciation (₹)", "Book Value After (₹)"],
            rows: depLogs.map((l: any) => [
              l.asset?.assetId ?? "", l.asset?.assetName ?? "",
              fmt(l.periodStart), fmt(l.periodEnd), l.fyLabel ?? "",
              money(l.depreciationAmount), money(l.bookValueAfter),
            ]),
          },
          {
            name: "Additions (Period)",
            total: true,
            headers: ["Asset ID", "Asset Name", "Category", "Vendor", "Purchase Date", "Cost (₹)", "Invoice No"],
            rows: additions.map((a: any) => [
              a.assetId, a.assetName, a.assetCategory?.name ?? "", a.vendor?.name ?? "",
              fmt(a.purchaseDate), money(a.purchaseCost), a.invoiceNumber ?? "",
            ]),
          },
          {
            name: "Disposals (Period)",
            total: true,
            headers: ["Asset ID", "Asset Name", "Disposal Type", "Status", "Sale Value (₹)", "Book Value (₹)", "Gain/Loss (₹)", "Date"],
            rows: disposals.map((d: any) => [
              d.asset?.assetId ?? "", d.asset?.assetName ?? "",
              d.disposalType, d.status, money(d.actualSaleValue), money(d.bookValueAtDisposal), money(d.netGainLoss),
              fmt(d.createdAt),
            ]),
          },
          {
            name: "Active Vendors",
            headers: ["Vendor", "GST No", "PAN", "Contact", "Email", "City", "State"],
            rows: vendorBalances.map((v: any) => [
              v.name, v.gstNumber ?? "", v.panNumber ?? "", v.contact ?? "", v.email ?? "", v.city ?? "", v.state ?? "",
            ]),
          },
        ];
        return sendMultiSheetExcel(res, `Auditor_Working_Paper_Pack${f.fyLabel ? `_${f.fyLabel}` : ""}`, sheets);
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP B — DEPRECIATION & FA MOVEMENT
      // ═══════════════════════════════════════════════════════════════════

      // B1 — Depreciation Log (by FY)
      case "depreciation-log": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.periodEnd = dr;
        if (f.fyLabel) where.fyLabel = f.fyLabel.startsWith("FY") ? f.fyLabel : `FY${f.fyLabel}`;
        const logs = await prisma.depreciationLog.findMany({
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
        const rows: Row[] = logs.map((l: any) => [
          l.fyLabel ?? "", fmt(l.periodStart), fmt(l.periodEnd),
          l.asset?.assetId ?? "", l.asset?.assetName ?? "",
          l.asset?.assetCategory?.name ?? "", l.asset?.department?.name ?? "",
          money(l.openingWdv), money(l.additionsAmount),
          money(l.depOnOpening), money(l.depOnAdditions),
          money(l.depreciationAmount), money(l.bookValueAfter),
          num(l.effectiveRate).toFixed(4),
          yn(l.halfYearApplied), yn(l.isFirstFY),
          l.batchRun?.runNumber ?? "", l.doneBy?.name ?? "",
        ]);
        return sendExcel(res, `Depreciation_Log${f.fyLabel ? `_${f.fyLabel}` : ""}`, headers, rows, { total: true });
      }

      // B2 — Asset Additions Register
      case "asset-additions": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.purchaseDate = dr;
        if (f.assetCategoryId) where.assetCategoryId = f.assetCategoryId;
        if (f.departmentId)    where.departmentId    = f.departmentId;
        if (f.branchId)        where.currentBranchId = f.branchId;
        if (f.vendorId)        where.vendorId        = f.vendorId;
        const assets = await prisma.asset.findMany({
          where,
          include: { assetCategory: true, department: true, vendor: true },
          orderBy: { purchaseDate: "desc" },
        });
        const headers = [
          "Asset ID", "Asset Name", "Category", "Asset Type", "Department", "Location", "Vendor",
          "Mode of Procurement", "Purchase Date", "Purchase Cost (₹)",
          "Invoice No", "GRN No", "PO No",
        ];
        const rows: Row[] = assets.map((a: any) => [
          a.assetId, a.assetName, a.assetCategory?.name ?? "", a.assetType ?? "",
          a.department?.name ?? "", a.currentLocation ?? "", a.vendor?.name ?? "",
          a.modeOfProcurement ?? "", fmt(a.purchaseDate), money(a.purchaseCost),
          a.invoiceNumber ?? "", a.grnNumber ?? "", a.purchaseOrderNo ?? "",
        ]);
        return sendExcel(res, "Asset_Additions", headers, rows, { total: true });
      }

      // B3 — Asset Retirements & Disposals (with gain/loss)
      case "asset-retirements": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        const disposals = await prisma.assetDisposal.findMany({
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
        const rows: Row[] = disposals.map((d: any) => [
          d.asset?.assetId ?? "", d.asset?.assetName ?? "",
          d.asset?.assetCategory?.name ?? "", d.asset?.department?.name ?? "",
          d.disposalType, d.status, d.reason ?? "",
          money(d.estimatedScrapValue), money(d.actualSaleValue),
          money(d.bookValueAtDisposal), money(d.netGainLoss),
          d.buyerName ?? "", d.buyerContact ?? "",
          fmt(d.createdAt), fmt(d.committeeApprovalDate), fmt(d.completedAt),
        ]);
        return sendExcel(res, "Asset_Retirements", headers, rows, { total: true });
      }

      // B4 — Net Block Movement by Category
      case "net-block-movement": {
        const categories = await prisma.assetCategory.findMany({ select: { id: true, name: true } });
        const assets = await prisma.asset.findMany({ include: { depreciation: true } });
        const agg = new Map<number, { name: string; count: number; gross: number; accDep: number; netBlock: number }>();
        for (const c of categories) agg.set(c.id, { name: c.name, count: 0, gross: 0, accDep: 0, netBlock: 0 });
        for (const a of assets as any[]) {
          const row = agg.get(a.assetCategoryId);
          if (!row) continue;
          row.count++;
          row.gross += num(a.purchaseCost);
          row.accDep += num(a.depreciation?.accumulatedDepreciation);
          row.netBlock += num(a.depreciation?.currentBookValue);
        }
        const headers = ["Category", "No. of Assets", "Gross Block (₹)", "Accumulated Depreciation (₹)", "Net Block (₹)"];
        const rows: Row[] = Array.from(agg.values())
          .filter(r => r.count > 0)
          .map(r => [r.name, r.count, money(r.gross), money(r.accDep), money(r.netBlock)]);
        return sendExcel(res, "Net_Block_Movement_by_Category", headers, rows, { total: true });
      }

      // B5 — Fully Depreciated, Still-In-Use
      case "fully-depreciated-in-use": {
        const assets = await prisma.asset.findMany({
          include: { assetCategory: true, department: true, depreciation: true },
        });
        const filtered = (assets as any[]).filter(a => {
          if (!a.depreciation) return false;
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
        const rows: Row[] = filtered.map((a: any) => [
          a.assetId, a.assetName, a.assetCategory?.name ?? "", a.department?.name ?? "",
          fmt(a.purchaseDate), money(a.purchaseCost),
          money(a.depreciation?.accumulatedDepreciation), money(a.depreciation?.currentBookValue),
          money(a.depreciation?.salvageValue),
          a.status ?? "",
        ]);
        return sendExcel(res, "Fully_Depreciated_In_Use", headers, rows, { total: true });
      }

      // B6 — FA Schedule from Asset Pool (FY + Category)
      case "fa-schedule-pool": {
        const where: any = {};
        if (f.assetCategoryId) where.categoryId = f.assetCategoryId;
        if (f.fyLabel)         where.financialYear = f.fyLabel.startsWith("FY") ? f.fyLabel : `FY${f.fyLabel}`;
        const pools = await prisma.assetPool.findMany({
          where,
          include: { category: true, department: true, depreciationSchedules: true },
          orderBy: { financialYear: "asc" },
        });
        const headers = [
          "Pool Code", "FY", "Category", "Department",
          "Original Quantity", "Total Pool Cost (₹)", "Status", "Description",
        ];
        const rows: Row[] = pools.map((p: any) => [
          p.poolCode, p.financialYear, p.category?.name ?? "", p.department?.name ?? "",
          p.originalQuantity, money(p.totalPoolCost), p.status, p.description ?? "",
        ]);
        return sendExcel(res, "FA_Schedule_Pool", headers, rows, { total: true });
      }

      // B7 — Useful Life Remaining
      case "useful-life-remaining": {
        const assets = await prisma.asset.findMany({
          include: { assetCategory: true, depreciation: true },
        });
        const now = new Date();
        const headers = [
          "Asset ID", "Asset Name", "Category", "Purchase Date",
          "Expected Life (Years)", "Years Elapsed", "Years Remaining",
          "Purchase Cost (₹)", "Net Book Value (₹)",
        ];
        const rows: Row[] = (assets as any[])
          .filter(a => a.depreciation && a.depreciation.expectedLifeYears)
          .map(a => {
            const start = a.depreciation.depreciationStart ?? a.purchaseDate ?? a.createdAt;
            const elapsed = start ? (now.getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 365.25) : 0;
            const remaining = Math.max(0, a.depreciation.expectedLifeYears - elapsed);
            return [
              a.assetId, a.assetName, a.assetCategory?.name ?? "",
              fmt(a.purchaseDate), a.depreciation.expectedLifeYears,
              elapsed.toFixed(2), remaining.toFixed(2),
              money(a.purchaseCost), money(a.depreciation.currentBookValue),
            ];
          });
        return sendExcel(res, "Useful_Life_Remaining", headers, rows, { total: true });
      }

      // B8 — Half-Year Convention Applied
      case "half-year-applied": {
        const where: any = { halfYearApplied: true };
        const dr = dateRangeOn(f);
        if (dr) where.periodEnd = dr;
        const logs = await prisma.depreciationLog.findMany({
          where,
          include: { asset: { include: { assetCategory: true } } },
        });
        const headers = ["Asset ID", "Asset Name", "Category", "FY", "Purchase/Addition (₹)", "Effective Rate (%)", "Depreciation (₹)"];
        const rows: Row[] = logs.map((l: any) => [
          l.asset?.assetId ?? "", l.asset?.assetName ?? "", l.asset?.assetCategory?.name ?? "",
          l.fyLabel ?? "", money(l.additionsAmount),
          num(l.effectiveRate).toFixed(4), money(l.depreciationAmount),
        ]);
        return sendExcel(res, "Half_Year_Convention_Applied", headers, rows, { total: true });
      }

      // B9 — Depreciation Method Summary
      case "depreciation-method-summary": {
        const deps = await prisma.assetDepreciation.findMany({ include: { asset: true } });
        const agg = new Map<string, { count: number; gross: number; accDep: number; netBlock: number }>();
        for (const d of deps as any[]) {
          const m = d.depreciationMethod || "OTHER";
          if (!agg.has(m)) agg.set(m, { count: 0, gross: 0, accDep: 0, netBlock: 0 });
          const a = agg.get(m)!;
          a.count++;
          a.gross += num(d.asset?.purchaseCost);
          a.accDep += num(d.accumulatedDepreciation);
          a.netBlock += num(d.currentBookValue);
        }
        const headers = ["Depreciation Method", "No. of Assets", "Gross Block (₹)", "Accumulated Depreciation (₹)", "Net Block (₹)"];
        const rows: Row[] = Array.from(agg.entries()).map(([m, v]) => [m, v.count, money(v.gross), money(v.accDep), money(v.netBlock)]);
        return sendExcel(res, "Depreciation_Method_Summary", headers, rows, { total: true });
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP C — TAX & GST
      // ═══════════════════════════════════════════════════════════════════

      // C1 — GST on Asset Purchases (from PO + Service Invoice GST data)
      case "gst-on-asset-purchases": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.poDate = dr;
        if (f.vendorId) where.vendorId = f.vendorId;
        const pos = await prisma.purchaseOrder.findMany({
          where,
          include: { vendor: true, department: true, lines: true },
          orderBy: { poDate: "desc" },
        });
        const headers = [
          "PO Number", "PO Date", "Vendor", "GST No (Vendor)", "Department", "Status",
          "Subtotal (₹)", "Tax Amount (₹)", "Total Amount (₹)",
          "HSN Codes", "Line Items",
        ];
        const rows: Row[] = pos.map((p: any) => [
          p.poNumber, fmt(p.poDate), p.vendor?.name ?? "", p.vendor?.gstNumber ?? "",
          p.department?.name ?? "", p.status,
          money(p.subtotal), money(p.taxAmount), money(p.totalAmount),
          (p.lines || []).map((l: any) => l.hsnCode).filter(Boolean).join(", "),
          (p.lines || []).length,
        ]);
        return sendExcel(res, "GST_on_Asset_Purchases", headers, rows, { total: true });
      }

      // C2 — Capital Goods ITC Register (5-year amortisation per GST rules)
      case "capital-goods-itc-register": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.poDate = dr;
        const pos = await prisma.purchaseOrder.findMany({
          where: { ...where, status: { in: ["FULLY_RECEIVED", "PARTIALLY_RECEIVED", "CLOSED"] } },
          include: { vendor: true },
        });
        const headers = [
          "PO Number", "PO Date", "Vendor", "GST No",
          "Tax / ITC Amount (₹)", "Monthly Amortisation @60 months (₹)", "Yearly ITC Claimable (₹)",
          "FY",
        ];
        const rows: Row[] = pos.map((p: any) => {
          const tax = num(p.taxAmount);
          const monthly = tax / 60;
          const yearly = monthly * 12;
          return [
            p.poNumber, fmt(p.poDate), p.vendor?.name ?? "", p.vendor?.gstNumber ?? "",
            money(tax), money(monthly), money(yearly), fyLabelFromDate(p.poDate),
          ];
        });
        return sendExcel(res, "Capital_Goods_ITC_Register", headers, rows, { total: true });
      }

      // C3 — TDS on Capital Purchases (from Service Invoice)
      case "tds-on-capital-purchases": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.invoiceDate = dr;
        if (f.vendorId) where.vendorId = f.vendorId;
        const invs = await (prisma as any).serviceInvoice.findMany({
          where,
          include: { vendor: true, asset: true },
          orderBy: { invoiceDate: "desc" },
        });
        const headers = [
          "Invoice No", "Invoice Date", "Vendor", "GST No (Vendor)", "PAN",
          "Asset", "Net Amount (₹)", "GST (%)", "GST Amount (₹)", "TDS Amount (₹)", "Payable (₹)",
        ];
        const rows: Row[] = invs.map((i: any) => [
          i.invoiceNo, fmt(i.invoiceDate), i.vendor?.name ?? "", i.vendor?.gstNumber ?? "", i.vendor?.panNumber ?? "",
          i.asset?.assetId ?? "", money(i.netAmount),
          num(i.gstPct).toFixed(2), money(i.gstAmount), money(i.tdsAmount), money(i.payableAmount),
        ]);
        return sendExcel(res, "TDS_on_Capital_Purchases", headers, rows, { total: true });
      }

      // C4 — Vendor TDS Deductions Summary
      case "vendor-tds-deductions": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.invoiceDate = dr;
        const invs = await (prisma as any).serviceInvoice.findMany({
          where,
          include: { vendor: true },
        });
        const agg = new Map<number, { name: string; gst: string; pan: string; tds: number; net: number; count: number }>();
        for (const i of invs) {
          if (!i.vendorId) continue;
          if (!agg.has(i.vendorId)) agg.set(i.vendorId, {
            name: i.vendor?.name ?? "",
            gst: i.vendor?.gstNumber ?? "",
            pan: i.vendor?.panNumber ?? "",
            tds: 0, net: 0, count: 0,
          });
          const a = agg.get(i.vendorId)!;
          a.tds += num(i.tdsAmount);
          a.net += num(i.netAmount);
          a.count++;
        }
        const headers = ["Vendor", "GST No", "PAN", "No. of Invoices", "Net Billed (₹)", "TDS Deducted (₹)"];
        const rows: Row[] = Array.from(agg.values()).map(v => [v.name, v.gst, v.pan, v.count, money(v.net), money(v.tds)]);
        return sendExcel(res, "Vendor_TDS_Deductions", headers, rows, { total: true });
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP D — VOUCHERS & LEDGER
      // ═══════════════════════════════════════════════════════════════════

      // D1 — Journal Entries (with lines as sub-sheet)
      case "journal-entries": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.entryDate = dr;
        const entries = await prisma.journalEntry.findMany({
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
        const masterRows: Row[] = entries.map((e: any) => [
          e.entryNo, fmt(e.entryDate), fyLabelFromDate(e.entryDate),
          e.narration ?? "", yn(e.isAutoGenerated),
          money(e.totalAmount), e.purchaseVoucher?.voucherNo ?? "", e.paymentVoucher?.voucherNo ?? "",
          e.createdBy?.name ?? "", fmt(e.createdAt),
        ]);
        const lineHeaders = ["Entry No", "Entry Date", "Debit Account", "Credit Account", "Amount (₹)", "Narration"];
        const lineRows: Row[] = entries.flatMap((e: any) =>
          (e.lines || []).map((l: any) => [
            e.entryNo, fmt(e.entryDate),
            l.debitAccount ? `${l.debitAccount.code} - ${l.debitAccount.name}` : "",
            l.creditAccount ? `${l.creditAccount.code} - ${l.creditAccount.name}` : "",
            money(l.amount), l.narration ?? "",
          ])
        );
        return sendMultiSheetExcel(res, "Journal_Entries", [
          { name: "Entries", headers: masterHeaders, rows: masterRows, total: true },
          { name: "Lines",   headers: lineHeaders,   rows: lineRows,   total: true },
        ]);
      }

      // D2 — Payment Vouchers
      case "payment-vouchers": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.voucherDate = dr;
        if (f.vendorId) where.vendorId = f.vendorId;
        const pvs = await prisma.paymentVoucher.findMany({
          where,
          include: { vendor: true, purchaseVoucher: true, approvedBy: true },
          orderBy: { voucherDate: "desc" },
        });
        const headers = [
          "Voucher No", "Voucher Date", "Amount (₹)", "Payment Mode",
          "Bank Name", "Bank Reference", "Vendor", "Linked PV",
          "Status", "Approved By", "Approved On", "Narration",
        ];
        const rows: Row[] = pvs.map((v: any) => [
          v.voucherNo, fmt(v.voucherDate), money(v.amount),
          v.paymentMode, v.bankName ?? "", v.bankReference ?? "",
          v.vendor?.name ?? "", v.purchaseVoucher?.voucherNo ?? "",
          v.status, v.approvedBy?.name ?? "", fmt(v.approvedAt), v.narration ?? "",
        ]);
        return sendExcel(res, "Payment_Vouchers", headers, rows, { total: true });
      }

      // D3 — Purchase Vouchers
      case "purchase-vouchers": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.voucherDate = dr;
        if (f.vendorId) where.vendorId = f.vendorId;
        const pvs = await prisma.purchaseVoucher.findMany({
          where,
          include: { vendor: true, asset: true, goodsReceipt: true },
          orderBy: { voucherDate: "desc" },
        });
        const headers = [
          "Voucher No", "Voucher Date", "Amount (₹)", "Vendor",
          "Asset", "Linked GRN", "Status", "Narration",
        ];
        const rows: Row[] = pvs.map((v: any) => [
          v.voucherNo, fmt(v.voucherDate), money(v.amount),
          v.vendor?.name ?? "", v.asset?.assetId ?? "",
          v.goodsReceipt?.grnNumber ?? "", v.status, v.narration ?? "",
        ]);
        return sendExcel(res, "Purchase_Vouchers", headers, rows, { total: true });
      }

      // D4 — Chart of Accounts
      case "chart-of-accounts": {
        const coa = await prisma.chartOfAccount.findMany({
          include: { parent: true },
          orderBy: { code: "asc" },
        });
        const headers = ["Code", "Name", "Type", "Sub-Type", "Parent Account", "Active", "Description", "Created On"];
        const rows: Row[] = coa.map((c: any) => [
          c.code, c.name, c.type, c.subType ?? "",
          c.parent ? `${c.parent.code} - ${c.parent.name}` : "",
          yn(c.isActive), c.description ?? "", fmt(c.createdAt),
        ]);
        return sendExcel(res, "Chart_of_Accounts", headers, rows);
      }

      // D5 — Trial Balance for FA Accounts
      case "trial-balance-fa": {
        const accounts = await prisma.chartOfAccount.findMany({
          where: { OR: [{ subType: "Fixed Asset" }, { type: "ASSET" as any }] },
          include: { debitLines: true, creditLines: true },
        });
        const headers = ["Code", "Account Name", "Type", "Sub-Type", "Total Debit (₹)", "Total Credit (₹)", "Net Balance (₹)"];
        const rows: Row[] = accounts.map((a: any) => {
          const debit  = (a.debitLines  ?? []).reduce((s: number, l: any) => s + num(l.amount), 0);
          const credit = (a.creditLines ?? []).reduce((s: number, l: any) => s + num(l.amount), 0);
          return [a.code, a.name, a.type, a.subType ?? "", money(debit), money(credit), money(debit - credit)];
        });
        return sendExcel(res, "Trial_Balance_FA", headers, rows, { total: true });
      }

      // D6 — Asset GL Mapping
      case "gl-mapping": {
        const maps = await (prisma as any).assetGLMapping.findMany({
          include: { glFixedAsset: true, glAccDep: true, category: true },
        }).catch(() => []);
        const headers = ["Category", "Fixed Asset GL", "Accumulated Depreciation GL", "Active"];
        const rows: Row[] = maps.map((m: any) => [
          m.category?.name ?? "",
          m.glFixedAsset ? `${m.glFixedAsset.code} - ${m.glFixedAsset.name}` : "",
          m.glAccDep ? `${m.glAccDep.code} - ${m.glAccDep.name}` : "",
          yn(m.isActive ?? true),
        ]);
        return sendExcel(res, "GL_Mapping", headers, rows);
      }

      // D7 — Manual Ledger Entries
      case "manual-ledger": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.entryDate = dr;
        const entries = await (prisma as any).manualLedgerEntry.findMany({
          where,
          orderBy: { entryDate: "desc" },
        });
        const headers = ["Entry No", "Entry Date", "Account", "Type", "Amount (₹)", "Narration", "Created On"];
        const rows: Row[] = entries.map((e: any) => [
          e.entryNo ?? e.id, fmt(e.entryDate), e.accountName ?? e.account ?? "",
          e.type ?? "", money(e.amount), e.narration ?? "", fmt(e.createdAt),
        ]);
        return sendExcel(res, "Manual_Ledger", headers, rows, { total: true });
      }

      // D8 — Sub-Ledger by Asset (depreciation log + cost allocations)
      case "sub-ledger-by-asset": {
        const where: any = {};
        if (f.assetCategoryId) where.assetCategoryId = f.assetCategoryId;
        const assets = await prisma.asset.findMany({
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
        const rows: Row[] = (assets as any[]).map(a => {
          const dep = (a.depreciationLogs || []).reduce((s: number, l: any) => s + num(l.depreciationAmount), 0);
          const cost = (a.costAllocations || []).reduce((s: number, l: any) => s + num(l.amount), 0);
          const lastPeriod = a.depreciationLogs?.[0]?.periodEnd;
          return [
            a.assetId, a.assetName, a.assetCategory?.name ?? "",
            money(a.purchaseCost), money(dep), money(cost),
            money(a.depreciation?.currentBookValue),
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
        const where: any = {};
        if (f.year) where.fiscalYear = f.year;
        if (f.departmentId) where.departmentId = f.departmentId;
        const rows0 = await prisma.capexBudget.findMany({
          where,
          include: { department: true, category: true, createdBy: true },
          orderBy: { fiscalYear: "desc" },
        });
        const headers = [
          "Fiscal Year", "Department", "Category",
          "Budget (₹)", "Actual (₹)", "Variance (₹)", "Utilisation (%)",
          "Created By", "Notes",
        ];
        const rows: Row[] = rows0.map((r: any) => {
          const budget = num(r.budgetAmount);
          const actual = num(r.actualAmount);
          const variance = budget - actual;
          const util = budget > 0 ? (actual / budget) * 100 : 0;
          return [
            r.fiscalYear, r.department?.name ?? "All", r.category?.name ?? "All",
            money(budget), money(actual), money(variance), util.toFixed(2),
            r.createdBy?.name ?? "", r.notes ?? "",
          ];
        });
        return sendExcel(res, "Capex_Budget_vs_Actual", headers, rows, { total: true });
      }

      // E2 — Cost per Asset (Total Cost of Ownership)
      case "cost-per-asset-tco": {
        const assets = await prisma.asset.findMany({
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
        const rows: Row[] = (assets as any[]).map(a => {
          const alloc = (a.costAllocations || []).reduce((s: number, l: any) => s + num(l.amount), 0);
          const ins   = (a.insurance      || []).reduce((s: number, l: any) => s + num(l.premiumAmount), 0);
          const amc   = (a.serviceContracts || []).reduce((s: number, l: any) => s + num(l.contractValue ?? l.value ?? 0), 0);
          const tco = num(a.purchaseCost) + alloc + ins + amc;
          return [
            a.assetId, a.assetName, a.assetCategory?.name ?? "",
            money(a.purchaseCost), money(alloc), money(ins), money(amc),
            money(tco), money(a.depreciation?.currentBookValue),
          ];
        });
        return sendExcel(res, "Cost_per_Asset_TCO", headers, rows, { total: true });
      }

      // E3 — Maintenance Spend by Department / Category
      case "maintenance-spend": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.entryDate = dr;
        const allocs = await prisma.assetCostAllocation.findMany({
          where,
          include: { asset: { include: { assetCategory: true, department: true } } },
        });
        type Key = string;
        const agg = new Map<Key, { department: string; category: string; cost: number; count: number }>();
        for (const c of allocs as any[]) {
          const dept = c.asset?.department?.name ?? "Unassigned";
          const cat  = c.asset?.assetCategory?.name ?? "Unassigned";
          const key  = `${dept}||${cat}`;
          if (!agg.has(key)) agg.set(key, { department: dept, category: cat, cost: 0, count: 0 });
          const e = agg.get(key)!;
          e.cost += num(c.amount);
          e.count++;
        }
        const headers = ["Department", "Category", "Entries", "Total Spend (₹)"];
        const rows: Row[] = Array.from(agg.values())
          .sort((a, b) => b.cost - a.cost)
          .map(v => [v.department, v.category, v.count, money(v.cost)]);
        return sendExcel(res, "Maintenance_Spend", headers, rows, { total: true });
      }

      // E4 — Capex vs Opex Split
      case "capex-vs-opex": {
        const where: any = {};
        if (f.year) {
          where.purchaseDate = {
            gte: new Date(f.year, 3, 1),
            lte: new Date(f.year + 1, 2, 31, 23, 59, 59),
          };
        }
        const [assets, allocations] = await Promise.all([
          prisma.asset.findMany({ where, select: { purchaseCost: true, assetNature: true } }),
          (prisma as any).assetCostAllocation.findMany({
            where: dateRangeOn(f) ? { entryDate: dateRangeOn(f) } : {},
            select: { amount: true },
          }),
        ]);
        const capex = (assets as any[]).reduce((s, a) => s + num(a.purchaseCost), 0);
        const opex  = (allocations as any[]).reduce((s, a) => s + num(a.amount), 0);
        const headers = ["Category", "Amount (₹)", "Share (%)"];
        const total = capex + opex || 1;
        const rows: Row[] = [
          ["Capex (Asset Purchases)", money(capex), ((capex / total) * 100).toFixed(2)],
          ["Opex (Cost Allocations)", money(opex),  ((opex  / total) * 100).toFixed(2)],
          ["Total",                    money(capex + opex), "100.00"],
        ];
        return sendExcel(res, "Capex_vs_Opex", headers, rows);
      }

      // E5 — Top Vendors by Spend (per FY)
      case "top-vendors-by-spend": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.poDate = dr;
        const pos = await prisma.purchaseOrder.findMany({ where, include: { vendor: true } });
        const agg = new Map<number, { name: string; gst: string; pos: number; value: number }>();
        for (const p of pos as any[]) {
          if (!p.vendorId) continue;
          if (!agg.has(p.vendorId)) agg.set(p.vendorId, { name: p.vendor?.name ?? "", gst: p.vendor?.gstNumber ?? "", pos: 0, value: 0 });
          const e = agg.get(p.vendorId)!;
          e.pos++;
          e.value += num(p.totalAmount);
        }
        const headers = ["Vendor", "GST No", "PO Count", "Total PO Value (₹)"];
        const rows: Row[] = Array.from(agg.values())
          .sort((a, b) => b.value - a.value)
          .map(v => [v.name, v.gst, v.pos, money(v.value)]);
        return sendExcel(res, "Top_Vendors_by_Spend", headers, rows, { total: true });
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP F — PROCUREMENT & STORE
      // ═══════════════════════════════════════════════════════════════════

      // F1 — Purchase Orders (multi-sheet: PO + lines + linked GRNs)
      case "purchase-orders": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.poDate = dr;
        if (f.vendorId)     where.vendorId = f.vendorId;
        if (f.departmentId) where.departmentId = f.departmentId;
        const pos = await prisma.purchaseOrder.findMany({
          where,
          include: {
            vendor: true, department: true, indent: true,
            lines: { include: { store: true } },
            goodsReceipts: { include: { vendor: true } } as any,
          } as any,
          orderBy: { poDate: "desc" },
        });
        const masterHeaders = [
          "PO Number", "PO Date", "FY", "Vendor", "GST No", "Department", "Indent",
          "Status", "Subtotal (₹)", "Tax (₹)", "Total (₹)", "Line Count",
        ];
        const masterRows: Row[] = pos.map((p: any) => [
          p.poNumber, fmt(p.poDate), fyLabelFromDate(p.poDate),
          p.vendor?.name ?? "", p.vendor?.gstNumber ?? "",
          p.department?.name ?? "", p.indent?.indentNumber ?? "",
          p.status, money(p.subtotal), money(p.taxAmount), money(p.totalAmount),
          (p.lines || []).length,
        ]);
        const lineHeaders = [
          "PO Number", "Line #", "Item Type", "Description",
          "HSN", "Store", "Quantity", "Unit Price (₹)", "Tax %", "Line Total (₹)",
          "Received Qty", "Pending Qty",
        ];
        const lineRows: Row[] = pos.flatMap((p: any) =>
          (p.lines || []).map((l: any) => [
            p.poNumber, l.lineNumber, l.itemType, l.description,
            l.hsnCode ?? "", l.store?.name ?? "",
            l.quantity, money(l.unitPrice), num(l.taxPercent).toFixed(2), money(l.lineTotal),
            l.receivedQty, l.pendingQty ?? "",
          ])
        );
        const grnHeaders = ["PO Number", "GRN Number", "GRN Date", "Vendor", "Status", "Delivery Date"];
        const grnRows: Row[] = pos.flatMap((p: any) =>
          (p.goodsReceipts || []).map((g: any) => [
            p.poNumber, g.grnNumber, fmt(g.grnDate), g.vendor?.name ?? "", g.status, fmt(g.deliveryDate),
          ])
        );
        return sendMultiSheetExcel(res, "Purchase_Orders", [
          { name: "POs",   headers: masterHeaders, rows: masterRows, total: true },
          { name: "Lines", headers: lineHeaders,   rows: lineRows,   total: true },
          { name: "GRNs",  headers: grnHeaders,    rows: grnRows },
        ]);
      }

      // F2 — Goods Receipt Notes
      case "goods-receipts": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.grnDate = dr;
        if (f.vendorId) where.vendorId = f.vendorId;
        const grs = await prisma.goodsReceipt.findMany({
          where,
          include: { vendor: true, purchaseOrder: true, lines: true },
          orderBy: { grnDate: "desc" },
        });
        const headers = [
          "GRN Number", "GRN Date", "PO Number", "Vendor", "Status",
          "Delivery Challan No", "Delivery Date", "Inspection Remarks", "Line Count",
        ];
        const rows: Row[] = grs.map((g: any) => [
          g.grnNumber, fmt(g.grnDate),
          g.purchaseOrder?.poNumber ?? "", g.vendor?.name ?? "",
          g.status, g.deliveryChallanNo ?? "", fmt(g.deliveryDate),
          g.inspectionRemarks ?? "", (g.lines || []).length,
        ]);
        return sendExcel(res, "Goods_Receipts", headers, rows);
      }

      // F3 — Material Requests
      case "material-requests": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        const reqs = await prisma.materialRequest.findMany({
          where,
          include: { ticket: { include: { asset: true, raisedBy: true } } as any, approvedBy: true } as any,
          orderBy: { createdAt: "desc" },
        });
        const headers = [
          "Ticket ID", "Asset", "Raised By", "Item Type", "Description",
          "Quantity", "Estimated Cost (₹)", "Status",
          "Approved By", "Approved On", "Expected Delivery", "Created On",
        ];
        const rows: Row[] = reqs.map((r: any) => [
          r.ticket?.ticketId ?? "", r.ticket?.asset?.assetName ?? "",
          r.ticket?.raisedBy?.name ?? "",
          r.itemType, r.description, num(r.quantity),
          money(r.estimatedCost), r.status,
          r.approvedBy?.name ?? "", fmt(r.approvedAt),
          fmt(r.expectedDelivery), fmt(r.createdAt),
        ]);
        return sendExcel(res, "Material_Requests", headers, rows, { total: true });
      }

      // F4 — Asset Indents
      case "asset-indents": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        if (f.assetCategoryId) where.assetCategoryId = f.assetCategoryId;
        if (f.departmentId)    where.departmentId    = f.departmentId;
        const indents = await prisma.assetIndent.findMany({
          where,
          include: { raisedBy: true, department: true, assetCategory: true } as any,
          orderBy: { createdAt: "desc" },
        });
        const headers = [
          "Indent No", "Raised By", "Department", "Category",
          "Asset Name", "Quantity", "Urgency",
          "Estimated Budget (₹)", "Required By", "Specifications", "Status", "Created On",
        ];
        const rows: Row[] = indents.map((i: any) => [
          i.indentNumber, i.raisedBy?.name ?? "", i.department?.name ?? "", i.assetCategory?.name ?? "",
          i.assetName, i.quantity, i.urgency,
          money(i.estimatedBudget), fmt(i.requiredByDate),
          i.specifications ?? "", i.status ?? "", fmt(i.createdAt),
        ]);
        return sendExcel(res, "Asset_Indents", headers, rows, { total: true });
      }

      // F5 — Store Stock Position
      case "store-stock-position": {
        const stock = await prisma.storeStockPosition.findMany({
          include: { store: true, sparePart: true, consumable: true } as any,
        });
        const headers = [
          "Store", "Item Type", "Item Name", "Current Qty",
          "Reorder Level", "Status",
        ];
        const rows: Row[] = (stock as any[]).map(s => {
          const itemName = s.sparePart?.name ?? s.consumable?.name ?? "";
          const itemType = s.sparePart ? "Spare Part" : s.consumable ? "Consumable" : "";
          const current = num(s.currentQty);
          const reorder = num(s.reorderLevel);
          const status = reorder > 0 && current <= reorder ? "LOW STOCK" : "OK";
          return [s.store?.name ?? "", itemType, itemName, current, s.reorderLevel ?? "", status];
        });
        return sendExcel(res, "Store_Stock_Position", headers, rows);
      }

      // F6 — Inventory Ageing (consumable batches by expiry)
      case "inventory-ageing": {
        const batches = await (prisma as any).consumableBatch.findMany({
          include: { consumable: true } as any,
          orderBy: { expiryDate: "asc" },
        }).catch(() => []);
        const now = new Date();
        const headers = ["Consumable", "Batch No", "Qty", "Expiry Date", "Days to Expiry", "Status"];
        const rows: Row[] = batches.map((b: any) => {
          const daysToExpiry = b.expiryDate
            ? Math.floor((new Date(b.expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : null;
          const status = daysToExpiry === null ? "" : daysToExpiry < 0 ? "EXPIRED" : daysToExpiry <= 30 ? "EXPIRING SOON" : "OK";
          return [b.consumable?.name ?? "", b.batchNo ?? "", num(b.quantity), fmt(b.expiryDate), daysToExpiry ?? "", status];
        });
        return sendExcel(res, "Inventory_Ageing", headers, rows);
      }

      // F7 — Slow / Non-Moving Spares (no usage in last 6 months)
      case "slow-moving-spares": {
        const sixMoAgo = new Date();
        sixMoAgo.setMonth(sixMoAgo.getMonth() - 6);
        const spares = await prisma.sparePart.findMany({
          include: { usages: { where: { createdAt: { gte: sixMoAgo } } } } as any,
        });
        const headers = ["Spare Part", "Stock Qty", "Reorder Level", "Cost (₹)", "Usage (6 mo)", "Status"];
        const rows: Row[] = (spares as any[])
          .map(s => {
            const usage = (s.usages || []).length;
            return [s.name, s.stockQuantity ?? "", s.reorderLevel ?? "", money(s.cost), usage, usage === 0 ? "NON-MOVING" : usage <= 2 ? "SLOW" : "MOVING"];
          })
          .filter(r => r[5] !== "MOVING");
        return sendExcel(res, "Slow_Moving_Spares", headers, rows, { total: true });
      }

      // F8 — Reorder List
      case "reorder-list": {
        const stock = await prisma.storeStockPosition.findMany({
          where: { reorderLevel: { not: null } } as any,
          include: { store: true, sparePart: true, consumable: true } as any,
        });
        const low = (stock as any[]).filter(s => num(s.currentQty) <= num(s.reorderLevel));
        const headers = ["Store", "Item Type", "Item Name", "Current Qty", "Reorder Level", "Shortfall"];
        const rows: Row[] = low.map(s => [
          s.store?.name ?? "",
          s.sparePart ? "Spare Part" : "Consumable",
          s.sparePart?.name ?? s.consumable?.name ?? "",
          num(s.currentQty), num(s.reorderLevel),
          num(s.reorderLevel) - num(s.currentQty),
        ]);
        return sendExcel(res, "Reorder_List", headers, rows);
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP G — VENDOR ANALYTICS
      // ═══════════════════════════════════════════════════════════════════

      // G1 — Vendor Master
      case "vendor-master": {
        const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
        const headers = [
          "Vendor", "Contact Person", "Phone", "Alternate Phone", "Email",
          "Address", "City", "State", "Pincode",
          "GST No", "PAN", "Vendor Type", "Rating", "Active",
          "Bank Name", "Bank Account", "IFSC",
        ];
        const rows: Row[] = vendors.map((v: any) => [
          v.name, v.contactPerson ?? "", v.contact, v.alternatePhone ?? "", v.email ?? "",
          v.address ?? "", v.city ?? "", v.state ?? "", v.pincode ?? "",
          v.gstNumber ?? "", v.panNumber ?? "", v.vendorType ?? "", v.rating ?? "", yn(v.isActive),
          v.bankName ?? "", v.bankAccount ?? "", v.bankIfsc ?? "",
        ]);
        return sendExcel(res, "Vendor_Master", headers, rows);
      }

      // G2 — Vendor Performance
      case "vendor-performance": {
        const perf = await (prisma as any).vendorPerformanceMetric.findMany({
          include: { vendor: true } as any,
        }).catch(async () => {
          // fallback: compute basic metrics from POs + GRs
          const vs = await prisma.vendor.findMany({ include: { purchaseOrders: { include: { goodsReceipts: true } } } as any });
          return (vs as any[]).map(v => ({
            vendor: v,
            totalPOs: v.purchaseOrders?.length ?? 0,
            grns: v.purchaseOrders?.reduce((s: number, p: any) => s + (p.goodsReceipts?.length ?? 0), 0) ?? 0,
            rating: v.rating,
          }));
        });
        const headers = ["Vendor", "GST No", "Rating", "Total POs", "GRNs", "On-Time %", "Defect %"];
        const rows: Row[] = perf.map((p: any) => [
          p.vendor?.name ?? "", p.vendor?.gstNumber ?? "", p.rating ?? p.vendor?.rating ?? "",
          p.totalPOs ?? "", p.grns ?? "",
          p.onTimePct?.toFixed?.(2) ?? "", p.defectPct?.toFixed?.(2) ?? "",
        ]);
        return sendExcel(res, "Vendor_Performance", headers, rows);
      }

      // G3 — Vendor Outstanding (PO raised vs invoiced vs paid)
      case "vendor-outstanding": {
        const vendors = await prisma.vendor.findMany({
          include: {
            purchaseOrders: { select: { totalAmount: true } },
          } as any,
        });
        const purchaseVouchers = await prisma.purchaseVoucher.findMany({ select: { vendorId: true, amount: true } });
        const paymentVouchers  = await prisma.paymentVoucher.findMany({  select: { vendorId: true, amount: true, status: true } });

        const pvByVendor = new Map<number, number>();
        for (const pv of purchaseVouchers) {
          if (pv.vendorId) pvByVendor.set(pv.vendorId, (pvByVendor.get(pv.vendorId) || 0) + num(pv.amount));
        }
        const paidByVendor = new Map<number, number>();
        for (const pmt of paymentVouchers) {
          if (pmt.vendorId && pmt.status === "APPROVED") {
            paidByVendor.set(pmt.vendorId, (paidByVendor.get(pmt.vendorId) || 0) + num(pmt.amount));
          }
        }

        const headers = ["Vendor", "GST No", "PO Value (₹)", "Invoiced (₹)", "Paid (₹)", "Outstanding (₹)"];
        const rows: Row[] = (vendors as any[]).map(v => {
          const poVal = (v.purchaseOrders || []).reduce((s: number, p: any) => s + num(p.totalAmount), 0);
          const inv = pvByVendor.get(v.id) || 0;
          const paid = paidByVendor.get(v.id) || 0;
          return [v.name, v.gstNumber ?? "", money(poVal), money(inv), money(paid), money(inv - paid)];
        });
        return sendExcel(res, "Vendor_Outstanding", headers, rows, { total: true });
      }

      // G4 — Price Variance (PO rate vs Invoice rate)
      case "price-variance": {
        const invoices = await (prisma as any).serviceInvoice.findMany({
          where: dateRangeOn(f) ? { invoiceDate: dateRangeOn(f) } : {},
          include: { vendor: true, asset: true } as any,
        });
        const headers = ["Invoice No", "Invoice Date", "Vendor", "Asset", "Invoice Amount (₹)", "Net (₹)", "GST (₹)"];
        const rows: Row[] = invoices.map((i: any) => [
          i.invoiceNo, fmt(i.invoiceDate), i.vendor?.name ?? "", i.asset?.assetId ?? "",
          money(i.invoiceAmount ?? i.netAmount), money(i.netAmount), money(i.gstAmount),
        ]);
        return sendExcel(res, "Price_Variance", headers, rows, { total: true });
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP H — INSURANCE & CLAIMS
      // ═══════════════════════════════════════════════════════════════════

      // H1 — Insurance Policies (multi-sheet: policies + claims)
      case "insurance-policies": {
        const [policies, claims] = await Promise.all([
          prisma.assetInsurance.findMany({
            include: { asset: { include: { assetCategory: true, department: true } }, vendor: true } as any,
          }),
          prisma.insuranceClaim.findMany({
            include: { insurance: { include: { asset: true } } } as any,
            orderBy: { createdAt: "desc" },
          }),
        ]);
        const policyHeaders = [
          "Policy No", "Asset", "Category", "Department", "Insurer",
          "Policy Type", "Coverage Amount (₹)", "Premium (₹)",
          "Start Date", "End Date", "Status", "Active",
        ];
        const policyRows: Row[] = (policies as any[]).map(p => [
          p.policyNumber, p.asset?.assetName ?? "", p.asset?.assetCategory?.name ?? "",
          p.asset?.department?.name ?? "", p.vendor?.name ?? p.insurerName ?? "",
          p.policyType ?? "", money(p.coverageAmount), money(p.premiumAmount),
          fmt(p.startDate), fmt(p.endDate), p.policyStatus ?? "", yn(p.isActive),
        ]);
        const claimHeaders = [
          "Claim No", "Policy No", "Asset", "Claim Date",
          "Claim Amount (₹)", "Settled Amount (₹)", "Status", "Settled On", "Reason",
        ];
        const claimRows: Row[] = (claims as any[]).map(c => [
          c.claimNumber ?? c.id, c.insurance?.policyNumber ?? "",
          c.insurance?.asset?.assetName ?? "", fmt(c.claimDate),
          money(c.claimAmount), money(c.settledAmount), c.status,
          fmt(c.settledAt), c.reason ?? "",
        ]);
        return sendMultiSheetExcel(res, "Insurance_Policies", [
          { name: "Policies", headers: policyHeaders, rows: policyRows, total: true },
          { name: "Claims",   headers: claimHeaders,  rows: claimRows,  total: true },
        ]);
      }

      // H2 — Premium Paid by FY
      case "premium-paid-by-fy": {
        const policies = await prisma.assetInsurance.findMany({ include: { asset: true } as any });
        const agg = new Map<string, { count: number; premium: number; coverage: number }>();
        for (const p of policies as any[]) {
          const fy = fyLabelFromDate(p.startDate);
          if (!agg.has(fy)) agg.set(fy, { count: 0, premium: 0, coverage: 0 });
          const e = agg.get(fy)!;
          e.count++;
          e.premium += num(p.premiumAmount);
          e.coverage += num(p.coverageAmount);
        }
        const headers = ["FY", "Policies", "Total Premium (₹)", "Total Coverage (₹)"];
        const rows: Row[] = Array.from(agg.entries())
          .sort()
          .map(([fy, v]) => [fy, v.count, money(v.premium), money(v.coverage)]);
        return sendExcel(res, "Premium_Paid_by_FY", headers, rows, { total: true });
      }

      // H3 — Claims Raised vs Settled
      case "claims-raised-vs-settled": {
        const claims = await prisma.insuranceClaim.findMany({
          where: dateRangeOn(f) ? { createdAt: dateRangeOn(f) } : {},
          include: { insurance: { include: { asset: true } } } as any,
        });
        let raised = 0, settled = 0, pending = 0, rejected = 0;
        let raisedAmt = 0, settledAmt = 0;
        for (const c of claims as any[]) {
          raised++;
          raisedAmt += num(c.claimAmount);
          const s = String(c.status || "").toUpperCase();
          if (s === "SETTLED" || s === "APPROVED") { settled++; settledAmt += num(c.settledAmount); }
          else if (s === "REJECTED")                 rejected++;
          else                                       pending++;
        }
        const headers = ["Metric", "Count", "Amount (₹)"];
        const rows: Row[] = [
          ["Claims Raised",   raised,   money(raisedAmt)],
          ["Claims Settled",  settled,  money(settledAmt)],
          ["Claims Pending",  pending,  ""],
          ["Claims Rejected", rejected, ""],
        ];
        return sendExcel(res, "Claims_Raised_vs_Settled", headers, rows);
      }

      // H4 — Pending Claims
      case "pending-claims": {
        const claims = await prisma.insuranceClaim.findMany({
          where: { status: { notIn: ["SETTLED", "APPROVED", "REJECTED", "CLOSED"] } } as any,
          include: { insurance: { include: { asset: { include: { assetCategory: true, department: true } } } } } as any,
        });
        const headers = ["Claim No", "Policy No", "Asset", "Category", "Department", "Claim Date", "Claim Amount (₹)", "Status", "Days Pending"];
        const now = Date.now();
        const rows: Row[] = (claims as any[]).map(c => [
          c.claimNumber ?? c.id, c.insurance?.policyNumber ?? "",
          c.insurance?.asset?.assetName ?? "",
          c.insurance?.asset?.assetCategory?.name ?? "",
          c.insurance?.asset?.department?.name ?? "",
          fmt(c.claimDate), money(c.claimAmount), c.status,
          c.claimDate ? Math.floor((now - new Date(c.claimDate).getTime()) / (1000 * 60 * 60 * 24)) : "",
        ]);
        return sendExcel(res, "Pending_Claims", headers, rows, { total: true });
      }

      // H5 — Insurance Coverage Gaps (assets without an active policy)
      case "insurance-coverage-gaps": {
        const assets = await prisma.asset.findMany({
          include: { assetCategory: true, department: true, insurance: true } as any,
        });
        const gaps = (assets as any[]).filter(a => {
          const active = (a.insurance || []).some((p: any) =>
            p.isActive && (!p.endDate || new Date(p.endDate) >= new Date())
          );
          const inService = !["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());
          return inService && !active;
        });
        const headers = ["Asset ID", "Asset Name", "Category", "Department", "Purchase Cost (₹)", "Status"];
        const rows: Row[] = gaps.map((a: any) => [
          a.assetId, a.assetName, a.assetCategory?.name ?? "", a.department?.name ?? "",
          money(a.purchaseCost), a.status ?? "",
        ]);
        return sendExcel(res, "Insurance_Coverage_Gaps", headers, rows, { total: true });
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP I — WARRANTY & SERVICE CONTRACTS
      // ═══════════════════════════════════════════════════════════════════

      // I1 — Warranties
      case "warranties": {
        const warranties = await prisma.warranty.findMany({
          include: { asset: { include: { assetCategory: true, department: true } }, vendor: true } as any,
        });
        const now = new Date();
        const headers = [
          "Asset ID", "Asset Name", "Category", "Department",
          "Warranty Type", "Provider", "Reference",
          "Warranty Start", "Warranty End", "Days to Expiry", "Status",
          "Coverage Details", "Support Contact",
        ];
        const rows: Row[] = (warranties as any[]).map(w => {
          const days = w.warrantyEnd
            ? Math.floor((new Date(w.warrantyEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : null;
          const status = days === null ? "" : days < 0 ? "EXPIRED" : days <= 30 ? "EXPIRING SOON" : "ACTIVE";
          return [
            w.asset?.assetId ?? "", w.asset?.assetName ?? "",
            w.asset?.assetCategory?.name ?? "", w.asset?.department?.name ?? "",
            w.warrantyType ?? "", w.warrantyProvider ?? w.vendor?.name ?? "", w.warrantyReference ?? "",
            fmt(w.warrantyStart), fmt(w.warrantyEnd), days ?? "", status,
            w.coverageDetails ?? "", w.supportContact ?? "",
          ];
        });
        return sendExcel(res, "Warranties", headers, rows);
      }

      // I2 — Service Contracts (AMC/CMC)
      case "service-contracts": {
        const contracts = await prisma.serviceContract.findMany({
          include: { asset: { include: { assetCategory: true, department: true } }, vendor: true } as any,
          orderBy: { endDate: "asc" },
        });
        const now = new Date();
        const headers = [
          "Contract No", "Asset", "Category", "Department",
          "Contract Type", "Vendor", "Status",
          "Start Date", "End Date", "Days to Expiry",
          "Contract Value (₹)", "Coverage", "Service Window",
        ];
        const rows: Row[] = (contracts as any[]).map(c => {
          const days = c.endDate ? Math.floor((new Date(c.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
          return [
            c.contractNumber ?? c.id, c.asset?.assetName ?? "",
            c.asset?.assetCategory?.name ?? "", c.asset?.department?.name ?? "",
            c.contractType, c.vendor?.name ?? "", c.status,
            fmt(c.startDate), fmt(c.endDate), days ?? "",
            money(c.contractValue ?? c.value), c.coverage ?? "", c.serviceWindow ?? "",
          ];
        });
        return sendExcel(res, "Service_Contracts", headers, rows, { total: true });
      }

      // I3 — Warranty Utilisation (claims raised vs expired unused)
      case "warranty-utilisation": {
        const warranties = await prisma.warranty.findMany({
          include: { asset: true } as any,
        });
        let active = 0, expiredUnused = 0, expiredUsed = 0;
        for (const w of warranties as any[]) {
          const expired = w.warrantyEnd && new Date(w.warrantyEnd) < new Date();
          if (!expired) active++;
          else if (w.claimsCount && w.claimsCount > 0) expiredUsed++;
          else expiredUnused++;
        }
        const total = warranties.length || 1;
        const headers = ["Status", "Count", "Share (%)"];
        const rows: Row[] = [
          ["Active",          active,        ((active        / total) * 100).toFixed(2)],
          ["Expired (used)",  expiredUsed,   ((expiredUsed   / total) * 100).toFixed(2)],
          ["Expired (unused)",expiredUnused, ((expiredUnused / total) * 100).toFixed(2)],
        ];
        return sendExcel(res, "Warranty_Utilisation", headers, rows);
      }

      // I4 — AMC Coverage Gaps
      case "amc-coverage-gaps": {
        const assets = await prisma.asset.findMany({
          include: { assetCategory: true, department: true, serviceContracts: true } as any,
        });
        const now = new Date();
        const gaps = (assets as any[]).filter(a => {
          const active = (a.serviceContracts || []).some((c: any) =>
            c.status === "ACTIVE" && (!c.endDate || new Date(c.endDate) >= now)
          );
          const inService = !["DISPOSED", "WRITTEN_OFF", "SCRAPPED"].includes(String(a.status || "").toUpperCase());
          return inService && !active;
        });
        const headers = ["Asset ID", "Asset Name", "Category", "Department", "Purchase Cost (₹)", "Status"];
        const rows: Row[] = gaps.map((a: any) => [
          a.assetId, a.assetName, a.assetCategory?.name ?? "", a.department?.name ?? "",
          money(a.purchaseCost), a.status ?? "",
        ]);
        return sendExcel(res, "AMC_Coverage_Gaps", headers, rows, { total: true });
      }

      // I5 — AMC Renewal Cost Projection (contracts expiring in next 12 months)
      case "amc-renewal-projection": {
        const now = new Date();
        const oneYear = new Date(); oneYear.setFullYear(oneYear.getFullYear() + 1);
        const contracts = await prisma.serviceContract.findMany({
          where: { status: "ACTIVE", endDate: { gte: now, lte: oneYear } } as any,
          include: { asset: { include: { assetCategory: true } }, vendor: true } as any,
          orderBy: { endDate: "asc" },
        });
        const headers = ["Asset", "Category", "Vendor", "Current Contract Value (₹)", "Expiry Date", "Renewal FY"];
        const rows: Row[] = (contracts as any[]).map(c => [
          c.asset?.assetName ?? "", c.asset?.assetCategory?.name ?? "", c.vendor?.name ?? "",
          money(c.contractValue ?? c.value), fmt(c.endDate), fyLabelFromDate(c.endDate),
        ]);
        return sendExcel(res, "AMC_Renewal_Projection", headers, rows, { total: true });
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP J — ASSET MASTER & LIFECYCLE
      // ═══════════════════════════════════════════════════════════════════

      // J1 — Asset Master (multi-sheet: master + assignments + sub-assets + documents + maintenance)
      case "asset-master": {
        const where: any = {};
        if (f.assetCategoryId) where.assetCategoryId = f.assetCategoryId;
        if (f.departmentId)    where.departmentId    = f.departmentId;
        if (f.branchId)        where.currentBranchId = f.branchId;
        if (f.assetType)       where.assetType       = f.assetType;
        const [assets, assignments, subAssets, documents, maintHistory] = await Promise.all([
          prisma.asset.findMany({
            where,
            include: { assetCategory: true, department: true, vendor: true, depreciation: true } as any,
            orderBy: { assetId: "asc" },
          }),
          prisma.assetAssignment.findMany({
            include: { asset: true, assignedTo: true, assignedBy: true } as any,
            orderBy: { createdAt: "desc" },
          }),
          // Sub-assets are Asset rows linked to a parent (no separate SubAsset model).
          prisma.asset.findMany({ where: { parentAssetId: { not: null } }, include: { parentAsset: true } as any }).catch(() => []),
          prisma.document.findMany({ include: { asset: true } as any }).catch(() => []),
          prisma.maintenanceHistory.findMany({
            include: { asset: true } as any,
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
        const masterRows: Row[] = (assets as any[]).map(a => [
          a.assetId, a.assetName, a.serialNumber ?? "",
          a.assetCategory?.name ?? "", a.assetType ?? "", a.assetNature ?? "",
          a.department?.name ?? "", a.currentLocation ?? "", a.vendor?.name ?? "",
          fmt(a.purchaseDate), money(a.purchaseCost),
          a.invoiceNumber ?? "", a.grnNumber ?? "", a.purchaseOrderNo ?? "",
          a.modeOfProcurement ?? "", a.manufacturer ?? "", a.modelNumber ?? "",
          a.status ?? "", a.physicalCondition ?? "",
          money(a.depreciation?.accumulatedDepreciation), money(a.depreciation?.currentBookValue),
          fmt(a.createdAt),
        ]);

        const assignHeaders = ["Asset ID", "Asset Name", "Assigned To", "Assigned By", "Assignment Date", "Status", "Acknowledged On"];
        const assignRows: Row[] = (assignments as any[]).map(a => [
          a.asset?.assetId ?? "", a.asset?.assetName ?? "",
          a.assignedTo?.name ?? "", a.assignedBy?.name ?? "",
          fmt(a.createdAt), a.status, fmt(a.acknowledgedAt),
        ]);

        const subHeaders = ["Parent Asset ID", "Parent Asset Name", "Sub-Asset ID", "Sub-Asset Name", "Type", "Status"];
        const subRows: Row[] = (subAssets as any[]).map(s => [
          s.parentAsset?.assetId ?? "", s.parentAsset?.assetName ?? "",
          s.assetId ?? s.id, s.assetName ?? "", s.assetType ?? "", s.status ?? "",
        ]);

        const docHeaders = ["Asset ID", "Asset Name", "Document Title", "Type", "File URL", "Uploaded On"];
        const docRows: Row[] = (documents as any[]).map(d => [
          d.asset?.assetId ?? "", d.asset?.assetName ?? "",
          d.title ?? d.fileName ?? "", d.type ?? d.documentType ?? "",
          d.fileUrl ?? d.filePath ?? "", fmt(d.createdAt),
        ]);

        const mhHeaders = ["Asset ID", "Asset Name", "Performed By", "Performed On", "Service Type", "Total Cost (₹)"];
        const mhRows: Row[] = (maintHistory as any[]).map(m => [
          m.asset?.assetId ?? "", m.asset?.assetName ?? "",
          m.performedBy ?? "", fmt(m.actualDoneAt),
          m.serviceType ?? "", money(m.totalCost ?? m.serviceCost),
        ]);

        return sendMultiSheetExcel(res, "Asset_Master", [
          { name: "Master",              headers: masterHeaders, rows: masterRows, total: true },
          { name: "Assignments",         headers: assignHeaders, rows: assignRows },
          { name: "Sub-Assets",          headers: subHeaders,    rows: subRows },
          { name: "Documents",           headers: docHeaders,    rows: docRows },
          { name: "Maintenance History", headers: mhHeaders,     rows: mhRows,     total: true },
        ]);
      }

      // J2 — Asset Movement Log (transfers + gate passes consolidated)
      case "asset-movement-log": {
        const [transfers, gatePasses] = await Promise.all([
          prisma.assetTransferHistory.findMany({
            include: { asset: true, fromDepartment: true, toDepartment: true } as any,
            orderBy: { createdAt: "desc" },
          }),
          prisma.gatePass.findMany({
            include: { items: { include: { asset: true } }, requestedBy: true } as any,
            orderBy: { createdAt: "desc" },
          }),
        ]);
        const tHeaders = ["Date", "Asset ID", "Asset Name", "From Department", "To Department", "Type", "Reason", "Status"];
        const tRows: Row[] = (transfers as any[]).map(t => [
          fmt(t.createdAt), t.asset?.assetId ?? "", t.asset?.assetName ?? "",
          t.fromDepartment?.name ?? "", t.toDepartment?.name ?? "",
          t.transferType ?? "TRANSFER", t.reason ?? "", t.status ?? "",
        ]);
        const gHeaders = ["Date", "Gate Pass No", "Type", "Issued To", "Items", "Expected Return", "Status", "Requested By"];
        const gRows: Row[] = (gatePasses as any[]).map(g => [
          fmt(g.createdAt), g.gatePassNo, g.type, g.issuedTo ?? "",
          (g.items || []).map((i: any) => i.asset?.assetName).filter(Boolean).join("; "),
          fmt(g.expectedReturnDate), g.status, g.requestedBy?.name ?? "",
        ]);
        return sendMultiSheetExcel(res, "Asset_Movement_Log", [
          { name: "Transfers",  headers: tHeaders, rows: tRows },
          { name: "Gate Passes", headers: gHeaders, rows: gRows },
        ]);
      }

      // J3 — Physical Audit Records
      case "physical-audit": {
        const audits = await prisma.assetAudit.findMany({
          include: { items: { include: { asset: true } } } as any,
          orderBy: { auditDate: "desc" },
        });
        const headers = [
          "Audit Name", "Audit Date", "Status",
          "Total Assets", "Verified", "Missing", "Mismatched",
          "Completed On", "Remarks",
        ];
        const rows: Row[] = audits.map((a: any) => [
          a.auditName, fmt(a.auditDate), a.status,
          a.totalAssets, a.verifiedCount, a.missingCount, a.mismatchCount,
          fmt(a.completedAt), a.remarks ?? "",
        ]);
        return sendExcel(res, "Physical_Audit", headers, rows);
      }

      // J4 — Asset Utilisation (assigned vs in-store vs idle)
      case "asset-utilisation": {
        const assets = await prisma.asset.findMany({
          include: { assetCategory: true } as any,
        });
        const byCategory = new Map<string, { total: number; active: number; inStore: number; idle: number; disposed: number }>();
        for (const a of assets as any[]) {
          const cat = a.assetCategory?.name ?? "Uncategorised";
          if (!byCategory.has(cat)) byCategory.set(cat, { total: 0, active: 0, inStore: 0, idle: 0, disposed: 0 });
          const s = byCategory.get(cat)!;
          s.total++;
          const st = String(a.status || "").toUpperCase();
          if (st === "ACTIVE")           s.active++;
          else if (st === "IN_STORE")    s.inStore++;
          else if (st === "DISPOSED")    s.disposed++;
          else                            s.idle++;
        }
        const headers = ["Category", "Total", "Active", "In Store", "Idle / Other", "Disposed", "Utilisation %"];
        const rows: Row[] = Array.from(byCategory.entries()).map(([cat, s]) => [
          cat, s.total, s.active, s.inStore, s.idle, s.disposed,
          s.total > 0 ? ((s.active / s.total) * 100).toFixed(2) : "0.00",
        ]);
        return sendExcel(res, "Asset_Utilisation", headers, rows);
      }

      // J5 — Disposal & E-Waste (consolidated)
      case "disposal-ewaste": {
        const [disposals, ewaste] = await Promise.all([
          prisma.assetDisposal.findMany({
            include: { asset: { include: { assetCategory: true, department: true } } } as any,
            orderBy: { createdAt: "desc" },
          }),
          prisma.eWasteRecord.findMany({
            include: { asset: true } as any,
            orderBy: { createdAt: "desc" },
          }),
        ]);
        const dHeaders = ["Asset ID", "Asset Name", "Category", "Department", "Disposal Type", "Status", "Sale Value (₹)", "Book Value (₹)", "Gain/Loss (₹)", "Date"];
        const dRows: Row[] = (disposals as any[]).map(d => [
          d.asset?.assetId ?? "", d.asset?.assetName ?? "",
          d.asset?.assetCategory?.name ?? "", d.asset?.department?.name ?? "",
          d.disposalType, d.status, money(d.actualSaleValue),
          money(d.bookValueAtDisposal), money(d.netGainLoss), fmt(d.createdAt),
        ]);
        const eHeaders = ["E-Waste Ref", "Asset ID", "Asset Name", "Status", "Asset Condition", "Data Wiped", "Wipe Method", "Created On"];
        const eRows: Row[] = (ewaste as any[]).map(e => [
          e.eWasteRefNo, e.asset?.assetId ?? "", e.asset?.assetName ?? "",
          e.status, e.assetCondition ?? "", yn(e.dataWiped), e.dataWipeMethod ?? "", fmt(e.createdAt),
        ]);
        return sendMultiSheetExcel(res, "Disposal_EWaste", [
          { name: "Disposals", headers: dHeaders, rows: dRows, total: true },
          { name: "E-Waste",   headers: eHeaders, rows: eRows },
        ]);
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP K — MAINTENANCE, CALIBRATION & SLA
      // ═══════════════════════════════════════════════════════════════════

      // K1 — Repair Tickets
      case "tickets": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        if (f.departmentId) where.departmentId = f.departmentId;
        const tickets = await prisma.ticket.findMany({
          where,
          include: { asset: true, raisedBy: true, assignedTo: true, department: true } as any,
          orderBy: { createdAt: "desc" },
        });
        const headers = [
          "Ticket ID", "Asset ID", "Asset Name", "Department",
          "Issue Type", "Priority", "Status", "Raised By", "Assigned To",
          "Created On", "Resolved On", "SLA Breached", "SLA Deadline",
        ];
        const rows: Row[] = (tickets as any[]).map(t => [
          t.ticketId, t.asset?.assetId ?? "", t.asset?.assetName ?? "",
          t.department?.name ?? "",
          t.issueType ?? "", t.priority ?? "", t.status,
          t.raisedBy?.name ?? "", t.assignedTo?.name ?? "",
          fmt(t.createdAt), fmt(t.resolvedAt),
          yn(t.slaBreached), `${t.slaExpectedValue ?? ""} ${t.slaExpectedUnit ?? ""}`,
        ]);
        return sendExcel(res, "Repair_Tickets", headers, rows);
      }

      // K2 — Work Orders (multi-sheet: WO + WCC)
      case "work-orders": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        const wos = await prisma.workOrder.findMany({
          where,
          include: { asset: true, assignedTo: true, vendor: true, wcc: true } as any,
          orderBy: { createdAt: "desc" },
        });
        const woHeaders = [
          "WO Number", "Asset", "Job Type", "Assigned To", "Vendor",
          "Status", "Scheduled Date", "Estimated Cost (₹)", "Actual Cost (₹)", "Created On",
        ];
        const woRows: Row[] = (wos as any[]).map(w => [
          w.workOrderNumber ?? w.woNumber ?? w.id, w.asset?.assetName ?? "",
          w.jobType ?? "", w.assignedTo?.name ?? "", w.vendor?.name ?? "",
          w.status, fmt(w.scheduledDate), money(w.estimatedCost), money(w.actualCost), fmt(w.createdAt),
        ]);
        const wccHeaders = ["WO Number", "Completion Date", "Work Done", "Actual Cost (₹)", "Approved By"];
        const wccRows: Row[] = (wos as any[]).flatMap(w =>
          (w.wcc ? [w.wcc] : []).map((c: any) => [
            w.workOrderNumber ?? w.woNumber ?? w.id, fmt(c.completionDate),
            c.workDone ?? c.description ?? "", money(c.actualCost), c.approvedBy ?? "",
          ])
        );
        return sendMultiSheetExcel(res, "Work_Orders", [
          { name: "Work Orders", headers: woHeaders, rows: woRows,  total: true },
          { name: "WCCs",        headers: wccHeaders, rows: wccRows, total: true },
        ]);
      }

      // K3 — Preventive Maintenance Schedules
      case "pm-schedules": {
        const schedules = await prisma.maintenanceSchedule.findMany({
          include: { asset: { include: { department: true } } } as any,
        });
        const headers = ["Asset", "Department", "Schedule Type", "Frequency", "Next Due", "Last Performed", "Active"];
        const rows: Row[] = (schedules as any[]).map(s => [
          s.asset?.assetName ?? "", s.asset?.department?.name ?? "",
          s.scheduleType ?? "", `${s.frequencyValue ?? ""} ${s.frequencyUnit ?? ""}`,
          fmt(s.nextDueAt), fmt(s.lastPerformedAt), yn(s.isActive ?? true),
        ]);
        return sendExcel(res, "PM_Schedules", headers, rows);
      }

      // K4 — PM Checklist Runs
      case "pm-runs": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.scheduledDue = dr;
        const runs = await prisma.preventiveChecklistRun.findMany({
          where,
          include: { asset: true, template: true, performedBy: true } as any,
          orderBy: { scheduledDue: "desc" },
        });
        const headers = [
          "Template", "Asset", "Scheduled Due", "Status",
          "Performed On", "Performed By",
        ];
        const rows: Row[] = (runs as any[]).map(r => [
          r.template?.name ?? "", r.asset?.assetName ?? "",
          fmt(r.scheduledDue), r.status,
          fmt(r.performedAt), r.performedBy?.name ?? "",
        ]);
        return sendExcel(res, "PM_Runs", headers, rows);
      }

      // K5 — Calibration Schedules
      case "calibration-schedules": {
        const schedules = await prisma.calibrationSchedule.findMany({
          include: { asset: { include: { department: true } }, vendor: true } as any,
        });
        const headers = ["Asset", "Department", "Frequency", "Next Due", "Last Calibrated", "Vendor", "Reminder Days", "Active"];
        const rows: Row[] = (schedules as any[]).map(s => [
          s.asset?.assetName ?? "", s.asset?.department?.name ?? "",
          `${s.frequencyValue} ${s.frequencyUnit}`,
          fmt(s.nextDueAt), fmt(s.lastCalibratedAt),
          s.vendor?.name ?? "", s.reminderDays ?? "", yn(s.isActive),
        ]);
        return sendExcel(res, "Calibration_Schedules", headers, rows);
      }

      // K6 — Calibration History
      case "calibration-history": {
        const history = await prisma.calibrationHistory.findMany({
          include: { asset: true, performedBy: true } as any,
          orderBy: { calibratedAt: "desc" },
        }).catch(() => []);
        const headers = ["Asset", "Calibrated On", "Performed By", "Result", "Certificate", "Next Due", "Notes"];
        const rows: Row[] = (history as any[]).map(h => [
          h.asset?.assetName ?? "", fmt(h.calibratedAt),
          h.performedBy?.name ?? "", h.result ?? "",
          h.certificateUrl ?? h.certificateNumber ?? "", fmt(h.nextDueAt), h.notes ?? "",
        ]);
        return sendExcel(res, "Calibration_History", headers, rows);
      }

      // K7 — Out-of-Calibration list (overdue)
      case "out-of-calibration": {
        const now = new Date();
        const schedules = await prisma.calibrationSchedule.findMany({
          where: { isActive: true, nextDueAt: { lt: now } },
          include: { asset: { include: { department: true } }, vendor: true } as any,
        });
        const headers = ["Asset", "Department", "Vendor", "Last Calibrated", "Was Due On", "Days Overdue"];
        const rows: Row[] = (schedules as any[]).map(s => [
          s.asset?.assetName ?? "", s.asset?.department?.name ?? "", s.vendor?.name ?? "",
          fmt(s.lastCalibratedAt), fmt(s.nextDueAt),
          Math.floor((now.getTime() - new Date(s.nextDueAt).getTime()) / (1000 * 60 * 60 * 24)),
        ]);
        return sendExcel(res, "Out_of_Calibration", headers, rows);
      }

      // K8 — SLA Breach Trend
      case "sla-breach-trend": {
        const where: any = { slaBreached: true };
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        const tickets = await prisma.ticket.findMany({
          where,
          include: { asset: { include: { assetCategory: true, department: true } }, assignedTo: true } as any,
          orderBy: { createdAt: "desc" },
        });
        const headers = ["Ticket", "Asset", "Category", "Department", "Priority", "Assigned To", "Created On", "Resolved On", "SLA"];
        const rows: Row[] = (tickets as any[]).map(t => [
          t.ticketId, t.asset?.assetName ?? "",
          t.asset?.assetCategory?.name ?? "", t.asset?.department?.name ?? "",
          t.priority ?? "", t.assignedTo?.name ?? "",
          fmt(t.createdAt), fmt(t.resolvedAt),
          `${t.slaExpectedValue ?? ""} ${t.slaExpectedUnit ?? ""}`,
        ]);
        return sendExcel(res, "SLA_Breach_Trend", headers, rows);
      }

      // K9 — Escalation Log
      case "escalation-log": {
        const escalations = await (prisma as any).ticketEscalation.findMany({
          include: { ticket: { include: { asset: true } }, escalatedTo: true } as any,
          orderBy: { createdAt: "desc" },
        }).catch(() => []);
        const headers = ["Ticket", "Asset", "Escalated To", "Level", "Reason", "Created On"];
        const rows: Row[] = (escalations as any[]).map(e => [
          e.ticket?.ticketId ?? "", e.ticket?.asset?.assetName ?? "",
          e.escalatedTo?.name ?? "", e.level ?? "", e.reason ?? "", fmt(e.createdAt),
        ]);
        return sendExcel(res, "Escalation_Log", headers, rows);
      }

      // K10 — Root Cause Analysis log
      case "rca-log": {
        const rcas = await (prisma as any).rootCauseAnalysis.findMany({
          include: { ticket: { include: { asset: true } } } as any,
          orderBy: { createdAt: "desc" },
        }).catch(() => []);
        const headers = ["Ticket", "Asset", "Root Cause", "Corrective Action", "Preventive Action", "Created On"];
        const rows: Row[] = (rcas as any[]).map(r => [
          r.ticket?.ticketId ?? "", r.ticket?.asset?.assetName ?? "",
          r.rootCause ?? "", r.correctiveAction ?? "", r.preventiveAction ?? "", fmt(r.createdAt),
        ]);
        return sendExcel(res, "RCA_Log", headers, rows);
      }

      // K11 — Decision Engine Recommendations
      case "decision-engine": {
        const logs = await (prisma as any).decisionEngineLog.findMany({
          include: { asset: true } as any,
          orderBy: { createdAt: "desc" },
        }).catch(() => []);
        const headers = ["Asset", "Recommendation", "Reason", "Score", "Created On"];
        const rows: Row[] = (logs as any[]).map(l => [
          l.asset?.assetName ?? "", l.recommendation ?? l.action ?? "",
          l.reason ?? "", l.score ?? "", fmt(l.createdAt),
        ]);
        return sendExcel(res, "Decision_Engine_Log", headers, rows);
      }

      // ═══════════════════════════════════════════════════════════════════
      // GROUP L — HR & ADMIN AUDIT
      // ═══════════════════════════════════════════════════════════════════

      // L1 — Employees with Assigned Assets
      case "employees-with-assets": {
        const employees = await prisma.employee.findMany({
          include: {
            department: true,
            assignedAssets: { include: { asset: { include: { assetCategory: true } } } } as any,
          } as any,
          orderBy: { name: "asc" },
        });
        const headers = [
          "Employee ID", "Name", "Department", "Role",
          "Assets Count", "Asset List", "Email", "Active",
        ];
        const rows: Row[] = (employees as any[]).map(e => [
          e.employeeID, e.name, e.department?.name ?? "", e.role ?? "",
          (e.assignedAssets || []).length,
          (e.assignedAssets || []).map((a: any) => a.asset?.assetName).filter(Boolean).join("; "),
          e.email ?? "", yn(e.isActive),
        ]);
        return sendExcel(res, "Employees_with_Assets", headers, rows);
      }

      // L2 — Employee Exit Clearance
      case "employee-exits": {
        const exits = await prisma.employeeExit.findMany({
          include: { employee: { include: { department: true } }, exitAssets: { include: { asset: true } } } as any,
          orderBy: { exitDate: "desc" },
        });
        const headers = [
          "Exit Number", "Employee", "Department", "Exit Type",
          "Last Working Date", "Initiated On", "Status",
          "Assigned", "Returned", "Pending",
          "Pending Items",
        ];
        const rows: Row[] = (exits as any[]).map(e => [
          e.exitNumber, e.employee?.name ?? "", e.employee?.department?.name ?? "",
          e.exitType, fmt(e.exitDate), fmt(e.initiatedDate), e.status,
          e.totalAssetsAssigned, e.assetsReturned, e.assetsPending,
          (e.exitAssets || []).filter((a: any) => a.status === "PENDING").map((a: any) => a.asset?.assetName).filter(Boolean).join("; "),
        ]);
        return sendExcel(res, "Employee_Exits", headers, rows);
      }

      // L3 — Login History
      case "login-history": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.attemptedAt = dr;
        const logs = await prisma.loginHistory.findMany({
          where,
          include: { user: { include: { employee: true } } } as any,
          orderBy: { attemptedAt: "desc" },
          take: 5000,
        });
        const headers = ["Employee", "User Name", "Role", "Attempted At", "Success", "IP Address", "User Agent"];
        const rows: Row[] = (logs as any[]).map(l => [
          l.user?.employee?.name ?? "", l.user?.username ?? l.user?.employeeID ?? "",
          l.user?.role ?? "", fmtT(l.attemptedAt), yn(l.success),
          l.ipAddress ?? "", l.userAgent ?? "",
        ]);
        return sendExcel(res, "Login_History", headers, rows);
      }

      // L4 — Activity Audit Trail
      case "audit-trail": {
        const where: any = {};
        const dr = dateRangeOn(f);
        if (dr) where.createdAt = dr;
        const logs = await prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 10000,
        });
        const headers = [
          "Date / Time", "Entity Type", "Entity ID", "Action",
          "Description", "Performed By", "IP Address",
        ];
        const rows: Row[] = (logs as any[]).map(l => [
          fmtT(l.createdAt), l.entityType, l.entityId, l.action,
          l.description ?? "", l.performedBy ?? "", l.ipAddress ?? "",
        ]);
        return sendExcel(res, "Audit_Trail", headers, rows);
      }

      // L5 — User Access Matrix
      case "user-access-matrix": {
        const users = await prisma.user.findMany({
          include: { employee: { include: { department: true } } } as any,
          orderBy: { id: "asc" },
        });
        const headers = ["User ID", "Employee ID", "Name", "Email", "Department", "Role", "Last Login", "Active"];
        const rows: Row[] = (users as any[]).map(u => [
          u.id, u.employeeID ?? "", u.employee?.name ?? "",
          u.employee?.email ?? "", u.employee?.department?.name ?? "",
          u.role, fmtT(u.lastLogin), yn(u.isActive ?? true),
        ]);
        return sendExcel(res, "User_Access_Matrix", headers, rows);
      }

      // L6 — Module Access by Role
      case "module-access-by-role": {
        const perms = await prisma.modulePermission.findMany({
          include: { module: true, moduleItem: true, employee: true } as any,
        });
        const headers = ["Module", "Module Item", "Role", "Employee", "Can Access", "Last Updated"];
        const rows: Row[] = (perms as any[]).map(p => [
          p.module?.name ?? "", p.moduleItem?.name ?? "",
          p.role ?? "", p.employee?.name ?? "",
          yn(p.canAccess), fmt(p.updatedAt),
        ]);
        return sendExcel(res, "Module_Access_by_Role", headers, rows);
      }

      // L7 — Approval Config Snapshot
      case "approval-config": {
        const cfg = await prisma.approvalConfig.findMany({ orderBy: [{ module: "asc" }, { level: "asc" }] });
        const headers = ["Module", "Level", "Approver Role", "Min Amount (₹)", "Max Amount (₹)", "Active"];
        const rows: Row[] = (cfg as any[]).map(c => [
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
  } catch (err: any) {
    console.error(`Export failed [${report}]:`, err);
    res.status(500).json({ error: "Export failed", details: err?.message });
  }
};

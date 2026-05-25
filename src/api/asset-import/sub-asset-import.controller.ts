import { Request, Response } from "express";
import fs from "fs";
import XLSX from "xlsx";
import prisma from "../../prismaClient";
import { generateSubAssetId } from "../../utilis/assetIdGenerator";

// ─────────────────────────────────────────────────────────────────────────────
// SUB-ASSET BULK IMPORT
// One flat "SubAssets" sheet — each row is a sub-asset linked to its parent by
// the parent's visible Asset ID. Mirrors the asset importer's pattern.
// Rows whose value is >= 40% of the parent's value are skipped and reported
// (the same threshold the single-create UI enforces).
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_NAME = "SubAssets";
const THRESHOLD_PCT = 40;

const TEMPLATE_HEADERS = [
  "Parent Asset ID",   // required — parent's visible assetId
  "Sub-Asset Name",    // required
  "Asset Type",        // required
  "Category",          // required — resolved by category name
  "Serial Number",     // required — unique
  "Status",            // required — e.g. ACTIVE | IN_STORE
  "Source Type",       // NEW | INVENTORY_SPARE (default NEW)
  "Reference Code",    // optional — unique
  "Mode of Procurement", // default PURCHASE
  "Vendor",            // optional — resolved by vendor name
  "Department",        // optional — resolved by department name
  "Purchase Date",     // optional — YYYY-MM-DD
  "Purchase Cost",     // optional — number
  "Working Condition", // optional
  "Remarks",           // optional
];

const norm = (v: any): string => String(v ?? "").trim();
const lc = (v: any): string => norm(v).toLowerCase();

function parseDate(v: any): Date | null {
  const s = norm(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function parseNum(v: any): number | null {
  const s = norm(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// ─── GET /api/import/sub-assets-template ─────────────────────────────────────
export const downloadSubAssetTemplate = (_req: Request, res: Response): void => {
  try {
    const example = [{
      "Parent Asset ID": "AST-EXAMPLE-0001",
      "Sub-Asset Name": "Compressor Unit",
      "Asset Type": "Component",
      "Category": "Medical Equipment",
      "Serial Number": "SUB-SN-0001",
      "Status": "ACTIVE",
      "Source Type": "NEW",
      "Reference Code": "",
      "Mode of Procurement": "PURCHASE",
      "Vendor": "",
      "Department": "",
      "Purchase Date": "2025-04-01",
      "Purchase Cost": 15000,
      "Working Condition": "WORKING",
      "Remarks": "Optional notes",
    }];

    const instructions = [
      { Field: "Parent Asset ID", Notes: "REQUIRED. The visible Asset ID of the parent (must already exist)." },
      { Field: "Sub-Asset Name",  Notes: "REQUIRED." },
      { Field: "Asset Type",      Notes: "REQUIRED. Free text, e.g. Component / Accessory." },
      { Field: "Category",        Notes: "REQUIRED. Must match an existing Asset Category name exactly (case-insensitive)." },
      { Field: "Serial Number",   Notes: "REQUIRED. Must be unique across all assets." },
      { Field: "Status",          Notes: "REQUIRED. e.g. ACTIVE, IN_STORE." },
      { Field: "Source Type",     Notes: "Optional. NEW or INVENTORY_SPARE. Defaults to NEW." },
      { Field: "Reference Code",  Notes: "Optional. Must be unique if provided." },
      { Field: "Mode of Procurement", Notes: "Optional. Defaults to PURCHASE." },
      { Field: "Vendor",          Notes: "Optional. Must match an existing Vendor name if provided." },
      { Field: "Department",      Notes: "Optional. Must match an existing Department name if provided." },
      { Field: "Purchase Date",   Notes: "Optional. Format YYYY-MM-DD." },
      { Field: "Purchase Cost",   Notes: "Optional. Number. NOTE: rows where this is >= 40% of the parent's value are still created as sub-assets, but flagged for review in the app." },
      { Field: "Working Condition", Notes: "Optional. e.g. WORKING / PARTIAL / NOT_WORKING." },
      { Field: "Remarks",         Notes: "Optional." },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(example, { header: TEMPLATE_HEADERS });
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
    const instrWs = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sub_Assets_Import_Template.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("downloadSubAssetTemplate error:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
};

// ─── POST /api/import/sub-assets-excel ───────────────────────────────────────
export const importSubAssetsExcel = async (req: Request, res: Response): Promise<void> => {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  type RowResult = {
    row: number;
    parentAssetId: string;
    serialNumber: string;
    status: "CREATED" | "SKIPPED" | "ERROR";
    subAssetId?: string;
    reason?: string;
    flagged?: boolean; // created but value >= 40% of parent
  };
  const results: RowResult[] = [];
  let created = 0, skipped = 0, errored = 0, flagged = 0;

  try {
    const workbook = XLSX.readFile(file.path);
    const sheet = workbook.Sheets[SHEET_NAME] || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      res.status(400).json({ message: `Sheet "${SHEET_NAME}" not found in the uploaded file.` });
      return;
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    if (!rows.length) {
      res.status(400).json({ message: "The sheet has no data rows." });
      return;
    }

    // ── Resolution maps (loaded once) ──
    const [categories, vendors, departments] = await Promise.all([
      prisma.assetCategory.findMany({ select: { id: true, name: true } }),
      prisma.vendor.findMany({ select: { id: true, name: true } }),
      prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const catByName  = new Map(categories.map(c => [lc(c.name), c.id]));
    const venByName  = new Map(vendors.map(v => [lc(v.name), v.id]));
    const deptByName = new Map(departments.map(d => [lc(d.name), d.id]));

    // Parent cache (assetId → parent row) + in-file serial/ref dedupe sets
    const parentCache = new Map<string, { id: number; assetId: string; value: number } | null>();
    const seenSerials = new Set<string>();
    const seenRefs = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2; // +2: 1-based + header row
      const parentAssetId = norm(r["Parent Asset ID"]);
      const serialNumber  = norm(r["Serial Number"]);
      const push = (status: RowResult["status"], reason?: string, subAssetId?: string, isFlagged?: boolean) => {
        results.push({ row: rowNo, parentAssetId, serialNumber, status, reason, subAssetId, flagged: isFlagged });
        if (status === "CREATED") { created++; if (isFlagged) flagged++; }
        else if (status === "SKIPPED") skipped++;
        else errored++;
      };

      // ── Required fields ──
      const assetName = norm(r["Sub-Asset Name"]);
      const assetType = norm(r["Asset Type"]);
      const categoryName = norm(r["Category"]);
      const status = norm(r["Status"]);
      if (!parentAssetId || !assetName || !assetType || !categoryName || !serialNumber || !status) {
        push("ERROR", "Missing one or more required fields (Parent Asset ID, Sub-Asset Name, Asset Type, Category, Serial Number, Status).");
        continue;
      }

      // ── Resolve parent (cached) ──
      let parent = parentCache.get(parentAssetId);
      if (parent === undefined) {
        const p = await prisma.asset.findUnique({
          where: { assetId: parentAssetId },
          select: { id: true, assetId: true, purchaseCost: true, estimatedValue: true },
        });
        parent = p ? { id: p.id, assetId: p.assetId, value: Number(p.purchaseCost ?? p.estimatedValue ?? 0) } : null;
        parentCache.set(parentAssetId, parent);
      }
      if (!parent) { push("ERROR", `Parent asset "${parentAssetId}" not found.`); continue; }

      // ── Resolve category ──
      const assetCategoryId = catByName.get(lc(categoryName));
      if (!assetCategoryId) { push("ERROR", `Category "${categoryName}" not found.`); continue; }

      // ── Serial / reference duplicate checks (in-file + DB) ──
      const serialKey = lc(serialNumber);
      if (seenSerials.has(serialKey)) { push("SKIPPED", "Duplicate serial number within this file."); continue; }
      const refCode = norm(r["Reference Code"]);
      if (refCode && seenRefs.has(lc(refCode))) { push("SKIPPED", "Duplicate reference code within this file."); continue; }

      const dbSerial = await prisma.asset.findUnique({ where: { serialNumber }, select: { id: true } });
      if (dbSerial) { push("SKIPPED", "Serial number already exists in the system."); continue; }
      if (refCode) {
        const dbRef = await prisma.asset.findUnique({ where: { referenceCode: refCode }, select: { id: true } });
        if (dbRef) { push("SKIPPED", "Reference code already exists in the system."); continue; }
      }

      // ── 40% threshold check ──
      // Per requirement: do NOT skip these — still create them as sub-assets,
      // but flag them so they're surfaced in the app for review.
      const subValue = parseNum(r["Purchase Cost"]) ?? 0;
      let exceedsThreshold = false;
      let thresholdNote = "";
      if (parent.value > 0 && subValue > 0) {
        const pct = (subValue / parent.value) * 100;
        if (pct >= THRESHOLD_PCT) {
          exceedsThreshold = true;
          thresholdNote = `Flagged: value ₹${subValue.toLocaleString("en-IN")} is ${pct.toFixed(1)}% of parent (≥ ${THRESHOLD_PCT}%).`;
        }
      }

      // ── Resolve optional vendor / department ──
      const vendorName = norm(r["Vendor"]);
      const deptName = norm(r["Department"]);
      const vendorId = vendorName ? venByName.get(lc(vendorName)) ?? null : null;
      const departmentId = deptName ? deptByName.get(lc(deptName)) ?? null : null;

      // ── Create ──
      try {
        const subAssetId = await generateSubAssetId(parent.assetId, parent.id);
        await prisma.asset.create({
          data: {
            assetId: subAssetId,
            parentAssetId: parent.id,
            assetName,
            assetType,
            assetCategoryId,
            serialNumber,
            referenceCode: refCode || null,
            status,
            sourceType: norm(r["Source Type"]) || "NEW",
            modeOfProcurement: norm(r["Mode of Procurement"]) || "PURCHASE",
            vendorId,
            departmentId,
            purchaseDate: parseDate(r["Purchase Date"]),
            purchaseCost: parseNum(r["Purchase Cost"]),
            workingCondition: norm(r["Working Condition"]) || null,
            remarks: norm(r["Remarks"]) || null,
            exceedsParentThreshold: exceedsThreshold,
          } as any,
        });
        seenSerials.add(serialKey);
        if (refCode) seenRefs.add(lc(refCode));
        push("CREATED", thresholdNote || undefined, subAssetId, exceedsThreshold);
      } catch (e: any) {
        push("ERROR", e?.message || "Create failed");
      }
    }

    res.json({
      message: `Sub-asset import complete: ${created} created (${flagged} flagged > ${THRESHOLD_PCT}%), ${skipped} skipped, ${errored} errors.`,
      summary: { total: rows.length, created, flaggedOver40Pct: flagged, skipped, errored },
      results,
    });
  } catch (err: any) {
    console.error("importSubAssetsExcel error:", err);
    res.status(500).json({ message: "Failed to import sub-assets", error: err?.message });
  } finally {
    // Clean up the temp upload
    if (file?.path) fs.unlink(file.path, () => {});
  }
};

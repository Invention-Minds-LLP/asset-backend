import { Request, Response } from "express";
import fs from "fs";
import XLSX from "xlsx";
import prisma from "../../prismaClient";
import { syncCurrentBranch } from "../../lib/assetLocation";

// ─────────────────────────────────────────────────────────────────────────────
// ASSET LOCATION BULK IMPORT (asset-wise)
// One row per asset → sets that asset's current location + precise placement.
// Creates a new active AssetLocation row (deactivating the previous one), exactly
// like the Location tab's "Update Location" — so location history is preserved.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_NAME = "Locations";

const TEMPLATE_HEADERS = [
  "Asset ID",            // required — the asset's visible assetId
  "Branch",              // required — resolved by branch name
  "Block", "Floor", "Room",
  "Department",          // free text (departmentSnapshot)
  "Employee Responsible",// optional — matched by Employee ID or name
  "Placement Profile",   // ROOM | CAMERA | NETWORK | OUTDOOR | GENERIC
  "Placement Type",      // ROOM | RACK | MOUNTED | AREA | OUTDOOR
  "Mount Type",          // WALL | CEILING | POLE | DESK | RACK | FLOOR
  "Placement Label",
  "Coverage Area",
  "Rack Code", "Rack Unit", "Port Ref",
  "Latitude", "Longitude",
];

const norm = (v: any): string => String(v ?? "").trim();
const lc = (v: any): string => norm(v).toLowerCase();
const numOrNull = (v: any): number | null => {
  const s = norm(v);
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
};

// ─── GET /api/import/locations-template ──────────────────────────────────────
export const downloadLocationTemplate = (_req: Request, res: Response): void => {
  try {
    const example = [{
      "Asset ID": "AST-EXAMPLE-0001",
      "Branch": "Main Hospital",
      "Block": "Admin", "Floor": "2", "Room": "201",
      "Department": "Biomedical",
      "Employee Responsible": "EMP001",
      "Placement Profile": "CAMERA",
      "Placement Type": "MOUNTED",
      "Mount Type": "CEILING",
      "Placement Label": "Above main entrance, facing reception",
      "Coverage Area": "Lobby + reception",
      "Rack Code": "", "Rack Unit": "", "Port Ref": "",
      "Latitude": "", "Longitude": "",
    }];
    const instructions = [
      { Field: "Asset ID", Notes: "REQUIRED. Visible Asset ID of an existing asset." },
      { Field: "Branch", Notes: "REQUIRED. Must match an existing Branch name." },
      { Field: "Block / Floor / Room", Notes: "Optional free text." },
      { Field: "Department", Notes: "Optional free text (stored as the location's department snapshot)." },
      { Field: "Employee Responsible", Notes: "Optional. Matched by Employee ID first, then by name." },
      { Field: "Placement Profile", Notes: "ROOM | CAMERA | NETWORK | OUTDOOR | GENERIC. Defaults to ROOM." },
      { Field: "Placement Type", Notes: "e.g. ROOM, CORRIDOR, ENTRANCE, RECEPTION, STAIRWELL, LIFT_LOBBY, WARD, PARKING, PERIMETER, ROOFTOP, GATE, RACK, DUCT, MOUNTED, AREA, OUTDOOR." },
      { Field: "Mount Type", Notes: "e.g. WALL, CEILING, POLE, DESK, FLOOR, RACK, PEDESTAL, TRIPOD, GANTRY, BRACKET, CONCEALED." },
      { Field: "Placement Label / Coverage Area", Notes: "Free text (cameras/sensors)." },
      { Field: "Rack Code / Rack Unit / Port Ref", Notes: "Network gear." },
      { Field: "Latitude / Longitude", Notes: "Outdoor / GPS-tagged assets. Decimal degrees." },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(example, { header: TEMPLATE_HEADERS }), SHEET_NAME);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instructions), "Instructions");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Asset_Locations_Import_Template.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("downloadLocationTemplate error:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
};

// ─── POST /api/import/locations-excel ────────────────────────────────────────
export const importLocationsExcel = async (req: Request, res: Response): Promise<void> => {
  const file = (req as any).file;
  if (!file) { res.status(400).json({ message: "No file uploaded" }); return; }

  type RowResult = { row: number; assetId: string; status: "UPDATED" | "ERROR"; reason?: string };
  const results: RowResult[] = [];
  let updated = 0, errored = 0;

  try {
    const workbook = XLSX.readFile(file.path);
    const sheet = workbook.Sheets[SHEET_NAME] || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) { res.status(400).json({ message: `Sheet "${SHEET_NAME}" not found.` }); return; }
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    if (!rows.length) { res.status(400).json({ message: "The sheet has no data rows." }); return; }

    // Lookup maps
    const [branches, employees] = await Promise.all([
      prisma.branch.findMany({ select: { id: true, name: true } }),
      prisma.employee.findMany({ select: { id: true, name: true, employeeID: true } }),
    ]);
    const branchByName = new Map(branches.map(b => [lc(b.name), b.id]));
    const empByCode = new Map(employees.filter(e => e.employeeID).map(e => [lc(e.employeeID), e.id]));
    const empByName = new Map(employees.map(e => [lc(e.name), e.id]));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      const assetCode = norm(r["Asset ID"]);
      const branchName = norm(r["Branch"]);
      const push = (status: RowResult["status"], reason?: string) => {
        results.push({ row: rowNo, assetId: assetCode, status, reason });
        if (status === "UPDATED") updated++; else errored++;
      };

      if (!assetCode || !branchName) { push("ERROR", "Asset ID and Branch are required."); continue; }

      const asset = await prisma.asset.findUnique({ where: { assetId: assetCode }, select: { id: true } });
      if (!asset) { push("ERROR", `Asset "${assetCode}" not found.`); continue; }

      const branchId = branchByName.get(lc(branchName));
      if (!branchId) { push("ERROR", `Branch "${branchName}" not found.`); continue; }

      const empRaw = norm(r["Employee Responsible"]);
      const employeeResponsibleId = empRaw
        ? (empByCode.get(lc(empRaw)) ?? empByName.get(lc(empRaw)) ?? null)
        : null;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.assetLocation.updateMany({ where: { assetId: asset.id, isActive: true }, data: { isActive: false } });
          await (tx as any).assetLocation.create({
            data: {
              assetId: asset.id,
              branchId,
              block: norm(r["Block"]) || null,
              floor: norm(r["Floor"]) || null,
              room: norm(r["Room"]) || null,
              departmentSnapshot: norm(r["Department"]) || null,
              employeeResponsibleId,
              placementProfile: norm(r["Placement Profile"]) || null,
              placementType: norm(r["Placement Type"]) || null,
              mountType: norm(r["Mount Type"]) || null,
              placementLabel: norm(r["Placement Label"]) || null,
              coverageArea: norm(r["Coverage Area"]) || null,
              rackCode: norm(r["Rack Code"]) || null,
              rackUnit: norm(r["Rack Unit"]) || null,
              portRef: norm(r["Port Ref"]) || null,
              latitude: numOrNull(r["Latitude"]),
              longitude: numOrNull(r["Longitude"]),
              isActive: true,
            },
          });
          // Sync the denormalized current-branch cache
          await syncCurrentBranch(tx, asset.id, branchId);
        });
        push("UPDATED");
      } catch (e: any) {
        push("ERROR", e?.message || "Update failed");
      }
    }

    res.json({
      message: `Location import complete: ${updated} updated, ${errored} errors.`,
      summary: { total: rows.length, updated, errored },
      results,
    });
  } catch (err: any) {
    console.error("importLocationsExcel error:", err);
    res.status(500).json({ message: "Failed to import locations", error: err?.message });
  } finally {
    if (file?.path) fs.unlink(file.path, () => {});
  }
};

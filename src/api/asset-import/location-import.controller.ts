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

// ── Placement normalisation ──────────────────────────────────────────────────
// Sheets arrive with "Room", "outdoor", "Corridoor" — mixed case and typos. The
// guided audit classifies rooms vs outdoor from these two columns, so a stray
// spelling silently sends an asset to the wrong walk. Normalise on the way in
// rather than guessing at read time.
const PROFILES = ["ROOM", "CAMERA", "NETWORK", "OUTDOOR", "GENERIC"];
const TYPES = [
  "ROOM", "CORRIDOR", "ENTRANCE", "RECEPTION", "STAIRWELL", "LIFT_LOBBY", "WARD",
  "PARKING", "PERIMETER", "ROOFTOP", "GATE", "RACK", "DUCT", "MOUNTED", "AREA", "OUTDOOR",
];
const MOUNTS = [
  "WALL", "CEILING", "POLE", "DESK", "FLOOR", "RACK", "PEDESTAL", "TRIPOD",
  "GANTRY", "BRACKET", "CONCEALED",
];
// Common wordings that mean an existing value.
const SYNONYMS: Record<string, string> = {
  CORRIDOOR: "CORRIDOR", CORRIDER: "CORRIDOR", PASSAGE: "CORRIDOR", HALLWAY: "CORRIDOR",
  LOBBY: "RECEPTION", FOYER: "RECEPTION", VERANDA: "CORRIDOR", VERANDAH: "CORRIDOR",
  "LIFT LOBBY": "LIFT_LOBBY", STAIRS: "STAIRWELL", STAIRCASE: "STAIRWELL",
  OUTSIDE: "OUTDOOR", EXTERIOR: "OUTDOOR", TABLE: "DESK", CUPBOARD: "RACK",
};

/**
 * Snap a free-typed value onto the allowed set. Returns the canonical value and
 * a warning when the input had to be changed or could not be matched.
 */
const snap = (
  raw: string,
  allowed: string[],
  field: string
): { value: string | null; warning?: string } => {
  const v = norm(raw);
  if (!v) return { value: null };
  const up = v.toUpperCase().replace(/[\s-]+/g, "_");
  const flat = up.replace(/_/g, " ");
  const candidate = SYNONYMS[up] ?? SYNONYMS[flat] ?? up;
  if (allowed.includes(candidate)) {
    return candidate === v
      ? { value: candidate }
      : { value: candidate, warning: `${field} "${v}" read as ${candidate}.` };
  }
  return {
    value: null,
    warning: `${field} "${v}" is not a recognised value — left blank. Expected one of: ${allowed.join(", ")}.`,
  };
};
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

// ─── GET /api/import/locations-export?branchId=&departmentId= ────────────────
// The same workbook the importer reads, pre-filled with every asset's CURRENT
// location. The blank template gives you one example row; filling in thousands
// of assets from it by hand is why floor/room coverage sits where it does. This
// turns the job into "complete the blanks in a sheet that already knows your
// assets" and round-trips straight back into POST /locations-excel.
//
// Assets with no location row yet are included with empty placement columns —
// they are precisely the ones that need filling. Branch falls back to the
// asset's cached currentBranch so the required column is rarely blank.
export const downloadCurrentLocations = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: any = {};
    if (req.query.branchId) where.currentBranchId = Number(req.query.branchId);
    if (req.query.departmentId) where.departmentId = Number(req.query.departmentId);

    const assets = await prisma.asset.findMany({
      where,
      select: {
        id: true,
        assetId: true,
        assetName: true,
        department: { select: { name: true } },
        currentBranch: { select: { name: true } },
      },
      orderBy: { assetId: "asc" },
    });

    const ids = assets.map((a) => a.id);
    const locs = ids.length
      ? await prisma.assetLocation.findMany({
          where: { assetId: { in: ids }, isActive: true },
          select: {
            assetId: true, block: true, floor: true, room: true,
            departmentSnapshot: true, placementProfile: true, placementType: true,
            mountType: true, placementLabel: true, coverageArea: true,
            rackCode: true, rackUnit: true, portRef: true,
            latitude: true, longitude: true,
            branch: { select: { name: true } },
            employeeResponsible: { select: { name: true, employeeID: true } },
          },
          orderBy: { id: "desc" },
        })
      : [];

    // Latest active row per asset (defensive: the invariant is one, but a
    // historical duplicate must not silently win).
    const locByAsset = new Map<number, (typeof locs)[number]>();
    for (const l of locs) if (!locByAsset.has(l.assetId)) locByAsset.set(l.assetId, l);

    const rows = assets.map((a) => {
      const l = locByAsset.get(a.id);
      return {
        "Asset ID": a.assetId,
        // Read-only helper column — the importer matches by key and ignores it.
        "Asset Name": a.assetName ?? "",
        "Branch": l?.branch?.name ?? a.currentBranch?.name ?? "",
        "Block": l?.block ?? "",
        "Floor": l?.floor ?? "",
        "Room": l?.room ?? "",
        "Department": l?.departmentSnapshot ?? a.department?.name ?? "",
        "Employee Responsible": l?.employeeResponsible?.employeeID ?? l?.employeeResponsible?.name ?? "",
        "Placement Profile": l?.placementProfile ?? "",
        "Placement Type": l?.placementType ?? "",
        "Mount Type": l?.mountType ?? "",
        "Placement Label": l?.placementLabel ?? "",
        "Coverage Area": l?.coverageArea ?? "",
        "Rack Code": l?.rackCode ?? "",
        "Rack Unit": l?.rackUnit ?? "",
        "Port Ref": l?.portRef ?? "",
        "Latitude": l?.latitude?.toString() ?? "",
        "Longitude": l?.longitude?.toString() ?? "",
      };
    });

    // What is actually missing, so the person filling this in knows the size of
    // the job and which columns matter most for the guided audit.
    const blank = (k: keyof (typeof rows)[number]) => rows.filter((r) => !String(r[k] ?? "").trim()).length;
    const summary = [
      { Metric: "Assets in this sheet", Count: rows.length },
      { Metric: "Missing Floor", Count: blank("Floor") },
      { Metric: "Missing Room", Count: blank("Room") },
      { Metric: "Missing Placement Label", Count: blank("Placement Label") },
      { Metric: "Missing Branch (required to re-import)", Count: blank("Branch") },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows, { header: ["Asset ID", "Asset Name", ...TEMPLATE_HEADERS.slice(1)] }),
      SHEET_NAME
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "What's Missing");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Asset_Locations_Current.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("downloadCurrentLocations error:", err);
    res.status(500).json({ message: "Failed to export current locations", error: err?.message });
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

      // Normalise the placement columns and gather anything worth flagging.
      const warnings: string[] = [];
      const profile = snap(r["Placement Profile"], PROFILES, "Placement Profile");
      const ptype = snap(r["Placement Type"], TYPES, "Placement Type");
      const mount = snap(r["Mount Type"], MOUNTS, "Mount Type");
      for (const w of [profile.warning, ptype.warning, mount.warning]) if (w) warnings.push(w);

      // Fields the guided audit depends on. Not errors — the import still runs —
      // but the auditor will feel each one on the floor.
      if (!norm(r["Floor"])) warnings.push("No Floor — this asset won't appear under any floor when auditing.");
      if (!norm(r["Placement Label"])) warnings.push("No Placement Label — the audit assistant will have no directions to give.");
      if (!norm(r["Room"]) && !norm(r["Placement Label"])) warnings.push("No Room and no Placement Label — location is effectively unknown.");

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
              placementProfile: profile.value,
              placementType: ptype.value,
              mountType: mount.value,
              placementLabel: norm(r["Placement Label"]) || null,
              coverageArea: norm(r["Coverage Area"]) || null,
              rackCode: norm(r["Rack Code"]) || null,
              rackUnit: norm(r["Rack Unit"]) || null,
              portRef: norm(r["Port Ref"]) || null,
              latitude: numOrNull(r["Latitude"]),
              longitude: numOrNull(r["Longitude"]),
              isActive: true,
              // An imported placement is a statement of where the asset already
              // is, not a request to move it. Without this it would default to
              // REQUESTED and be invisible to every audit scope query.
              status: "APPROVED",
            },
          });
          // Sync the denormalized current-branch cache
          await syncCurrentBranch(tx, asset.id, branchId);
        });
        push("UPDATED", warnings.length ? warnings.join(" ") : undefined);
      } catch (e: any) {
        push("ERROR", e?.message || "Update failed");
      }
    }

    res.json({
      message: `Location import complete: ${updated} updated, ${errored} errors.`,
      summary: {
        total: rows.length,
        updated,
        errored,
        // Rows that imported but will give the audit assistant less to work with.
        warned: results.filter((x) => x.status === "UPDATED" && x.reason).length,
      },
      results,
    });
  } catch (err: any) {
    console.error("importLocationsExcel error:", err);
    res.status(500).json({ message: "Failed to import locations", error: err?.message });
  } finally {
    if (file?.path) fs.unlink(file.path, () => {});
  }
};

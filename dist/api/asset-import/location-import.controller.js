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
exports.importLocationsExcel = exports.downloadLocationTemplate = void 0;
const fs_1 = __importDefault(require("fs"));
const xlsx_1 = __importDefault(require("xlsx"));
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─────────────────────────────────────────────────────────────────────────────
// ASSET LOCATION BULK IMPORT (asset-wise)
// One row per asset → sets that asset's current location + precise placement.
// Creates a new active AssetLocation row (deactivating the previous one), exactly
// like the Location tab's "Update Location" — so location history is preserved.
// ─────────────────────────────────────────────────────────────────────────────
const SHEET_NAME = "Locations";
const TEMPLATE_HEADERS = [
    "Asset ID", // required — the asset's visible assetId
    "Branch", // required — resolved by branch name
    "Block", "Floor", "Room",
    "Department", // free text (departmentSnapshot)
    "Employee Responsible", // optional — matched by Employee ID or name
    "Placement Profile", // ROOM | CAMERA | NETWORK | OUTDOOR | GENERIC
    "Placement Type", // ROOM | RACK | MOUNTED | AREA | OUTDOOR
    "Mount Type", // WALL | CEILING | POLE | DESK | RACK | FLOOR
    "Placement Label",
    "Coverage Area",
    "Rack Code", "Rack Unit", "Port Ref",
    "Latitude", "Longitude",
];
const norm = (v) => String(v !== null && v !== void 0 ? v : "").trim();
const lc = (v) => norm(v).toLowerCase();
const numOrNull = (v) => {
    const s = norm(v);
    if (!s)
        return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
};
// ─── GET /api/import/locations-template ──────────────────────────────────────
const downloadLocationTemplate = (_req, res) => {
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
        const wb = xlsx_1.default.utils.book_new();
        xlsx_1.default.utils.book_append_sheet(wb, xlsx_1.default.utils.json_to_sheet(example, { header: TEMPLATE_HEADERS }), SHEET_NAME);
        xlsx_1.default.utils.book_append_sheet(wb, xlsx_1.default.utils.json_to_sheet(instructions), "Instructions");
        const buffer = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="Asset_Locations_Import_Template.xlsx"');
        res.send(buffer);
    }
    catch (err) {
        console.error("downloadLocationTemplate error:", err);
        res.status(500).json({ message: "Failed to generate template" });
    }
};
exports.downloadLocationTemplate = downloadLocationTemplate;
// ─── POST /api/import/locations-excel ────────────────────────────────────────
const importLocationsExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const file = req.file;
    if (!file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
    }
    const results = [];
    let updated = 0, errored = 0;
    try {
        const workbook = xlsx_1.default.readFile(file.path);
        const sheet = workbook.Sheets[SHEET_NAME] || workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
            res.status(400).json({ message: `Sheet "${SHEET_NAME}" not found.` });
            return;
        }
        const rows = xlsx_1.default.utils.sheet_to_json(sheet, { defval: "" });
        if (!rows.length) {
            res.status(400).json({ message: "The sheet has no data rows." });
            return;
        }
        // Lookup maps
        const [branches, employees] = yield Promise.all([
            prismaClient_1.default.branch.findMany({ select: { id: true, name: true } }),
            prismaClient_1.default.employee.findMany({ select: { id: true, name: true, employeeID: true } }),
        ]);
        const branchByName = new Map(branches.map(b => [lc(b.name), b.id]));
        const empByCode = new Map(employees.filter(e => e.employeeID).map(e => [lc(e.employeeID), e.id]));
        const empByName = new Map(employees.map(e => [lc(e.name), e.id]));
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rowNo = i + 2;
            const assetCode = norm(r["Asset ID"]);
            const branchName = norm(r["Branch"]);
            const push = (status, reason) => {
                results.push({ row: rowNo, assetId: assetCode, status, reason });
                if (status === "UPDATED")
                    updated++;
                else
                    errored++;
            };
            if (!assetCode || !branchName) {
                push("ERROR", "Asset ID and Branch are required.");
                continue;
            }
            const asset = yield prismaClient_1.default.asset.findUnique({ where: { assetId: assetCode }, select: { id: true } });
            if (!asset) {
                push("ERROR", `Asset "${assetCode}" not found.`);
                continue;
            }
            const branchId = branchByName.get(lc(branchName));
            if (!branchId) {
                push("ERROR", `Branch "${branchName}" not found.`);
                continue;
            }
            const empRaw = norm(r["Employee Responsible"]);
            const employeeResponsibleId = empRaw
                ? ((_b = (_a = empByCode.get(lc(empRaw))) !== null && _a !== void 0 ? _a : empByName.get(lc(empRaw))) !== null && _b !== void 0 ? _b : null)
                : null;
            try {
                yield prismaClient_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    yield tx.assetLocation.updateMany({ where: { assetId: asset.id, isActive: true }, data: { isActive: false } });
                    yield tx.assetLocation.create({
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
                }));
                push("UPDATED");
            }
            catch (e) {
                push("ERROR", (e === null || e === void 0 ? void 0 : e.message) || "Update failed");
            }
        }
        res.json({
            message: `Location import complete: ${updated} updated, ${errored} errors.`,
            summary: { total: rows.length, updated, errored },
            results,
        });
    }
    catch (err) {
        console.error("importLocationsExcel error:", err);
        res.status(500).json({ message: "Failed to import locations", error: err === null || err === void 0 ? void 0 : err.message });
    }
    finally {
        if (file === null || file === void 0 ? void 0 : file.path)
            fs_1.default.unlink(file.path, () => { });
    }
});
exports.importLocationsExcel = importLocationsExcel;

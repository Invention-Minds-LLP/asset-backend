import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Canonical set of column keys the asset table can show. The frontend has the
// matching catalog with labels/value-paths/render-types; the backend only needs
// the keys to validate what gets saved. Keep the two in sync.
export const COLUMN_KEYS = [
  "assetId", "storeAssetId", "referenceCode", "assetName", "assetType",
  "departmentName", "targetDepartmentName", "currentBranchName", "assetCategoryName", "allottedToName",
  "supervisorName", "vendorName", "subTypeName", "serialNumber", "manufacturer", "modelNumber",
  "status", "purchaseDate", "purchaseCost", "currentLocation", "criticalityLevel",
  "warrantyStatus", "workingCondition", "installedAt", "assetPhoto",
] as const;

// Always present, regardless of a department's saved layout.
const MANDATORY = ["assetId", "assetName"];

// Shown when a department hasn't configured anything (today's columns).
const DEFAULT_COLUMNS = [
  "assetId", "storeAssetId", "referenceCode", "assetName", "assetType",
  "departmentName", "assetCategoryName", "allottedToName", "assetPhoto",
];

const KEY_SET = new Set<string>(COLUMN_KEYS as readonly string[]);

// Keep only known keys, force the mandatory ones to the front (in order), and
// de-dupe — so a saved layout can never drop a required column or an unknown one.
function sanitize(cols: any): string[] {
  const arr: string[] = Array.isArray(cols) ? cols.filter((c) => typeof c === "string" && KEY_SET.has(c)) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...MANDATORY, ...arr]) {
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

async function resolveColumns(departmentId?: number | null): Promise<string[]> {
  if (!departmentId) return DEFAULT_COLUMNS;
  const cfg = await prisma.departmentColumnConfig.findFirst({
    where: { departmentId: Number(departmentId) },
    orderBy: { updatedAt: "desc" },
  });
  return cfg ? sanitize(cfg.columns) : DEFAULT_COLUMNS;
}

// Effective columns for the caller's own department.
export const getMyColumns = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const columns = await resolveColumns((req.user as any)?.departmentId);
    res.json({ columns, defaults: DEFAULT_COLUMNS });
  } catch (e) {
    console.error("getMyColumns error:", e);
    res.status(500).json({ message: "Failed to load columns" });
  }
};

// Columns for a specific department (config screen). HOD → own only; Admin → any.
export const getColumnsForDept = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const departmentId = Number(req.params.departmentId);
    const user = req.user as any;
    if (user?.role === "HOD" && Number(user?.departmentId) !== departmentId) {
      res.status(403).json({ message: "Not allowed to view another department's columns" });
      return;
    }
    const columns = await resolveColumns(departmentId);
    res.json({ departmentId, columns, defaults: DEFAULT_COLUMNS });
  } catch (e) {
    console.error("getColumnsForDept error:", e);
    res.status(500).json({ message: "Failed to load columns" });
  }
};

// Save a department's layout. HOD → own only; Admin → any.
export const setColumnsForDept = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const departmentId = Number(req.params.departmentId);
    const user = req.user as any;
    if (user?.role === "HOD" && Number(user?.departmentId) !== departmentId) {
      res.status(403).json({ message: "Not allowed to modify another department's columns" });
      return;
    }
    if (!departmentId) { res.status(400).json({ message: "departmentId is required" }); return; }

    const columns = sanitize(req.body?.columns);
    if (columns.length === 0) { res.status(400).json({ message: "No valid columns provided" }); return; }

    // One config per department, enforced here (no DB unique): update if present.
    const existing = await prisma.departmentColumnConfig.findFirst({
      where: { departmentId },
      orderBy: { updatedAt: "desc" },
    });
    const saved = existing
      ? await prisma.departmentColumnConfig.update({
          where: { id: existing.id },
          data: { columns, updatedById: user?.employeeDbId ?? null },
        })
      : await prisma.departmentColumnConfig.create({
          data: { departmentId, columns, updatedById: user?.employeeDbId ?? null },
        });

    res.json({ departmentId, columns: sanitize(saved.columns) });
  } catch (e: any) {
    console.error("setColumnsForDept error:", e);
    res.status(500).json({ message: e.message || "Failed to save columns" });
  }
};

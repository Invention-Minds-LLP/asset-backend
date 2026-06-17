import { Request, Response } from "express";
import fs from "fs";
import XLSX from "xlsx";
import prisma from "../../prismaClient";

// ─────────────────────────────────────────────────────────────────────────────
// ASSET DEPARTMENT & ASSIGNMENT BULK IMPORT (asset-wise)
// One row per existing asset (matched by visible Asset ID) updates its
// org-structure links: source department, target department, supervisor, end user.
//
// HOD is NOT a column — it is derived at query time as the employee whose role is
// HOD and whose departmentId matches the asset's SOURCE department. Setting the
// source department correctly is what determines the asset's HOD.
//
// Blank cells are SKIPPED (existing values are left untouched), so a partial sheet
// can update just one column without wiping the others.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_NAME = "Departments";

const TEMPLATE_HEADERS = [
  "Asset ID",                  // required — the asset's visible assetId
  "Source Department",         // optional — name; created automatically if not exists
  "Target Department",         // optional — name; created automatically if not exists
  "Supervisor Employee Code",  // optional — matched by Employee ID, then by name
  "End User Employee Code",    // optional — matched by Employee ID, then by name
];

const norm = (v: any): string => String(v ?? "").trim();
const lc = (v: any): string => norm(v).toLowerCase();

// ─── GET /api/import/departments-template ────────────────────────────────────
export const downloadDepartmentTemplate = (_req: Request, res: Response): void => {
  try {
    const example = [{
      "Asset ID": "AST-EXAMPLE-0001",
      "Source Department": "Radiology",
      "Target Department": "ICU",
      "Supervisor Employee Code": "EMP001",
      "End User Employee Code": "EMP002",
    }];
    const instructions = [
      { Field: "Asset ID", Notes: "REQUIRED. Visible Asset ID of an existing asset." },
      { Field: "Source Department", Notes: "Optional. Owning department name — created automatically if not exists. The asset's HOD is auto-resolved from this department's HOD employee; there is no HOD column." },
      { Field: "Target Department", Notes: "Optional. Department where the end user belongs — created automatically if not exists." },
      { Field: "Supervisor Employee Code", Notes: "Optional. Employee ID of the supervisor (matched by Employee ID first, then by name). Must already exist." },
      { Field: "End User Employee Code", Notes: "Optional. Employee ID of the end user the asset is allotted to (matched by Employee ID first, then by name). Must already exist." },
      { Field: "(blank cells)", Notes: "Left blank = existing value is kept unchanged. Only filled-in columns are updated." },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(example, { header: TEMPLATE_HEADERS }), SHEET_NAME);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instructions), "Instructions");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Asset_Departments_Import_Template.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("downloadDepartmentTemplate error:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
};

// ─── POST /api/import/departments-excel ──────────────────────────────────────
export const importDepartmentsExcel = async (req: Request, res: Response): Promise<void> => {
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

    // Employee lookup maps (departments are upserted on demand below)
    const employees = await prisma.employee.findMany({ select: { id: true, name: true, employeeID: true } });
    const empByCode = new Map(employees.filter(e => e.employeeID).map(e => [lc(e.employeeID), e.id]));
    const empByName = new Map(employees.map(e => [lc(e.name), e.id]));

    // Cache department name → id so repeated names in the sheet aren't upserted twice
    const deptIdByName = new Map<string, number>();
    const resolveDepartmentId = async (name: string): Promise<number> => {
      const key = lc(name);
      const cached = deptIdByName.get(key);
      if (cached != null) return cached;
      const dept = await prisma.department.upsert({
        where: { name: norm(name) },
        update: {},
        create: { name: norm(name) },
      });
      deptIdByName.set(key, dept.id);
      return dept.id;
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      const assetCode = norm(r["Asset ID"]);
      const push = (status: RowResult["status"], reason?: string) => {
        results.push({ row: rowNo, assetId: assetCode, status, reason });
        if (status === "UPDATED") updated++; else errored++;
      };

      if (!assetCode) { push("ERROR", "Asset ID is required."); continue; }

      const asset = await prisma.asset.findUnique({ where: { assetId: assetCode }, select: { id: true } });
      if (!asset) { push("ERROR", `Asset "${assetCode}" not found.`); continue; }

      const sourceDept = norm(r["Source Department"]);
      const targetDept = norm(r["Target Department"]);
      const supervisorRaw = norm(r["Supervisor Employee Code"]);
      const endUserRaw = norm(r["End User Employee Code"]);

      // Build update with ONLY the fields actually provided — blanks keep existing values.
      const data: Record<string, any> = {};
      try {
        if (sourceDept) data.departmentId = await resolveDepartmentId(sourceDept);
        if (targetDept) data.targetDepartmentId = await resolveDepartmentId(targetDept);

        if (supervisorRaw) {
          const supId = empByCode.get(lc(supervisorRaw)) ?? empByName.get(lc(supervisorRaw)) ?? null;
          if (!supId) { push("ERROR", `Supervisor "${supervisorRaw}" not found.`); continue; }
          data.supervisorId = supId;
        }
        if (endUserRaw) {
          const userId = empByCode.get(lc(endUserRaw)) ?? empByName.get(lc(endUserRaw)) ?? null;
          if (!userId) { push("ERROR", `End user "${endUserRaw}" not found.`); continue; }
          data.allottedToId = userId;
        }

        if (Object.keys(data).length === 0) { push("ERROR", "No fields to update — all assignment columns were blank."); continue; }

        await prisma.asset.update({ where: { id: asset.id }, data });
        push("UPDATED");
      } catch (e: any) {
        push("ERROR", e?.message || "Update failed");
      }
    }

    res.json({
      message: `Department import complete: ${updated} updated, ${errored} errors.`,
      summary: { total: rows.length, updated, errored },
      results,
    });
  } catch (err: any) {
    console.error("importDepartmentsExcel error:", err);
    res.status(500).json({ message: "Failed to import departments", error: err?.message });
  } finally {
    if (file?.path) fs.unlink(file.path, () => {});
  }
};

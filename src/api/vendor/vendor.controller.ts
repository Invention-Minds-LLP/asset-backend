import { Request, Response } from "express";
import prisma from "../../prismaClient";
import XLSX from "xlsx";
import multer from "multer";
import fs from "fs";
import path from "path";

const uploadDir = path.join(process.cwd(), "uploads", "vendor-import");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXTS = [".xlsx", ".xls"];
const ALLOWED_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];
export const vendorUpload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext) && ALLOWED_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Invalid file type. Only Excel (${ALLOWED_EXTS.join(", ")}) is allowed.`));
  },
});

export const getAllVendors = async (req: Request, res: Response) => {
  try {
    const { includeInactive, search, page, limit: lim, exportCsv } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { contact: { contains: String(search) } },
        { email: { contains: String(search) } },
        { gstNumber: { contains: String(search) } },
      ];
    }

    if (page && lim) {
      const skip = (parseInt(String(page)) - 1) * parseInt(String(lim));
      const take = parseInt(String(lim));
      const [total, vendors] = await Promise.all([
        prisma.vendor.count({ where }),
        prisma.vendor.findMany({
          where, orderBy: { name: "asc" }, skip, take,
          include: { departments: { select: { id: true, name: true } } },
        }),
      ]);

      if (exportCsv === "true") {
        const csvRows = vendors.map((v: any) => ({
          Name: v.name, Contact: v.contact, Email: v.email || "", VendorType: v.vendorType || "",
          GST: v.gstNumber || "", PAN: v.panNumber || "", Rating: v.rating || "", Active: v.isActive ? "Yes" : "No",
          Departments: (v.departments || []).map((d: any) => d.name).join(" / "),
        }));
        const headers = Object.keys(csvRows[0] || {}).join(",");
        const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=vendors.csv");
        res.send(headers + "\n" + rows);
        return;
      }

      res.json({ data: vendors, total, page: parseInt(String(page)), limit: take });
      return;
    }

    const vendors = await prisma.vendor.findMany({
      where, orderBy: { name: "asc" },
      include: { departments: { select: { id: true, name: true } } },
    });
    res.json(vendors);
  } catch (error) {
    console.error("getAllVendors error:", error);
    res.status(500).json({ message: "Failed to fetch vendors" });
  }
};

export const createVendor = async (req: Request, res: Response) => {
  try {
    // Split out the M2M departments list from the scalar vendor fields
    const { departmentIds, ...vendorData } = req.body ?? {};
    const ids: number[] = Array.isArray(departmentIds)
      ? departmentIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];

    const vendor = await prisma.vendor.create({
      data: {
        ...vendorData,
        ...(ids.length ? { departments: { connect: ids.map(id => ({ id })) } } : {}),
      },
      include: { departments: { select: { id: true, name: true } } },
    });
    res.status(201).json(vendor);
  } catch (error: any) {
    console.error("createVendor error:", error);
    res.status(500).json({ message: error.message || "Failed to create vendor" });
  }
};

export const deleteVendor = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    // Soft delete
    await prisma.vendor.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Vendor deactivated" });
  } catch (error) {
    console.error("deleteVendor error:", error);
    res.status(500).json({ message: "Failed to delete vendor" });
  }
};

export const updateVendor = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { departmentIds, ...vendorData } = req.body ?? {};

    // Only touch the M2M when the client explicitly sent the field — avoids
    // wiping departments on partial patches that omit it.
    const departmentsUpdate = Array.isArray(departmentIds)
      ? {
          departments: {
            set: departmentIds
              .map((n: any) => Number(n))
              .filter((n: number) => Number.isFinite(n))
              .map((deptId: number) => ({ id: deptId })),
          },
        }
      : {};

    const updatedVendor = await prisma.vendor.update({
      where: { id },
      data: { ...vendorData, ...departmentsUpdate },
      include: { departments: { select: { id: true, name: true } } },
    });
    res.json(updatedVendor);
  } catch (error: any) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: error.message || 'Failed to update vendor.' });
  }
};

// ── POST /vendors/import — Bulk import vendors from Excel ────────────────────
// Expects columns: CODE, VENDOR NAME, ADDRESS, PHONE, PAN, ACTIVE, GST REGN
// Matches by vendor name (case-insensitive). If exists → updates, if new → creates.
export const importVendors = async (req: Request, res: Response) => {
  const filePath = (req as any).file?.path;
  try {
    if (!filePath) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      res.status(400).json({ message: "Spreadsheet is empty" });
      return;
    }

    const created: any[] = [];
    const updated: any[] = [];
    const skipped: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      // Flexible column name matching (handles various header formats)
      const vendorName = String(
        row["VENDOR NAME"] ?? row["Vendor Name"] ?? row["vendorName"] ?? row["name"] ?? row["Name"] ?? ""
      ).trim();

      if (!vendorName || vendorName === "." || vendorName === "0") {
        skipped.push({ row: rowNum, reason: "Empty or invalid vendor name" });
        continue;
      }

      const code = String(row["CODE"] ?? row["Code"] ?? row["code"] ?? "").trim();
      const address = String(row["ADDRESS"] ?? row["Address"] ?? row["address"] ?? "").trim();
      const phone = String(row["PHONE"] ?? row["Phone"] ?? row["phone"] ?? row["contact"] ?? "").trim();
      const pan = String(row["PAN"] ?? row["Pan"] ?? row["pan"] ?? row["panNumber"] ?? "").trim();
      const activeRaw = String(row["ACTIVE"] ?? row["Active"] ?? row["active"] ?? "Yes").trim();
      const gstRaw = String(row["GST REGN"] ?? row["GST"] ?? row["gst"] ?? row["gstNumber"] ?? "").trim();

      // Parse active status
      const isActive = activeRaw.toLowerCase() === "yes" || activeRaw === "true" || activeRaw === "1";

      // Clean phone — take first number if multiple separated by /
      const cleanPhone = phone
        .replace(/[^0-9/+-]/g, "")
        .split("/")[0]
        .trim() || "N/A";

      // Clean address — skip if just "." or ",,,"
      const cleanAddress = (address && address !== "." && !address.match(/^[.,\s]+$/))
        ? address : null;

      // Build vendor data
      const vendorData: any = {
        contact: cleanPhone,
        isActive,
      };
      if (cleanAddress) vendorData.address = cleanAddress;
      if (pan && pan.length === 10) vendorData.panNumber = pan.toUpperCase();
      if (gstRaw.toLowerCase() === "yes") vendorData.gstNumber = vendorData.gstNumber || null; // flag only, no number in source
      if (code) vendorData.notes = vendorData.notes ? vendorData.notes : `Legacy Code: ${code}`;

      try {
        // Check if vendor already exists (case-insensitive match)
        const existing = await prisma.vendor.findFirst({
          where: { name: { equals: vendorName } },
        });

        if (existing) {
          // Update — merge non-empty fields only
          const updateData: any = {};
          if (cleanPhone !== "N/A" && !existing.contact) updateData.contact = cleanPhone;
          if (cleanAddress && !existing.address) updateData.address = cleanAddress;
          if (pan && pan.length === 10 && !existing.panNumber) updateData.panNumber = pan.toUpperCase();
          if (!existing.isActive && isActive) updateData.isActive = true;
          if (code && !existing.notes?.includes("Legacy Code")) {
            updateData.notes = existing.notes
              ? `${existing.notes}\nLegacy Code: ${code}`
              : `Legacy Code: ${code}`;
          }

          if (Object.keys(updateData).length > 0) {
            await prisma.vendor.update({ where: { id: existing.id }, data: updateData });
            updated.push({ row: rowNum, id: existing.id, name: vendorName, fieldsUpdated: Object.keys(updateData) });
          } else {
            skipped.push({ row: rowNum, name: vendorName, reason: "Already exists, no new data to update" });
          }
        } else {
          // Create new vendor
          const newVendor = await prisma.vendor.create({
            data: {
              name: vendorName,
              contact: cleanPhone,
              address: cleanAddress,
              panNumber: (pan && pan.length === 10) ? pan.toUpperCase() : null,
              isActive,
              notes: code ? `Legacy Code: ${code}` : null,
            },
          });
          created.push({ row: rowNum, id: newVendor.id, name: vendorName });
        }
      } catch (rowErr: any) {
        errors.push({ row: rowNum, name: vendorName, error: rowErr?.message ?? "Unknown error" });
      }
    }

    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      message: `Import complete: ${created.length} created, ${updated.length} updated, ${skipped.length} skipped, ${errors.length} errors`,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      errorCount: errors.length,
      details: { created, updated, skipped, errors },
    });
  } catch (err: any) {
    try { if (filePath) fs.unlinkSync(filePath); } catch {}
    console.error("importVendors error:", err);
    res.status(500).json({ message: "Failed to import vendors", error: err.message });
  }
};

// ─── Download Vendor Import Template ────────────────────────────────────────
export const downloadVendorTemplate = (_req: Request, res: Response) => {
  const headers = ["VENDOR NAME", "CODE", "ADDRESS", "PHONE", "PAN", "GST REGN", "ACTIVE"];
  const example = [
    {
      "VENDOR NAME": "GE Healthcare India Pvt Ltd",
      "CODE": "VND-001",
      "ADDRESS": "Plot 12, Whitefield, Bengaluru 560066",
      "PHONE": "9876543210",
      "PAN": "AAACG1234F",
      "GST REGN": "29AAACG1234F1Z5",
      "ACTIVE": "Yes",
    },
    {
      "VENDOR NAME": "Medtronic India",
      "CODE": "VND-002",
      "ADDRESS": "Tower B, Cyber City, Gurugram 122002",
      "PHONE": "9123456780",
      "PAN": "AAACM5678K",
      "GST REGN": "06AAACM5678K1Z2",
      "ACTIVE": "Yes",
    },
  ];

  const instructions = [
    { Field: "VENDOR NAME", Required: "YES", Notes: "Used to detect duplicates on re-import. Must be unique." },
    { Field: "CODE",        Required: "NO",  Notes: "Internal vendor code (optional)." },
    { Field: "ADDRESS",     Required: "NO",  Notes: "Full postal address. Skip rows with placeholder values like '.' or ',,,'." },
    { Field: "PHONE",       Required: "NO",  Notes: "Primary contact number. Multiple numbers? Separate with '/' — only the first is kept." },
    { Field: "PAN",         Required: "NO",  Notes: "Indian Permanent Account Number." },
    { Field: "GST REGN",    Required: "NO",  Notes: "GST registration number." },
    { Field: "ACTIVE",      Required: "NO",  Notes: "Yes / No (default: Yes)." },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(example, { header: headers });
  ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 4, 22) }));
  XLSX.utils.book_append_sheet(wb, ws, "Vendors");

  const instrWs = XLSX.utils.json_to_sheet(instructions);
  instrWs["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=vendor-import-template.xlsx");
  res.send(buffer);
};
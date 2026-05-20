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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadVendorTemplate = exports.importVendors = exports.updateVendor = exports.deleteVendor = exports.createVendor = exports.getAllVendors = exports.vendorUpload = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const xlsx_1 = __importDefault(require("xlsx"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uploadDir = path_1.default.join(process.cwd(), "uploads", "vendor-import");
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const ALLOWED_EXTS = [".xlsx", ".xls"];
const ALLOWED_MIMES = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
];
exports.vendorUpload = (0, multer_1.default)({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (ALLOWED_EXTS.includes(ext) && ALLOWED_MIMES.includes(file.mimetype))
            return cb(null, true);
        cb(new Error(`Invalid file type. Only Excel (${ALLOWED_EXTS.join(", ")}) is allowed.`));
    },
});
const getAllVendors = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { includeInactive, search, page, limit: lim, exportCsv } = req.query;
        const where = {};
        if (includeInactive !== "true")
            where.isActive = true;
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
            const [total, vendors] = yield Promise.all([
                prismaClient_1.default.vendor.count({ where }),
                prismaClient_1.default.vendor.findMany({
                    where, orderBy: { name: "asc" }, skip, take,
                    include: { departments: { select: { id: true, name: true } } },
                }),
            ]);
            if (exportCsv === "true") {
                const csvRows = vendors.map((v) => ({
                    Name: v.name, Contact: v.contact, Email: v.email || "", VendorType: v.vendorType || "",
                    GST: v.gstNumber || "", PAN: v.panNumber || "", Rating: v.rating || "", Active: v.isActive ? "Yes" : "No",
                    Departments: (v.departments || []).map((d) => d.name).join(" / "),
                }));
                const headers = Object.keys(csvRows[0] || {}).join(",");
                const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", "attachment; filename=vendors.csv");
                res.send(headers + "\n" + rows);
                return;
            }
            res.json({ data: vendors, total, page: parseInt(String(page)), limit: take });
            return;
        }
        const vendors = yield prismaClient_1.default.vendor.findMany({
            where, orderBy: { name: "asc" },
            include: { departments: { select: { id: true, name: true } } },
        });
        res.json(vendors);
    }
    catch (error) {
        console.error("getAllVendors error:", error);
        res.status(500).json({ message: "Failed to fetch vendors" });
    }
});
exports.getAllVendors = getAllVendors;
const createVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Split out the M2M departments list from the scalar vendor fields
        const _b = (_a = req.body) !== null && _a !== void 0 ? _a : {}, { departmentIds } = _b, vendorData = __rest(_b, ["departmentIds"]);
        const ids = Array.isArray(departmentIds)
            ? departmentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
            : [];
        const vendor = yield prismaClient_1.default.vendor.create({
            data: Object.assign(Object.assign({}, vendorData), (ids.length ? { departments: { connect: ids.map(id => ({ id })) } } : {})),
            include: { departments: { select: { id: true, name: true } } },
        });
        res.status(201).json(vendor);
    }
    catch (error) {
        console.error("createVendor error:", error);
        res.status(500).json({ message: error.message || "Failed to create vendor" });
    }
});
exports.createVendor = createVendor;
const deleteVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        // Soft delete
        yield prismaClient_1.default.vendor.update({ where: { id }, data: { isActive: false } });
        res.json({ message: "Vendor deactivated" });
    }
    catch (error) {
        console.error("deleteVendor error:", error);
        res.status(500).json({ message: "Failed to delete vendor" });
    }
});
exports.deleteVendor = deleteVendor;
const updateVendor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = parseInt(req.params.id, 10);
        const _b = (_a = req.body) !== null && _a !== void 0 ? _a : {}, { departmentIds } = _b, vendorData = __rest(_b, ["departmentIds"]);
        // Only touch the M2M when the client explicitly sent the field — avoids
        // wiping departments on partial patches that omit it.
        const departmentsUpdate = Array.isArray(departmentIds)
            ? {
                departments: {
                    set: departmentIds
                        .map((n) => Number(n))
                        .filter((n) => Number.isFinite(n))
                        .map((deptId) => ({ id: deptId })),
                },
            }
            : {};
        const updatedVendor = yield prismaClient_1.default.vendor.update({
            where: { id },
            data: Object.assign(Object.assign({}, vendorData), departmentsUpdate),
            include: { departments: { select: { id: true, name: true } } },
        });
        res.json(updatedVendor);
    }
    catch (error) {
        console.error('Error updating vendor:', error);
        res.status(500).json({ error: error.message || 'Failed to update vendor.' });
    }
});
exports.updateVendor = updateVendor;
// ── POST /vendors/import — Bulk import vendors from Excel ────────────────────
// Expects columns: CODE, VENDOR NAME, ADDRESS, PHONE, PAN, ACTIVE, GST REGN
// Matches by vendor name (case-insensitive). If exists → updates, if new → creates.
const importVendors = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4;
    const filePath = (_a = req.file) === null || _a === void 0 ? void 0 : _a.path;
    try {
        if (!filePath) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const wb = xlsx_1.default.readFile(filePath);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = xlsx_1.default.utils.sheet_to_json(sheet, { defval: "" });
        if (!rows.length) {
            res.status(400).json({ message: "Spreadsheet is empty" });
            return;
        }
        const created = [];
        const updated = [];
        const skipped = [];
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;
            // Flexible column name matching (handles various header formats)
            const vendorName = String((_f = (_e = (_d = (_c = (_b = row["VENDOR NAME"]) !== null && _b !== void 0 ? _b : row["Vendor Name"]) !== null && _c !== void 0 ? _c : row["vendorName"]) !== null && _d !== void 0 ? _d : row["name"]) !== null && _e !== void 0 ? _e : row["Name"]) !== null && _f !== void 0 ? _f : "").trim();
            if (!vendorName || vendorName === "." || vendorName === "0") {
                skipped.push({ row: rowNum, reason: "Empty or invalid vendor name" });
                continue;
            }
            const code = String((_j = (_h = (_g = row["CODE"]) !== null && _g !== void 0 ? _g : row["Code"]) !== null && _h !== void 0 ? _h : row["code"]) !== null && _j !== void 0 ? _j : "").trim();
            const address = String((_m = (_l = (_k = row["ADDRESS"]) !== null && _k !== void 0 ? _k : row["Address"]) !== null && _l !== void 0 ? _l : row["address"]) !== null && _m !== void 0 ? _m : "").trim();
            const phone = String((_r = (_q = (_p = (_o = row["PHONE"]) !== null && _o !== void 0 ? _o : row["Phone"]) !== null && _p !== void 0 ? _p : row["phone"]) !== null && _q !== void 0 ? _q : row["contact"]) !== null && _r !== void 0 ? _r : "").trim();
            const pan = String((_v = (_u = (_t = (_s = row["PAN"]) !== null && _s !== void 0 ? _s : row["Pan"]) !== null && _t !== void 0 ? _t : row["pan"]) !== null && _u !== void 0 ? _u : row["panNumber"]) !== null && _v !== void 0 ? _v : "").trim();
            const activeRaw = String((_y = (_x = (_w = row["ACTIVE"]) !== null && _w !== void 0 ? _w : row["Active"]) !== null && _x !== void 0 ? _x : row["active"]) !== null && _y !== void 0 ? _y : "Yes").trim();
            const gstRaw = String((_2 = (_1 = (_0 = (_z = row["GST REGN"]) !== null && _z !== void 0 ? _z : row["GST"]) !== null && _0 !== void 0 ? _0 : row["gst"]) !== null && _1 !== void 0 ? _1 : row["gstNumber"]) !== null && _2 !== void 0 ? _2 : "").trim();
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
            const vendorData = {
                contact: cleanPhone,
                isActive,
            };
            if (cleanAddress)
                vendorData.address = cleanAddress;
            if (pan && pan.length === 10)
                vendorData.panNumber = pan.toUpperCase();
            if (gstRaw.toLowerCase() === "yes")
                vendorData.gstNumber = vendorData.gstNumber || null; // flag only, no number in source
            if (code)
                vendorData.notes = vendorData.notes ? vendorData.notes : `Legacy Code: ${code}`;
            try {
                // Check if vendor already exists (case-insensitive match)
                const existing = yield prismaClient_1.default.vendor.findFirst({
                    where: { name: { equals: vendorName } },
                });
                if (existing) {
                    // Update — merge non-empty fields only
                    const updateData = {};
                    if (cleanPhone !== "N/A" && !existing.contact)
                        updateData.contact = cleanPhone;
                    if (cleanAddress && !existing.address)
                        updateData.address = cleanAddress;
                    if (pan && pan.length === 10 && !existing.panNumber)
                        updateData.panNumber = pan.toUpperCase();
                    if (!existing.isActive && isActive)
                        updateData.isActive = true;
                    if (code && !((_3 = existing.notes) === null || _3 === void 0 ? void 0 : _3.includes("Legacy Code"))) {
                        updateData.notes = existing.notes
                            ? `${existing.notes}\nLegacy Code: ${code}`
                            : `Legacy Code: ${code}`;
                    }
                    if (Object.keys(updateData).length > 0) {
                        yield prismaClient_1.default.vendor.update({ where: { id: existing.id }, data: updateData });
                        updated.push({ row: rowNum, id: existing.id, name: vendorName, fieldsUpdated: Object.keys(updateData) });
                    }
                    else {
                        skipped.push({ row: rowNum, name: vendorName, reason: "Already exists, no new data to update" });
                    }
                }
                else {
                    // Create new vendor
                    const newVendor = yield prismaClient_1.default.vendor.create({
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
            }
            catch (rowErr) {
                errors.push({ row: rowNum, name: vendorName, error: (_4 = rowErr === null || rowErr === void 0 ? void 0 : rowErr.message) !== null && _4 !== void 0 ? _4 : "Unknown error" });
            }
        }
        try {
            fs_1.default.unlinkSync(filePath);
        }
        catch (_5) { }
        res.json({
            message: `Import complete: ${created.length} created, ${updated.length} updated, ${skipped.length} skipped, ${errors.length} errors`,
            created: created.length,
            updated: updated.length,
            skipped: skipped.length,
            errorCount: errors.length,
            details: { created, updated, skipped, errors },
        });
    }
    catch (err) {
        try {
            if (filePath)
                fs_1.default.unlinkSync(filePath);
        }
        catch (_6) { }
        console.error("importVendors error:", err);
        res.status(500).json({ message: "Failed to import vendors", error: err.message });
    }
});
exports.importVendors = importVendors;
// ─── Download Vendor Import Template ────────────────────────────────────────
const downloadVendorTemplate = (_req, res) => {
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
        { Field: "CODE", Required: "NO", Notes: "Internal vendor code (optional)." },
        { Field: "ADDRESS", Required: "NO", Notes: "Full postal address. Skip rows with placeholder values like '.' or ',,,'." },
        { Field: "PHONE", Required: "NO", Notes: "Primary contact number. Multiple numbers? Separate with '/' — only the first is kept." },
        { Field: "PAN", Required: "NO", Notes: "Indian Permanent Account Number." },
        { Field: "GST REGN", Required: "NO", Notes: "GST registration number." },
        { Field: "ACTIVE", Required: "NO", Notes: "Yes / No (default: Yes)." },
    ];
    const wb = xlsx_1.default.utils.book_new();
    const ws = xlsx_1.default.utils.json_to_sheet(example, { header: headers });
    ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 4, 22) }));
    xlsx_1.default.utils.book_append_sheet(wb, ws, "Vendors");
    const instrWs = xlsx_1.default.utils.json_to_sheet(instructions);
    instrWs["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 70 }];
    xlsx_1.default.utils.book_append_sheet(wb, instrWs, "Instructions");
    const buffer = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=vendor-import-template.xlsx");
    res.send(buffer);
};
exports.downloadVendorTemplate = downloadVendorTemplate;

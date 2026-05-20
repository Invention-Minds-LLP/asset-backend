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
exports.getDepartmentAssets = exports.deleteDepartment = exports.updateDepartment = exports.createDepartment = exports.getAllDepartments = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllDepartments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { includeInactive, search, exportCsv } = req.query;
        const where = {};
        if (includeInactive !== "true")
            where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: String(search) } },
                { code: { contains: String(search) } },
            ];
        }
        const departments = yield prismaClient_1.default.department.findMany({
            where,
            include: {
                parentDepartment: { select: { name: true } },
                _count: { select: { employees: true, assets: true } },
            },
            orderBy: { name: "asc" },
        });
        if (exportCsv === "true") {
            const csvRows = departments.map((d) => {
                var _a, _b, _c;
                return ({
                    Name: d.name, Code: d.code || "", Parent: ((_a = d.parentDepartment) === null || _a === void 0 ? void 0 : _a.name) || "",
                    Employees: ((_b = d._count) === null || _b === void 0 ? void 0 : _b.employees) || 0, Assets: ((_c = d._count) === null || _c === void 0 ? void 0 : _c.assets) || 0,
                    Active: d.isActive ? "Yes" : "No",
                });
            });
            const headers = Object.keys(csvRows[0] || {}).join(",");
            const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=departments.csv");
            res.send(headers + "\n" + rows);
            return;
        }
        res.json(departments);
    }
    catch (error) {
        console.error("getAllDepartments error:", error);
        res.status(500).json({ message: "Failed to fetch departments" });
    }
});
exports.getAllDepartments = getAllDepartments;
const createDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const department = yield prismaClient_1.default.department.create({ data: req.body });
    res.status(201).json(department);
});
exports.createDepartment = createDepartment;
const updateDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const { name } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim())) {
            res.status(400).json({ message: "Department name is required" });
            return;
        }
        const updated = yield prismaClient_1.default.department.update({ where: { id }, data: { name: name.trim() } });
        res.json(updated);
    }
    catch (error) {
        console.error("updateDepartment error:", error);
        res.status(500).json({ message: "Failed to update department" });
    }
});
exports.updateDepartment = updateDepartment;
const deleteDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const inUse = yield prismaClient_1.default.employee.findFirst({ where: { departmentId: id } });
        if (inUse) {
            res.status(400).json({ message: "Department has employees assigned. Reassign them first." });
            return;
        }
        // Soft delete
        yield prismaClient_1.default.department.update({ where: { id }, data: { isActive: false } });
        res.json({ message: "Department deactivated" });
    }
    catch (error) {
        console.error("deleteDepartment error:", error);
        res.status(500).json({ message: "Failed to delete department" });
    }
});
exports.deleteDepartment = deleteDepartment;
// GET /api/departments/:id/assets  — all assets assigned to a department
const getDepartmentAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const deptId = Number(req.params.id);
        const { status, categoryId } = req.query;
        const where = { departmentId: deptId };
        if (status)
            where.status = String(status);
        if (categoryId)
            where.assetCategoryId = Number(categoryId);
        const assets = yield prismaClient_1.default.asset.findMany({
            where,
            include: {
                assetCategory: { select: { id: true, name: true } },
                allottedTo: { select: { id: true, name: true, employeeID: true, designation: true } },
                supervisor: { select: { id: true, name: true } },
            },
            orderBy: { assetName: "asc" },
        });
        // Summary always reflects ALL department assets (ignores status/category filter)
        // so the status pills stay meaningful when the user filters the table.
        const allDeptAssets = yield prismaClient_1.default.asset.findMany({
            where: { departmentId: deptId },
            select: { status: true },
        });
        const byStatus = allDeptAssets.reduce((acc, a) => {
            acc[a.status] = (acc[a.status] || 0) + 1;
            return acc;
        }, {});
        const summary = {
            total: allDeptAssets.length,
            active: byStatus['ACTIVE'] || 0,
            underMaintenance: byStatus['IN_MAINTENANCE'] || 0,
            inStore: byStatus['IN_STORE'] || 0,
            disposed: byStatus['DISPOSED'] || 0,
            byStatus, // raw counts for any other status (RETIRED, SCRAPPED, etc.)
        };
        res.json({ summary, assets });
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch department assets" });
    }
});
exports.getDepartmentAssets = getDepartmentAssets;

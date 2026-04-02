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
exports.getEmployeeAssets = exports.getDepartmentNameByEmployeeID = exports.deleteEmployee = exports.createEmployee = exports.getAllEmployees = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { includeInactive, search, page, limit: lim, exportCsv } = req.query;
        const where = {};
        if (includeInactive !== "true")
            where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: String(search) } },
                { employeeID: { contains: String(search) } },
                { email: { contains: String(search) } },
                { designation: { contains: String(search) } },
            ];
        }
        const include = {
            department: true,
            reportingTo: { select: { name: true, employeeID: true } },
        };
        if (page && lim) {
            const skip = (parseInt(String(page)) - 1) * parseInt(String(lim));
            const take = parseInt(String(lim));
            const [total, employees] = yield Promise.all([
                prismaClient_1.default.employee.count({ where }),
                prismaClient_1.default.employee.findMany({ where, include, orderBy: { name: "asc" }, skip, take }),
            ]);
            if (exportCsv === "true") {
                const csvRows = employees.map((e) => {
                    var _a, _b;
                    return ({
                        EmployeeID: e.employeeID, Name: e.name, Email: e.email || "",
                        Phone: e.phone || "", Designation: e.designation || "",
                        Department: ((_a = e.department) === null || _a === void 0 ? void 0 : _a.name) || "", Role: e.role,
                        ReportsTo: ((_b = e.reportingTo) === null || _b === void 0 ? void 0 : _b.name) || "", Active: e.isActive ? "Yes" : "No",
                    });
                });
                const headers = Object.keys(csvRows[0] || {}).join(",");
                const rows = csvRows.map((r) => Object.values(r).join(",")).join("\n");
                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", "attachment; filename=employees.csv");
                res.send(headers + "\n" + rows);
                return;
            }
            res.json({ data: employees, total, page: parseInt(String(page)), limit: take });
            return;
        }
        const employees = yield prismaClient_1.default.employee.findMany({ where, include, orderBy: { name: "asc" } });
        res.json(employees);
    }
    catch (error) {
        console.error("getAllEmployees error:", error);
        res.status(500).json({ message: "Failed to fetch employees" });
    }
});
exports.getAllEmployees = getAllEmployees;
const createEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employee = yield prismaClient_1.default.employee.create({ data: req.body });
    res.status(201).json(employee);
});
exports.createEmployee = createEmployee;
const deleteEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        yield prismaClient_1.default.employee.update({ where: { id }, data: { isActive: false } });
        res.json({ message: "Employee deactivated" });
    }
    catch (error) {
        console.error("deleteEmployee error:", error);
        res.status(500).json({ message: "Failed to deactivate employee" });
    }
});
exports.deleteEmployee = deleteEmployee;
const getDepartmentNameByEmployeeID = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { employeeID } = req.params;
    try {
        const employee = yield prismaClient_1.default.employee.findUnique({
            where: { employeeID },
            include: {
                department: true,
            },
        });
        if (!employee || !employee.department) {
            res.status(404).json({ message: "Department not found for the given employeeID" });
            return;
        }
        res.json({ departmentName: employee.department });
    }
    catch (error) {
        console.error("Error fetching department by employeeID:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.getDepartmentNameByEmployeeID = getDepartmentNameByEmployeeID;
// GET /api/employees/:id/assets — all assets assigned to a specific employee
const getEmployeeAssets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const empId = Number(req.params.id);
        const employee = yield prismaClient_1.default.employee.findUnique({
            where: { id: empId },
            select: { id: true, name: true, employeeID: true, designation: true },
        });
        if (!employee) {
            res.status(404).json({ message: "Employee not found" });
            return;
        }
        const assets = yield prismaClient_1.default.asset.findMany({
            where: { allottedToId: empId, status: { notIn: ["DISPOSED", "CONDEMNED"] } },
            include: {
                assetCategory: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
            },
            orderBy: { assetName: "asc" },
        });
        res.json({ employee, totalAssets: assets.length, assets });
    }
    catch (e) {
        res.status(500).json({ message: e.message || "Failed to fetch employee assets" });
    }
});
exports.getEmployeeAssets = getEmployeeAssets;

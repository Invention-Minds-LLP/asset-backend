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
exports.getDepartmentNameByEmployeeID = exports.deleteEmployee = exports.createEmployee = exports.getAllEmployees = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employees = yield prismaClient_1.default.employee.findMany({
        include: {
            department: true, // Include department details if needed
        },
    });
    res.json(employees);
});
exports.getAllEmployees = getAllEmployees;
const createEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employee = yield prismaClient_1.default.employee.create({ data: req.body });
    res.status(201).json(employee);
});
exports.createEmployee = createEmployee;
const deleteEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    yield prismaClient_1.default.employee.delete({ where: { id } });
    res.status(204).send();
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

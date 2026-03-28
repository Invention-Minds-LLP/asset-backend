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
exports.deleteDepartment = exports.createDepartment = exports.getAllDepartments = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const getAllDepartments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const departments = yield prismaClient_1.default.department.findMany();
    res.json(departments);
});
exports.getAllDepartments = getAllDepartments;
const createDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const department = yield prismaClient_1.default.department.create({ data: req.body });
    res.status(201).json(department);
});
exports.createDepartment = createDepartment;
const deleteDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    yield prismaClient_1.default.department.delete({ where: { id } });
    res.status(204).send();
});
exports.deleteDepartment = deleteDepartment;

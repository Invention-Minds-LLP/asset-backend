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
exports.deleteBranch = exports.updateBranch = exports.createBranch = exports.getBranches = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ------------------------------------------------------
// GET ALL BRANCHES
// ------------------------------------------------------
const getBranches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branches = yield prismaClient_1.default.branch.findMany({
            orderBy: { name: "asc" },
        });
        res.json(branches);
    }
    catch (err) {
        console.error("Error fetching branches:", err);
        res.status(500).json({ message: "Failed to fetch branches" });
    }
});
exports.getBranches = getBranches;
// ------------------------------------------------------
// CREATE BRANCH
// ------------------------------------------------------
const createBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            res.status(400).json({ message: "Branch name is required" });
            return;
        }
        // Prevent duplicates
        const exists = yield prismaClient_1.default.branch.findUnique({
            where: { name },
        });
        if (exists) {
            res.status(400).json({ message: "Branch already exists" });
            return;
        }
        const branch = yield prismaClient_1.default.branch.create({
            data: { name },
        });
        res.status(201).json(branch);
    }
    catch (err) {
        console.error("Error creating branch:", err);
        res.status(500).json({ message: "Failed to create branch" });
    }
});
exports.createBranch = createBranch;
// ------------------------------------------------------
// UPDATE BRANCH
// ------------------------------------------------------
const updateBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { name } = req.body;
        if (!name || !name.trim()) {
            res.status(400).json({ message: "Branch name is required" });
            return;
        }
        const branch = yield prismaClient_1.default.branch.update({
            where: { id },
            data: { name },
        });
        res.json(branch);
    }
    catch (err) {
        console.error("Error updating branch:", err);
        res.status(500).json({ message: "Failed to update branch" });
    }
});
exports.updateBranch = updateBranch;
// ------------------------------------------------------
// DELETE BRANCH (ONLY IF NO ASSET LOCATIONS/TRANSFERS ATTACHED)
// ------------------------------------------------------
const deleteBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        // Check if branch is in use
        const usage = yield prismaClient_1.default.assetLocation.findFirst({
            where: { branchId: id },
        });
        if (usage) {
            res.status(400).json({
                message: "Branch is linked to assets. Cannot delete.",
            });
            return;
        }
        yield prismaClient_1.default.branch.delete({ where: { id } });
        res.json({ message: "Branch deleted successfully" });
    }
    catch (err) {
        console.error("Error deleting branch:", err);
        res.status(500).json({ message: "Failed to delete branch" });
    }
});
exports.deleteBranch = deleteBranch;

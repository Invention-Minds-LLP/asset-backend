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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDirectorySync = void 0;
const directory_1 = require("../../utilis/directory");
// POST /api/directory-sync/run
// Admin-triggered backfill: pushes all Employee IDs + external-auditor emails
// to the tenant directory now (instead of waiting for the nightly cron).
const runDirectorySync = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const role = (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) || "").toUpperCase();
    if (!["ADMIN", "OPERATIONS", "CEO", "COO", "CEO_COO"].includes(role)) {
        res.status(403).json({ message: "Forbidden: admin only" });
        return;
    }
    const result = yield (0, directory_1.syncAllToDirectory)();
    res.status(result.ok ? 200 : 502).json(result);
});
exports.runDirectorySync = runDirectorySync;

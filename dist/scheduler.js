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
exports.startScheduler = startScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const cron_jobs_controller_1 = require("./api/cron-jobs/cron-jobs.controller");
// In-process daily scheduler for the alert / expiry checks.
// Runs every day at 08:00 server time. Each individual check is also still
// exposed as a POST endpoint under /api/cron-jobs for manual / external runs.
function startScheduler() {
    node_cron_1.default.schedule("0 8 * * *", () => __awaiter(this, void 0, void 0, function* () {
        const startedAt = new Date().toISOString();
        console.log(`[scheduler] daily alert checks started at ${startedAt}`);
        try {
            const results = yield (0, cron_jobs_controller_1.runAllChecksInternal)();
            console.log("[scheduler] daily alert checks complete:", JSON.stringify(results));
        }
        catch (err) {
            console.error("[scheduler] daily alert checks failed:", err);
        }
    }));
    console.log("[scheduler] daily alert checks scheduled for 08:00 server time");
}

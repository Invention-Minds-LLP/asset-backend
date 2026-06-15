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
exports.syncEmployeeIdentifier = syncEmployeeIdentifier;
exports.syncExternalAuditorIdentifier = syncExternalAuditorIdentifier;
exports.syncAllToDirectory = syncAllToDirectory;
const prismaClient_1 = __importDefault(require("../prismaClient"));
// ───────────────────────────────────────────────────────────────────────────
// Directory sync — pushes this client's identifiers (Employee IDs + external
// auditor emails) to the shared hrminds-directory so the mobile app can resolve
// which client backend a user belongs to. Multi-tenant routing: one app, many
// client backends. No-ops silently if the directory isn't configured.
//
// Env:
//   DIRECTORY_URL       e.g. https://hrmindsdirectory.imapps.in   (no trailing slash)
//   DIRECTORY_API_KEY   this tenant's apiKey (issued by the directory admin)
//   DIRECTORY_PRODUCT   defaults to "SMART_ASSETS"
// ───────────────────────────────────────────────────────────────────────────
const DIRECTORY_URL = process.env.DIRECTORY_URL;
const DIRECTORY_API_KEY = process.env.DIRECTORY_API_KEY;
const PRODUCT = process.env.DIRECTORY_PRODUCT || "SMART_ASSETS";
const isConfigured = () => !!(DIRECTORY_URL && DIRECTORY_API_KEY);
function post(path, body) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const resp = yield fetch(`${DIRECTORY_URL}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-tenant-key": DIRECTORY_API_KEY },
                body: JSON.stringify(body),
            });
            const data = yield resp.json().catch(() => ({}));
            if (!resp.ok)
                return { ok: false, error: (data === null || data === void 0 ? void 0 : data.error) || `HTTP ${resp.status}` };
            return { ok: true, data };
        }
        catch (err) {
            return { ok: false, error: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : "unknown error" };
        }
    });
}
// Upsert a single Employee ID → this tenant. Call after creating/updating a user.
function syncEmployeeIdentifier(employeeID_1, fullName_1) {
    return __awaiter(this, arguments, void 0, function* (employeeID, fullName, isActive = true) {
        if (!isConfigured() || !employeeID)
            return;
        const res = yield post("/api/directory/sync/identifier/upsert", {
            product: PRODUCT,
            type: "EMPLOYEE_ID",
            value: employeeID,
            fullName: fullName !== null && fullName !== void 0 ? fullName : null,
            isActive,
        });
        if (!res.ok)
            console.error("[directory] employee upsert failed:", res.error);
    });
}
// Upsert a single external-auditor email → this tenant.
function syncExternalAuditorIdentifier(email_1, fullName_1) {
    return __awaiter(this, arguments, void 0, function* (email, fullName, isActive = true) {
        if (!isConfigured() || !email)
            return;
        const res = yield post("/api/directory/sync/identifier/upsert", {
            product: PRODUCT,
            type: "EMAIL",
            value: email,
            fullName: fullName !== null && fullName !== void 0 ? fullName : null,
            isActive,
        });
        if (!res.ok)
            console.error("[directory] external auditor upsert failed:", res.error);
    });
}
// Bulk push every active employee (EMPLOYEE_ID) + external auditor (EMAIL).
// Safe to run nightly; the directory upserts so re-runs are idempotent.
function syncAllToDirectory() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isConfigured())
            return { ok: false, error: "directory not configured" };
        const [employees, auditors] = yield Promise.all([
            prismaClient_1.default.employee.findMany({ select: { employeeID: true, name: true, isActive: true } }),
            prismaClient_1.default.externalAuditor.findMany({ select: { email: true, name: true, status: true } }),
        ]);
        const entries = [
            ...employees
                .filter((e) => e.employeeID)
                .map((e) => ({ type: "EMPLOYEE_ID", value: e.employeeID, fullName: e.name, isActive: e.isActive })),
            ...auditors
                .filter((a) => a.email)
                .map((a) => ({ type: "EMAIL", value: a.email, fullName: a.name, isActive: a.status === "ACTIVE" })),
        ];
        const res = yield post("/api/directory/sync/identifier/bulk", { product: PRODUCT, entries });
        if (!res.ok) {
            console.error("[directory] bulk sync failed:", res.error);
            return { ok: false, error: res.error };
        }
        return { ok: true, result: res.data };
    });
}

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
exports.getMyAccess = exports.deletePermission = exports.bulkSetPermissions = exports.setPermission = exports.getPermissions = exports.deleteModuleItem = exports.updateModuleItem = exports.addModuleItem = exports.deleteModule = exports.updateModule = exports.createModule = exports.getAllModules = exports.resetAndReseed = exports.seedDefaultModules = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Seed default modules (call once to populate AppModule + AppModuleItem) ──
const seedDefaultModules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const defaults = [
            // ── Overview ──
            { name: "master-dashboard", label: "Dashboard", icon: "pi pi-chart-bar", path: "/master-dashboard", sortOrder: 1, items: [] },
            { name: "my-assets", label: "My Assets", icon: "pi pi-id-card", path: "/my-assets", sortOrder: 2, items: [] },
            // ── Asset Management ──
            { name: "asset-master", label: "Asset Master", icon: "pi pi-database", path: "/assets", sortOrder: 3,
                items: [
                    { name: "view-assets", label: "View Assets", path: "/assets/view", icon: "pi pi-eye", sortOrder: 1 },
                    { name: "new-asset", label: "New Asset", path: "/assets/new", icon: "pi pi-plus", sortOrder: 2 },
                    { name: "assignments", label: "Assignments", path: "/assets/assignments", icon: "pi pi-user", sortOrder: 3 },
                    { name: "transfer", label: "Transfer", path: "/transfer", icon: "pi pi-arrows-h", sortOrder: 4 },
                    { name: "import", label: "Import", path: "/import", icon: "pi pi-upload", sortOrder: 5 },
                    { name: "sub-assets", label: "Sub-Assets", path: "/sub-assets", icon: "pi pi-sitemap", sortOrder: 6 },
                    { name: "department-assets", label: "Department Assets", path: "/department-assets", icon: "pi pi-building", sortOrder: 7 },
                    { name: "revenue-log", label: "Revenue Log", path: "/revenue-log", icon: "pi pi-chart-line", sortOrder: 8 },
                    { name: "asset-disposal", label: "Asset Disposal", path: "/disposal", icon: "pi pi-trash", sortOrder: 9 },
                ]
            },
            { name: "asset-indent", label: "Asset Indent", icon: "pi pi-list-check", path: "/asset-indent", sortOrder: 4, items: [] },
            // ── Procurement ──
            // { name: "procurement", label: "Procurement", icon: "pi pi-shopping-cart", path: "/procurement", sortOrder: 5,
            //   items: [
            //     { name: "purchase-orders", label: "Purchase Orders",      path: "/purchase-orders", icon: "pi pi-file-edit", sortOrder: 1 },
            //     { name: "goods-receipts",  label: "Goods Receipt (GRA)", path: "/goods-receipts",  icon: "pi pi-inbox",     sortOrder: 2 },
            //   ]
            // },
            // ── Store & Inventory ──
            { name: "store-management", label: "Store & Inventory", icon: "pi pi-warehouse", path: "/store-management", sortOrder: 6, items: [] },
            // ── Maintenance & Service ──
            { name: "maintenance", label: "Maintenance", icon: "pi pi-wrench", path: "/maintenance", sortOrder: 7,
                items: [
                    { name: "repair-tickets", label: "Repair Tickets", path: "/ticket/view", icon: "pi pi-wrench", sortOrder: 1 },
                    { name: "new-ticket", label: "New Ticket", path: "/ticket/new", icon: "pi pi-plus", sortOrder: 2 },
                    { name: "work-orders", label: "Work Orders", path: "/work-orders", icon: "pi pi-briefcase", sortOrder: 3 },
                    { name: "preventive-maintenance", label: "Preventive Maintenance", path: "/preventive-maintenance", icon: "pi pi-calendar", sortOrder: 4 },
                    { name: "calibration", label: "Calibration", path: "/calibration", icon: "pi pi-sliders-h", sortOrder: 5 },
                    { name: "pm-checklists", label: "PM Checklists", path: "/pm-checklist", icon: "pi pi-list-check", sortOrder: 6 },
                ]
            },
            // ── Contracts & Coverage ──
            { name: "contracts-coverage", label: "Contracts & Coverage", icon: "pi pi-verified", path: "/contracts", sortOrder: 8,
                items: [
                    { name: "warranty", label: "Warranty", path: "/warranty-management", icon: "pi pi-verified", sortOrder: 1 },
                    { name: "insurance", label: "Insurance", path: "/insurance-management", icon: "pi pi-shield", sortOrder: 2 },
                    { name: "service-contracts", label: "Service Contracts", path: "/service-contracts", icon: "pi pi-file-edit", sortOrder: 3 },
                    { name: "vendor-performance", label: "Vendor Performance", path: "/vendor-performance", icon: "pi pi-star", sortOrder: 4 },
                ]
            },
            // ── Finance & Analytics ──
            { name: "finance-analytics", label: "Finance & Analytics", icon: "pi pi-indian-rupee", path: "/finance", sortOrder: 9,
                items: [
                    { name: "financial-dashboard", label: "Financial Dashboard", path: "/financial-dashboard", icon: "pi pi-indian-rupee", sortOrder: 1 },
                    { name: "cfo-dashboard", label: "CFO Dashboard", path: "/cfo-dashboard", icon: "pi pi-chart-pie", sortOrder: 2 },
                    { name: "coo-dashboard", label: "COO Dashboard", path: "/coo-dashboard", icon: "pi pi-gauge", sortOrder: 3 },
                    { name: "cost-analysis", label: "Cost Analysis", path: "/cost-analysis", icon: "pi pi-chart-bar", sortOrder: 4 },
                    { name: "decision-engine", label: "Decision Engine", path: "/decision-engine", icon: "pi pi-microchip", sortOrder: 5 },
                    { name: "batch-depreciation", label: "Batch Depreciation", path: "/batch-depreciation", icon: "pi pi-chart-line", sortOrder: 6 },
                    { name: "fixed-assets-schedule", label: "Fixed Assets Schedule", path: "/fixed-assets-schedule", icon: "pi pi-table", sortOrder: 7 },
                    { name: "finance-centre", label: "Finance Centre", path: "/finance-centre", icon: "pi pi-building-columns", sortOrder: 8 },
                    { name: "reports", label: "Reports", path: "/reports", icon: "pi pi-file", sortOrder: 9 },
                ]
            },
            // ── Accounts ──
            // { name: "accounts", label: "Accounts", icon: "pi pi-calculator", path: "/accounts", sortOrder: 10,
            //   items: [
            //     { name: "accounts-dashboard",    label: "Accounts Dashboard", path: "/accounts/dashboard",          icon: "pi pi-chart-bar",   sortOrder: 1 },
            //     { name: "chart-of-accounts",     label: "Chart of Accounts",  path: "/accounts/chart-of-accounts",  icon: "pi pi-list",        sortOrder: 2 },
            //     { name: "purchase-vouchers",     label: "Purchase Vouchers",  path: "/accounts/purchase-vouchers",  icon: "pi pi-file-edit",   sortOrder: 3 },
            //     { name: "payment-vouchers",      label: "Payment Vouchers",   path: "/accounts/payment-vouchers",   icon: "pi pi-credit-card", sortOrder: 4 },
            //     { name: "journal-entries",       label: "Journal Entries",    path: "/accounts/journal-entries",    icon: "pi pi-book",        sortOrder: 5 },
            //     { name: "account-ledger",        label: "Account Ledger",     path: "/accounts/ledger",             icon: "pi pi-chart-line",  sortOrder: 6 },
            //   ]
            // },
            // ── Operations ──
            { name: "operations", label: "Operations", icon: "pi pi-cog", path: "/operations", sortOrder: 11,
                items: [
                    { name: "gate-pass", label: "Gate Pass", path: "/gate-pass", icon: "pi pi-id-card", sortOrder: 1 },
                    { name: "acknowledgement", label: "Acknowledgement", path: "/acknowledgement", icon: "pi pi-check-square", sortOrder: 2 },
                    { name: "physical-audit", label: "Physical Audit", path: "/asset-audit", icon: "pi pi-clipboard", sortOrder: 3 },
                    { name: "employee-exit", label: "Employee Exit", path: "/employee-exit", icon: "pi pi-sign-out", sortOrder: 4 },
                    { name: "document-vault", label: "Document Vault", path: "/document-vault", icon: "pi pi-folder-open", sortOrder: 5 },
                    { name: "knowledge-base", label: "Knowledge Base", path: "/knowledge-base", icon: "pi pi-book", sortOrder: 6 },
                    { name: "rca", label: "Root Cause Analysis", path: "/rca", icon: "pi pi-search-minus", sortOrder: 7 },
                    { name: "bulk-operations", label: "Bulk Operations", path: "/quick-actions", icon: "pi pi-bolt", sortOrder: 8 },
                ]
            },
            // ── Administration ──
            { name: "administration", label: "Administration", icon: "pi pi-shield", path: "/admin", sortOrder: 12,
                items: [
                    { name: "sla-matrix", label: "SLA Matrix", path: "/sla", icon: "pi pi-clock", sortOrder: 1 },
                    { name: "escalation-matrix", label: "Escalation Matrix", path: "/escalation", icon: "pi pi-sort-alt", sortOrder: 2 },
                    { name: "support-matrix", label: "Support Matrix", path: "/support-matrix", icon: "pi pi-users", sortOrder: 3 },
                    { name: "hierarchy-dashboard", label: "Hierarchy Dashboard", path: "/hierarchy-config", icon: "pi pi-sitemap", sortOrder: 4 },
                    { name: "master-settings", label: "Master Settings", path: "/master-settings", icon: "pi pi-cog", sortOrder: 5 },
                    { name: "approval-config", label: "Approval Config", path: "/approval-config", icon: "pi pi-check-circle", sortOrder: 6 },
                    { name: "module-access", label: "Module Access", path: "/module-access", icon: "pi pi-lock", sortOrder: 7 },
                    { name: "system-config", label: "System Config", path: "/tenant-config", icon: "pi pi-sliders-v", sortOrder: 8 },
                    { name: "user-activity", label: "User Activity", path: "/user-activity", icon: "pi pi-users", sortOrder: 9 },
                    { name: "audit-trail", label: "Audit Trail", path: "/audit-trail", icon: "pi pi-history", sortOrder: 10 },
                    { name: "notifications", label: "Notifications", path: "/notifications", icon: "pi pi-bell", sortOrder: 11 },
                    { name: "notification-preferences", label: "Notification Preferences", path: "/notification-preferences", icon: "pi pi-sliders-h", sortOrder: 12 },
                    { name: "email-templates", label: "Email Templates", path: "/email-templates", icon: "pi pi-envelope", sortOrder: 13 },
                    { name: "inventory-master", label: "Inventory Master", path: "/master", icon: "pi pi-box", sortOrder: 14 },
                ]
            },
            // ── Settings ──
            { name: "settings", label: "Settings", icon: "pi pi-user-edit", path: "/settings", sortOrder: 13,
                items: [
                    { name: "profile", label: "Profile", path: "/settings", icon: "pi pi-user", sortOrder: 1 },
                    { name: "reset-password", label: "Reset Password", path: "/settings", icon: "pi pi-lock", sortOrder: 2 },
                    { name: "user-creation", label: "User Creation", path: "/settings", icon: "pi pi-user-plus", sortOrder: 3 },
                    { name: "employee-creation", label: "Employee Creation", path: "/settings", icon: "pi pi-id-card", sortOrder: 4 },
                    { name: "table", label: "Table", path: "/settings", icon: "pi pi-table", sortOrder: 5 },
                    { name: "master-data", label: "Master Data", path: "/settings", icon: "pi pi-database", sortOrder: 6 },
                ]
            },
        ];
        const created = [];
        for (const mod of defaults) {
            const existing = yield prismaClient_1.default.appModule.findUnique({ where: { name: mod.name } });
            if (!existing) {
                yield prismaClient_1.default.appModule.create({
                    data: {
                        name: mod.name,
                        label: mod.label,
                        icon: mod.icon,
                        path: mod.path,
                        sortOrder: mod.sortOrder,
                        subItems: mod.items.length
                            ? { create: mod.items.map(i => { var _a; return ({ name: i.name, label: i.label, path: (_a = i.path) !== null && _a !== void 0 ? _a : undefined, icon: i.icon, sortOrder: i.sortOrder }); }) }
                            : undefined
                    }
                });
                created.push(mod.name);
            }
            else if (mod.items.length) {
                // Add any missing sub-items to an existing module
                for (const item of mod.items) {
                    const existingItem = yield prismaClient_1.default.appModuleItem.findUnique({
                        where: { moduleId_name: { moduleId: existing.id, name: item.name } }
                    });
                    if (!existingItem) {
                        yield prismaClient_1.default.appModuleItem.create({
                            data: { moduleId: existing.id, name: item.name, label: item.label, path: (_a = item.path) !== null && _a !== void 0 ? _a : undefined, icon: item.icon, sortOrder: item.sortOrder }
                        });
                    }
                }
            }
        }
        res.json({ message: "Seed complete", created });
    }
    catch (error) {
        console.error("seedDefaultModules error:", error);
        res.status(500).json({ message: "Failed to seed modules" });
    }
});
exports.seedDefaultModules = seedDefaultModules;
// ─── Reset & Re-seed (DESTRUCTIVE — wipes all modules/items/permissions) ─────
const resetAndReseed = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Delete in correct order (FK constraints)
        yield prismaClient_1.default.modulePermission.deleteMany({});
        yield prismaClient_1.default.appModuleItem.deleteMany({});
        yield prismaClient_1.default.appModule.deleteMany({});
        // Now re-seed by calling the same logic as seedDefaultModules
        // Re-use the defaults array from above by forwarding to seed
        // We can't call seedDefaultModules directly, so duplicate the insert logic
        const seedReq = Object.assign({}, req);
        const seedRes = {
            json: (data) => res.json(Object.assign({ message: "Reset & re-seed complete" }, data)),
            status: (code) => ({ json: (data) => res.status(code).json(data) }),
        };
        // Forward to seed
        yield (0, exports.seedDefaultModules)(seedReq, seedRes);
    }
    catch (error) {
        console.error("resetAndReseed error:", error);
        res.status(500).json({ message: "Failed to reset and re-seed modules" });
    }
});
exports.resetAndReseed = resetAndReseed;
// ─── App Modules CRUD ─────────────────────────────────────────────────────────
const getAllModules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const modules = yield prismaClient_1.default.appModule.findMany({
            include: { subItems: { orderBy: { sortOrder: "asc" } } },
            orderBy: { sortOrder: "asc" }
        });
        res.json(modules);
    }
    catch (error) {
        console.error("getAllModules error:", error);
        res.status(500).json({ message: "Failed to fetch modules" });
    }
});
exports.getAllModules = getAllModules;
const createModule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, label, icon, path, sortOrder } = req.body;
        if (!name || !label) {
            res.status(400).json({ message: "name and label are required" });
            return;
        }
        const module = yield prismaClient_1.default.appModule.create({ data: { name, label, icon, path, sortOrder: sortOrder !== null && sortOrder !== void 0 ? sortOrder : 0 } });
        res.status(201).json(module);
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === "P2002") {
            res.status(409).json({ message: "Module name already exists" });
            return;
        }
        console.error("createModule error:", error);
        res.status(500).json({ message: "Failed to create module" });
    }
});
exports.createModule = createModule;
const updateModule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        const updated = yield prismaClient_1.default.appModule.update({ where: { id }, data: req.body });
        res.json(updated);
    }
    catch (error) {
        console.error("updateModule error:", error);
        res.status(500).json({ message: "Failed to update module" });
    }
});
exports.updateModule = updateModule;
const deleteModule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        yield prismaClient_1.default.modulePermission.deleteMany({ where: { moduleId: id } });
        yield prismaClient_1.default.appModuleItem.deleteMany({ where: { moduleId: id } });
        yield prismaClient_1.default.appModule.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteModule error:", error);
        res.status(500).json({ message: "Failed to delete module" });
    }
});
exports.deleteModule = deleteModule;
// ─── Module Items ─────────────────────────────────────────────────────────────
const addModuleItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const moduleId = parseInt(req.params.moduleId);
        const { name, label, path, icon, sortOrder } = req.body;
        if (!name || !label) {
            res.status(400).json({ message: "name and label are required" });
            return;
        }
        const item = yield prismaClient_1.default.appModuleItem.create({ data: { moduleId, name, label, path, icon, sortOrder: sortOrder !== null && sortOrder !== void 0 ? sortOrder : 0 } });
        res.status(201).json(item);
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) === "P2002") {
            res.status(409).json({ message: "Item name already exists in this module" });
            return;
        }
        console.error("addModuleItem error:", error);
        res.status(500).json({ message: "Failed to add module item" });
    }
});
exports.addModuleItem = addModuleItem;
const updateModuleItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.itemId);
        const updated = yield prismaClient_1.default.appModuleItem.update({ where: { id }, data: req.body });
        res.json(updated);
    }
    catch (error) {
        console.error("updateModuleItem error:", error);
        res.status(500).json({ message: "Failed to update item" });
    }
});
exports.updateModuleItem = updateModuleItem;
const deleteModuleItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.itemId);
        yield prismaClient_1.default.modulePermission.deleteMany({ where: { moduleItemId: id } });
        yield prismaClient_1.default.appModuleItem.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deleteModuleItem error:", error);
        res.status(500).json({ message: "Failed to delete item" });
    }
});
exports.deleteModuleItem = deleteModuleItem;
// ─── Permissions ──────────────────────────────────────────────────────────────
const getPermissions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { role, employeeId } = req.query;
        const where = {};
        if (role)
            where.role = String(role);
        if (employeeId)
            where.employeeId = Number(employeeId);
        const permissions = yield prismaClient_1.default.modulePermission.findMany({
            where,
            include: {
                module: { select: { name: true, label: true, icon: true, path: true } },
                moduleItem: { select: { name: true, label: true, path: true } },
                employee: { select: { name: true, employeeID: true } }
            },
            orderBy: { moduleId: "asc" }
        });
        res.json(permissions);
    }
    catch (error) {
        console.error("getPermissions error:", error);
        res.status(500).json({ message: "Failed to fetch permissions" });
    }
});
exports.getPermissions = getPermissions;
const setPermission = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { moduleId, moduleItemId, role, employeeId, canAccess } = req.body;
        if (!moduleId && !moduleItemId) {
            res.status(400).json({ message: "moduleId or moduleItemId is required" });
            return;
        }
        if (!role && !employeeId) {
            res.status(400).json({ message: "role or employeeId is required" });
            return;
        }
        const mId = moduleId ? Number(moduleId) : null;
        const miId = moduleItemId ? Number(moduleItemId) : null;
        const rStr = role ? String(role) : null;
        const eId = employeeId ? Number(employeeId) : null;
        const access = canAccess !== undefined ? Boolean(canAccess) : true;
        const existing = yield prismaClient_1.default.modulePermission.findFirst({
            where: { moduleId: mId, moduleItemId: miId, role: rStr, employeeId: eId }
        });
        const permission = existing
            ? yield prismaClient_1.default.modulePermission.update({ where: { id: existing.id }, data: { canAccess: access } })
            : yield prismaClient_1.default.modulePermission.create({
                data: { moduleId: mId !== null && mId !== void 0 ? mId : undefined, moduleItemId: miId !== null && miId !== void 0 ? miId : undefined, role: rStr !== null && rStr !== void 0 ? rStr : undefined, employeeId: eId !== null && eId !== void 0 ? eId : undefined, canAccess: access, createdById: (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeDbId }
            });
        res.json(permission);
    }
    catch (error) {
        console.error("setPermission error:", error);
        res.status(500).json({ message: "Failed to set permission" });
    }
});
exports.setPermission = setPermission;
const bulkSetPermissions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const { permissions } = req.body;
        if (!(permissions === null || permissions === void 0 ? void 0 : permissions.length)) {
            res.status(400).json({ message: "permissions array is required" });
            return;
        }
        // Determine the shared filter (all permissions in one bulk call share the same role/employee)
        const firstP = permissions[0];
        const sharedRole = (_a = firstP.role) !== null && _a !== void 0 ? _a : null;
        const sharedEmp = (_b = firstP.employeeId) !== null && _b !== void 0 ? _b : null;
        // 1 — Fetch all existing records for this role/employee in one query
        const existing = yield prismaClient_1.default.modulePermission.findMany({
            where: {
                role: sharedRole,
                employeeId: sharedEmp,
            },
            select: { id: true, moduleId: true, moduleItemId: true }
        });
        // Build a lookup map: "moduleId|moduleItemId" → existing record id
        const existingMap = new Map();
        for (const e of existing) {
            existingMap.set(`${(_c = e.moduleId) !== null && _c !== void 0 ? _c : ""}|${(_d = e.moduleItemId) !== null && _d !== void 0 ? _d : ""}`, e.id);
        }
        // 2 — Split into updates vs creates
        const toUpdate = [];
        const toCreate = [];
        for (const p of permissions) {
            const key = `${(_e = p.moduleId) !== null && _e !== void 0 ? _e : ""}|${(_f = p.moduleItemId) !== null && _f !== void 0 ? _f : ""}`;
            const existingId = existingMap.get(key);
            if (existingId !== undefined) {
                toUpdate.push({ id: existingId, canAccess: p.canAccess });
            }
            else {
                toCreate.push(p);
            }
        }
        // 3 — Run updates and creates in parallel
        yield Promise.all([
            ...toUpdate.map(u => prismaClient_1.default.modulePermission.update({ where: { id: u.id }, data: { canAccess: u.canAccess } })),
            ...toCreate.map(p => {
                var _a, _b, _c, _d, _e;
                return prismaClient_1.default.modulePermission.create({
                    data: {
                        moduleId: (_a = p.moduleId) !== null && _a !== void 0 ? _a : undefined,
                        moduleItemId: (_b = p.moduleItemId) !== null && _b !== void 0 ? _b : undefined,
                        role: (_c = p.role) !== null && _c !== void 0 ? _c : undefined,
                        employeeId: (_d = p.employeeId) !== null && _d !== void 0 ? _d : undefined,
                        canAccess: p.canAccess,
                        createdById: (_e = req.user) === null || _e === void 0 ? void 0 : _e.employeeDbId
                    }
                });
            })
        ]);
        res.json({ saved: permissions.length });
    }
    catch (error) {
        console.error("bulkSetPermissions error:", error);
        res.status(500).json({ message: "Failed to save permissions" });
    }
});
exports.bulkSetPermissions = bulkSetPermissions;
const deletePermission = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = parseInt(req.params.id);
        yield prismaClient_1.default.modulePermission.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        console.error("deletePermission error:", error);
        res.status(500).json({ message: "Failed to delete permission" });
    }
});
exports.deletePermission = deletePermission;
// ─── Get effective access for current user ────────────────────────────────────
const getMyAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        const { role: rawRole, employeeDbId } = req.user;
        // Normalize: treat "user" as "EXECUTIVE" for module access
        const role = rawRole === "user" ? "EXECUTIVE" : rawRole;
        // ADMIN gets everything
        if (role === "ADMIN") {
            const all = yield prismaClient_1.default.appModule.findMany({
                where: { isActive: true },
                include: { subItems: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
                orderBy: { sortOrder: "asc" }
            });
            res.json({ isAdmin: true, modules: all });
            return;
        }
        // Get role-level permissions
        const rolePerms = yield prismaClient_1.default.modulePermission.findMany({
            where: { role, canAccess: true },
            select: { moduleId: true, moduleItemId: true }
        });
        // Get employee-specific permissions (override)
        const employeePerms = yield prismaClient_1.default.modulePermission.findMany({
            where: { employeeId: employeeDbId },
            select: { moduleId: true, moduleItemId: true, canAccess: true }
        });
        // ── Employee overrides role completely ──────────────────────────────────
        // If employee has ANY permissions configured → use ONLY those (role ignored)
        // If no employee permissions → use role permissions
        // If neither → default allow all (open access)
        const hasEmployeePerms = employeePerms.length > 0;
        const activePerms = hasEmployeePerms ? employeePerms : rolePerms;
        if (activePerms.length === 0) {
            const all = yield prismaClient_1.default.appModule.findMany({
                where: { isActive: true },
                include: { subItems: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
                orderBy: { sortOrder: "asc" }
            });
            res.json({ isAdmin: false, modules: all, note: "no_permissions_configured" });
            return;
        }
        const allowedModuleIds = new Set();
        const allowedItemIds = new Set();
        activePerms.forEach(p => {
            if (p.canAccess === false)
                return;
            if (p.moduleId && !p.moduleItemId)
                allowedModuleIds.add(p.moduleId);
            if (p.moduleItemId)
                allowedItemIds.add(p.moduleItemId);
        });
        const finalModuleIds = [...allowedModuleIds];
        const finalItemIds = [...allowedItemIds];
        // If item-level permissions are configured, filter sub-items to only those IDs.
        // If NO item-level permissions exist, show all active sub-items of allowed modules
        // (module-level access = full access to all sub-items).
        const subItemsWhere = finalItemIds.length > 0
            ? { isActive: true, id: { in: finalItemIds } }
            : { isActive: true };
        const modules = yield prismaClient_1.default.appModule.findMany({
            where: { isActive: true, id: { in: finalModuleIds } },
            include: {
                subItems: { where: subItemsWhere, orderBy: { sortOrder: "asc" } }
            },
            orderBy: { sortOrder: "asc" }
        });
        res.json({ isAdmin: false, modules });
    }
    catch (error) {
        console.error("getMyAccess error:", error);
        res.status(500).json({ message: "Failed to get access" });
    }
});
exports.getMyAccess = getMyAccess;

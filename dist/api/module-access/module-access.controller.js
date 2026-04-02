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
exports.getMyAccess = exports.deletePermission = exports.bulkSetPermissions = exports.setPermission = exports.getPermissions = exports.deleteModuleItem = exports.updateModuleItem = exports.addModuleItem = exports.deleteModule = exports.updateModule = exports.createModule = exports.getAllModules = exports.seedDefaultModules = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
// ─── Seed default modules (call once to populate AppModule + AppModuleItem) ──
const seedDefaultModules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const defaults = [
            // { name: "dashboard",      label: "Dashboard",           icon: "pi pi-th-large",     path: "/dashboard",      sortOrder: 1,  items: [] },
            { name: "master-dashboard", label: "Dashboard", icon: "pi pi-chart-bar", path: "/master-dashboard", sortOrder: 2, items: [] },
            { name: "assets", label: "Assets Master", icon: "pi pi-database", path: "/assets", sortOrder: 3,
                items: [
                    { name: "view", label: "View Assets", path: "/assets/view", icon: "pi pi-eye", sortOrder: 1 },
                    { name: "create", label: "New Asset", path: "/assets/new", icon: "pi pi-plus", sortOrder: 2 },
                    { name: "edit", label: "Edit Asset", path: "/assets/edit", icon: "pi pi-pencil", sortOrder: 3 },
                    { name: "delete", label: "Delete Asset", path: null, icon: "pi pi-trash", sortOrder: 4 },
                    { name: "assignments", label: "Assignments", path: "/assets/assignments", icon: "pi pi-user", sortOrder: 5 },
                    { name: "transfer", label: "Transfer", path: "/transfer", icon: "pi pi-arrows-h", sortOrder: 6 },
                    { name: "import", label: "Import", path: "/import", icon: "pi pi-upload", sortOrder: 7 },
                ]
            },
            { name: "tickets", label: "Ticket for Repair", icon: "pi pi-wrench", path: "/ticket", sortOrder: 4,
                items: [
                    { name: "view", label: "View Tickets", path: "/ticket/view", icon: "pi pi-eye", sortOrder: 1 },
                    { name: "create", label: "New Ticket", path: "/ticket/new", icon: "pi pi-plus", sortOrder: 2 },
                    { name: "assign", label: "Assign Ticket", path: null, icon: "pi pi-user", sortOrder: 3 },
                ]
            },
            { name: "warranty", label: "Warranty & AMC", icon: "pi pi-shield", path: "/warranty", sortOrder: 5, items: [] },
            { name: "calibration", label: "Calibration", icon: "pi pi-sliders-h", path: "/calibration", sortOrder: 6, items: [] },
            { name: "gate-pass", label: "Gate Pass", icon: "pi pi-id-card", path: "/gate-pass", sortOrder: 7, items: [] },
            { name: "acknowledgement", label: "Acknowledgement", icon: "pi pi-check-square", path: "/acknowledgement", sortOrder: 8, items: [] },
            { name: "sla", label: "SLA Matrix", icon: "pi pi-clock", path: "/sla", sortOrder: 9, items: [] },
            { name: "escalation", label: "Escalation Matrix", icon: "pi pi-sort-alt", path: "/escalation", sortOrder: 10, items: [] },
            { name: "support-matrix", label: "Support Matrix", icon: "pi pi-users", path: "/support-matrix", sortOrder: 11, items: [] },
            { name: "inventory", label: "Inventory", icon: "pi pi-box", path: "/master", sortOrder: 12, items: [] },
            { name: "notifications", label: "Notifications", icon: "pi pi-bell", path: "/notifications", sortOrder: 13, items: [] },
            { name: "master-settings", label: "Master Settings", icon: "pi pi-cog", path: "/master-settings", sortOrder: 14, items: [] },
            { name: "module-access", label: "Module Access", icon: "pi pi-lock", path: "/module-access", sortOrder: 15, items: [] },
            { name: "financial-dashboard", label: "Financial Dashboard", icon: "pi pi-indian-rupee", path: "/financial-dashboard", sortOrder: 16, items: [] },
            { name: "reports", label: "Reports", icon: "pi pi-file", path: "/reports", sortOrder: 17, items: [] },
            { name: "disposal", label: "Asset Disposal", icon: "pi pi-trash", path: "/disposal", sortOrder: 18, items: [] },
            { name: "asset-audit", label: "Physical Audit", icon: "pi pi-clipboard", path: "/asset-audit", sortOrder: 19, items: [] },
            { name: "audit-trail", label: "Audit Trail", icon: "pi pi-history", path: "/audit-trail", sortOrder: 20, items: [] },
            { name: "warranty-management", label: "Warranty Management", icon: "pi pi-verified", path: "/warranty-management", sortOrder: 21, items: [] },
            { name: "insurance-management", label: "Insurance Management", icon: "pi pi-shield", path: "/insurance-management", sortOrder: 22, items: [] },
            { name: "service-contracts", label: "Service Contracts", icon: "pi pi-file-edit", path: "/service-contracts", sortOrder: 23, items: [] },
            { name: "document-vault", label: "Document Vault", icon: "pi pi-folder-open", path: "/document-vault", sortOrder: 24, items: [] },
            { name: "preventive-maintenance", label: "Preventive Maintenance", icon: "pi pi-calendar", path: "/preventive-maintenance", sortOrder: 25, items: [] },
            { name: "batch-depreciation", label: "Batch Depreciation", icon: "pi pi-chart-line", path: "/batch-depreciation", sortOrder: 26, items: [] },
            { name: "vendor-performance", label: "Vendor Performance", icon: "pi pi-star", path: "/vendor-performance", sortOrder: 27, items: [] },
            { name: "knowledge-base", label: "Knowledge Base", icon: "pi pi-book", path: "/knowledge-base", sortOrder: 28, items: [] },
            { name: "user-activity", label: "User Activity", icon: "pi pi-users", path: "/user-activity", sortOrder: 29, items: [] },
            { name: "notification-preferences", label: "Notification Preferences", icon: "pi pi-sliders-h", path: "/notification-preferences", sortOrder: 30, items: [] },
            { name: "settings", label: "Settings", icon: "pi pi-user-edit", path: "/settings", sortOrder: 31,
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
        const { role, employeeDbId } = req.user;
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
        // Build allowed moduleIds
        const allowedModuleIds = new Set();
        const blockedModuleIds = new Set();
        const allowedItemIds = new Set();
        const blockedItemIds = new Set();
        rolePerms.forEach(p => {
            if (p.moduleId && !p.moduleItemId)
                allowedModuleIds.add(p.moduleId);
            if (p.moduleItemId)
                allowedItemIds.add(p.moduleItemId);
        });
        employeePerms.forEach(p => {
            if (p.moduleId && !p.moduleItemId) {
                p.canAccess ? allowedModuleIds.add(p.moduleId) : blockedModuleIds.add(p.moduleId);
            }
            if (p.moduleItemId) {
                p.canAccess ? allowedItemIds.add(p.moduleItemId) : blockedItemIds.add(p.moduleItemId);
            }
        });
        // If no permissions configured at all — default allow all (open access)
        const totalPerms = rolePerms.length + employeePerms.length;
        if (totalPerms === 0) {
            const all = yield prismaClient_1.default.appModule.findMany({
                where: { isActive: true },
                include: { subItems: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
                orderBy: { sortOrder: "asc" }
            });
            res.json({ isAdmin: false, modules: all, note: "no_permissions_configured" });
            return;
        }
        const finalModuleIds = [...allowedModuleIds].filter(id => !blockedModuleIds.has(id));
        const finalItemIds = [...allowedItemIds].filter(id => !blockedItemIds.has(id));
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

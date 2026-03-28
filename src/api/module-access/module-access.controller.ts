import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── Seed default modules (call once to populate AppModule + AppModuleItem) ──
export const seedDefaultModules = async (req: Request, res: Response) => {
  try {
    const defaults = [
      // { name: "dashboard",      label: "Dashboard",           icon: "pi pi-th-large",     path: "/dashboard",      sortOrder: 1,  items: [] },
      { name: "master-dashboard", label: "Dashboard",  icon: "pi pi-chart-bar",    path: "/master-dashboard", sortOrder: 2, items: [] },
      { name: "assets",         label: "Assets Master",       icon: "pi pi-database",     path: "/assets",         sortOrder: 3,
        items: [
          { name: "view",        label: "View Assets",        path: "/assets/view",        icon: "pi pi-eye",       sortOrder: 1 },
          { name: "create",      label: "New Asset",          path: "/assets/new",         icon: "pi pi-plus",      sortOrder: 2 },
          { name: "edit",        label: "Edit Asset",         path: "/assets/edit",        icon: "pi pi-pencil",    sortOrder: 3 },
          { name: "delete",      label: "Delete Asset",       path: null,                  icon: "pi pi-trash",     sortOrder: 4 },
          { name: "assignments", label: "Assignments",        path: "/assets/assignments", icon: "pi pi-user",      sortOrder: 5 },
          { name: "transfer",    label: "Transfer",           path: "/transfer",           icon: "pi pi-arrows-h",  sortOrder: 6 },
          { name: "import",      label: "Import",             path: "/import",             icon: "pi pi-upload",    sortOrder: 7 },
        ]
      },
      { name: "tickets",        label: "Ticket for Repair",   icon: "pi pi-wrench",        path: "/ticket",         sortOrder: 4,
        items: [
          { name: "view",   label: "View Tickets",  path: "/ticket/view", icon: "pi pi-eye",  sortOrder: 1 },
          { name: "create", label: "New Ticket",    path: "/ticket/new",  icon: "pi pi-plus", sortOrder: 2 },
          { name: "assign", label: "Assign Ticket", path: null,           icon: "pi pi-user", sortOrder: 3 },
        ]
      },
      { name: "warranty",       label: "Warranty & AMC",      icon: "pi pi-shield",       path: "/warranty",       sortOrder: 5,  items: [] },
      { name: "calibration",    label: "Calibration",         icon: "pi pi-sliders-h",    path: "/calibration",    sortOrder: 6,  items: [] },
      { name: "gate-pass",      label: "Gate Pass",           icon: "pi pi-id-card",      path: "/gate-pass",      sortOrder: 7,  items: [] },
      { name: "acknowledgement",label: "Acknowledgement",     icon: "pi pi-check-square", path: "/acknowledgement",sortOrder: 8,  items: [] },
      { name: "sla",            label: "SLA Matrix",          icon: "pi pi-clock",        path: "/sla",            sortOrder: 9,  items: [] },
      { name: "escalation",     label: "Escalation Matrix",   icon: "pi pi-sort-alt",     path: "/escalation",     sortOrder: 10, items: [] },
      { name: "support-matrix", label: "Support Matrix",      icon: "pi pi-users",        path: "/support-matrix", sortOrder: 11, items: [] },
      { name: "inventory",      label: "Inventory",           icon: "pi pi-box",          path: "/master",         sortOrder: 12, items: [] },
      { name: "notifications",  label: "Notifications",       icon: "pi pi-bell",         path: "/notifications",  sortOrder: 13, items: [] },
      { name: "master-settings",label: "Master Settings",     icon: "pi pi-cog",          path: "/master-settings",sortOrder: 14, items: [] },
      { name: "module-access",  label: "Module Access",       icon: "pi pi-lock",         path: "/module-access",  sortOrder: 15, items: [] },
      { name: "settings", label: "Settings", icon: "pi pi-user-edit", path: "/settings", sortOrder: 16,
        items: [
          { name: "profile",           label: "Profile",           path: "/settings", icon: "pi pi-user",       sortOrder: 1 },
          { name: "reset-password",    label: "Reset Password",    path: "/settings", icon: "pi pi-lock",       sortOrder: 2 },
          { name: "user-creation",     label: "User Creation",     path: "/settings", icon: "pi pi-user-plus",  sortOrder: 3 },
          { name: "employee-creation", label: "Employee Creation", path: "/settings", icon: "pi pi-id-card",    sortOrder: 4 },
          { name: "table",             label: "Table",             path: "/settings", icon: "pi pi-table",      sortOrder: 5 },
          { name: "master-data",       label: "Master Data",       path: "/settings", icon: "pi pi-database",   sortOrder: 6 },
        ]
      },
    ];

    const created: string[] = [];

    for (const mod of defaults) {
      const existing = await prisma.appModule.findUnique({ where: { name: mod.name } });
      if (!existing) {
        await prisma.appModule.create({
          data: {
            name: mod.name,
            label: mod.label,
            icon: mod.icon,
            path: mod.path,
            sortOrder: mod.sortOrder,
            subItems: mod.items.length
              ? { create: mod.items.map(i => ({ name: i.name, label: i.label, path: i.path ?? undefined, icon: i.icon, sortOrder: i.sortOrder })) }
              : undefined
          }
        });
        created.push(mod.name);
      } else if (mod.items.length) {
        // Add any missing sub-items to an existing module
        for (const item of mod.items) {
          const existingItem = await prisma.appModuleItem.findUnique({
            where: { moduleId_name: { moduleId: existing.id, name: item.name } }
          });
          if (!existingItem) {
            await prisma.appModuleItem.create({
              data: { moduleId: existing.id, name: item.name, label: item.label, path: item.path ?? undefined, icon: item.icon, sortOrder: item.sortOrder }
            });
          }
        }
      }
    }

    res.json({ message: "Seed complete", created });
  } catch (error) {
    console.error("seedDefaultModules error:", error);
    res.status(500).json({ message: "Failed to seed modules" });
  }
};

// ─── App Modules CRUD ─────────────────────────────────────────────────────────
export const getAllModules = async (req: Request, res: Response) => {
  try {
    const modules = await prisma.appModule.findMany({
      include: { subItems: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" }
    });
    res.json(modules);
  } catch (error) {
    console.error("getAllModules error:", error);
    res.status(500).json({ message: "Failed to fetch modules" });
  }
};

export const createModule = async (req: Request, res: Response) => {
  try {
    const { name, label, icon, path, sortOrder } = req.body;
    if (!name || !label) {
      res.status(400).json({ message: "name and label are required" });
      return;
    }
    const module = await prisma.appModule.create({ data: { name, label, icon, path, sortOrder: sortOrder ?? 0 } });
    res.status(201).json(module);
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ message: "Module name already exists" });
      return;
    }
    console.error("createModule error:", error);
    res.status(500).json({ message: "Failed to create module" });
  }
};

export const updateModule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updated = await prisma.appModule.update({ where: { id }, data: req.body });
    res.json(updated);
  } catch (error) {
    console.error("updateModule error:", error);
    res.status(500).json({ message: "Failed to update module" });
  }
};

export const deleteModule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.modulePermission.deleteMany({ where: { moduleId: id } });
    await prisma.appModuleItem.deleteMany({ where: { moduleId: id } });
    await prisma.appModule.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteModule error:", error);
    res.status(500).json({ message: "Failed to delete module" });
  }
};

// ─── Module Items ─────────────────────────────────────────────────────────────
export const addModuleItem = async (req: Request, res: Response) => {
  try {
    const moduleId = parseInt(req.params.moduleId);
    const { name, label, path, icon, sortOrder } = req.body;
    if (!name || !label) {
      res.status(400).json({ message: "name and label are required" });
      return;
    }
    const item = await prisma.appModuleItem.create({ data: { moduleId, name, label, path, icon, sortOrder: sortOrder ?? 0 } });
    res.status(201).json(item);
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ message: "Item name already exists in this module" });
      return;
    }
    console.error("addModuleItem error:", error);
    res.status(500).json({ message: "Failed to add module item" });
  }
};

export const updateModuleItem = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.itemId);
    const updated = await prisma.appModuleItem.update({ where: { id }, data: req.body });
    res.json(updated);
  } catch (error) {
    console.error("updateModuleItem error:", error);
    res.status(500).json({ message: "Failed to update item" });
  }
};

export const deleteModuleItem = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.itemId);
    await prisma.modulePermission.deleteMany({ where: { moduleItemId: id } });
    await prisma.appModuleItem.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteModuleItem error:", error);
    res.status(500).json({ message: "Failed to delete item" });
  }
};

// ─── Permissions ──────────────────────────────────────────────────────────────
export const getPermissions = async (req: Request, res: Response) => {
  try {
    const { role, employeeId } = req.query;
    const where: any = {};
    if (role)       where.role       = String(role);
    if (employeeId) where.employeeId = Number(employeeId);

    const permissions = await prisma.modulePermission.findMany({
      where,
      include: {
        module:     { select: { name: true, label: true, icon: true, path: true } },
        moduleItem: { select: { name: true, label: true, path: true } },
        employee:   { select: { name: true, employeeID: true } }
      },
      orderBy: { moduleId: "asc" }
    });

    res.json(permissions);
  } catch (error) {
    console.error("getPermissions error:", error);
    res.status(500).json({ message: "Failed to fetch permissions" });
  }
};

export const setPermission = async (req: AuthenticatedRequest, res: Response) => {
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

    const mId   = moduleId     ? Number(moduleId)     : null;
    const miId  = moduleItemId ? Number(moduleItemId) : null;
    const rStr  = role         ? String(role)         : null;
    const eId   = employeeId   ? Number(employeeId)   : null;
    const access = canAccess !== undefined ? Boolean(canAccess) : true;

    const existing = await prisma.modulePermission.findFirst({
      where: { moduleId: mId, moduleItemId: miId, role: rStr, employeeId: eId }
    });

    const permission = existing
      ? await prisma.modulePermission.update({ where: { id: existing.id }, data: { canAccess: access } })
      : await prisma.modulePermission.create({
          data: { moduleId: mId ?? undefined, moduleItemId: miId ?? undefined, role: rStr ?? undefined, employeeId: eId ?? undefined, canAccess: access, createdById: req.user?.employeeDbId }
        });

    res.json(permission);
  } catch (error) {
    console.error("setPermission error:", error);
    res.status(500).json({ message: "Failed to set permission" });
  }
};

export const bulkSetPermissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { permissions } = req.body as {
      permissions: { moduleId?: number; moduleItemId?: number; role?: string; employeeId?: number; canAccess: boolean }[]
    };

    if (!permissions?.length) {
      res.status(400).json({ message: "permissions array is required" });
      return;
    }

    // Determine the shared filter (all permissions in one bulk call share the same role/employee)
    const firstP   = permissions[0];
    const sharedRole = firstP.role       ?? null;
    const sharedEmp  = firstP.employeeId ?? null;

    // 1 — Fetch all existing records for this role/employee in one query
    const existing = await prisma.modulePermission.findMany({
      where: {
        role:       sharedRole,
        employeeId: sharedEmp,
      },
      select: { id: true, moduleId: true, moduleItemId: true }
    });

    // Build a lookup map: "moduleId|moduleItemId" → existing record id
    const existingMap = new Map<string, number>();
    for (const e of existing) {
      existingMap.set(`${e.moduleId ?? ""}|${e.moduleItemId ?? ""}`, e.id);
    }

    // 2 — Split into updates vs creates
    const toUpdate: { id: number; canAccess: boolean }[] = [];
    const toCreate: typeof permissions = [];

    for (const p of permissions) {
      const key = `${p.moduleId ?? ""}|${p.moduleItemId ?? ""}`;
      const existingId = existingMap.get(key);
      if (existingId !== undefined) {
        toUpdate.push({ id: existingId, canAccess: p.canAccess });
      } else {
        toCreate.push(p);
      }
    }

    // 3 — Run updates and creates in parallel
    await Promise.all([
      ...toUpdate.map(u =>
        prisma.modulePermission.update({ where: { id: u.id }, data: { canAccess: u.canAccess } })
      ),
      ...toCreate.map(p =>
        prisma.modulePermission.create({
          data: {
            moduleId:     p.moduleId     ?? undefined,
            moduleItemId: p.moduleItemId ?? undefined,
            role:         p.role         ?? undefined,
            employeeId:   p.employeeId   ?? undefined,
            canAccess:    p.canAccess,
            createdById:  req.user?.employeeDbId
          }
        })
      )
    ]);

    res.json({ saved: permissions.length });
  } catch (error) {
    console.error("bulkSetPermissions error:", error);
    res.status(500).json({ message: "Failed to save permissions" });
  }
};

export const deletePermission = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.modulePermission.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deletePermission error:", error);
    res.status(500).json({ message: "Failed to delete permission" });
  }
};

// ─── Get effective access for current user ────────────────────────────────────
export const getMyAccess = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { role, employeeDbId } = req.user;

    // ADMIN gets everything
    if (role === "ADMIN") {
      const all = await prisma.appModule.findMany({
        where: { isActive: true },
        include: { subItems: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" }
      });
       res.json({ isAdmin: true, modules: all });
       return;
    }

    // Get role-level permissions
    const rolePerms = await prisma.modulePermission.findMany({
      where: { role, canAccess: true },
      select: { moduleId: true, moduleItemId: true }
    });

    // Get employee-specific permissions (override)
    const employeePerms = await prisma.modulePermission.findMany({
      where: { employeeId: employeeDbId },
      select: { moduleId: true, moduleItemId: true, canAccess: true }
    });

    // Build allowed moduleIds
    const allowedModuleIds = new Set<number>();
    const blockedModuleIds = new Set<number>();
    const allowedItemIds   = new Set<number>();
    const blockedItemIds   = new Set<number>();

    rolePerms.forEach(p => {
      if (p.moduleId && !p.moduleItemId) allowedModuleIds.add(p.moduleId);
      if (p.moduleItemId)               allowedItemIds.add(p.moduleItemId);
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
      const all = await prisma.appModule.findMany({
        where: { isActive: true },
        include: { subItems: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" }
      });
       res.json({ isAdmin: false, modules: all, note: "no_permissions_configured" });
       return;
    }

    const finalModuleIds = [...allowedModuleIds].filter(id => !blockedModuleIds.has(id));
    const finalItemIds   = [...allowedItemIds].filter(id => !blockedItemIds.has(id));

    // If item-level permissions are configured, filter sub-items to only those IDs.
    // If NO item-level permissions exist, show all active sub-items of allowed modules
    // (module-level access = full access to all sub-items).
    const subItemsWhere = finalItemIds.length > 0
      ? { isActive: true, id: { in: finalItemIds } }
      : { isActive: true };

    const modules = await prisma.appModule.findMany({
      where: { isActive: true, id: { in: finalModuleIds } },
      include: {
        subItems: { where: subItemsWhere, orderBy: { sortOrder: "asc" } }
      },
      orderBy: { sortOrder: "asc" }
    });

    res.json({ isAdmin: false, modules });
  } catch (error) {
    console.error("getMyAccess error:", error);
    res.status(500).json({ message: "Failed to get access" });
  }
};

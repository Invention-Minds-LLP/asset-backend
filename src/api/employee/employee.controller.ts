import { Request, Response } from "express";
import prisma from "../../prismaClient";
import {
  MAX_SCOPED_DEPARTMENTS,
  getConfiguredDepartmentIds,
  getResponsibleDepartments,
  hasBroadDepartmentAccess,
  setConfiguredDepartmentIds,
} from "../../utilis/departmentScopeHelper";

export const getAllEmployees = async (req: Request, res: Response) => {
  try {
    const { includeInactive, search, page, limit: lim, exportCsv } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
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
      const [total, employees] = await Promise.all([
        prisma.employee.count({ where }),
        prisma.employee.findMany({ where, include, orderBy: { name: "asc" }, skip, take }),
      ]);

      if (exportCsv === "true") {
        const csvRows = employees.map((e: any) => ({
          EmployeeID: e.employeeID, Name: e.name, Email: e.email || "",
          Phone: e.phone || "", Designation: e.designation || "",
          Department: e.department?.name || "", Role: e.role,
          ReportsTo: e.reportingTo?.name || "", Active: e.isActive ? "Yes" : "No",
        }));
        const headers = Object.keys(csvRows[0] || {}).join(",");
        const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=employees.csv");
        res.send(headers + "\n" + rows);
        return;
      }

      res.json({ data: employees, total, page: parseInt(String(page)), limit: take });
      return;
    }

    const employees = await prisma.employee.findMany({ where, include, orderBy: { name: "asc" } });
    res.json(employees);
  } catch (error) {
    console.error("getAllEmployees error:", error);
    res.status(500).json({ message: "Failed to fetch employees" });
  }
};

// Coerce + null-safe the subset of fields the create/edit form sends.
// Stops random body keys (e.g. departmentId === "") from blowing up Prisma.
function pickEmployeeFields(body: any) {
  const trim = (v: any) => {
    const s = String(v ?? '').trim();
    return s ? s : null;
  };
  return {
    name:          body.name ? String(body.name).trim() : undefined,
    employeeID:    body.employeeID ? String(body.employeeID).trim() : undefined,
    departmentId:  body.departmentId != null && body.departmentId !== '' ? Number(body.departmentId) : null,
    reportingToId: body.reportingToId != null && body.reportingToId !== '' ? Number(body.reportingToId) : null,
    role:          body.role || undefined,
    designation:   trim(body.designation),
    email:         trim(body.email),
    phone:         trim(body.phone),
    isActive:      typeof body.isActive === 'boolean' ? body.isActive : undefined,
    isOutsourced:  typeof body.isOutsourced === 'boolean' ? body.isOutsourced : undefined,
  };
}

// Outsourced staff carry an "OS-" prefix in front of their normal employee ID,
// so IM001 becomes OS-IM001. The base ID is kept intact rather than renumbered:
// it stays readable, and agency numbering survives.
const OS_PREFIX = 'OS-';
const hasOsPrefix = (id: string) => id.toUpperCase().startsWith(OS_PREFIX);

/**
 * Apply the prefix rule to a new employee.
 *
 * Enforced here, not just in the form: createEmployee takes whatever
 * employeeID is posted, so a direct API call would otherwise sidestep it.
 * Idempotent — an operator who types "OS-IM001" with the toggle on doesn't get
 * "OS-OS-IM001".
 *
 * Returns an error message instead of throwing so the caller can 400 cleanly.
 */
function applyOutsourcedPrefix(employeeID: string, isOutsourced: boolean): { id?: string; error?: string } {
  if (isOutsourced) {
    return { id: hasOsPrefix(employeeID) ? employeeID : `${OS_PREFIX}${employeeID}` };
  }
  // Guard the other direction too, so an in-house record can't be given an
  // outsourced-looking ID and quietly skew headcount the other way.
  if (hasOsPrefix(employeeID)) {
    return { error: `Employee ID "${employeeID}" starts with ${OS_PREFIX}, which is reserved for outsourced staff. Tick "Outsourced employee" or use a different ID.` };
  }
  return { id: employeeID };
}

export const createEmployee = async (req: Request, res: Response) => {
  try {
    const data = pickEmployeeFields(req.body);
    if (!data.name || !data.employeeID) {
      res.status(400).json({ message: 'name and employeeID are required' });
      return;
    }

    const isOutsourced = data.isOutsourced === true;
    const { id, error } = applyOutsourcedPrefix(data.employeeID, isOutsourced);
    if (error) { res.status(400).json({ message: error }); return; }
    data.employeeID = id;
    data.isOutsourced = isOutsourced;

    const employee = await prisma.employee.create({ data: data as any });
    res.status(201).json(employee);
  } catch (err: any) {
    console.error('createEmployee error:', err);
    res.status(500).json({ message: err.message || 'Failed to create employee' });
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    // Only update keys that were sent — partial-patch friendly
    const raw = pickEmployeeFields(req.body);
    const data: any = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== undefined) data[k] = v;
    }

    // Outsourced status is fixed at creation. The employeeID it pairs with is
    // immutable (User.employeeID FKs to it, so renaming orphans the login),
    // which means flipping the flag later would leave an "OS-" ID on someone
    // marked in-house, or the reverse. Existing staff are not reclassified —
    // deactivate and re-create instead.
    delete data.isOutsourced;
    const employee = await prisma.employee.update({
      where: { id },
      data,
      include: { department: true, reportingTo: { select: { name: true, employeeID: true } } },
    });
    res.json(employee);
  } catch (err: any) {
    console.error('updateEmployee error:', err);
    res.status(500).json({ message: err.message || 'Failed to update employee' });
  }
};

export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.employee.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Employee deactivated" });
  } catch (error) {
    console.error("deleteEmployee error:", error);
    res.status(500).json({ message: "Failed to deactivate employee" });
  }
};

export const getDepartmentNameByEmployeeID = async (req: Request, res: Response) => {
  const { employeeID } = req.params;

  try {
    const employee = await prisma.employee.findUnique({
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
  } catch (error) {
    console.error("Error fetching department by employeeID:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// GET /api/employees/:id/assets — all assets assigned to a specific employee
export const getEmployeeAssets = async (req: Request, res: Response) => {
  try {
    const empId = Number(req.params.id);

    const employee = await prisma.employee.findUnique({
      where: { id: empId },
      select: { id: true, name: true, employeeID: true, designation: true },
    });
    if (!employee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    // Show assets where the employee is either the allottee OR the supervisor.
    // Supervisor-only inclusion matters when an asset has no end-user (allottedToId is null)
    // — the supervisor still needs visibility for revenue logging, handover, status updates, etc.
    const assets = await prisma.asset.findMany({
      where: {
        AND: [
          { status: { notIn: ["DISPOSED", "CONDEMNED"] } },
          { OR: [
            { allottedToId: empId },
            { supervisorId: empId },
            { supervisors: { some: { employeeId: empId, isActive: true } } },
          ] },
        ],
      },
      include: {
        assetCategory: { select: { id: true, name: true } },
        department:    { select: { id: true, name: true } },
        allottedTo:    { select: { id: true, name: true, employeeID: true } },
        supervisor:    { select: { id: true, name: true, employeeID: true } },
        supervisors:   { where: { isActive: true }, select: { employeeId: true } },
      },
      orderBy: { assetName: "asc" },
    });

    // Tag each row with the employee's relationship to the asset so the UI can show it.
    const tagged = assets.map(a => ({
      ...a,
      myRole: a.allottedToId === empId
        ? "ALLOTTEE"
        : (a.supervisorId === empId || (a.supervisors || []).some((s: any) => s.employeeId === empId))
          ? "SUPERVISOR"
          : "OTHER",
    }));

    res.json({ employee, totalAssets: tagged.length, assets: tagged });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch employee assets" });
  }
};

// ── Department responsibility ────────────────────────────────────────────────
// One HOD can answer for several departments. See utilis/departmentScopeHelper
// for where that list is held and how it is derived.

// GET /api/employees/my-departments — what the caller is responsible for.
export const getMyDepartments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const departments = await getResponsibleDepartments(user);
    res.json({
      departments,
      primaryDepartmentId: departments.find((d) => d.isPrimary)?.id ?? null,
      // Broad-access roles see every department anyway, so the switcher these
      // feed should offer the full list instead of this one.
      hasBroadAccess: hasBroadDepartmentAccess(user),
    });
  } catch (e: any) {
    console.error("getMyDepartments error:", e);
    res.status(500).json({ message: e.message || "Failed to load departments" });
  }
};

function isAdmin(user: any): boolean {
  return ["ADMIN", "CEO_COO", "OPERATIONS"].includes((user?.role || "").toUpperCase());
}

// GET /api/employees/:id/departments — the granted list, for the admin screen.
export const getEmployeeDepartments = async (req: Request, res: Response) => {
  try {
    if (!isAdmin((req as any).user)) { res.status(403).json({ message: "Admin only" }); return; }
    const id = Number(req.params.id);
    const employee = await prisma.employee.findUnique({
      where: { id },
      select: { id: true, name: true, employeeID: true, role: true, departmentId: true },
    });
    if (!employee) { res.status(404).json({ message: "Employee not found" }); return; }

    const granted = await getConfiguredDepartmentIds(id);
    res.json({
      employee,
      primaryDepartmentId: employee.departmentId,
      // The primary department is implicit and cannot be revoked here.
      departmentIds: granted.filter((d) => d !== employee.departmentId),
      maxDepartments: MAX_SCOPED_DEPARTMENTS,
    });
  } catch (e: any) {
    console.error("getEmployeeDepartments error:", e);
    res.status(500).json({ message: e.message || "Failed to load departments" });
  }
};

// PUT /api/employees/:id/departments — body { departmentIds: number[] }.
export const setEmployeeDepartments = async (req: Request, res: Response) => {
  try {
    if (!isAdmin((req as any).user)) { res.status(403).json({ message: "Admin only" }); return; }
    const id = Number(req.params.id);
    const requested: unknown[] | null = Array.isArray(req.body?.departmentIds) ? req.body.departmentIds : null;
    if (!requested) { res.status(400).json({ message: "departmentIds must be an array" }); return; }

    const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true, departmentId: true } });
    if (!employee) { res.status(404).json({ message: "Employee not found" }); return; }

    const wanted: number[] = [...new Set(requested.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
      .filter((d) => d !== employee.departmentId);
    if (wanted.length > MAX_SCOPED_DEPARTMENTS) {
      res.status(400).json({ message: `At most ${MAX_SCOPED_DEPARTMENTS} extra departments` });
      return;
    }

    const existing = await prisma.department.findMany({ where: { id: { in: wanted } }, select: { id: true } });
    if (existing.length !== wanted.length) {
      res.status(400).json({ message: "One or more departments do not exist" });
      return;
    }

    const saved = await setConfiguredDepartmentIds(id, wanted);
    res.json({ employeeId: id, departmentIds: saved });
  } catch (e: any) {
    console.error("setEmployeeDepartments error:", e);
    res.status(500).json({ message: e.message || "Failed to save departments" });
  }
};

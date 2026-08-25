import prisma from "../prismaClient";

/**
 * WHICH DEPARTMENTS ONE PERSON ANSWERS FOR
 *
 * Employee.departmentId is a single FK — the department someone belongs to.
 * Responsibility is wider than membership: one HOD can run several departments
 * at once. An asset still sits in exactly one of them, so the scope stays a
 * plain "departmentId IN (...)" and no asset is ever shared between two HODs.
 *
 * The extra departments live in one TenantConfig row per employee rather than a
 * new column, so anyone without a row scopes exactly as they did before this
 * existed.
 *
 * Supervisors need no configuration at all — the assets they supervise already
 * name the departments they answer for.
 */

/** TenantConfig row holding an employee's extra departments. Value is "3,7,12". */
export const deptScopeKey = (employeeId: number) => `DEPT_SCOPE_EMP_${employeeId}`;
export const DEPT_SCOPE_GROUP = "ACCESS";

/**
 * TenantConfig.value is a VARCHAR(191). At up to five digits plus a comma per
 * id, this cap keeps the joined string comfortably inside it.
 */
export const MAX_SCOPED_DEPARTMENTS = 30;

/** Roles that already see every department, so scoping never applies to them. */
const BROAD_ROLES = ["ADMIN", "CEO_COO", "OPERATIONS", "FINANCE", "CFO"];

export interface ScopeUser {
  id?: number;
  employeeDbId?: number;
  departmentId?: number | string | null;
  role?: string;
  /** Employee.role — resolved per request by authMiddleware, may be undefined. */
  employeeRole?: string;
}

export interface ResponsibleDepartment {
  id: number;
  name: string;
  code: string | null;
  isPrimary: boolean;
}

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function employeeIdOf(user: ScopeUser): number | null {
  return positiveInt(user?.employeeDbId ?? user?.id);
}

function primaryDeptOf(user: ScopeUser): number | null {
  return positiveInt(user?.departmentId);
}

function isSupervisor(user: ScopeUser): boolean {
  return [user?.employeeRole, user?.role].some((r) => (r || "").toUpperCase() === "SUPERVISOR");
}

function parseIds(value?: string | null): number[] {
  return String(value ?? "")
    .split(",")
    .map((part) => positiveInt(part))
    .filter((n): n is number => n !== null);
}

export function hasBroadDepartmentAccess(user: ScopeUser): boolean {
  return BROAD_ROLES.includes((user?.role || "").toUpperCase());
}

/** The extra departments an admin has granted this employee. */
export async function getConfiguredDepartmentIds(employeeId: number): Promise<number[]> {
  const row = await prisma.tenantConfig.findUnique({ where: { key: deptScopeKey(employeeId) } });
  return parseIds(row?.value);
}

/**
 * Replaces the granted list. An empty list drops the row entirely, so an
 * employee reverts to their primary department alone.
 */
export async function setConfiguredDepartmentIds(
  employeeId: number,
  departmentIds: unknown[]
): Promise<number[]> {
  const clean = [...new Set(departmentIds.map(positiveInt).filter((n): n is number => n !== null))];
  const key = deptScopeKey(employeeId);

  if (clean.length === 0) {
    await prisma.tenantConfig.deleteMany({ where: { key } });
    return [];
  }

  const value = clean.join(",");
  await prisma.tenantConfig.upsert({
    where: { key },
    create: { key, value, group: DEPT_SCOPE_GROUP, label: `Departments for employee ${employeeId}` },
    update: { value, group: DEPT_SCOPE_GROUP },
  });
  return clean;
}

/** Departments named by the assets this supervisor is responsible for. */
async function getSupervisedDepartmentIds(employeeId: number): Promise<number[]> {
  const rows = await prisma.asset.findMany({
    where: {
      departmentId: { not: null },
      OR: [
        { supervisorId: employeeId },
        { supervisors: { some: { employeeId, isActive: true } } },
      ],
    },
    select: { departmentId: true },
    distinct: ["departmentId"],
  });
  return rows.map((r) => r.departmentId).filter((id): id is number => id !== null);
}

/**
 * Every department this user answers for, primary first. Always includes the
 * primary department, so an unconfigured user scopes to exactly one id and
 * behaves as before.
 *
 * `includeSupervised` covers the derived half. Leave it on for anything that
 * only lists departments (the switcher, a dashboard picker). Turn it off where
 * the ids become a data filter — a supervisor's asset list is already scoped
 * asset-by-asset, and folding their departments in would hand them every other
 * asset parked in those departments.
 */
export async function getResponsibleDepartmentIds(
  user: ScopeUser,
  opts: { includeSupervised?: boolean } = {}
): Promise<number[]> {
  const { includeSupervised = true } = opts;
  const ids: number[] = [];

  const primary = primaryDeptOf(user);
  if (primary) ids.push(primary);

  const employeeId = employeeIdOf(user);
  if (employeeId) {
    ids.push(...(await getConfiguredDepartmentIds(employeeId)));
    // Derived, not granted: a supervisor's departments follow their assets.
    if (includeSupervised && isSupervisor(user)) {
      ids.push(...(await getSupervisedDepartmentIds(employeeId)));
    }
  }

  return [...new Set(ids)];
}

/** The same set, named — this is what the department switcher renders. */
export async function getResponsibleDepartments(user: ScopeUser): Promise<ResponsibleDepartment[]> {
  const ids = await getResponsibleDepartmentIds(user);
  if (ids.length === 0) return [];

  const primary = primaryDeptOf(user);
  const departments = await prisma.department.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true },
  });

  // Deactivated departments are kept: their assets still exist, and hiding a
  // department someone is accountable for is worse than showing a stale one.
  return departments
    .map((d) => ({ ...d, isPrimary: d.id === primary }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
}

/**
 * Which department a dashboard request should render. A broad-access role may
 * ask for any department; everyone else is held to the ones they answer for, so
 * a hand-edited query string cannot widen anyone's view.
 */
export async function resolveDashboardDepartment(
  user: ScopeUser,
  requested: unknown
): Promise<{ departmentId: number | null; departmentIds: number[]; forbidden: boolean }> {
  const wants = positiveInt(requested);

  if (hasBroadDepartmentAccess(user)) {
    return { departmentId: wants ?? primaryDeptOf(user), departmentIds: [], forbidden: false };
  }

  const departmentIds = await getResponsibleDepartmentIds(user);
  if (wants && !departmentIds.includes(wants)) {
    return { departmentId: null, departmentIds, forbidden: true };
  }
  return { departmentId: wants ?? departmentIds[0] ?? null, departmentIds, forbidden: false };
}

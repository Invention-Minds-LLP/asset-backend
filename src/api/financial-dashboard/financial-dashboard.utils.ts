// ─── Financial Year Helpers ──────────────────────────────────────────────────

export const INDIAN_FY_QUARTERS: Record<string, number[]> = {
  Q1: [4, 5, 6],
  Q2: [7, 8, 9],
  Q3: [10, 11, 12],
  Q4: [1, 2, 3],
};

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Returns the FY start year for a given date (April-March). e.g. Jan 2026 -> 2025, May 2025 -> 2025 */
export function getFYForDate(date: Date): number {
  const m = date.getMonth() + 1; // 1-12
  const y = date.getFullYear();
  return m >= 4 ? y : y - 1;
}

/** Returns start/end dates for a given FY start year. e.g. 2025 -> Apr 1 2025 to Apr 1 2026 */
export function getFYDateRange(fyStartYear: number): { start: Date; end: Date } {
  return {
    start: new Date(`${fyStartYear}-04-01T00:00:00.000Z`),
    end: new Date(`${fyStartYear + 1}-04-01T00:00:00.000Z`),
  };
}

/** Returns FY label like "2025-26" */
export function getFYLabel(fyStartYear: number): string {
  return `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;
}

/** Returns quarter label for a given month (1-12) */
export function getQuarterForMonth(month: number): string {
  for (const [q, months] of Object.entries(INDIAN_FY_QUARTERS)) {
    if (months.includes(month)) return q;
  }
  return "Q1";
}

/** Returns the quarter display label like "Apr-Jun 2025" */
export function getQuarterLabel(quarter: string, fyStartYear: number): string {
  const map: Record<string, string> = {
    Q1: `Apr-Jun ${fyStartYear}`,
    Q2: `Jul-Sep ${fyStartYear}`,
    Q3: `Oct-Dec ${fyStartYear}`,
    Q4: `Jan-Mar ${fyStartYear + 1}`,
  };
  return map[quarter] || quarter;
}

// ─── Role-based Filter Builder ──────────────────────────────────────────────

export function buildRoleFilter(user: any): any {
  const role = user?.role;
  const departmentId = user?.departmentId;
  const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;

  if (role === "HOD") return { departmentId: Number(departmentId) };
  if (role === "SUPERVISOR") return { supervisorId: Number(employeeDbId) };
  return {}; // ADMIN and others see everything
}

/** Build a Prisma where clause for assets from query + role */
export function buildAssetWhere(query: any, user: any): any {
  const where: any = { ...buildRoleFilter(user) };

  if (query.departmentId) where.departmentId = Number(query.departmentId);
  if (query.categoryId) where.assetCategoryId = Number(query.categoryId);
  if (query.vendorId) where.vendorId = Number(query.vendorId);
  if (query.status) where.status = query.status;
  if (query.modeOfProcurement) where.modeOfProcurement = query.modeOfProcurement;

  // Date filtering: FY range or custom dates
  if (query.fyStart) {
    const startRange = getFYDateRange(Number(query.fyStart));
    const endRange = query.fyEnd
      ? getFYDateRange(Number(query.fyEnd))
      : startRange;
    where.purchaseDate = { gte: startRange.start, lt: endRange.end };
  } else if (query.dateFrom || query.dateTo) {
    where.purchaseDate = {};
    if (query.dateFrom) where.purchaseDate.gte = new Date(query.dateFrom);
    if (query.dateTo) where.purchaseDate.lte = new Date(query.dateTo);
  }

  return where;
}

/** Build SQL WHERE fragments for raw queries (returns [clause, params]) */
export function buildRawWhereClause(query: any, user: any): { clause: string; params: any[] } {
  const conditions: string[] = ["a.purchaseDate IS NOT NULL"];
  const params: any[] = [];

  // Role filter
  const role = user?.role;
  if (role === "HOD" && user?.departmentId) {
    conditions.push("a.departmentId = ?");
    params.push(Number(user.departmentId));
  } else if (role === "SUPERVISOR") {
    const empId = user?.employeeDbId || user?.employeeId || user?.id;
    conditions.push("a.supervisorId = ?");
    params.push(Number(empId));
  }

  // User filters
  if (query.departmentId) { conditions.push("a.departmentId = ?"); params.push(Number(query.departmentId)); }
  if (query.categoryId) { conditions.push("a.assetCategoryId = ?"); params.push(Number(query.categoryId)); }
  if (query.vendorId) { conditions.push("a.vendorId = ?"); params.push(Number(query.vendorId)); }
  if (query.status) { conditions.push("a.status = ?"); params.push(query.status); }
  if (query.modeOfProcurement) { conditions.push("a.modeOfProcurement = ?"); params.push(query.modeOfProcurement); }

  if (query.fyStart) {
    const startRange = getFYDateRange(Number(query.fyStart));
    const endRange = query.fyEnd ? getFYDateRange(Number(query.fyEnd)) : startRange;
    conditions.push("a.purchaseDate >= ? AND a.purchaseDate < ?");
    params.push(startRange.start, endRange.end);
  } else if (query.dateFrom || query.dateTo) {
    if (query.dateFrom) { conditions.push("a.purchaseDate >= ?"); params.push(new Date(query.dateFrom)); }
    if (query.dateTo) { conditions.push("a.purchaseDate <= ?"); params.push(new Date(query.dateTo)); }
  }

  return { clause: conditions.join(" AND "), params };
}

// ─── Tree Builder ───────────────────────────────────────────────────────────

interface MonthlyRow {
  yr: number;
  mo: number;
  total: number;
  assetCount: number;
}

export interface MonthNode {
  month: number;
  year: number;
  label: string;
  total: number;
  assetCount: number;
}

export interface QuarterNode {
  quarter: string;
  label: string;
  total: number;
  assetCount: number;
  months: MonthNode[];
}

export interface FYNode {
  fy: string;
  fyStartYear: number;
  total: number;
  assetCount: number;
  quarters: QuarterNode[];
}

/** Transform flat monthly rows into nested FY > Quarter > Month tree */
export function buildFYTree(rows: MonthlyRow[]): FYNode[] {
  // Group by FY
  const fyMap = new Map<number, MonthlyRow[]>();
  for (const row of rows) {
    const fyYear = row.mo >= 4 ? row.yr : row.yr - 1;
    if (!fyMap.has(fyYear)) fyMap.set(fyYear, []);
    fyMap.get(fyYear)!.push(row);
  }

  const tree: FYNode[] = [];

  // Sort FY years descending (most recent first)
  const sortedYears = [...fyMap.keys()].sort((a, b) => b - a);

  for (const fyYear of sortedYears) {
    const fyRows = fyMap.get(fyYear)!;
    let fyTotal = 0;
    let fyCount = 0;

    // Build quarters
    const quarterMap = new Map<string, MonthlyRow[]>();
    for (const row of fyRows) {
      const q = getQuarterForMonth(row.mo);
      if (!quarterMap.has(q)) quarterMap.set(q, []);
      quarterMap.get(q)!.push(row);
    }

    const quarters: QuarterNode[] = [];
    for (const qKey of ["Q1", "Q2", "Q3", "Q4"]) {
      const qRows = quarterMap.get(qKey) || [];
      let qTotal = 0;
      let qCount = 0;

      const months: MonthNode[] = [];
      const qMonths = INDIAN_FY_QUARTERS[qKey];

      for (const mo of qMonths) {
        const yr = mo >= 4 ? fyYear : fyYear + 1;
        const matched = qRows.find((r) => r.mo === mo && r.yr === yr);
        const total = matched?.total || 0;
        const count = matched?.assetCount || 0;

        months.push({
          month: mo,
          year: yr,
          label: `${MONTH_NAMES[mo]} ${yr}`,
          total,
          assetCount: count,
        });

        qTotal += total;
        qCount += count;
      }

      quarters.push({
        quarter: qKey,
        label: getQuarterLabel(qKey, fyYear),
        total: qTotal,
        assetCount: qCount,
        months,
      });

      fyTotal += qTotal;
      fyCount += qCount;
    }

    tree.push({
      fy: getFYLabel(fyYear),
      fyStartYear: fyYear,
      total: fyTotal,
      assetCount: fyCount,
      quarters,
    });
  }

  return tree;
}

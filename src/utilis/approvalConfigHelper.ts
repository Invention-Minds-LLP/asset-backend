import prisma from "../prismaClient";

/**
 * Approval level names used across PO / WO workflow chains.
 * These are stored as `roleName` in the ApprovalConfig table and
 * correspond to the approval chain keys in each controller.
 */
export type ApprovalLevelKey = "HOD" | "MANAGEMENT" | "COO" | "CFO";

/** Fallback thresholds when no ApprovalConfig rows exist for a module */
const FALLBACK: { roleName: ApprovalLevelKey; minAmount: number; maxAmount: number | null }[] = [
  { roleName: "HOD",        minAmount: 0,         maxAmount: 100_000 },
  { roleName: "MANAGEMENT", minAmount: 100_001,   maxAmount: 500_000 },
  { roleName: "COO",        minAmount: 500_001,   maxAmount: 2_000_000 },
  { roleName: "CFO",        minAmount: 2_000_001, maxAmount: null },
];

/**
 * Returns the approval level key ("HOD" | "MANAGEMENT" | "COO" | "CFO")
 * required for the given module and amount.
 * Reads live from ApprovalConfig table; falls back to hardcoded defaults.
 */
export async function getRequiredApprovalLevel(module: string, amount: number): Promise<ApprovalLevelKey> {
  const configs = await prisma.approvalConfig.findMany({
    where: { module, isActive: true },
    orderBy: { level: "asc" },
  });

  const levels = configs.length > 0
    ? configs.map((c) => ({
        roleName: c.roleName as ApprovalLevelKey,
        minAmount: Number(c.minAmount),
        maxAmount: c.maxAmount != null ? Number(c.maxAmount) : null,
      }))
    : FALLBACK;

  const matched = levels.find((c) => {
    const max = c.maxAmount != null ? c.maxAmount : Infinity;
    return amount >= c.minAmount && amount <= max;
  });

  return (matched ?? levels[levels.length - 1]).roleName;
}

/**
 * Employee roles that have authority to approve at each level.
 * Any role listed can act on behalf of that level or higher.
 * e.g. a CEO_COO can approve HOD, MANAGEMENT, or COO level items.
 */
export const APPROVAL_AUTHORITY: Record<ApprovalLevelKey, string[]> = {
  HOD:        ["HOD", "FINANCE", "CEO_COO", "ADMIN"],
  MANAGEMENT: ["FINANCE", "CEO_COO", "ADMIN"],
  COO:        ["CEO_COO", "ADMIN"],
  CFO:        ["ADMIN"],
};

/**
 * Returns true if the given employee role can approve at the required level.
 */
export function canApproveAtLevel(employeeRole: string, requiredLevel: ApprovalLevelKey): boolean {
  return (APPROVAL_AUTHORITY[requiredLevel] ?? ["ADMIN"]).includes(employeeRole);
}

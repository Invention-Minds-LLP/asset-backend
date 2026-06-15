import prisma from "../prismaClient";

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

type IdentifierEntry = {
  type: "EMPLOYEE_ID" | "EMAIL";
  value: string;
  fullName?: string | null;
  isActive?: boolean;
};

const isConfigured = () => !!(DIRECTORY_URL && DIRECTORY_API_KEY);

async function post(path: string, body: any): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const resp = await fetch(`${DIRECTORY_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-key": DIRECTORY_API_KEY as string },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: data?.error || `HTTP ${resp.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "unknown error" };
  }
}

// Upsert a single Employee ID → this tenant. Call after creating/updating a user.
export async function syncEmployeeIdentifier(
  employeeID: string,
  fullName?: string | null,
  isActive = true
): Promise<void> {
  if (!isConfigured() || !employeeID) return;
  const res = await post("/api/directory/sync/identifier/upsert", {
    product: PRODUCT,
    type: "EMPLOYEE_ID",
    value: employeeID,
    fullName: fullName ?? null,
    isActive,
  });
  if (!res.ok) console.error("[directory] employee upsert failed:", res.error);
}

// Upsert a single external-auditor email → this tenant.
export async function syncExternalAuditorIdentifier(
  email: string,
  fullName?: string | null,
  isActive = true
): Promise<void> {
  if (!isConfigured() || !email) return;
  const res = await post("/api/directory/sync/identifier/upsert", {
    product: PRODUCT,
    type: "EMAIL",
    value: email,
    fullName: fullName ?? null,
    isActive,
  });
  if (!res.ok) console.error("[directory] external auditor upsert failed:", res.error);
}

// Bulk push every active employee (EMPLOYEE_ID) + external auditor (EMAIL).
// Safe to run nightly; the directory upserts so re-runs are idempotent.
export async function syncAllToDirectory(): Promise<{ ok: boolean; result?: any; error?: string }> {
  if (!isConfigured()) return { ok: false, error: "directory not configured" };

  const [employees, auditors] = await Promise.all([
    prisma.employee.findMany({ select: { employeeID: true, name: true, isActive: true } }),
    prisma.externalAuditor.findMany({ select: { email: true, name: true, status: true } }),
  ]);

  const entries: IdentifierEntry[] = [
    ...employees
      .filter((e) => e.employeeID)
      .map((e) => ({ type: "EMPLOYEE_ID" as const, value: e.employeeID, fullName: e.name, isActive: e.isActive })),
    ...auditors
      .filter((a) => a.email)
      .map((a) => ({ type: "EMAIL" as const, value: a.email, fullName: a.name, isActive: a.status === "ACTIVE" })),
  ];

  const res = await post("/api/directory/sync/identifier/bulk", { product: PRODUCT, entries });
  if (!res.ok) {
    console.error("[directory] bulk sync failed:", res.error);
    return { ok: false, error: res.error };
  }
  return { ok: true, result: res.data };
}

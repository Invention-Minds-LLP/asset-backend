/**
 * Give an HOD the security-supervisor console as well as their normal HOD access.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The obvious move — setting User.role = "SECURITY" — breaks the HOD half:
 * denySecurityApproval returns 403 on approve/reject for any SECURITY account,
 * so they would lose every approval they are supposed to make.
 *
 * It isn't needed either. requireSecuritySupervisor is a DENY guard: it only
 * blocks accounts where User.role === "SECURITY" and the employee role is not
 * SUPERVISOR. A non-security account passes straight through, so an HOD can
 * already call gate-out, gate-in, security-queue and history. Nothing in the
 * security flow is department-scoped, so they do not need to sit in the Security
 * department either.
 *
 * The only thing actually missing is the MENU ITEM: gate-pass-security is
 * explicitly false for role=HOD, so the console is hidden.
 *
 * THE TRAP THIS SCRIPT AVOIDS
 * ---------------------------
 * Employee-level permissions REPLACE role permissions outright (see
 * module-access.controller.ts → "Employee overrides role completely"). Adding a
 * single employee row for the console would strip every other HOD grant and
 * leave them with nothing but the security screen — which is exactly what
 * happened to an earlier account here.
 *
 * So this copies the whole role=HOD grant set down to employee level first, then
 * adds the console on top. Granting the console to role=HOD instead would hand
 * it to EVERY HOD, which is not the intent.
 *
 * USAGE
 *   # list candidates
 *   npx ts-node --transpile-only prisma/grantSecuritySupervisorToHod.ts
 *
 *   # dry run for one person (shows every row it would write, changes nothing)
 *   npx ts-node --transpile-only prisma/grantSecuritySupervisorToHod.ts --employee=IM001
 *
 *   # apply it
 *   npx ts-node --transpile-only prisma/grantSecuritySupervisorToHod.ts --employee=IM001 --apply
 *
 *   # also give them the label-printing queue
 *   npx ts-node --transpile-only prisma/grantSecuritySupervisorToHod.ts --employee=IM001 --with-label-queue --apply
 *
 * Idempotent: re-running only fills in what is missing.
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const SECURITY_ITEM = "gate-pass-security";
const LABEL_ITEM = "gate-pass-print-queue";

async function listCandidates() {
  const hods = await prisma.employee.findMany({
    where: { role: "HOD", isActive: true },
    select: {
      id: true, name: true, employeeID: true,
      department: { select: { name: true } },
      user: { select: { username: true, role: true } },
    },
    orderBy: { name: "asc" },
  });
  console.log("HODs who could take on the security-supervisor console:\n");
  for (const h of hods) {
    const login = h.user ? `${h.user.username} (User.role=${h.user.role})` : "NO LOGIN — create a user first";
    console.log(`  --employee=${h.employeeID.padEnd(12)} ${h.name.padEnd(20)} dept=${(h.department?.name ?? "—").padEnd(16)} ${login}`);
  }
  console.log("\nRe-run with --employee=<employeeID> to see exactly what would change.");
}

async function main() {
  const who = arg("employee");
  if (!who) { await listCandidates(); return; }

  const apply = flag("apply");
  const withLabel = flag("with-label-queue");

  const emp = await prisma.employee.findFirst({
    where: { employeeID: who },
    select: {
      id: true, name: true, employeeID: true, role: true,
      department: { select: { name: true } },
      user: { select: { username: true, role: true } },
    },
  });
  if (!emp) { console.log(`No employee with employeeID "${who}".`); return; }

  console.log(`Target: ${emp.name} (${emp.employeeID})`);
  console.log(`  department   : ${emp.department?.name ?? "—"}   (unchanged — security work is not department-scoped)`);
  console.log(`  Employee.role: ${emp.role}   (must stay HOD so approval routing still works)`);
  console.log(`  User.role    : ${emp.user?.role ?? "NO LOGIN"}   (must NOT be SECURITY, or approvals break)\n`);

  if (!emp.user) { console.log("This employee has no login. Create the user first, then re-run."); return; }
  if (emp.user.role === "SECURITY") {
    console.log("STOP: User.role is SECURITY. denySecurityApproval will block their approvals.");
    console.log("      Set User.role back to HOD before running this.");
    return;
  }
  if (emp.role !== "HOD") {
    console.log(`WARNING: Employee.role is ${emp.role}, not HOD. This script is written for an HOD.`);
  }

  // What role=HOD currently grants — the set that an employee override would
  // otherwise wipe out.
  const roleGrants = await prisma.modulePermission.findMany({
    where: { role: "HOD", canAccess: true },
    select: { moduleId: true, moduleItemId: true },
  });

  const items = await prisma.appModuleItem.findMany({
    where: { name: { in: withLabel ? [SECURITY_ITEM, LABEL_ITEM] : [SECURITY_ITEM] } },
    select: { id: true, name: true, path: true },
  });
  if (items.length === 0) {
    console.log(`Could not find the ${SECURITY_ITEM} module item — run the module seed first.`);
    return;
  }

  const existing = await prisma.modulePermission.findMany({
    where: { employeeId: emp.id },
    select: { moduleId: true, moduleItemId: true, canAccess: true },
  });
  const seen = new Set(existing.map((e) => `${e.moduleId ?? "-"}|${e.moduleItemId ?? "-"}`));

  const wanted = [
    ...roleGrants.map((g) => ({ moduleId: g.moduleId, moduleItemId: g.moduleItemId, why: "copied from role=HOD" })),
    ...items.map((i) => ({ moduleId: null as number | null, moduleItemId: i.id, why: `security work → ${i.path}` })),
  ];

  const toCreate = wanted.filter((w) => !seen.has(`${w.moduleId ?? "-"}|${w.moduleItemId ?? "-"}`));
  const toFix = existing.filter(
    (e) => e.canAccess === false && items.some((i) => i.id === e.moduleItemId)
  );

  console.log(`role=HOD grants to mirror : ${roleGrants.length}`);
  console.log(`already on this employee  : ${existing.length}`);
  console.log(`rows to create            : ${toCreate.length}`);
  console.log(`existing rows to flip true: ${toFix.length}`);
  console.log(`security items granted    : ${items.map((i) => i.name).join(", ")}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to make these changes.");
    return;
  }

  for (const w of toCreate) {
    await prisma.modulePermission.create({
      data: {
        moduleId: w.moduleId ?? undefined,
        moduleItemId: w.moduleItemId ?? undefined,
        employeeId: emp.id,
        canAccess: true,
      },
    });
  }
  for (const f of toFix) {
    await prisma.modulePermission.updateMany({
      where: { employeeId: emp.id, moduleItemId: f.moduleItemId },
      data: { canAccess: true },
    });
  }

  const after = await prisma.modulePermission.count({ where: { employeeId: emp.id, canAccess: true } });
  console.log(`\nApplied. ${emp.name} now has ${after} employee-level grants (these override role=HOD entirely).`);
  console.log("They keep HOD approvals and gain the security console. Ask them to sign out and back in.");
}

main().catch(console.error).finally(() => prisma.$disconnect());

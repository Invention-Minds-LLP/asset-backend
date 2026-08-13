/**
 * Adds the "Gate Pass — Label Printing" sub-item to the operations module in the
 * module-access catalog, so it can be granted to the security EXECUTIVE role and
 * appears in their sidebar.
 *
 * Without this row the new /gate-pass/print-queue menu entry is filtered out for
 * every non-admin user (the sidebar only shows sub-items whose path is present
 * in the module catalog), which is exactly the audience the screen is for.
 *
 * Idempotent.
 *
 * Run: npx ts-node --transpile-only prisma/addGatePassPrintQueueModuleItem.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  const mod = await prisma.appModule.findUnique({
    where: { name: "operations" },
    include: { subItems: { select: { id: true, name: true, path: true, sortOrder: true } } },
  });
  if (!mod) {
    console.log("operations module not found — run the module seed first. Aborting.");
    return;
  }

  console.log(`operations module #${mod.id} — existing sub-items:`);
  for (const s of mod.subItems) console.log(`  #${s.id} ${s.name} → ${s.path ?? "(no path)"}`);

  const existing = await prisma.appModuleItem.findUnique({
    where: { moduleId_name: { moduleId: mod.id, name: "gate-pass-print-queue" } },
  });
  if (existing) {
    console.log(`Already present (item #${existing.id}). Nothing to do.`);
    return;
  }

  // Sit directly after the security console wherever that happens to be.
  const securityItem = mod.subItems.find((s) => s.path === "/gate-pass/security");
  const sortOrder = (securityItem?.sortOrder ?? mod.subItems.length) + 1;

  const item = await prisma.appModuleItem.create({
    data: {
      moduleId: mod.id,
      name: "gate-pass-print-queue",
      label: "Gate Pass — Label Printing",
      path: "/gate-pass/print-queue",
      icon: "pi pi-print",
      sortOrder,
    },
  });
  console.log(`Created AppModuleItem #${item.id} (gate-pass-print-queue) under operations (module #${mod.id}).`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

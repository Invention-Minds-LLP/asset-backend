/**
 * Adds the "Sub-Type Support & Assets" sub-item to the existing administration
 * module in the module-access catalog, so it can be granted per role/employee
 * and appears in the sidebar for non-admin users (HODs). Idempotent.
 *
 * Run: npx ts-node --transpile-only prisma/addSubtypeSupportModuleItem.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  const mod = await prisma.appModule.findUnique({ where: { name: "administration" } });
  if (!mod) {
    console.log("administration module not found — run the module seed first. Aborting.");
    return;
  }

  const existing = await prisma.appModuleItem.findUnique({
    where: { moduleId_name: { moduleId: mod.id, name: "subtype-support" } },
  });
  if (existing) {
    console.log(`Already present (item #${existing.id}). Nothing to do.`);
    return;
  }

  const item = await prisma.appModuleItem.create({
    data: {
      moduleId: mod.id,
      name: "subtype-support",
      label: "Sub-Type Support & Assets",
      path: "/subtype-support",
      icon: "pi pi-sitemap",
      sortOrder: 4,
    },
  });
  console.log(`Created AppModuleItem #${item.id} (subtype-support) under administration (module #${mod.id}).`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

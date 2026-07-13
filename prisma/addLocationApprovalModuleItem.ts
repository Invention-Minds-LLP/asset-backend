/**
 * Adds the "Location Approvals" sub-item to the existing asset-master module in
 * the module-access catalog, so it can be granted per role/employee and appears
 * in the sidebar for non-admin users. Idempotent.
 *
 * Run: npx ts-node --transpile-only prisma/addLocationApprovalModuleItem.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  const mod = await prisma.appModule.findUnique({ where: { name: "asset-master" } });
  if (!mod) {
    console.log("asset-master module not found — run the module seed first. Aborting.");
    return;
  }

  const existing = await prisma.appModuleItem.findUnique({
    where: { moduleId_name: { moduleId: mod.id, name: "location-approvals" } },
  });
  if (existing) {
    console.log(`Already present (item #${existing.id}). Nothing to do.`);
    return;
  }

  const item = await prisma.appModuleItem.create({
    data: {
      moduleId: mod.id,
      name: "location-approvals",
      label: "Location Approvals",
      path: "/location-approvals",
      icon: "pi pi-check-circle",
      sortOrder: 8,
    },
  });
  console.log(`Created AppModuleItem #${item.id} (location-approvals) under asset-master (module #${mod.id}).`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

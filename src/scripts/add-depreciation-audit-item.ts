/**
 * One-off, idempotent: add the "Depreciation Audit" item under the
 * "Finance & Analytics" module in the live module-access catalog, so it shows
 * on the Module Access screen and in role filtering. Safe to re-run.
 *
 * Run:  npx ts-node src/scripts/add-depreciation-audit-item.ts
 */
import prisma from "../prismaClient";

async function main() {
  const finance = await prisma.appModule.findUnique({ where: { name: "finance-analytics" } });
  if (!finance) {
    console.error('✗ "finance-analytics" module not found. Run the seed first.');
    process.exit(1);
  }

  const existing = await prisma.appModuleItem.findUnique({
    where: { moduleId_name: { moduleId: finance.id, name: "depreciation-audit" } },
  });
  if (existing) {
    console.log("• Depreciation Audit item already present — skipping.");
    return;
  }

  const item = await prisma.appModuleItem.create({
    data: {
      moduleId: finance.id,
      name: "depreciation-audit",
      label: "Depreciation Audit",
      path: "/depreciation-audit",
      icon: "pi pi-verified",
      sortOrder: 7,
    },
  });
  console.log(`✓ Added "Depreciation Audit" (item ${item.id}) under Finance & Analytics (${finance.id}).`);
}

main()
  .catch((e) => {
    console.error("add-depreciation-audit-item error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

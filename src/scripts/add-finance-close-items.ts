/**
 * One-off, idempotent: add the "Financial Year Close" and "Asset
 * Reclassification" items under the "Finance & Analytics" module in the live
 * module-access catalog, so they show on the Module Access screen and pass role
 * filtering. Safe to re-run.
 *
 * The module seed only creates items that are missing on a fresh tenant; an
 * existing tenant needs this script (same pattern as add-depreciation-audit-item).
 *
 * Run:  npx ts-node src/scripts/add-finance-close-items.ts
 * Then grant both items to the FINANCE and CFO roles on the Module Access screen.
 */
import prisma from "../prismaClient";

const ITEMS = [
  { name: "fy-close", label: "Financial Year Close", path: "/fy-close", icon: "pi pi-lock", sortOrder: 7 },
  { name: "reclassification", label: "Asset Reclassification", path: "/reclassification", icon: "pi pi-arrow-right-arrow-left", sortOrder: 7 },
];

async function main() {
  const finance = await prisma.appModule.findUnique({ where: { name: "finance-analytics" } });
  if (!finance) {
    console.error('✗ "finance-analytics" module not found. Run the seed first.');
    process.exit(1);
  }

  for (const it of ITEMS) {
    const existing = await prisma.appModuleItem.findUnique({
      where: { moduleId_name: { moduleId: finance.id, name: it.name } },
    });
    if (existing) {
      console.log(`• "${it.label}" already present — skipping.`);
      continue;
    }
    const item = await prisma.appModuleItem.create({ data: { moduleId: finance.id, ...it } });
    console.log(`✓ Added "${it.label}" (item ${item.id}) under Finance & Analytics (${finance.id}).`);
  }
  console.log("  Grant them to the FINANCE and CFO roles on the Module Access screen.");
}

main()
  .catch((e) => {
    console.error("add-finance-close-items error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

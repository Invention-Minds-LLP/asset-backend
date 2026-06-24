/**
 * One-off, idempotent data realignment.
 *
 * Moves three already-seeded module items into the "Maintenance" module so the
 * Module Access screen matches the sidebar:
 *   - Knowledge Base      (was Operations)      -> Maintenance
 *   - Root Cause Analysis (was Operations)      -> Maintenance
 *   - Hierarchy Dashboard (was Administration)  -> Maintenance
 *
 * Existing role/employee permissions are preserved: each item keeps its id, and
 * the ModulePermission rows that reference it have their parent moduleId
 * repointed to Maintenance. Safe to run multiple times.
 *
 * Run:  npx ts-node src/scripts/realign-modules.ts
 */
import prisma from "../prismaClient";

// itemName -> new sortOrder within Maintenance
const MOVES: { name: string; sortOrder: number }[] = [
  { name: "hierarchy-dashboard", sortOrder: 7 },
  { name: "knowledge-base", sortOrder: 8 },
  { name: "rca", sortOrder: 9 },
];

async function main() {
  const maintenance = await prisma.appModule.findUnique({ where: { name: "maintenance" } });
  if (!maintenance) {
    console.error('✗ "maintenance" module not found. Run the seed first.');
    process.exit(1);
  }

  for (const { name, sortOrder } of MOVES) {
    // Locate the item by its (globally-used) name, wherever it currently lives.
    const item = await prisma.appModuleItem.findFirst({ where: { name } });
    if (!item) {
      console.log(`• "${name}" not found — skipping (nothing to move).`);
      continue;
    }

    if (item.moduleId === maintenance.id) {
      console.log(`• "${name}" already under Maintenance — skipping.`);
      continue;
    }

    // Guard against the [moduleId, name] unique constraint: bail if a same-named
    // item already exists under Maintenance.
    const clash = await prisma.appModuleItem.findUnique({
      where: { moduleId_name: { moduleId: maintenance.id, name } },
    });
    if (clash) {
      console.warn(`! "${name}" already exists under Maintenance (id ${clash.id}); leaving item ${item.id} in place.`);
      continue;
    }

    await prisma.$transaction([
      // Repoint permission rows that reference this item to the new parent module.
      prisma.modulePermission.updateMany({
        where: { moduleItemId: item.id },
        data: { moduleId: maintenance.id },
      }),
      // Move the item itself.
      prisma.appModuleItem.update({
        where: { id: item.id },
        data: { moduleId: maintenance.id, sortOrder },
      }),
    ]);

    console.log(`✓ Moved "${name}" (item ${item.id}) from module ${item.moduleId} → Maintenance (${maintenance.id}), sortOrder ${sortOrder}.`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("realign-modules error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

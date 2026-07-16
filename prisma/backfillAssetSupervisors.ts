/**
 * Backfills the AssetSupervisor join table from the existing single
 * Asset.supervisorId, marking each as the primary supervisor. Idempotent —
 * skips assets that already have their primary row.
 *
 * Run: npx ts-node --transpile-only prisma/backfillAssetSupervisors.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  const assets = await prisma.asset.findMany({
    where: { supervisorId: { not: null } },
    select: { id: true, supervisorId: true },
  });

  let created = 0;
  let skipped = 0;
  for (const a of assets) {
    const existing = await prisma.assetSupervisor.findUnique({
      where: { assetId_employeeId: { assetId: a.id, employeeId: a.supervisorId! } },
    });
    if (existing) {
      // Ensure it's flagged primary even if it pre-existed.
      if (!existing.isPrimary) {
        await prisma.assetSupervisor.update({ where: { id: existing.id }, data: { isPrimary: true } });
      }
      skipped++;
      continue;
    }
    await prisma.assetSupervisor.create({
      data: { assetId: a.id, employeeId: a.supervisorId!, isPrimary: true, isActive: true },
    });
    created++;
  }

  console.log(`Backfill complete. assets with supervisor: ${assets.length}, created: ${created}, already present: ${skipped}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

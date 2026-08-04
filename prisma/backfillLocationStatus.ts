/**
 * One-off backfill: mark already-applied AssetLocation rows as APPROVED.
 *
 * AssetLocation.status defaults to REQUESTED, but several write paths (the bulk
 * location importer, the asset importer's location sheet, and all three
 * transfer paths) created rows without setting it. Those rows went live as
 * `isActive: true, status: 'REQUESTED'` — visible on the asset, invisible to
 * every audit scope query, which all filter `status: 'APPROVED'`. The result was
 * imported and transferred assets silently missing from audits.
 *
 * The predicate is unambiguous: a genuinely pending change is always written
 * `isActive: false` by location-approval.controller.ts, so an ACTIVE row can
 * never legitimately be REQUESTED. Only those rows are touched; pending
 * requests and rejected history are left exactly as they are.
 *
 * Idempotent — safe to re-run. Pass --apply to write; without it the script
 * only reports what it would change.
 *
 * Run: npx ts-node --transpile-only prisma/backfillLocationStatus.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

async function main() {
  const target = { isActive: true, status: "REQUESTED" };

  const affected = await prisma.assetLocation.count({ where: target });

  // Context, so the number above can be sanity-checked before writing.
  const [activeTotal, pendingRequests] = await Promise.all([
    prisma.assetLocation.count({ where: { isActive: true } }),
    prisma.assetLocation.count({ where: { isActive: false, status: "REQUESTED" } }),
  ]);

  console.log(`Active location rows:                    ${activeTotal}`);
  console.log(`  ...of those, stuck at REQUESTED:       ${affected}   <- to fix`);
  console.log(`Genuinely pending requests (inactive):   ${pendingRequests}   <- untouched`);

  if (affected === 0) {
    console.log("\nNothing to do.");
    return;
  }

  // A sample, so it is obvious these are real placements and not requests.
  const sample = await prisma.assetLocation.findMany({
    where: target,
    take: 5,
    orderBy: { id: "asc" },
    select: {
      id: true, assetId: true, floor: true, block: true, room: true, requestedById: true,
      asset: { select: { assetId: true, assetName: true } },
    },
  });
  console.log("\nSample of rows to be marked APPROVED:");
  for (const r of sample) {
    const where = [r.floor, r.block, r.room].filter(Boolean).join(" / ") || "(no floor/block/room)";
    console.log(
      `  #${r.id}  ${r.asset?.assetId ?? "?"} ${r.asset?.assetName ?? ""} — ${where}` +
        `  requestedById=${r.requestedById ?? "null"}`
    );
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to update ${affected} row(s).`);
    return;
  }

  const res = await prisma.assetLocation.updateMany({
    where: target,
    data: { status: "APPROVED" },
  });
  console.log(`\nUpdated ${res.count} row(s) to APPROVED.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

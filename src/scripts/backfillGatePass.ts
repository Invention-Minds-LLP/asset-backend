/**
 * One-shot backfill for the Gate Pass overhaul:
 *  1. For every existing GatePass with a single legacy assetId, create a matching GatePassItem row
 *     (so the new multi-asset structure has data parity with the old single-asset structure).
 *  2. For every existing EWasteRecord that stored gatePassNo as a free-text string,
 *     resolve it to the actual GatePass.id and populate gatePassId.
 *
 * Idempotent: skips rows that already have items / already have gatePassId set.
 *
 * Run:
 *   npx ts-node src/scripts/backfillGatePass.ts
 */

import prisma from "../prismaClient";

async function backfillItems() {
  const passes = await prisma.gatePass.findMany({
    where: { assetId: { not: null } },
    select: { id: true, assetId: true, quantity: true, description: true, items: { select: { id: true } } },
  });

  let created = 0;
  for (const p of passes) {
    if (p.items.length > 0) continue; // already has items — leave alone
    if (p.assetId == null) continue;
    await prisma.gatePassItem.create({
      data: {
        gatePassId: p.id,
        assetId: p.assetId,
        quantity: p.quantity ?? 1,
        remarks: p.description ?? null,
      },
    });
    created++;
  }
  console.log(`[gate-pass] Created ${created} GatePassItem rows from ${passes.length} legacy passes`);
}

async function backfillEwasteFk() {
  const records = await prisma.eWasteRecord.findMany({
    where: { gatePassNo: { not: null }, gatePassId: null },
    select: { id: true, gatePassNo: true },
  });

  let linked = 0;
  for (const r of records) {
    if (!r.gatePassNo) continue;
    const gp = await prisma.gatePass.findUnique({ where: { gatePassNo: r.gatePassNo }, select: { id: true } });
    if (!gp) continue;
    await prisma.eWasteRecord.update({ where: { id: r.id }, data: { gatePassId: gp.id } });
    linked++;
  }
  console.log(`[e-waste] Linked ${linked} of ${records.length} EWasteRecord rows to gatePassId`);
}

async function main() {
  await backfillItems();
  await backfillEwasteFk();
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

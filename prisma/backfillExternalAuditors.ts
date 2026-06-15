/**
 * One-off backfill: for every EXTERNAL AssetAuditor snapshot whose email is not
 * yet in the ExternalAuditor master, create the master record (status ACTIVE)
 * so the auditor can log in. Also lowercases snapshot emails so the portal's
 * scope check (which compares against the lowercase master email) matches.
 *
 * Run: npx ts-node --transpile-only prisma/backfillExternalAuditors.ts
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  if (!admin) {
    console.error("No User found to attribute as addedById — aborting.");
    return;
  }

  const rows = await prisma.assetAuditor.findMany({ where: { type: "EXTERNAL" } });
  let created = 0;
  let normalized = 0;

  for (const r of rows) {
    if (!r.email) continue;
    const email = r.email.trim().toLowerCase();

    // Normalize the snapshot email in place if it differs.
    if (email !== r.email) {
      await prisma.assetAuditor.update({ where: { id: r.id }, data: { email } });
      normalized++;
    }

    const existing = await prisma.externalAuditor.findUnique({ where: { email } });
    if (!existing) {
      await prisma.externalAuditor.create({
        data: {
          email,
          name: r.name || email,
          organization: r.organization,
          phone: r.phone,
          status: "ACTIVE",
          addedById: admin.id,
        },
      });
      created++;
      console.log(`  + created master for ${email}`);
    }
  }

  console.log(`Done. Masters created: ${created}, snapshot emails normalized: ${normalized}.`);
}
main().catch(console.error).finally(() => prisma.$disconnect());

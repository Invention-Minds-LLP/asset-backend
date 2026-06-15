import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
import { getFirebaseApp } from "../src/lib/firebase";

const prisma = new PrismaClient();
const EMP_ID = 22;

async function main() {
  const tokens: any[] = await (prisma as any).deviceToken.findMany({
    where: { employeeId: EMP_ID },
    select: { token: true, platform: true },
  });
  console.log(`Device tokens for employee ${EMP_ID}: ${tokens.length}`);
  tokens.forEach((t, i) => console.log(`   [${i}] ${t.platform}  ${String(t.token).slice(0, 20)}…`));

  const app = getFirebaseApp();
  console.log(`Firebase admin configured: ${app ? "YES" : "NO"}`);

  if (!app) {
    console.log("→ Can't send: set FIREBASE_SERVICE_ACCOUNT_PATH to a valid service-account.json.");
    return;
  }
  if (!tokens.length) {
    console.log("→ Can't send: no device token registered. Build the native app, install on a device, log in as this employee to register a token, then re-run.");
    return;
  }

  const resp = await app.messaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title: "Push Test", body: "This is a push test for employee 22." },
    data: { route: "/notifications" },
  });

  console.log(`FCM result → success=${resp.successCount}, failure=${resp.failureCount}`);
  resp.responses.forEach((r, i) => {
    if (!r.success) console.log(`   token[${i}] error: ${(r.error as any)?.code} — ${(r.error as any)?.message}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());

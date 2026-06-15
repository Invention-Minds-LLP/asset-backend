import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

const EMP_ID = 22;

async function main() {
  const emp = await prisma.employee.findUnique({
    where: { id: EMP_ID },
    select: { id: true, name: true, employeeID: true, email: true },
  });
  if (!emp) {
    console.error(`Employee id ${EMP_ID} not found in this database.`);
    return;
  }

  const n = await prisma.notification.create({
    data: {
      type: "OTHER",
      title: "Test Notification",
      message: `Hi ${emp.name}, this is a test alert to confirm you receive notifications.`,
      priority: "MEDIUM",
      recipients: { create: [{ employeeId: EMP_ID }] },
    },
    include: { recipients: true },
  });

  console.log(`Created notification #${n.id} for ${emp.name} (${emp.employeeID}).`);
  console.log(`Recipients created: ${n.recipients.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

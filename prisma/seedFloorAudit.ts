/**
 * Self-contained seed for testing the floor-plan-driven Asset Audit.
 *
 * Creates (idempotently — safe to re-run):
 *   • an SVG floor-plan image under /uploads/floor-plans
 *   • a [SEED] branch, three [SEED] categories
 *   • a FloorPlan row for the branch + "Ground Floor"
 *   • 9 assets spread across ICU / Ward A / Lab / Lobby / Veranda, each with an
 *     APPROVED active AssetLocation pinned on the plan (room + planX/planY)
 *
 * Run:  npx ts-node --transpile-only prisma/seedFloorAudit.ts
 * Wipe: npx ts-node --transpile-only prisma/seedFloorAudit.ts --clean
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

const BRANCH_NAME = "[SEED] Test Hospital";
const FLOOR = "Ground Floor";
const PLAN_NAME = "[SEED] Ground Floor Plan";
const CODE_PREFIX = "SEED-AUD-";
const W = 1000;
const H = 700;

const CATEGORIES = {
  med: "[SEED] Medical Equipment",
  it: "[SEED] IT Equipment",
  fur: "[SEED] Furniture",
} as const;

// Drawn rooms (pixel boxes) — labels rendered on the SVG.
const ROOMS = [
  { label: "VERANDA", x: 40, y: 14, w: 920, h: 70, fill: "#eef2ff" },
  { label: "ICU", x: 60, y: 120, w: 300, h: 200, fill: "#ecfdf5" },
  { label: "WARD A", x: 640, y: 120, w: 300, h: 200, fill: "#ecfdf5" },
  { label: "LAB", x: 60, y: 380, w: 300, h: 180, fill: "#ecfdf5" },
  { label: "CORRIDOR", x: 380, y: 120, w: 240, h: 440, fill: "#f8fafc" },
  { label: "LOBBY", x: 340, y: 580, w: 320, h: 100, fill: "#fff7ed" },
];

// Assets: planX/planY are 0–100 % of the image, positioned inside their room.
const ASSETS = [
  { code: "001", name: "Ventilator", cat: "med", room: "ICU", x: 15, y: 28 },
  { code: "002", name: "Patient Monitor", cat: "med", room: "ICU", x: 23, y: 34 },
  { code: "003", name: "Infusion Pump", cat: "med", room: "ICU", x: 29, y: 41 },
  { code: "004", name: "Hospital Bed", cat: "fur", room: "Ward A", x: 75, y: 28 },
  { code: "005", name: "Bedside Cabinet", cat: "fur", room: "Ward A", x: 85, y: 36 },
  { code: "006", name: "Centrifuge", cat: "med", room: "Lab", x: 15, y: 62 },
  { code: "007", name: "Lab Workstation PC", cat: "it", room: "Lab", x: 26, y: 70 },
  { code: "008", name: "Reception Desk PC", cat: "it", room: "Lobby", x: 50, y: 90 },
  { code: "009", name: "CCTV Camera", cat: "it", room: "Veranda", x: 50, y: 7 },
] as const;

function buildSvg(): string {
  const rects = ROOMS.map(
    (r) =>
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="${r.fill}" stroke="#94a3b8" stroke-width="2"/>` +
      `<text x="${r.x + 12}" y="${r.y + 26}" font-family="sans-serif" font-size="20" font-weight="700" fill="#475569">${r.label}</text>`
  ).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" stroke="#334155" stroke-width="4"/>
  ${rects}
</svg>`;
}

async function clean() {
  const seedAssets = await prisma.asset.findMany({
    where: { assetId: { startsWith: CODE_PREFIX } },
    select: { id: true },
  });
  const ids = seedAssets.map((a) => a.id);
  if (ids.length) {
    await prisma.assetLocation.deleteMany({ where: { assetId: { in: ids } } });
    // Remove any audit items that reference these assets, then the assets.
    await prisma.assetAuditItem.deleteMany({ where: { assetId: { in: ids } } });
    await prisma.asset.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.floorPlan.deleteMany({ where: { name: PLAN_NAME } });
  console.log(`Cleaned ${ids.length} seed assets + floor plan.`);
}

async function main() {
  const wipeOnly = process.argv.includes("--clean");
  await clean();
  if (wipeOnly) return;

  // 1. Floor-plan image file.
  const dir = path.join(process.cwd(), "uploads", "floor-plans");
  fs.mkdirSync(dir, { recursive: true });
  const filename = "seed-ground-floor.svg";
  fs.writeFileSync(path.join(dir, filename), buildSvg(), "utf8");
  const imageUrl = `/uploads/floor-plans/${filename}`;

  // 2. Branch.
  const branch = await prisma.branch.upsert({
    where: { name: BRANCH_NAME },
    update: {},
    create: { name: BRANCH_NAME },
  });

  // 3. Categories.
  const catIds: Record<string, number> = {};
  for (const [key, name] of Object.entries(CATEGORIES)) {
    const c = await prisma.assetCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    catIds[key] = c.id;
  }

  // 4. Floor plan (recreated fresh by clean()).
  const plan = await prisma.floorPlan.create({
    data: { name: PLAN_NAME, branchId: branch.id, floor: FLOOR, imageUrl, width: W, height: H },
  });

  // 5. Assets + pinned approved locations.
  for (const a of ASSETS) {
    const asset = await prisma.asset.create({
      data: {
        assetId: `${CODE_PREFIX}${a.code}`,
        assetName: a.name,
        assetType: "EQUIPMENT",
        assetCategoryId: catIds[a.cat],
        status: "ACTIVE",
      },
    });
    await prisma.assetLocation.create({
      data: {
        assetId: asset.id,
        branchId: branch.id,
        floor: FLOOR,
        room: a.room,
        status: "APPROVED",
        isActive: true,
        floorPlanId: plan.id,
        planX: a.x,
        planY: a.y,
      },
    });
  }

  console.log("✔ Seed complete.");
  console.log(`  Branch:    ${branch.name} (id ${branch.id})`);
  console.log(`  FloorPlan: ${plan.name} (id ${plan.id}) — ${imageUrl}`);
  console.log(`  Assets:    ${ASSETS.length} across ICU / Ward A / Lab / Lobby / Veranda`);
  console.log(`\nNow create an audit scoped to branch "${branch.name}", floor "${FLOOR}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

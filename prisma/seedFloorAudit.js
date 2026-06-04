"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const client_1 = require("@prisma/client");
const dotenv = __importStar(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv.config({ path: path_1.default.join(__dirname, "..", ".env") });
const prisma = new client_1.PrismaClient();
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
};
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
];
function buildSvg() {
    const rects = ROOMS.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="${r.fill}" stroke="#94a3b8" stroke-width="2"/>` +
        `<text x="${r.x + 12}" y="${r.y + 26}" font-family="sans-serif" font-size="20" font-weight="700" fill="#475569">${r.label}</text>`).join("\n  ");
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" stroke="#334155" stroke-width="4"/>
  ${rects}
</svg>`;
}
function clean() {
    return __awaiter(this, void 0, void 0, function* () {
        const seedAssets = yield prisma.asset.findMany({
            where: { assetId: { startsWith: CODE_PREFIX } },
            select: { id: true },
        });
        const ids = seedAssets.map((a) => a.id);
        if (ids.length) {
            yield prisma.assetLocation.deleteMany({ where: { assetId: { in: ids } } });
            // Remove any audit items that reference these assets, then the assets.
            yield prisma.assetAuditItem.deleteMany({ where: { assetId: { in: ids } } });
            yield prisma.asset.deleteMany({ where: { id: { in: ids } } });
        }
        yield prisma.floorPlan.deleteMany({ where: { name: PLAN_NAME } });
        console.log(`Cleaned ${ids.length} seed assets + floor plan.`);
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const wipeOnly = process.argv.includes("--clean");
        yield clean();
        if (wipeOnly)
            return;
        // 1. Floor-plan image file.
        const dir = path_1.default.join(process.cwd(), "uploads", "floor-plans");
        fs_1.default.mkdirSync(dir, { recursive: true });
        const filename = "seed-ground-floor.svg";
        fs_1.default.writeFileSync(path_1.default.join(dir, filename), buildSvg(), "utf8");
        const imageUrl = `/uploads/floor-plans/${filename}`;
        // 2. Branch.
        const branch = yield prisma.branch.upsert({
            where: { name: BRANCH_NAME },
            update: {},
            create: { name: BRANCH_NAME },
        });
        // 3. Categories.
        const catIds = {};
        for (const [key, name] of Object.entries(CATEGORIES)) {
            const c = yield prisma.assetCategory.upsert({
                where: { name },
                update: {},
                create: { name },
            });
            catIds[key] = c.id;
        }
        // 4. Floor plan (recreated fresh by clean()).
        const plan = yield prisma.floorPlan.create({
            data: { name: PLAN_NAME, branchId: branch.id, floor: FLOOR, imageUrl, width: W, height: H },
        });
        // 5. Assets + pinned approved locations.
        for (const a of ASSETS) {
            const asset = yield prisma.asset.create({
                data: {
                    assetId: `${CODE_PREFIX}${a.code}`,
                    assetName: a.name,
                    assetType: "EQUIPMENT",
                    assetCategoryId: catIds[a.cat],
                    status: "ACTIVE",
                },
            });
            yield prisma.assetLocation.create({
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
    });
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());

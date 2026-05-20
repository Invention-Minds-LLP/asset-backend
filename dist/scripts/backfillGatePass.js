"use strict";
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
const prismaClient_1 = __importDefault(require("../prismaClient"));
function backfillItems() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const passes = yield prismaClient_1.default.gatePass.findMany({
            where: { assetId: { not: null } },
            select: { id: true, assetId: true, quantity: true, description: true, items: { select: { id: true } } },
        });
        let created = 0;
        for (const p of passes) {
            if (p.items.length > 0)
                continue; // already has items — leave alone
            if (p.assetId == null)
                continue;
            yield prismaClient_1.default.gatePassItem.create({
                data: {
                    gatePassId: p.id,
                    assetId: p.assetId,
                    quantity: (_a = p.quantity) !== null && _a !== void 0 ? _a : 1,
                    remarks: (_b = p.description) !== null && _b !== void 0 ? _b : null,
                },
            });
            created++;
        }
        console.log(`[gate-pass] Created ${created} GatePassItem rows from ${passes.length} legacy passes`);
    });
}
function backfillEwasteFk() {
    return __awaiter(this, void 0, void 0, function* () {
        const records = yield prismaClient_1.default.eWasteRecord.findMany({
            where: { gatePassNo: { not: null }, gatePassId: null },
            select: { id: true, gatePassNo: true },
        });
        let linked = 0;
        for (const r of records) {
            if (!r.gatePassNo)
                continue;
            const gp = yield prismaClient_1.default.gatePass.findUnique({ where: { gatePassNo: r.gatePassNo }, select: { id: true } });
            if (!gp)
                continue;
            yield prismaClient_1.default.eWasteRecord.update({ where: { id: r.id }, data: { gatePassId: gp.id } });
            linked++;
        }
        console.log(`[e-waste] Linked ${linked} of ${records.length} EWasteRecord rows to gatePassId`);
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield backfillItems();
        yield backfillEwasteFk();
    });
}
main()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => __awaiter(void 0, void 0, void 0, function* () { yield prismaClient_1.default.$disconnect(); }));

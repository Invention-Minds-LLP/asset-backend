"use strict";
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
exports.computeNextItem = exports.buildAuditMap = void 0;
const prismaClient_1 = __importDefault(require("../prismaClient"));
// Shared floor-map + next-asset routing logic, used by both the internal
// auditor endpoints (asset-audit.controller) and the external auditor portal
// (external-audit.controller). Keep the algorithm in one place so the two
// flows can never drift.
const CONNECTOR_RE = /lobby|veranda|verandah|corridor|passage|foyer|hallway|hall|walkway|reception/i;
const isConnector = (room) => !!room && CONNECTOR_RE.test(room);
// Resolves the audit's floor plan and maps every item to its current pin
// coordinates (read from the location module's AssetLocation rows).
const buildAuditMap = (auditId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const audit = yield prismaClient_1.default.assetAudit.findUnique({ where: { id: auditId } });
    if (!audit)
        return null;
    const items = yield prismaClient_1.default.assetAuditItem.findMany({
        where: { auditId },
        include: {
            asset: {
                select: {
                    id: true,
                    assetId: true,
                    assetName: true,
                    assetCategory: { select: { name: true } },
                },
            },
        },
    });
    const assetIds = items.map((i) => i.assetId);
    const locs = assetIds.length
        ? yield prismaClient_1.default.assetLocation.findMany({
            where: { assetId: { in: assetIds }, isActive: true },
            select: {
                assetId: true,
                room: true,
                planX: true,
                planY: true,
                floorPlanId: true,
            },
            orderBy: { id: "desc" },
        })
        : [];
    // Latest active location per asset.
    const locByAsset = new Map();
    for (const l of locs)
        if (!locByAsset.has(l.assetId))
            locByAsset.set(l.assetId, l);
    // Resolve the plan: prefer the audit's stored floorPlanId, else the modal
    // floorPlanId across the items' pins.
    let planId = (_a = audit.floorPlanId) !== null && _a !== void 0 ? _a : null;
    if (!planId) {
        const counts = new Map();
        for (const l of locs)
            if (l.floorPlanId)
                counts.set(l.floorPlanId, ((_b = counts.get(l.floorPlanId)) !== null && _b !== void 0 ? _b : 0) + 1);
        let best = 0;
        for (const [pid, n] of counts)
            if (n > best) {
                best = n;
                planId = pid;
            }
    }
    const plan = planId
        ? yield prismaClient_1.default.floorPlan.findUnique({ where: { id: planId } })
        : null;
    const placed = [];
    const unplaced = [];
    for (const it of items) {
        const l = locByAsset.get(it.assetId);
        const base = {
            itemId: it.id,
            assetId: it.assetId,
            assetCode: (_d = (_c = it.asset) === null || _c === void 0 ? void 0 : _c.assetId) !== null && _d !== void 0 ? _d : null,
            assetName: (_f = (_e = it.asset) === null || _e === void 0 ? void 0 : _e.assetName) !== null && _f !== void 0 ? _f : null,
            category: (_j = (_h = (_g = it.asset) === null || _g === void 0 ? void 0 : _g.assetCategory) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "",
            status: it.status,
            scannedAt: it.scannedAt,
            room: (_k = l === null || l === void 0 ? void 0 : l.room) !== null && _k !== void 0 ? _k : null,
            planX: null,
            planY: null,
        };
        const pinnedHere = l && l.planX != null && l.planY != null && (!plan || l.floorPlanId === plan.id);
        if (pinnedHere) {
            placed.push(Object.assign(Object.assign({}, base), { planX: l.planX, planY: l.planY }));
        }
        else {
            unplaced.push(base);
        }
    }
    return { audit, plan, placed, unplaced };
});
exports.buildAuditMap = buildAuditMap;
// Greedy nearest-neighbour route over PENDING pinned items: finish the current
// room first, then step to the nearest real room; lobby/veranda/corridor are
// de-prioritised pass-through spaces. Returns the next item + the full route.
const computeNextItem = (plan, placed, fromItemId) => {
    var _a;
    const W = (plan === null || plan === void 0 ? void 0 : plan.width) || 100;
    const H = (plan === null || plan === void 0 ? void 0 : plan.height) || 100;
    const norm = (i) => { var _a, _b; return ({ x: (((_a = i.planX) !== null && _a !== void 0 ? _a : 0) / 100) * W, y: (((_b = i.planY) !== null && _b !== void 0 ? _b : 0) / 100) * H }); };
    const pending = placed
        .filter((i) => i.status === "PENDING")
        .map((i) => (Object.assign(Object.assign({}, i), { _x: norm(i).x, _y: norm(i).y })));
    if (!pending.length)
        return { next: null, route: [] };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const nearest = (cur, arr) => arr.reduce((best, i) => {
        const d = dist(cur, { x: i._x, y: i._y });
        return d < best.d ? { item: i, d } : best;
    }, { item: arr[0], d: Infinity }).item;
    const centroid = (arr) => ({
        x: arr.reduce((s, i) => s + i._x, 0) / arr.length,
        y: arr.reduce((s, i) => s + i._y, 0) / arr.length,
    });
    const groupByRoom = (arr) => {
        const m = new Map();
        for (const i of arr) {
            const k = i.room || "__none__";
            if (!m.has(k))
                m.set(k, []);
            m.get(k).push(i);
        }
        return [...m.entries()].map(([room, items]) => ({
            room: room === "__none__" ? null : room,
            items,
        }));
    };
    const pickNext = (cur, remaining) => {
        // 1. Finish the current (real) room first.
        if (cur.room && !isConnector(cur.room)) {
            const sameRoom = remaining.filter((i) => i.room === cur.room);
            if (sameRoom.length)
                return nearest(cur, sameRoom);
        }
        // 2. Choose the next room by centroid distance; connectors only if nothing else.
        const groups = groupByRoom(remaining);
        const real = groups.filter((g) => !isConnector(g.room));
        const pool = real.length ? real : groups;
        let bestGroup = pool[0];
        let bestD = Infinity;
        for (const g of pool) {
            const d = dist(cur, centroid(g.items));
            if (d < bestD) {
                bestD = d;
                bestGroup = g;
            }
        }
        return nearest(cur, bestGroup.items);
    };
    // Starting position.
    let cur = null;
    if (fromItemId) {
        const f = (_a = pending.find((i) => i.itemId === fromItemId)) !== null && _a !== void 0 ? _a : placed.find((i) => i.itemId === fromItemId && i.planX != null);
        if (f)
            cur = { x: norm(f).x, y: norm(f).y, room: f.room };
    }
    if (!cur) {
        const scanned = placed
            .filter((i) => i.scannedAt)
            .sort((a, b) => (b.scannedAt.getTime() - a.scannedAt.getTime()));
        if (scanned[0])
            cur = { x: norm(scanned[0]).x, y: norm(scanned[0]).y, room: scanned[0].room };
    }
    if (!cur) {
        // Nothing scanned yet: start from a connector (entrance) centroid if any,
        // else the pending pin closest to the image origin.
        const conn = pending.filter((i) => isConnector(i.room));
        if (conn.length) {
            cur = Object.assign(Object.assign({}, centroid(conn)), { room: null });
        }
        else {
            const start = nearest({ x: 0, y: 0 }, pending);
            cur = { x: start._x, y: start._y, room: start.room };
        }
    }
    // Build the full ordered route.
    const route = [];
    let remaining = [...pending];
    let pos = cur;
    while (remaining.length) {
        const nxt = pickNext(pos, remaining);
        route.push(nxt);
        remaining = remaining.filter((i) => i.itemId !== nxt.itemId);
        pos = { x: nxt._x, y: nxt._y, room: nxt.room };
    }
    const strip = (i) => ({
        itemId: i.itemId,
        assetId: i.assetId,
        assetCode: i.assetCode,
        assetName: i.assetName,
        category: i.category,
        room: i.room,
        planX: i.planX,
        planY: i.planY,
    });
    return { next: strip(route[0]), route: route.map(strip) };
};
exports.computeNextItem = computeNextItem;

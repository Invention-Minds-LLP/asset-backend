import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import prisma from "../../prismaClient";
import { asPolygon, pointInPolygon, polygonBounds, polygonCentroid } from "../../utilis/geometry";

// ─── Image upload (stored under /uploads/floor-plans, served by static mw) ───
const DEST = path.join(process.cwd(), "uploads", "floor-plans");
fs.mkdirSync(DEST, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DEST),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
export const floorPlanUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only image files (png, jpg, webp, gif, svg) are allowed"));
  },
});

// ─── POST /api/floor-plan  (multipart: file + name, branchId, block, floor) ──
export const uploadFloorPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file;
    const { name, branchId, block, floor, width, height } = req.body || {};
    if (!file) { res.status(400).json({ message: "Image file is required" }); return; }
    if (!branchId) { res.status(400).json({ message: "branchId is required" }); return; }

    const plan = await (prisma as any).floorPlan.create({
      data: {
        name: name?.trim() || file.originalname,
        branchId: Number(branchId),
        block: block || null,
        floor: floor || null,
        imageUrl: `/uploads/floor-plans/${file.filename}`,
        width: width ? Number(width) : null,
        height: height ? Number(height) : null,
        createdById: (req as any).user?.employeeDbId ?? null,
      },
    });
    res.status(201).json(plan);
  } catch (err: any) {
    console.error("uploadFloorPlan error:", err);
    res.status(500).json({ message: "Failed to upload floor plan", error: err?.message });
  }
};

// ─── GET /api/floor-plan?branchId=&block=&floor= ─────────────────────────────
export const listFloorPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const { branchId, block, floor } = req.query;
    const where: any = { isActive: true };
    if (branchId) where.branchId = Number(branchId);
    if (block) where.block = String(block);
    if (floor) where.floor = String(floor);
    const plans = await (prisma as any).floorPlan.findMany({
      where,
      include: { branch: { select: { id: true, name: true } }, _count: { select: { locations: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(plans);
  } catch (err: any) {
    console.error("listFloorPlans error:", err);
    res.status(500).json({ message: "Failed to load floor plans" });
  }
};

// ─── GET /api/floor-plan/:id  → plan + the assets pinned on it ───────────────
export const getFloorPlanWithPins = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const plan = await (prisma as any).floorPlan.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!plan) { res.status(404).json({ message: "Floor plan not found" }); return; }

    const pins = await (prisma as any).assetLocation.findMany({
      where: { floorPlanId: id, isActive: true, planX: { not: null } },
      include: { asset: { select: { id: true, assetId: true, assetName: true, status: true, assetCategory: { select: { name: true, locationProfile: true } } } } },
    });
    res.json({ plan, pins });
  } catch (err: any) {
    console.error("getFloorPlanWithPins error:", err);
    res.status(500).json({ message: "Failed to load floor plan" });
  }
};

// ─── GET /api/floor-plan/:id/pinnable  → assets at this branch/floor to place ─
// Returns assets whose ACTIVE location is at the plan's branch (+ floor/block if
// set), so the user can drop pins for them. Includes their current pin if any.
export const getPinnableAssets = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const plan = await (prisma as any).floorPlan.findUnique({ where: { id } });
    if (!plan) { res.status(404).json({ message: "Floor plan not found" }); return; }

    const where: any = { isActive: true, branchId: plan.branchId };
    if (plan.floor) where.floor = plan.floor;
    if (plan.block) where.block = plan.block;

    const locations = await (prisma as any).assetLocation.findMany({
      where,
      include: { asset: { select: { id: true, assetId: true, assetName: true, status: true, assetCategory: { select: { name: true } } } } },
      orderBy: { id: "desc" },
    });
    const assets = locations
      .filter((l: any) => l.asset)
      .map((l: any) => ({
        locationId: l.id,
        assetId: l.asset.id,
        assetCode: l.asset.assetId,
        assetName: l.asset.assetName,
        status: l.asset.status,
        category: l.asset.assetCategory?.name ?? "",
        pinnedHere: l.floorPlanId === id && l.planX != null,
        planX: l.floorPlanId === id ? l.planX : null,
        planY: l.floorPlanId === id ? l.planY : null,
      }));
    res.json(assets);
  } catch (err: any) {
    console.error("getPinnableAssets error:", err);
    res.status(500).json({ message: "Failed to load assets" });
  }
};

// ─── POST /api/floor-plan/:id/pin  { assetId, planX, planY } ─────────────────
// Pins an asset onto this plan by updating its ACTIVE AssetLocation row.
export const savePin = async (req: Request, res: Response): Promise<void> => {
  try {
    const floorPlanId = Number(req.params.id);
    const { assetId, planX, planY } = req.body || {};
    if (!assetId || planX == null || planY == null) {
      res.status(400).json({ message: "assetId, planX and planY are required" });
      return;
    }
    const active = await (prisma as any).assetLocation.findFirst({
      where: { assetId: Number(assetId), isActive: true },
      orderBy: { id: "desc" },
    });
    if (!active) {
      res.status(400).json({ message: "Asset has no active location to pin. Set its location first." });
      return;
    }
    const updated = await (prisma as any).assetLocation.update({
      where: { id: active.id },
      data: { floorPlanId, planX: Number(planX), planY: Number(planY) },
    });
    res.json(updated);
  } catch (err: any) {
    console.error("savePin error:", err);
    res.status(500).json({ message: "Failed to save pin", error: err?.message });
  }
};

// ─── DELETE /api/floor-plan/:id/pin/:assetId  → clear an asset's pin ─────────
export const removePin = async (req: Request, res: Response): Promise<void> => {
  try {
    const floorPlanId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    await (prisma as any).assetLocation.updateMany({
      where: { assetId, floorPlanId, isActive: true },
      data: { floorPlanId: null, planX: null, planY: null },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("removePin error:", err);
    res.status(500).json({ message: "Failed to remove pin" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ZONES — traced room / area outlines on a plan
//  Which assets are in a zone is always DERIVED from planX/planY by
//  point-in-polygon, never stored, so pins and zones cannot drift apart.
// ─────────────────────────────────────────────────────────────────────────────

const ZONE_KINDS = ["ROOM", "CORRIDOR", "WARD", "OT", "UTILITY", "OUTDOOR"];

/** Validates and clamps an incoming outline. */
const cleanPolygon = (raw: any): [number, number][] | null => {
  const poly = asPolygon(raw).map(
    ([x, y]) => [Math.min(100, Math.max(0, x)), Math.min(100, Math.max(0, y))] as [number, number]
  );
  return poly.length >= 3 ? poly : null;
};

// ─── GET /api/floor-plan/:id/zones ───────────────────────────────────────────
export const listZones = async (req: Request, res: Response): Promise<void> => {
  try {
    const floorPlanId = Number(req.params.id);
    const zones = await (prisma as any).floorPlanZone.findMany({
      where: { floorPlanId },
      orderBy: { name: "asc" },
    });
    res.json(zones.map(shapeZone));
  } catch (err: any) {
    console.error("listZones error:", err);
    res.status(500).json({ message: "Failed to load zones", error: err?.message });
  }
};

/** Adds the derived geometry the client would otherwise recompute. */
const shapeZone = (z: any) => {
  const poly = asPolygon(z.polygon);
  return { ...z, polygon: poly, bounds: polygonBounds(poly), centroid: polygonCentroid(poly) };
};

// ─── POST /api/floor-plan/:id/zones ──────────────────────────────────────────
export const createZone = async (req: Request, res: Response): Promise<void> => {
  try {
    const floorPlanId = Number(req.params.id);
    const { name, roomNumber, department, kind, polygon } = req.body || {};
    if (!name?.trim()) { res.status(400).json({ message: "name is required" }); return; }
    const poly = cleanPolygon(polygon);
    if (!poly) { res.status(400).json({ message: "polygon needs at least 3 points" }); return; }

    const plan = await (prisma as any).floorPlan.findUnique({ where: { id: floorPlanId } });
    if (!plan) { res.status(404).json({ message: "Floor plan not found" }); return; }

    const zone = await (prisma as any).floorPlanZone.create({
      data: {
        floorPlanId,
        name: name.trim(),
        roomNumber: roomNumber?.trim() || null,
        department: department?.trim() || null,
        kind: ZONE_KINDS.includes(String(kind).toUpperCase()) ? String(kind).toUpperCase() : "ROOM",
        polygon: poly,
        createdById: (req as any).user?.employeeDbId ?? null,
      },
    });
    res.status(201).json(shapeZone(zone));
  } catch (err: any) {
    console.error("createZone error:", err);
    res.status(500).json({ message: "Failed to create zone", error: err?.message });
  }
};

// ─── PUT /api/floor-plan/:id/zones/:zoneId ───────────────────────────────────
export const updateZone = async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = Number(req.params.zoneId);
    const { name, roomNumber, department, kind, polygon } = req.body || {};
    const data: any = {};
    if (name !== undefined) {
      if (!name?.trim()) { res.status(400).json({ message: "name cannot be blank" }); return; }
      data.name = name.trim();
    }
    if (roomNumber !== undefined) data.roomNumber = roomNumber?.trim() || null;
    if (department !== undefined) data.department = department?.trim() || null;
    if (kind !== undefined && ZONE_KINDS.includes(String(kind).toUpperCase())) {
      data.kind = String(kind).toUpperCase();
    }
    if (polygon !== undefined) {
      const poly = cleanPolygon(polygon);
      if (!poly) { res.status(400).json({ message: "polygon needs at least 3 points" }); return; }
      data.polygon = poly;
    }
    const zone = await (prisma as any).floorPlanZone.update({ where: { id: zoneId }, data });
    res.json(shapeZone(zone));
  } catch (err: any) {
    console.error("updateZone error:", err);
    res.status(500).json({ message: "Failed to update zone", error: err?.message });
  }
};

// ─── DELETE /api/floor-plan/:id/zones/:zoneId ────────────────────────────────
export const deleteZone = async (req: Request, res: Response): Promise<void> => {
  try {
    await (prisma as any).floorPlanZone.delete({ where: { id: Number(req.params.zoneId) } });
    res.json({ success: true });
  } catch (err: any) {
    console.error("deleteZone error:", err);
    res.status(500).json({ message: "Failed to delete zone", error: err?.message });
  }
};

// ─── GET /api/floor-plan/:id/zone-stats ──────────────────────────────────────
// Zones + which pinned assets fall inside each. Powers zone filtering, the
// "show only this room" view and the asset-count heatmap.
export const getZoneStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const floorPlanId = Number(req.params.id);
    const [zones, pins] = await Promise.all([
      (prisma as any).floorPlanZone.findMany({ where: { floorPlanId }, orderBy: { name: "asc" } }),
      (prisma as any).assetLocation.findMany({
        where: { floorPlanId, isActive: true, planX: { not: null }, planY: { not: null } },
        select: {
          planX: true,
          planY: true,
          asset: {
            select: {
              id: true,
              assetId: true,
              assetName: true,
              status: true,
              assetCategory: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const assigned = new Set<number>();
    const out = zones.map((z: any) => {
      const poly = asPolygon(z.polygon);
      const inside = pins.filter(
        (p: any) => p.asset && pointInPolygon(Number(p.planX), Number(p.planY), poly)
      );
      inside.forEach((p: any) => assigned.add(p.asset.id));
      const byStatus: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const p of inside) {
        const s = p.asset.status || "UNKNOWN";
        byStatus[s] = (byStatus[s] || 0) + 1;
        const c = p.asset.assetCategory?.name || "Uncategorised";
        byCategory[c] = (byCategory[c] || 0) + 1;
      }
      return {
        ...shapeZone(z),
        assetCount: inside.length,
        byStatus,
        byCategory,
        assetIds: inside.map((p: any) => p.asset.id),
      };
    });

    // Pins that fell outside every traced zone — the tracing to-do list.
    const unzoned = pins.filter((p: any) => p.asset && !assigned.has(p.asset.id)).length;
    const counts = out.map((z: any) => z.assetCount);

    res.json({
      zones: out,
      totals: {
        pins: pins.length,
        zoned: pins.length - unzoned,
        unzoned,
        maxAssetCount: counts.length ? Math.max(...counts) : 0,
      },
    });
  } catch (err: any) {
    console.error("getZoneStats error:", err);
    res.status(500).json({ message: "Failed to load zone stats", error: err?.message });
  }
};

// ─── DELETE /api/floor-plan/:id  → soft delete + unpin its assets ────────────
export const deleteFloorPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction([
      (prisma as any).assetLocation.updateMany({
        where: { floorPlanId: id },
        data: { floorPlanId: null, planX: null, planY: null },
      }),
      (prisma as any).floorPlan.update({ where: { id }, data: { isActive: false } }),
    ]);
    res.json({ success: true });
  } catch (err: any) {
    console.error("deleteFloorPlan error:", err);
    res.status(500).json({ message: "Failed to delete floor plan" });
  }
};

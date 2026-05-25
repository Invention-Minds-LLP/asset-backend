import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import prisma from "../../prismaClient";

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

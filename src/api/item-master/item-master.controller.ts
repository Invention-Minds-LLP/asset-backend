import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ─── List ────────────────────────────────────────────────────────────────────
// Open to any signed-in user: the asset form and the indent form pick from this
// list. ?search= filters by name so the pickers can query the server as the user
// types instead of pulling the whole master down.
export const getAllItems = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { includeInactive, search, assetCategoryId } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (assetCategoryId) where.assetCategoryId = Number(assetCategoryId);
    if (search) where.name = { contains: String(search) };

    const items = await prisma.assetItem.findMany({
      where,
      include: { assetCategory: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });

    res.json(items);
  } catch (error) {
    console.error("getAllItems error:", error);
    res.status(500).json({ message: "Failed to fetch items" });
  }
};

// Allowed fields for create/update — prevents Prisma errors from extra fields
function pickItemFields(body: any) {
  const nature = String(body.nature || "TANGIBLE").toUpperCase();
  return {
    name: body.name?.trim(),
    nature: nature === "INTANGIBLE" ? "INTANGIBLE" : "TANGIBLE",
    // Type is the FIXED/MOVABLE split, which only means anything for a physical
    // item — an intangible one (licence, software) is neither.
    type: nature === "INTANGIBLE" ? null : body.type?.trim() || null,
    assetCategoryId: body.assetCategoryId != null && body.assetCategoryId !== "" ? Number(body.assetCategoryId) : null,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────
export const createItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = pickItemFields(req.body);
    if (!data.name) { res.status(400).json({ message: "Item name is required" }); return; }
    if (!data.assetCategoryId) { res.status(400).json({ message: "Category is required" }); return; }

    const item = await prisma.assetItem.create({
      data: { ...data, createdById: req.user?.employeeDbId ?? null } as any,
      include: { assetCategory: { select: { id: true, name: true } } },
    });
    res.status(201).json(item);
  } catch (error: any) {
    console.error("createItem error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ message: "An item with that name already exists" });
      return;
    }
    if (error?.code === "P2003") {
      res.status(400).json({ message: "Selected category no longer exists" });
      return;
    }
    res.status(500).json({ message: error.message || "Failed to create item" });
  }
};

// ─── Update ──────────────────────────────────────────────────────────────────
export const updateItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = pickItemFields(req.body);
    if (!data.name) { res.status(400).json({ message: "Item name is required" }); return; }
    if (!data.assetCategoryId) { res.status(400).json({ message: "Category is required" }); return; }

    const updated = await prisma.assetItem.update({
      where: { id },
      data: { ...data, updatedById: req.user?.employeeDbId ?? null } as any,
      include: { assetCategory: { select: { id: true, name: true } } },
    });
    res.json(updated);
  } catch (error: any) {
    console.error("updateItem error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ message: "An item with that name already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to update item" });
  }
};

// ─── Delete (soft) ───────────────────────────────────────────────────────────
// Assets keep their name as plain text, so there is no FK to check — an item
// that has been used simply stops being offered for new entries.
export const deleteItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.assetItem.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Item deactivated" });
  } catch (error) {
    console.error("deleteItem error:", error);
    res.status(500).json({ message: "Failed to delete item" });
  }
};

import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllCategories = async (req: Request, res: Response) => {
  try {
    const { includeInactive, search, exportCsv } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { code: { contains: String(search) } },
      ];
    }

    const categories = await prisma.assetCategory.findMany({
      where,
      include: { _count: { select: { assets: true } } },
      orderBy: { name: "asc" },
    });

    if (exportCsv === "true") {
      const csvRows = categories.map((c: any) => ({
        Name: c.name, Code: c.code || "", Description: c.description || "",
        AssetCount: c._count?.assets || 0, Active: c.isActive ? "Yes" : "No",
      }));
      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=categories.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json(categories);
  } catch (error) {
    console.error("getAllCategories error:", error);
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  const category = await prisma.assetCategory.create({ data: req.body });
   res.status(201).json(category);
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ message: "Category name is required" });
      return;
    }
    const updated = await prisma.assetCategory.update({ where: { id }, data: { name: name.trim() } });
    res.json(updated);
  } catch (error) {
    console.error("updateCategory error:", error);
    res.status(500).json({ message: "Failed to update category" });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const inUse = await prisma.asset.findFirst({ where: { assetCategoryId: id } });
    if (inUse) {
      res.status(400).json({ message: "Category has assets assigned. Cannot delete." });
      return;
    }
    await prisma.assetCategory.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Category deactivated" });
  } catch (error) {
    console.error("deleteCategory error:", error);
    res.status(500).json({ message: "Failed to delete category" });
  }
};

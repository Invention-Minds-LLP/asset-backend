import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const createSupportMatrixEntry = async (req: Request, res: Response) => {
  try {
    const {
      assetCategoryId,
      assetId,
      levelNo,
      roleName,
      personName,
      employeeId,
      contactNumber,
      email,
      escalationTime,
      escalationUnit,
      notes,
    } = req.body;

    if (!levelNo) {
      res.status(400).json({ message: "levelNo is required" });
      return;
    }

    if (!assetCategoryId && !assetId) {
      res.status(400).json({ message: "Either assetCategoryId or assetId is required" });
      return;
    }

    const entry = await prisma.assetSupportMatrix.create({
      data: {
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
        assetId: assetId ? Number(assetId) : undefined,
        levelNo: Number(levelNo),
        roleName,
        personName,
        employeeId: employeeId ? Number(employeeId) : undefined,
        contactNumber,
        email,
        escalationTime: escalationTime ? Number(escalationTime) : undefined,
        escalationUnit,
        notes,
      },
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
        employee: { select: { name: true, employeeID: true } },
      },
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error("createSupportMatrixEntry error:", error);
    res.status(500).json({ message: "Failed to create support matrix entry" });
  }
};

export const getAllSupportMatrix = async (req: Request, res: Response) => {
  try {
    const { assetCategoryId, assetId } = req.query;
    const where: any = {};
    if (assetCategoryId) where.assetCategoryId = Number(assetCategoryId);
    if (assetId) where.assetId = Number(assetId);

    const entries = await prisma.assetSupportMatrix.findMany({
      where,
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
        employee: { select: { name: true, employeeID: true } },
      },
      orderBy: [{ assetCategoryId: "asc" }, { levelNo: "asc" }],
    });

    res.json(entries);
  } catch (error) {
    console.error("getAllSupportMatrix error:", error);
    res.status(500).json({ message: "Failed to fetch support matrix" });
  }
};

export const getSupportMatrixByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);

    // First try asset-specific matrix, then fall back to category-level
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { assetCategoryId: true },
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const assetSpecific = await prisma.assetSupportMatrix.findMany({
      where: { assetId },
      include: { employee: { select: { name: true, employeeID: true } } },
      orderBy: { levelNo: "asc" },
    });

    const categoryLevel = await prisma.assetSupportMatrix.findMany({
      where: { assetCategoryId: asset.assetCategoryId, assetId: null },
      include: { employee: { select: { name: true, employeeID: true } } },
      orderBy: { levelNo: "asc" },
    });

    res.json({ assetSpecific, categoryLevel });
  } catch (error) {
    console.error("getSupportMatrixByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch support matrix" });
  }
};

export const getSupportMatrixByCategory = async (req: Request, res: Response) => {
  try {
    const assetCategoryId = parseInt(req.params.assetCategoryId);

    const entries = await prisma.assetSupportMatrix.findMany({
      where: { assetCategoryId },
      include: { employee: { select: { name: true, employeeID: true } } },
      orderBy: { levelNo: "asc" },
    });

    res.json(entries);
  } catch (error) {
    console.error("getSupportMatrixByCategory error:", error);
    res.status(500).json({ message: "Failed to fetch support matrix" });
  }
};

export const updateSupportMatrixEntry = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.assetSupportMatrix.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }

    const updated = await prisma.assetSupportMatrix.update({
      where: { id },
      data: req.body,
      include: {
        assetCategory: { select: { name: true } },
        employee: { select: { name: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("updateSupportMatrixEntry error:", error);
    res.status(500).json({ message: "Failed to update entry" });
  }
};

export const deleteSupportMatrixEntry = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.assetSupportMatrix.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    await prisma.assetSupportMatrix.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteSupportMatrixEntry error:", error);
    res.status(500).json({ message: "Failed to delete entry" });
  }
};

export const bulkUpsertSupportMatrix = async (req: Request, res: Response) => {
  try {
    const { assetCategoryId, assetId, entries } = req.body as {
      assetCategoryId?: number;
      assetId?: number;
      entries: {
        levelNo: number;
        roleName?: string;
        personName?: string;
        employeeId?: number;
        contactNumber?: string;
        email?: string;
        escalationTime?: number;
        escalationUnit?: string;
        notes?: string;
      }[];
    };

    if (!entries?.length) {
      res.status(400).json({ message: "entries array is required" });
      return;
    }

    // Delete existing entries for this scope and recreate
    await prisma.assetSupportMatrix.deleteMany({
      where: {
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
        assetId: assetId ? Number(assetId) : undefined,
      },
    });

    const created = await prisma.$transaction(
      entries.map((e) =>
        prisma.assetSupportMatrix.create({
          data: {
            assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
            assetId: assetId ? Number(assetId) : undefined,
            levelNo: e.levelNo,
            roleName: e.roleName,
            personName: e.personName,
            employeeId: e.employeeId ? Number(e.employeeId) : undefined,
            contactNumber: e.contactNumber,
            email: e.email,
            escalationTime: e.escalationTime,
            escalationUnit: e.escalationUnit,
            notes: e.notes,
          },
        })
      )
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("bulkUpsertSupportMatrix error:", error);
    res.status(500).json({ message: "Failed to save support matrix" });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

interface CreateStoreBody {
  name: string;
  code?: string;
  storeType?: string;
  parentStoreId?: number;
  branchId?: number;
  departmentId?: number;
  managerId?: number;
  address?: string;
}

interface CreateLocationBody {
  rack?: string;
  shelf?: string;
  bin?: string;
  label?: string;
}

export const getAllStores = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { storeType } = req.query;

    const where: { isActive: boolean; storeType?: string } = { isActive: true };
    if (storeType) {
      where.storeType = String(storeType);
    }

    const stores = await prisma.store.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        parentStore: { select: { id: true, name: true, code: true } },
        _count: {
          select: {
            childStores: true,
            locations: true,
          },
        },
      },
    });

    res.json(stores);
  } catch (error) {
    console.error("getAllStores error:", error);
    res.status(500).json({ message: "Failed to fetch stores" });
  }
};

export const getStoreById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    const store = await prisma.store.findUnique({
      where: { id },
      include: {
        locations: true,
        childStores: true,
        stockPositions: true,
      },
    });

    if (!store) {
      res.status(404).json({ message: "Store not found" });
      return;
    }

    res.json(store);
  } catch (error) {
    console.error("getStoreById error:", error);
    res.status(500).json({ message: "Failed to fetch store" });
  }
};

export const createStore = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as CreateStoreBody;

    // Sub-store must have a parent
    if (body.storeType === "SUB_STORE" && !body.parentStoreId) {
      res.status(400).json({ message: "Sub-store must have a parentStoreId" });
      return;
    }

    // Validate parent exists if parentStoreId is provided
    if (body.parentStoreId) {
      const parent = await prisma.store.findUnique({
        where: { id: body.parentStoreId },
      });
      if (!parent) {
        res.status(400).json({ message: "Parent store not found" });
        return;
      }
    }

    const store = await prisma.store.create({
      data: {
        name: body.name,
        code: body.code,
        storeType: body.storeType || "MAIN_STORE",
        parentStoreId: body.parentStoreId,
        branchId: body.branchId,
        departmentId: body.departmentId,
        managerId: body.managerId,
        address: body.address,
        createdById: req.user?.employeeDbId,
      },
    });

    res.status(201).json(store);
  } catch (error: unknown) {
    console.error("createStore error:", error);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      res.status(409).json({ message: "Store with this name or code already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to create store" });
  }
};

export const updateStore = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    const store = await prisma.store.update({
      where: { id },
      data: {
        ...req.body,
        updatedById: req.user?.employeeDbId,
      },
    });

    res.json(store);
  } catch (error: unknown) {
    console.error("updateStore error:", error);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2025"
    ) {
      res.status(404).json({ message: "Store not found" });
      return;
    }
    res.status(500).json({ message: "Failed to update store" });
  }
};

export const deleteStore = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    await prisma.store.update({
      where: { id },
      data: { isActive: false, updatedById: req.user?.employeeDbId },
    });

    res.json({ message: "Store deactivated" });
  } catch (error: unknown) {
    console.error("deleteStore error:", error);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2025"
    ) {
      res.status(404).json({ message: "Store not found" });
      return;
    }
    res.status(500).json({ message: "Failed to delete store" });
  }
};

export const getStoreLocations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = parseInt(req.params.id, 10);

    const locations = await prisma.storeLocation.findMany({
      where: { storeId, isActive: true },
      orderBy: { rack: "asc" },
    });

    res.json(locations);
  } catch (error) {
    console.error("getStoreLocations error:", error);
    res.status(500).json({ message: "Failed to fetch store locations" });
  }
};

export const createStoreLocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    const { rack, shelf, bin, label } = req.body as CreateLocationBody;

    // Verify store exists
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      res.status(404).json({ message: "Store not found" });
      return;
    }

    const location = await prisma.storeLocation.create({
      data: { storeId, rack, shelf, bin, label },
    });

    res.status(201).json(location);
  } catch (error: unknown) {
    console.error("createStoreLocation error:", error);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      res.status(409).json({ message: "This rack/shelf/bin combination already exists in the store" });
      return;
    }
    res.status(500).json({ message: "Failed to create store location" });
  }
};

interface StoreTreeNode {
  id: number;
  name: string;
  code: string | null;
  storeType: string;
  isActive: boolean;
  children: StoreTreeNode[];
}

export const getStoreHierarchy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        storeType: true,
        parentStoreId: true,
        isActive: true,
      },
    });

    // Build tree from flat list
    const storeMap = new Map<number, StoreTreeNode>();
    const roots: StoreTreeNode[] = [];

    for (const s of stores) {
      storeMap.set(s.id, {
        id: s.id,
        name: s.name,
        code: s.code,
        storeType: s.storeType,
        isActive: s.isActive,
        children: [],
      });
    }

    for (const s of stores) {
      const node = storeMap.get(s.id)!;
      if (s.parentStoreId && storeMap.has(s.parentStoreId)) {
        storeMap.get(s.parentStoreId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json(roots);
  } catch (error) {
    console.error("getStoreHierarchy error:", error);
    res.status(500).json({ message: "Failed to fetch store hierarchy" });
  }
};

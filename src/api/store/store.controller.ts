import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Role-aware store visibility:
//  - Admin / leadership / Store-department users → all stores
//  - HOD → main stores (to draw from) + their own department's sub-stores
//  - Everyone else → only their own department's sub-stores
export async function buildStoreAccessWhere(user: any): Promise<any> {
  const role = user?.role;
  const deptId = user?.departmentId ? Number(user.departmentId) : null;

  let isStoreDept = false;
  if (deptId) {
    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { name: true } });
    if (dept?.name?.toUpperCase().includes("STORE")) isStoreDept = true;
  }

  if (["ADMIN", "CEO_COO", "OPERATIONS", "FINANCE"].includes(role) || isStoreDept) {
    return {}; // see everything
  }
  if (!deptId) return { id: -1 }; // no department → nothing scoped
  if (role === "HOD") {
    return { OR: [{ storeType: "MAIN_STORE" }, { departmentId: deptId }] };
  }
  // SUPERVISOR / EXECUTIVE / others → only their own department's sub-stores
  return { storeType: "SUB_STORE", departmentId: deptId };
}

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

    const access = await buildStoreAccessWhere(req.user);
    const where: any = { isActive: true, ...access };
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

// Lightweight, UN-scoped list of all active stores — for transfer destination
// dropdowns, so a user can send to any store (their data views stay scoped).
export const getStoreOptions = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, storeType: true, departmentId: true },
    });
    res.json(stores);
  } catch (error) {
    console.error("getStoreOptions error:", error);
    res.status(500).json({ message: "Failed to fetch store options" });
  }
};

export async function isStoreDeptUser(user: any): Promise<boolean> {
  const deptId = user?.departmentId ? Number(user.departmentId) : null;
  if (!deptId) return false;
  const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { name: true } });
  return !!dept?.name?.toUpperCase().includes("STORE");
}

// Stores the current user may transfer FROM (source):
//  - Admin/leadership → all stores
//  - Store-department users → main stores + unassigned stores + their own dept's stores
//  - Everyone else → only their own department's stores
export const getTransferSourceStores = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const role = (req.user as any)?.role;
    const deptId = (req.user as any)?.departmentId ? Number((req.user as any).departmentId) : null;
    const where: any = { isActive: true };

    if (["ADMIN", "CEO_COO", "OPERATIONS", "FINANCE"].includes(role)) {
      // all stores
    } else if (await isStoreDeptUser(req.user)) {
      where.OR = [
        { storeType: "MAIN_STORE" },
        { departmentId: null },
        ...(deptId ? [{ departmentId: deptId }] : []),
      ];
    } else if (deptId) {
      where.departmentId = deptId;
    } else {
      where.id = -1; // no department → nothing
    }

    const stores = await prisma.store.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, storeType: true, departmentId: true },
    });
    res.json(stores);
  } catch (error) {
    console.error("getTransferSourceStores error:", error);
    res.status(500).json({ message: "Failed to fetch source stores" });
  }
};

export const getStoreById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    // Guard: can't open a store outside the caller's access scope.
    const access = await buildStoreAccessWhere(req.user);
    if (Object.keys(access).length > 0) {
      const allowed = await prisma.store.findFirst({ where: { id, ...access }, select: { id: true } });
      if (!allowed) { res.status(403).json({ message: "You don't have access to this store" }); return; }
    }

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

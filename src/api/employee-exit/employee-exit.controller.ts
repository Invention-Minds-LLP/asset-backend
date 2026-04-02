import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

function mustUser(req: AuthenticatedRequest) {
  const u = (req as any).user;
  if (!u?.employeeDbId) throw new Error("Unauthorized");
  return u as { employeeDbId: number; employeeID: string; name?: string; role: string; departmentId?: number };
}

async function generateExitNumber(): Promise<string> {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEndYear = fyStartYear + 1;
  const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, "0")}`;

  const latest = await (prisma as any).employeeExit.findFirst({
    where: { exitNumber: { startsWith: `EXIT-${fyString}` } },
    orderBy: { id: "desc" },
  });

  let seq = 1;
  if (latest) {
    const parts = latest.exitNumber.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `EXIT-${fyString}-${seq.toString().padStart(3, "0")}`;
}

// GET /api/employee-exit
export const getAllExits = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, employeeId } = req.query;
    const where: any = {};
    if (status) where.status = String(status);
    if (employeeId) where.employeeId = Number(employeeId);

    const exits = await (prisma as any).employeeExit.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, employeeID: true, designation: true } },
        handledBy: { select: { id: true, name: true } },
        handoverItems: {
          include: {
            asset: { select: { id: true, assetId: true, assetName: true } },
          },
        },
      },
      orderBy: { id: "desc" },
    });

    res.json(exits);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch exits" });
  }
};

// GET /api/employee-exit/:id
export const getExitById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const exit = await (prisma as any).employeeExit.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        employee: { select: { id: true, name: true, employeeId: true, designation: true, departmentId: true } },
        handledBy: { select: { id: true, name: true } },
        handoverItems: {
          include: {
            asset: { select: { id: true, assetId: true, assetName: true, status: true } },
          },
        },
      },
    });

    if (!exit) {
      res.status(404).json({ message: "Exit record not found" });
      return;
    }
    res.json(exit);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch exit" });
  }
};

// POST /api/employee-exit — initiate offboarding for an employee
export const initiateExit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const { employeeId, exitType, exitDate, handledById } = req.body;

    if (!employeeId || !exitType || !exitDate) {
      res.status(400).json({ message: "employeeId, exitType, and exitDate are required" });
      return;
    }

    // Fetch all assets currently assigned to this employee
    const assignedAssets = await prisma.asset.findMany({
      where: { allottedToId: Number(employeeId), status: { notIn: ["DISPOSED", "CONDEMNED"] } },
      select: { id: true },
    });

    const exitNumber = await generateExitNumber();

    const exit = await (prisma as any).employeeExit.create({
      data: {
        exitNumber,
        employeeId: Number(employeeId),
        exitType: String(exitType),
        exitDate: new Date(exitDate),
        handledById: handledById ? Number(handledById) : user.employeeDbId,
        status: "INITIATED",
        totalAssetsAssigned: assignedAssets.length,
        assetsReturned: 0,
        assetsPending: assignedAssets.length,
        handoverItems: {
          create: assignedAssets.map((a: { id: number }) => ({
            assetId: a.id,
            status: "PENDING",
          })),
        },
      },
      include: {
        handoverItems: true,
      },
    });

    res.status(201).json(exit);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to initiate exit" });
  }
};

// PATCH /api/employee-exit/:id/return-asset — mark a single asset as returned
export const returnAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const exitId = Number(req.params.id);
    const { exitAssetId, conditionOnReturn, handoverToId } = req.body;

    if (!exitAssetId) {
      res.status(400).json({ message: "exitAssetId required" });
      return;
    }

    const exitItem = await (prisma as any).employeeExitAsset.findFirst({
      where: { id: Number(exitAssetId), exitId },
    });

    if (!exitItem) {
      res.status(404).json({ message: "Exit asset record not found" });
      return;
    }
    if (exitItem.status === "RETURNED") {
      res.status(400).json({ message: "Asset already marked as returned" });
      return;
    }

    await (prisma as any).employeeExitAsset.update({
      where: { id: exitItem.id },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        conditionOnReturn: conditionOnReturn ?? null,
        handoverToId: handoverToId ? Number(handoverToId) : null,
      },
    });

    // Update asset: unassign it
    await prisma.asset.update({
      where: { id: exitItem.assetId },
      data: {
        allottedToId: null,
        status: "IN_STORE",
      },
    });

    // Recalculate counts on exit record
    const allItems = await (prisma as any).employeeExitAsset.findMany({ where: { exitId } });
    const returned = allItems.filter((i: any) => i.status === "RETURNED").length;
    const pending = allItems.length - returned;

    const updatedExit = await (prisma as any).employeeExit.update({
      where: { id: exitId },
      data: {
        assetsReturned: returned,
        assetsPending: pending,
        status: pending === 0 ? "COMPLETED" : "IN_PROGRESS",
      },
    });

    res.json(updatedExit);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to mark asset returned" });
  }
};

// PATCH /api/employee-exit/:id/complete — force-complete even if assets pending (with reason)
export const completeExit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = mustUser(req);
    const exitId = Number(req.params.id);

    const exit = await (prisma as any).employeeExit.findUnique({ where: { id: exitId } });
    if (!exit) {
      res.status(404).json({ message: "Exit record not found" });
      return;
    }

    const updated = await (prisma as any).employeeExit.update({
      where: { id: exitId },
      data: { status: "COMPLETED" },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to complete exit" });
  }
};

// GET /api/employee-exit/employee/:employeeId — get exit record for a specific employee
export const getExitByEmployee = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const empId = Number(req.params.employeeId);

    const exits = await (prisma as any).employeeExit.findMany({
      where: { employeeId: empId },
      include: {
        handoverItems: {
          include: {
            asset: { select: { id: true, assetId: true, assetName: true, status: true } },
          },
        },
      },
      orderBy: { id: "desc" },
    });

    res.json(exits);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch exit records" });
  }
};

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

export const addAssetLocation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const {
      assetId,
      branchId,
      block,
      floor,
      room,
      employeeResponsibleId,
        departmentSnapshot,
      rfid
    } = req.body;

    if (!assetId) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1️⃣ Close previous active locations
      await tx.assetLocation.updateMany({
        where: { assetId, isActive: true },
        data: { isActive: false }
      });

      // 2️⃣ Create new location
      const newLocation = await tx.assetLocation.create({
        data: {
          assetId,
          branchId,
          block,
          floor,
          room,
          employeeResponsibleId,
            departmentSnapshot,
          isActive: true
        }
      });

      // 3️⃣ Update asset RFID (and optionally branch)
      await tx.asset.update({
        where: { id: assetId },
        data: {
          rfidCode: rfid,
        }
      });

      return newLocation;
    });

    res.status(201).json(result);

  } catch (err) {
    console.error("Error adding location:", err);
    res.status(500).json({ message: "Failed to add location" });
  }
};


export const updateCurrentLocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const locationId = Number(req.params.locationId);
    const { assetId, branchId, block, floor, room, employeeResponsibleId,  departmentSnapshot, rfid } = req.body;

    // Option A: if frontend sends assetId
    if (!assetId) {
       res.status(400).json({ message: "assetId is required" });
       return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1) deactivate current active location(s)
      await tx.assetLocation.updateMany({
        where: { assetId, isActive: true },
        data: { isActive: false }
      });

      // 2) create a NEW active row (history)
      const newLocation = await tx.assetLocation.create({
        data: {
          assetId,
          branchId,
          block,
          floor,
          room,
          employeeResponsibleId,
            departmentSnapshot,
          isActive: true
        },
        include: { branch: true, employeeResponsible: true }
      });

      // 3) update asset RFID if passed
      if (rfid !== undefined) {
        await tx.asset.update({
          where: { id: assetId },
          data: { rfidCode: rfid }
        });
      }

      return newLocation;
    });

    res.json(result);
  } catch (err) {
    console.error("Update location error:", err);
    res.status(500).json({ message: "Failed to update location" });
  }
};
export const getCurrentLocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);

    const location = await prisma.assetLocation.findFirst({
      where: { assetId, isActive: true },
      include: { branch: true, employeeResponsible: true },
      orderBy: { createdAt: "desc" }
    });

    if (!location) {
      res.status(404).json({ message: "No active location found" });
      return;
    }

    res.json(location);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch current location" });
  }
};
export const getLocationHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);

    const history = await prisma.assetLocation.findMany({
      where: { assetId },
      include: { branch: true, employeeResponsible: true },
      orderBy: { createdAt: "desc" }
    });

    res.json(history);

  } catch (err) {
    console.error("Location history error:", err);
    res.status(500).json({ message: "Failed to fetch history" });
  }
};
export const createBranch = async (req: AuthenticatedRequest, res: Response) => {
  try {

    const branch = await prisma.branch.create({
      data: { name: req.body.name }
    });

    res.status(201).json(branch);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create branch" });
  }
};
export const getBranches = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const branches = await prisma.branch.findMany();
    res.json(branches);

  } catch (err) {
    res.status(500).json({ message: "Failed to fetch branches" });
  }
};

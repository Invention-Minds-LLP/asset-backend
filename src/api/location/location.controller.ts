import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

export const addAssetLocation = async (req:AuthenticatedRequest, res: Response) => {
    try {
      if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
         res.status(403).json({ message: "Unauthorized" });
         return
      }
  
      const {
        assetId,
        branchId,
        block,
        floor,
        room,
        employeeResponsibleId
      } = req.body;
  
      // Close previous active locations
      await prisma.assetLocation.updateMany({
        where: { assetId, isActive: true },
        data: { isActive: false }
      });
  
      // Create new location entry
      const newLocation = await prisma.assetLocation.create({
        data: {
          assetId,
          branchId,
          block,
          floor,
          room,
          employeeResponsibleId,
          isActive: true
        }
      });
  
      res.status(201).json(newLocation);
  
    } catch (err) {
      console.error("Error adding location:", err);
      res.status(500).json({ message: "Failed to add location" });
    }
  };
  export const updateCurrentLocation = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const id = Number(req.params.locationId);
      const data = req.body;
  
      const updated = await prisma.assetLocation.update({
        where: { id },
        data: {
          block: data.block,
          floor: data.floor,
          room: data.room,
          employeeResponsibleId: data.employeeResponsibleId
        }
      });
  
      res.json(updated);
  
    } catch (err) {
      console.error("Update location error:", err);
      res.status(500).json({ message: "Failed to update location" });
    }
  };
  export const getCurrentLocation = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
  
      const location = await prisma.assetLocation.findFirst({
        where: { assetId, isActive: true },
        include: { branch: true, employeeResponsible: true }
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
  export const getLocationHistory = async (req:AuthenticatedRequest, res: Response) => {
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
  export const createBranch = async (req:AuthenticatedRequest, res: Response) => {
    try {
      if (req.user.role !== "superadmin") {
         res.status(403).json({ message: "Admins only" });
         return
      }
  
      const branch = await prisma.branch.create({
        data: { name: req.body.name }
      });
  
      res.status(201).json(branch);
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create branch" });
    }
  };
  export const getBranches = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const branches = await prisma.branch.findMany();
      res.json(branches);
  
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch branches" });
    }
  };
            
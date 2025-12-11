import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
export const transferAsset = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const { assetId, toBranchId, approvedBy, temporary, expiresAt } = req.body;
  
      if (!approvedBy) {
         res.status(400).json({ message: "approvedBy is required" });
         return
      }
  
      const asset = await prisma.asset.findUnique({
        where: { id: Number(assetId) },
        include: {
          locations: {
            where: { isActive: true },
            take: 1,
            orderBy: { id: "desc" }
          }
        }
      });
  
      if (!asset) {
         res.status(404).json({ message: "Asset not found" });
         return;
      }
  
      const currentLocation = asset.locations[0] || null;
  
      const fromBranchId = currentLocation?.branchId ?? null;
  
      // 1️⃣ CLOSE PREVIOUS LOCATION
      if (currentLocation) {
        await prisma.assetLocation.update({
          where: { id: currentLocation.id },
          data: { isActive: false }
        });
      }
  
      // 2️⃣ CREATE NEW LOCATION RECORD (active)
      const newLocation = await prisma.assetLocation.create({
        data: {
          assetId: Number(assetId),
          branchId: Number(toBranchId),
          block: null,
          floor: null,
          room: null,
          employeeResponsibleId: null,
          isActive: true
        }
      });
  
      // 3️⃣ INSERT TRANSFER HISTORY
      const history = await prisma.assetTransferHistory.create({
        data: {
          assetId: Number(assetId),
          fromBranchId: fromBranchId,
          toBranchId: Number(toBranchId),
          approvedBy,
          temporary: temporary ?? false,
          expiresAt: temporary ? new Date(expiresAt) : null
        }
      });
  
       res.json({
        message: "Asset transferred successfully",
        location: newLocation,
        history
      });
      return;
  
    } catch (err) {
      console.error("Transfer error:", err);
      res.status(500).json({ message: "Asset transfer failed" });
    }
  };
  export const getTransferHistory = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
  
      const history = await prisma.assetTransferHistory.findMany({
        where: { assetId },
        include: {
          fromBranch: true,
          toBranch: true
        },
        orderBy: { transferDate: "desc" }
      });
  
      res.json(history);
  
    } catch (err) {
      console.error("Transfer history error:", err);
      res.status(500).json({ message: "Failed to fetch transfer history" });
    }
  };
  export const autoExpireTransfers = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const now = new Date();
  
      const expiringTransfers = await prisma.assetTransferHistory.findMany({
        where: {
          temporary: true,
          expiresAt: { lt: now }
        },
        orderBy: { id: "desc" },
        take: 50
      });
  
      const results = [];
  
      for (const transfer of expiringTransfers) {
        const { assetId, fromBranchId, toBranchId } = transfer;
  
        // Reverse Transfer → Back to fromBranch
        if (fromBranchId) {
          // Close current active location
          await prisma.assetLocation.updateMany({
            where: { assetId, isActive: true },
            data: { isActive: false }
          });
  
          // Create new location entry
          await prisma.assetLocation.create({
            data: {
              assetId,
              branchId: fromBranchId,
              isActive: true
            }
          });
  
          // Log transfer history
          await prisma.assetTransferHistory.create({
            data: {
              assetId,
              fromBranchId: toBranchId,   // returning from temporary branch
              toBranchId: fromBranchId,   // going back
              approvedBy: "SYSTEM-AUTO",
              temporary: false,
              expiresAt: null
            }
          });
        }
  
        results.push(transfer.id);
      }
  
      res.json({
        message: "Temporary transfers auto expired and reverted",
        processed: results
      });
  
    } catch (err) {
      console.error("Auto-expire error:", err);
      res.status(500).json({ message: "Auto-expire process failed" });
    }
  };
      
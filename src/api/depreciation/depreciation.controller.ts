import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

export const addDepreciation = async (req:AuthenticatedRequest, res: Response) => {
    try {
      if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
         res.status(403).json({ message: "Not allowed" });
         return;
      }
  
      const {
        assetId,
        depreciationMethod,
        depreciationRate,
        expectedLifeYears,
        salvageValue,
        depreciationStart
      } = req.body;
  
      const existing = await prisma.assetDepreciation.findUnique({
        where: { assetId }
      });
  
      if (existing) {
         res.status(400).json({ message: "Depreciation already exists for asset" });
         return;
      }
  
      const depreciation = await prisma.assetDepreciation.create({
        data: {
          assetId,
          depreciationMethod,
          depreciationRate: parseFloat(depreciationRate),
          expectedLifeYears: parseInt(expectedLifeYears),
          salvageValue: salvageValue ? parseFloat(salvageValue) : null,
          depreciationStart: new Date(depreciationStart),
          lastCalculatedAt: null
        }
      });
  
       res.status(201).json(depreciation);
  
    } catch (err) {
      console.error(err);
       res.status(500).json({ message: "Failed to add depreciation" });
    }
  };
  export const updateDepreciation = async (req:AuthenticatedRequest, res: Response) => {
    try {
      if (req.user.role !== "superadmin") {
         res.status(403).json({ message: "Admins only" });
         return;
      }
  
      const id = parseInt(req.params.id);
      const data = req.body;
  
      const updated = await prisma.assetDepreciation.update({
        where: { id },
        data: {
          depreciationMethod: data.depreciationMethod,
          depreciationRate: parseFloat(data.depreciationRate),
          expectedLifeYears: parseInt(data.expectedLifeYears),
          salvageValue: data.salvageValue ? parseFloat(data.salvageValue) : null,
          depreciationStart: new Date(data.depreciationStart)
        }
      });
  
       res.json(updated);
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed updating depreciation" });
    }
  };
  export const calculateDepreciation = async (req:Request, res: Response) => {
    try {
      const { assetId } = req.params;
  
      const asset = await prisma.asset.findUnique({
        where: { id: parseInt(assetId) },
        include: { depreciation: true }
      });
  
      if (!asset || !asset.depreciation) {
         res.status(404).json({ message: "Depreciation not found" });
         return;
      }
  
      const dep = asset.depreciation;
  
      const cost = asset.purchaseCost ?? asset.estimatedValue ?? 0;
      const salvage = dep.salvageValue ?? 0;
      const life = dep.expectedLifeYears;
      const rate = dep.depreciationRate;
      const method = dep.depreciationMethod;
  
      const start = new Date(dep.depreciationStart);
      const today = new Date();
  
      const diffYears =
        (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365);
  
      let depreciationTillDate = 0;
      let bookValue = 0;
  
      if (method === "SL") {
        // Straight Line
        const annual = (cost - salvage) / life;
        depreciationTillDate = Math.min(annual * diffYears, cost - salvage);
        bookValue = cost - depreciationTillDate;
      }
  
      else if (method === "DB") {
        // Declining Balance
        bookValue = cost * Math.pow((1 - rate / 100), diffYears);
        depreciationTillDate = cost - bookValue;
      }
  
       res.json({
        assetId,
        depreciationMethod: method,
        purchaseCost: cost,
        depreciationTillDate: parseFloat(depreciationTillDate.toFixed(2)),
        bookValue: parseFloat(bookValue.toFixed(2)),
        yearsUsed: parseFloat(diffYears.toFixed(2))
      });
  
    } catch (err) {
      console.error(err);
       res.status(500).json({ message: "Error calculating depreciation" });
    }
  };
  export const runAnnualDepreciation = async (req:AuthenticatedRequest, res: Response) => {
    try {
      if (req.user.role !== "superadmin") {
         res.status(403).json({ message: "Admins only" });
         return;
      }
  
      const assets = await prisma.assetDepreciation.findMany();
  
      for (const dep of assets) {
        // Update only lastCalculatedAt, not book value
        await prisma.assetDepreciation.update({
          where: { id: dep.id },
          data: { lastCalculatedAt: new Date() }
        });
      }
  
      res.json({ message: "Annual depreciation recorded" });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Batch depreciation failed" });
    }
  };
      
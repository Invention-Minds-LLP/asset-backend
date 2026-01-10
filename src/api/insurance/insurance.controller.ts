import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

export const addInsurancePolicy = async (req:AuthenticatedRequest, res: Response) => {
    try {
      // if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
      //    res.status(403).json({ message: "Not allowed" });
      //    return;
      // }
  
      const {
        assetId,
        provider,
        policyNumber,
        coverageAmount,
        premiumAmount,
        startDate,
        endDate,
        notes
      } = req.body;
  
      const insurance = await prisma.assetInsurance.create({
        data: {
          assetId: Number(assetId),
          provider,
          policyNumber,
          coverageAmount: coverageAmount ? parseFloat(coverageAmount) : null,
          premiumAmount: premiumAmount ? parseFloat(premiumAmount) : null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          isActive: true,
          notes
        }
      });
  
      
       res.status(201).json(insurance);
  
    } catch (err) {
      console.error(err);
       res.status(500).json({ message: "Failed to add insurance policy" });
       return
    }
  };
  export const updateInsurancePolicy = async (req:AuthenticatedRequest, res: Response) => {
    try {
      // if (req.user.role !== "superadmin") {
      //    res.status(403).json({ message: "Admins only" });
      //    return
      // }
  
      const id = Number(req.params.id);
      const data = req.body;
  
      const updated = await prisma.assetInsurance.update({
        where: { id },
        data: {
          provider: data.provider,
          policyNumber: data.policyNumber,
          coverageAmount: data.coverageAmount ? parseFloat(data.coverageAmount) : null,
          premiumAmount: data.premiumAmount ? parseFloat(data.premiumAmount) : null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          isActive: data.isActive,
          notes: data.notes
        }
      });
  
      res.json(updated);
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update insurance" });
    }
  };
  export const getInsuranceHistory = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const assetId = Number(req.params.assetId);
  
      const history = await prisma.assetInsurance.findMany({
        where: { assetId },
        orderBy: { id: "desc" }
      });
  

       res.json(history);
       return
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Error fetching insurance history" });
    }
  };
  export const markInsuranceExpired = async (req:AuthenticatedRequest, res: Response) => {
    try {
      const today = new Date();
  
      const expiredPolicies = await prisma.assetInsurance.updateMany({
        where: {
          endDate: { lt: today },
          isActive: true
        },
        data: { isActive: false }
      });
  
      res.json({
        message: "Expired policies updated",
        total: expiredPolicies.count
      });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to expire policies" });
    }
  };
  export const uploadInsuranceDocument = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
  
      if (!req.file) {
         res.status(400).json({ message: "No file uploaded" });
         return;
      }
  
      const filePath = `/uploads/insurance/${req.file.filename}`;
  
      const updated = await prisma.assetInsurance.update({
        where: { id },
        data: { document: filePath }
      });
  
       res.json({
        message: "Insurance document uploaded",
        file: filePath
      });
  
    } catch (err) {
      console.error(err);
       res.status(500).json({ message: "Upload failed" });

    }
  };
  
          
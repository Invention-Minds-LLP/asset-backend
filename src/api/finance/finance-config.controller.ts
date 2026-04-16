import { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

const prisma = new PrismaClient();

// GET /api/finance/config
export async function getFinanceConfig(req: AuthenticatedRequest, res: Response) {
  try {
    let config = await prisma.financeConfig.findFirst();
    if (!config) {
      config = await prisma.financeConfig.create({ data: {} });
    }
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load finance config" });
  }
}

// PUT /api/finance/config
export async function updateFinanceConfig(req: AuthenticatedRequest, res: Response) {
  if (!req.user || req.user.role !== "FINANCE") {
    res.status(403).json({ error: "FINANCE role required" }); return;
  }
  const { accountingMode, exportTarget, autoVoucher, requireApproval, fyStartMonth, defaultCurrency } = req.body;
  try {
    let config = await prisma.financeConfig.findFirst();
    if (!config) {
      config = await prisma.financeConfig.create({
        data: { accountingMode, exportTarget, autoVoucher, requireApproval, fyStartMonth, defaultCurrency, updatedById: req.user.employeeDbId }
      });
    } else {
      config = await prisma.financeConfig.update({
        where: { id: config.id },
        data: { accountingMode, exportTarget, autoVoucher, requireApproval, fyStartMonth, defaultCurrency, updatedById: req.user.employeeDbId }
      });
    }
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update finance config" });
  }
}

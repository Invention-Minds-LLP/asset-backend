import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getMaintenanceHistory = async (req: Request, res: Response) => {
  const history = await prisma.maintenanceHistory.findMany({ include: { asset: true } });
   res.json(history);
};

export const createMaintenanceRecord = async (req: Request, res: Response) => {
  const record = await prisma.maintenanceHistory.create({ data: req.body });
   res.status(201).json(record);
};

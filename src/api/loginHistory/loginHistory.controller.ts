import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllLoginHistory = async (req: Request, res: Response) => {
  const history = await prisma.loginHistory.findMany({ include: { user: true } });
   res.json(history);
};

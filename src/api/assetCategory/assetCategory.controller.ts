import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllCategories = async (req: Request, res: Response) => {
  const categories = await prisma.assetCategory.findMany();
   res.json(categories);
};

export const createCategory = async (req: Request, res: Response) => {
  const category = await prisma.assetCategory.create({ data: req.body });
   res.status(201).json(category);
};

export const deleteCategory = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.assetCategory.delete({ where: { id } });
   res.status(204).send();
};

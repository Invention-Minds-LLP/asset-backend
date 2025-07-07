import { Request, Response } from "express";
import prisma from "../../prismaClient"

// GET /warranties/
export const getAllWarranties = async (req: Request, res: Response) => {
  const warranties = await prisma.warranty.findMany({ include: { asset: true } });
   res.json(warranties);
};

// GET /warranties/:id
export const getWarrantyById = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const warranty = await prisma.warranty.findUnique({
    where: { id },
    include: { asset: true },
  });
  if (!warranty) {
    res.status(404).json({ message: "Warranty not found" });
    return
  } 
   res.json(warranty);
};

// POST /warranties/
export const createWarranty = async (req: Request, res: Response) => {
  const warranty = await prisma.warranty.create({
    data: req.body,
  });
   res.status(201).json(warranty);
};

// PUT /warranties/:id
export const updateWarranty = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const warranty = await prisma.warranty.update({
    where: { id },
    data: req.body,
  });
 res.json(warranty);
};

// DELETE /warranties/:id
export const deleteWarranty = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.warranty.delete({
    where: { id },
  });
   res.status(204).send();
};

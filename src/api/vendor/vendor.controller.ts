import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllVendors = async (req: Request, res: Response) => {
  const vendors = await prisma.vendor.findMany();
   res.json(vendors);
};

export const createVendor = async (req: Request, res: Response) => {
  const vendor = await prisma.vendor.create({ data: req.body });
   res.status(201).json(vendor);
};

export const deleteVendor = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.vendor.delete({ where: { id } });
   res.status(204).send();
};

export const updateVendor = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updatedVendor = await prisma.vendor.update({
      where: { id },
      data: req.body, // update only the fields sent in request body
    });
    res.json(updatedVendor);
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: 'Failed to update vendor.' });
  }
};
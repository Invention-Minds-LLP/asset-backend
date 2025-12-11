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
    data: {
      warrantyStart: new Date(req.body.warrantyStart),
      warrantyEnd: new Date(req.body.warrantyEnd),
      isUnderWarranty: req.body.isUnderWarranty,
      amcActive: req.body.amcActive,
      amcVendor: req.body.amcVendor,
      amcStart: req.body.amcStart ? new Date(req.body.amcStart) : null,
      amcEnd: req.body.amcEnd ? new Date(req.body.amcEnd) : null,
      amcVisitsDue: req.body.amcVisitsDue ? Number(req.body.amcVisitsDue) : null,
      lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
      nextVisitDue: req.body.nextVisitDue ? new Date(req.body.nextVisitDue) : null,
      serviceReport: req.body.serviceReport ?? null,
  
      asset: {
        connect: {
          assetId: req.body.assetId,
        },
      },
    },
  });
   res.status(201).json(warranty);
};

// PUT /warranties/:id
export const updateWarranty = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const warranty = await prisma.warranty.update({
    where: { id },
    data: {
      warrantyStart: new Date(req.body.warrantyStart),
      warrantyEnd: new Date(req.body.warrantyEnd),
      isUnderWarranty: req.body.isUnderWarranty,
      amcActive: req.body.amcActive,
      amcVendor: req.body.amcVendor,
      amcStart: req.body.amcStart ? new Date(req.body.amcStart) : null,
      amcEnd: req.body.amcEnd ? new Date(req.body.amcEnd) : null,
      amcVisitsDue: req.body.amcVisitsDue ? Number(req.body.amcVisitsDue) : null,
      lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
      nextVisitDue: req.body.nextVisitDue ? new Date(req.body.nextVisitDue) : null,
      serviceReport: req.body.serviceReport ?? null,
    },
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

export const getWarrantyByAssetId = async (req: Request, res: Response) => {
  const assetIdString = req.params.assetId;

  const warranty = await prisma.warranty.findFirst({
    where: {
      asset: {
        assetId: assetIdString, // match the assetId string in related Asset
      },
    },
    include: { asset: true },
  });

  if (!warranty) {
     res.status(404).json({ message: "Warranty not found for given assetId" });
     return
  }

  res.json(warranty);
};

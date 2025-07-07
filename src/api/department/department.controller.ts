import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllDepartments = async (req: Request, res: Response) => {
  const departments = await prisma.department.findMany();
   res.json(departments);
};

export const createDepartment = async (req: Request, res: Response) => {
  const department = await prisma.department.create({ data: req.body });
   res.status(201).json(department);
};

export const deleteDepartment = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.department.delete({ where: { id } });
   res.status(204).send();
};

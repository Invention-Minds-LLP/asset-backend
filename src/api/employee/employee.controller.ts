import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllEmployees = async (req: Request, res: Response) => {
  const employees = await prisma.employee.findMany();
   res.json(employees);
};

export const createEmployee = async (req: Request, res: Response) => {
  const employee = await prisma.employee.create({ data: req.body });
   res.status(201).json(employee);
};

export const deleteEmployee = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.employee.delete({ where: { id } });
   res.status(204).send();
};

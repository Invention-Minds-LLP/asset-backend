import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllEmployees = async (req: Request, res: Response) => {
  const employees = await prisma.employee.findMany({
    include: {
      department: true, // Include department details if needed
    },
  });
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

export const getDepartmentNameByEmployeeID = async (req: Request, res: Response) => {
  const { employeeID } = req.params;

  try {
    const employee = await prisma.employee.findUnique({
      where: { employeeID },
      include: {
        department: true,
      },
    });

    if (!employee || !employee.department) {
       res.status(404).json({ message: "Department not found for the given employeeID" });
       return;
    }

    res.json({ departmentName: employee.department });
  } catch (error) {
    console.error("Error fetching department by employeeID:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

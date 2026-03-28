import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllEmployees = async (req: Request, res: Response) => {
  try {
    const { includeInactive, search, page, limit: lim, exportCsv } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { employeeID: { contains: String(search) } },
        { email: { contains: String(search) } },
        { designation: { contains: String(search) } },
      ];
    }

    const include = {
      department: true,
      reportingTo: { select: { name: true, employeeID: true } },
    };

    if (page && lim) {
      const skip = (parseInt(String(page)) - 1) * parseInt(String(lim));
      const take = parseInt(String(lim));
      const [total, employees] = await Promise.all([
        prisma.employee.count({ where }),
        prisma.employee.findMany({ where, include, orderBy: { name: "asc" }, skip, take }),
      ]);

      if (exportCsv === "true") {
        const csvRows = employees.map((e: any) => ({
          EmployeeID: e.employeeID, Name: e.name, Email: e.email || "",
          Phone: e.phone || "", Designation: e.designation || "",
          Department: e.department?.name || "", Role: e.role,
          ReportsTo: e.reportingTo?.name || "", Active: e.isActive ? "Yes" : "No",
        }));
        const headers = Object.keys(csvRows[0] || {}).join(",");
        const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=employees.csv");
        res.send(headers + "\n" + rows);
        return;
      }

      res.json({ data: employees, total, page: parseInt(String(page)), limit: take });
      return;
    }

    const employees = await prisma.employee.findMany({ where, include, orderBy: { name: "asc" } });
    res.json(employees);
  } catch (error) {
    console.error("getAllEmployees error:", error);
    res.status(500).json({ message: "Failed to fetch employees" });
  }
};

export const createEmployee = async (req: Request, res: Response) => {
  const employee = await prisma.employee.create({ data: req.body });
   res.status(201).json(employee);
};

export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.employee.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Employee deactivated" });
  } catch (error) {
    console.error("deleteEmployee error:", error);
    res.status(500).json({ message: "Failed to deactivate employee" });
  }
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

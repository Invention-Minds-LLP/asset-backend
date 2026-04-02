import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllDepartments = async (req: Request, res: Response) => {
  try {
    const { includeInactive, search, exportCsv } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { code: { contains: String(search) } },
      ];
    }

    const departments = await prisma.department.findMany({
      where,
      include: {
        parentDepartment: { select: { name: true } },
        _count: { select: { employees: true, assets: true } },
      },
      orderBy: { name: "asc" },
    });

    if (exportCsv === "true") {
      const csvRows = departments.map((d: any) => ({
        Name: d.name, Code: d.code || "", Parent: d.parentDepartment?.name || "",
        Employees: d._count?.employees || 0, Assets: d._count?.assets || 0,
        Active: d.isActive ? "Yes" : "No",
      }));
      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=departments.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json(departments);
  } catch (error) {
    console.error("getAllDepartments error:", error);
    res.status(500).json({ message: "Failed to fetch departments" });
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  const department = await prisma.department.create({ data: req.body });
   res.status(201).json(department);
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ message: "Department name is required" });
      return;
    }
    const updated = await prisma.department.update({ where: { id }, data: { name: name.trim() } });
    res.json(updated);
  } catch (error) {
    console.error("updateDepartment error:", error);
    res.status(500).json({ message: "Failed to update department" });
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const inUse = await prisma.employee.findFirst({ where: { departmentId: id } });
    if (inUse) {
      res.status(400).json({ message: "Department has employees assigned. Reassign them first." });
      return;
    }
    // Soft delete
    await prisma.department.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Department deactivated" });
  } catch (error) {
    console.error("deleteDepartment error:", error);
    res.status(500).json({ message: "Failed to delete department" });
  }
};

// GET /api/departments/:id/assets  — all assets assigned to a department
export const getDepartmentAssets = async (req: Request, res: Response) => {
  try {
    const deptId = Number(req.params.id);
    const { status, categoryId } = req.query;

    const where: any = { departmentId: deptId };
    if (status) where.status = String(status);
    if (categoryId) where.assetCategoryId = Number(categoryId);

    const assets = await prisma.asset.findMany({
      where,
      include: {
        assetCategory: { select: { id: true, name: true } },
        allottedTo: { select: { id: true, name: true, employeeID: true, designation: true } },
        supervisor: { select: { id: true, name: true } },
      },
      orderBy: { assetName: "asc" },
    });

    const summary = {
      total: assets.length,
      byStatus: assets.reduce((acc: Record<string, number>, a: any) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({ summary, assets });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch department assets" });
  }
};

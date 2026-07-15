import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Resolve which department this request operates on.
// HOD is locked to their own department; ADMIN/CEO_COO may target any (via
// ?departmentId on reads, or departmentId in the body on writes).
function resolveScopeDept(req: AuthenticatedRequest, fromBody = false): number | null | "FORBIDDEN" {
  const user = req.user as any;
  if (user?.role === "HOD") {
    return user?.departmentId ? Number(user.departmentId) : "FORBIDDEN";
  }
  const raw = fromBody ? req.body?.departmentId : req.query?.departmentId;
  return raw != null && raw !== "" ? Number(raw) : null; // null = all (reads only)
}

// ─── List configs ─────────────────────────────────────────────────────────────
export const getSupportConfigs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dept = resolveScopeDept(req);
    if (dept === "FORBIDDEN") {
      res.status(400).json({ message: "No department associated with your account" });
      return;
    }

    const where: any = { isActive: true };
    if (dept != null) where.departmentId = dept;
    if (req.query.subTypeId) where.assetSubTypeId = Number(req.query.subTypeId);

    const configs = await prisma.subTypeSupportConfig.findMany({
      where,
      include: {
        assetSubType: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        employee: { select: { id: true, name: true, employeeID: true, role: true } },
      },
      orderBy: [{ departmentId: "asc" }, { assetSubTypeId: "asc" }],
    });

    res.json(configs);
  } catch (error) {
    console.error("getSupportConfigs error:", error);
    res.status(500).json({ message: "Failed to fetch sub-type support configs" });
  }
};

// ─── Upsert config (one engineer per sub-type per department) ──────────────────
export const upsertSupportConfig = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dept = resolveScopeDept(req, true);
    if (dept === "FORBIDDEN") {
      res.status(400).json({ message: "No department associated with your account" });
      return;
    }
    if (dept == null) {
      res.status(400).json({ message: "departmentId is required" });
      return;
    }

    const assetSubTypeId = Number(req.body?.assetSubTypeId);
    const employeeId = Number(req.body?.employeeId);
    if (!assetSubTypeId || !employeeId) {
      res.status(400).json({ message: "assetSubTypeId and employeeId are required" });
      return;
    }

    // Engineer must belong to the department they're being configured for.
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { departmentId: true, isActive: true },
    });
    if (!employee || employee.isActive === false) {
      res.status(400).json({ message: "Selected engineer not found or inactive" });
      return;
    }
    if (employee.departmentId !== dept) {
      res.status(400).json({ message: "Engineer must belong to the selected department" });
      return;
    }

    const config = await prisma.subTypeSupportConfig.upsert({
      where: { assetSubTypeId_departmentId: { assetSubTypeId, departmentId: dept } },
      update: {
        employeeId,
        isActive: true,
        notes: req.body?.notes ?? null,
      },
      create: {
        assetSubTypeId,
        departmentId: dept,
        employeeId,
        notes: req.body?.notes ?? null,
        createdById: req.user?.employeeDbId ?? null,
      },
      include: {
        assetSubType: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, employeeID: true } },
      },
    });

    res.status(201).json(config);
  } catch (error: any) {
    console.error("upsertSupportConfig error:", error);
    res.status(500).json({ message: error.message || "Failed to save config" });
  }
};

// ─── Delete config ────────────────────────────────────────────────────────────
export const deleteSupportConfig = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.subTypeSupportConfig.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Config not found" });
      return;
    }
    // HOD may only delete configs for their own department.
    const user = req.user as any;
    if (user?.role === "HOD" && existing.departmentId !== Number(user?.departmentId)) {
      res.status(403).json({ message: "Not allowed to modify another department's config" });
      return;
    }
    await prisma.subTypeSupportConfig.delete({ where: { id } });
    res.json({ message: "Config removed" });
  } catch (error) {
    console.error("deleteSupportConfig error:", error);
    res.status(500).json({ message: "Failed to delete config" });
  }
};

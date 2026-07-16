import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Resolve the department a sub-type request is scoped to.
// HOD is locked to their own department. ADMIN/others may target any department
// via ?departmentId (list) or departmentId in the body (create/update); null on
// a list means "all departments".
function resolveSubTypeDept(req: AuthenticatedRequest, fromBody = false): number | null | "FORBIDDEN" {
  const user = req.user as any;
  if (user?.role === "HOD") {
    return user?.departmentId ? Number(user.departmentId) : "FORBIDDEN";
  }
  const raw = fromBody ? req.body?.departmentId : req.query?.departmentId;
  return raw != null && raw !== "" ? Number(raw) : null;
}

// ─── List ────────────────────────────────────────────────────────────────────
// HOD → only their department's sub-types. Others → all, or a single department
// when ?departmentId is supplied (the asset form passes the asset's department).
export const getAllSubTypes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { includeInactive, search } = req.query;

    const dept = resolveSubTypeDept(req);
    if (dept === "FORBIDDEN") {
      res.status(400).json({ message: "No department associated with your account" });
      return;
    }

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (dept != null) where.departmentId = dept;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { code: { contains: String(search) } },
      ];
    }

    const subTypes = await prisma.assetSubType.findMany({
      where,
      include: {
        _count: { select: { assets: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });

    res.json(subTypes);
  } catch (error) {
    console.error("getAllSubTypes error:", error);
    res.status(500).json({ message: "Failed to fetch sub-types" });
  }
};

// Allowed fields for create/update — prevents Prisma errors from extra fields
function pickSubTypeFields(body: any) {
  return {
    name: body.name?.trim(),
    code: body.code?.trim() || null,
    description: body.description ?? null,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────
export const createSubType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = pickSubTypeFields(req.body);
    if (!data.name) { res.status(400).json({ message: "Sub-type name is required" }); return; }

    const dept = resolveSubTypeDept(req, true);
    if (dept === "FORBIDDEN") {
      res.status(400).json({ message: "No department associated with your account" });
      return;
    }
    if (dept == null) {
      res.status(400).json({ message: "departmentId is required" });
      return;
    }

    const subType = await prisma.assetSubType.create({
      data: { ...data, departmentId: dept, createdById: req.user?.employeeDbId ?? null } as any,
    });
    res.status(201).json(subType);
  } catch (error: any) {
    console.error("createSubType error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ message: "A sub-type with that name or code already exists" });
      return;
    }
    res.status(500).json({ message: error.message || "Failed to create sub-type" });
  }
};

// ─── Update ──────────────────────────────────────────────────────────────────
export const updateSubType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = pickSubTypeFields(req.body);
    if (!data.name) { res.status(400).json({ message: "Sub-type name is required" }); return; }

    const user = req.user as any;
    // HOD may only edit sub-types that belong to their own department.
    if (user?.role === "HOD") {
      const existing = await prisma.assetSubType.findUnique({ where: { id }, select: { departmentId: true } });
      if (!existing || existing.departmentId !== Number(user?.departmentId)) {
        res.status(403).json({ message: "Not allowed to modify another department's sub-type" });
        return;
      }
    }

    const payload: any = { ...data, updatedById: req.user?.employeeDbId ?? null };
    // Admin may reassign the owning department; HOD cannot move it out of theirs.
    if (user?.role !== "HOD" && req.body?.departmentId != null && req.body.departmentId !== "") {
      payload.departmentId = Number(req.body.departmentId);
    }

    const updated = await prisma.assetSubType.update({ where: { id }, data: payload });
    res.json(updated);
  } catch (error: any) {
    console.error("updateSubType error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ message: "A sub-type with that name or code already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to update sub-type" });
  }
};

// ─── Delete (soft) ───────────────────────────────────────────────────────────
export const deleteSubType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const user = req.user as any;
    if (user?.role === "HOD") {
      const existing = await prisma.assetSubType.findUnique({ where: { id }, select: { departmentId: true } });
      if (!existing || existing.departmentId !== Number(user?.departmentId)) {
        res.status(403).json({ message: "Not allowed to modify another department's sub-type" });
        return;
      }
    }
    const inUse = await prisma.asset.findFirst({ where: { assetSubTypeId: id } });
    if (inUse) {
      res.status(400).json({ message: "Sub-type is assigned to assets. Cannot delete." });
      return;
    }
    await prisma.assetSubType.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Sub-type deactivated" });
  } catch (error) {
    console.error("deleteSubType error:", error);
    res.status(500).json({ message: "Failed to delete sub-type" });
  }
};

// ─── HOD summary — asset counts per sub-type, split source vs target dept ──────
// HOD: scoped to own department. ADMIN/CEO_COO: all departments, or a single
// department via ?departmentId. "source" = asset.departmentId (owning dept);
// "target" = asset.targetDepartmentId (end-user dept).
export const getSubTypeSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const role = user?.role;

    let departmentId: number | undefined;
    if (role === "HOD") {
      if (!user?.departmentId) {
        res.status(400).json({ message: "No department associated with your account" });
        return;
      }
      departmentId = Number(user.departmentId);
    } else if (req.query.departmentId) {
      departmentId = Number(req.query.departmentId);
    }

    const sourceWhere: any = { assetSubTypeId: { not: null } };
    const targetWhere: any = { assetSubTypeId: { not: null } };
    if (departmentId) {
      sourceWhere.departmentId = departmentId;
      targetWhere.targetDepartmentId = departmentId;
    }

    const [subTypes, sourceCounts, targetCounts] = await Promise.all([
      prisma.assetSubType.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
      prisma.asset.groupBy({
        by: ["assetSubTypeId"],
        where: sourceWhere,
        _count: { _all: true },
      }),
      prisma.asset.groupBy({
        by: ["assetSubTypeId"],
        where: targetWhere,
        _count: { _all: true },
      }),
    ]);

    const sourceMap = new Map<number, number>();
    for (const row of sourceCounts) {
      if (row.assetSubTypeId != null) sourceMap.set(row.assetSubTypeId, row._count._all);
    }
    const targetMap = new Map<number, number>();
    for (const row of targetCounts) {
      if (row.assetSubTypeId != null) targetMap.set(row.assetSubTypeId, row._count._all);
    }

    const rows = subTypes.map((st) => ({
      subTypeId: st.id,
      name: st.name,
      code: st.code,
      sourceCount: sourceMap.get(st.id) ?? 0,
      targetCount: targetMap.get(st.id) ?? 0,
    }));

    // Only surface sub-types that have at least one asset in scope
    const nonEmpty = rows.filter((r) => r.sourceCount > 0 || r.targetCount > 0);

    res.json({
      departmentId: departmentId ?? null,
      scope: departmentId ? "DEPARTMENT" : "ALL",
      rows: nonEmpty,
      totals: {
        sourceCount: nonEmpty.reduce((s, r) => s + r.sourceCount, 0),
        targetCount: nonEmpty.reduce((s, r) => s + r.targetCount, 0),
      },
    });
  } catch (error) {
    console.error("getSubTypeSummary error:", error);
    res.status(500).json({ message: "Failed to fetch sub-type summary" });
  }
};

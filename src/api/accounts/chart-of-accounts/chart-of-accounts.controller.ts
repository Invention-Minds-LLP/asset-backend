import { Request, Response } from "express";
import prisma from "../../../prismaClient";
import { AuthenticatedRequest } from "../../../middleware/authMiddleware";
import { logAction } from "../../audit-trail/audit-trail.controller";

// GET /api/accounts/chart-of-accounts
export const getAllAccounts = async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.chartOfAccount.findMany({
      include: { children: true, parent: { select: { id: true, code: true, name: true } } },
      orderBy: { code: "asc" },
    });
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch chart of accounts" });
  }
};

// GET /api/accounts/chart-of-accounts/:id
export const getAccountById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const account = await prisma.chartOfAccount.findUnique({
      where: { id },
      include: { children: true, parent: true },
    });
    if (!account) { res.status(404).json({ message: "Account not found" }); return; }
    res.json(account);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch account" });
  }
};

// POST /api/accounts/chart-of-accounts
export const createAccount = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, name, type, subType, description, parentId } = req.body;
    if (!code || !name || !type) {
      res.status(400).json({ message: "code, name and type are required" }); return;
    }
    const account = await prisma.chartOfAccount.create({
      data: { code, name, type, subType: subType ?? null, description: description ?? null, parentId: parentId ? Number(parentId) : null },
    });
    logAction({ entityType: "CHART_OF_ACCOUNT", entityId: account.id, action: "CREATE", description: `Account ${account.code} - ${account.name} created`, performedById: (req as any).user?.employeeDbId });
    res.status(201).json(account);
  } catch (err: any) {
    if (err.code === "P2002") { res.status(409).json({ message: "Account code already exists" }); return; }
    console.error(err);
    res.status(500).json({ message: "Failed to create account" });
  }
};

// PUT /api/accounts/chart-of-accounts/:id
export const updateAccount = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, subType, description, parentId, isActive } = req.body;
    const updated = await prisma.chartOfAccount.update({
      where: { id },
      data: { name, subType: subType ?? null, description: description ?? null, parentId: parentId ? Number(parentId) : null, isActive: isActive ?? true },
    });
    logAction({ entityType: "CHART_OF_ACCOUNT", entityId: id, action: "UPDATE", description: `Account ${updated.code} updated`, performedById: (req as any).user?.employeeDbId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update account" });
  }
};

// DELETE /api/accounts/chart-of-accounts/:id
export const deleteAccount = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.chartOfAccount.update({ where: { id }, data: { isActive: false } });
    logAction({ entityType: "CHART_OF_ACCOUNT", entityId: id, action: "DELETE", description: `Account deactivated`, performedById: (req as any).user?.employeeDbId });
    res.json({ message: "Account deactivated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to deactivate account" });
  }
};

// GET /api/accounts/chart-of-accounts/dropdown  — for voucher form selects
export const getAccountsDropdown = async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.chartOfAccount.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, type: true, subType: true },
      orderBy: { code: "asc" },
    });
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch accounts dropdown" });
  }
};

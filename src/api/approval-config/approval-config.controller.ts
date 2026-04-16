import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ═══════════════════════════════════════════════════════════
// GET / — List all approval configs
// ═══════════════════════════════════════════════════════════
export const listApprovalConfigs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { module } = req.query;
    const where: any = {};
    if (module) where.module = String(module);

    const configs = await prisma.approvalConfig.findMany({
      where,
      orderBy: [{ module: "asc" }, { level: "asc" }],
    });

    res.json(configs);
  } catch (err: any) {
    console.error("listApprovalConfigs error:", err);
    res.status(500).json({ error: "Failed to list approval configs", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST / — Create or upsert config
// ═══════════════════════════════════════════════════════════
export const createApprovalConfig = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { module, level, roleName, minAmount, maxAmount } = req.body;

    if (!module || level == null || !roleName || minAmount == null) {
      res.status(400).json({ error: "module, level, roleName, and minAmount are required" });
      return;
    }

    const config = await prisma.approvalConfig.upsert({
      where: { module_level: { module, level: Number(level) } },
      update: {
        roleName,
        minAmount,
        maxAmount: maxAmount ?? null,
        isActive: true,
      },
      create: {
        module,
        level: Number(level),
        roleName,
        minAmount,
        maxAmount: maxAmount ?? null,
        isActive: true,
      },
    });

    res.status(201).json(config);
  } catch (err: any) {
    console.error("createApprovalConfig error:", err);
    res.status(500).json({ error: "Failed to create approval config", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PUT /:id — Update config
// ═══════════════════════════════════════════════════════════
export const updateApprovalConfig = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { module, level, roleName, minAmount, maxAmount, isActive } = req.body;

    const existing = await prisma.approvalConfig.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Approval config not found" });
      return;
    }

    const updated = await prisma.approvalConfig.update({
      where: { id },
      data: {
        ...(module !== undefined && { module }),
        ...(level !== undefined && { level: Number(level) }),
        ...(roleName !== undefined && { roleName }),
        ...(minAmount !== undefined && { minAmount }),
        ...(maxAmount !== undefined && { maxAmount }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch (err: any) {
    console.error("updateApprovalConfig error:", err);
    res.status(500).json({ error: "Failed to update approval config", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// DELETE /:id — Delete config
// ═══════════════════════════════════════════════════════════
export const deleteApprovalConfig = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.approvalConfig.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Approval config not found" });
      return;
    }

    await prisma.approvalConfig.delete({ where: { id } });
    res.json({ message: "Approval config deleted" });
  } catch (err: any) {
    console.error("deleteApprovalConfig error:", err);
    res.status(500).json({ error: "Failed to delete approval config", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /seed — Seed default approval levels
// ═══════════════════════════════════════════════════════════
export const seedApprovalConfigs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const defaults = [
      // PURCHASE_ORDER — roleName maps to approvalChain keys in purchase-order.controller.ts
      { module: "PURCHASE_ORDER", level: 1, roleName: "HOD",        minAmount: 0,         maxAmount: 100000 },
      { module: "PURCHASE_ORDER", level: 2, roleName: "MANAGEMENT", minAmount: 100001,    maxAmount: 500000 },
      { module: "PURCHASE_ORDER", level: 3, roleName: "COO",        minAmount: 500001,    maxAmount: 2000000 },
      { module: "PURCHASE_ORDER", level: 4, roleName: "CFO",        minAmount: 2000001,   maxAmount: null },
      // WORK_ORDER
      { module: "WORK_ORDER", level: 1, roleName: "HOD",        minAmount: 0,         maxAmount: 100000 },
      { module: "WORK_ORDER", level: 2, roleName: "MANAGEMENT", minAmount: 100001,    maxAmount: 500000 },
      { module: "WORK_ORDER", level: 3, roleName: "COO",        minAmount: 500001,    maxAmount: 2000000 },
      { module: "WORK_ORDER", level: 4, roleName: "CFO",        minAmount: 2000001,   maxAmount: null },
      // DISPOSAL
      { module: "DISPOSAL", level: 1, roleName: "HOD",        minAmount: 0,         maxAmount: 100000 },
      { module: "DISPOSAL", level: 2, roleName: "MANAGEMENT", minAmount: 100001,    maxAmount: 500000 },
      { module: "DISPOSAL", level: 3, roleName: "COO",        minAmount: 500001,    maxAmount: 2000000 },
      { module: "DISPOSAL", level: 4, roleName: "CFO",        minAmount: 2000001,   maxAmount: null },
    ];

    const results = [];
    for (const d of defaults) {
      const config = await prisma.approvalConfig.upsert({
        where: { module_level: { module: d.module, level: d.level } },
        update: {
          roleName: d.roleName,
          minAmount: d.minAmount,
          maxAmount: d.maxAmount,
          isActive: true,
        },
        create: {
          module: d.module,
          level: d.level,
          roleName: d.roleName,
          minAmount: d.minAmount,
          maxAmount: d.maxAmount,
          isActive: true,
        },
      });
      results.push(config);
    }

    res.status(201).json({ message: "Seeded approval configs", count: results.length, configs: results });
  } catch (err: any) {
    console.error("seedApprovalConfigs error:", err);
    res.status(500).json({ error: "Failed to seed approval configs", details: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /required-level — Which role needs to approve for a given amount?
// ═══════════════════════════════════════════════════════════
export const getRequiredLevel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { module, amount } = req.query;

    if (!module || amount == null) {
      res.status(400).json({ error: "module and amount query params are required" });
      return;
    }

    const amt = Number(amount);

    const configs = await prisma.approvalConfig.findMany({
      where: {
        module: String(module),
        isActive: true,
      },
      orderBy: { level: "asc" },
    });

    if (configs.length === 0) {
      res.status(404).json({ error: `No approval config found for module ${module}` });
      return;
    }

    // Find the matching level for the given amount
    const matched = configs.find((c) => {
      const min = Number(c.minAmount);
      const max = c.maxAmount !== null ? Number(c.maxAmount) : Infinity;
      return amt >= min && amt <= max;
    });

    if (!matched) {
      // If no range matches, return the highest level (unlimited)
      const highest = configs[configs.length - 1];
      res.json({
        module: String(module),
        amount: amt,
        requiredLevel: highest.level,
        requiredRole: highest.roleName,
        allLevels: configs.map((c) => ({
          level: c.level,
          roleName: c.roleName,
          minAmount: Number(c.minAmount),
          maxAmount: c.maxAmount !== null ? Number(c.maxAmount) : null,
        })),
      });
      return;
    }

    res.json({
      module: String(module),
      amount: amt,
      requiredLevel: matched.level,
      requiredRole: matched.roleName,
      allLevels: configs.map((c) => ({
        level: c.level,
        roleName: c.roleName,
        minAmount: Number(c.minAmount),
        maxAmount: c.maxAmount !== null ? Number(c.maxAmount) : null,
      })),
    });
  } catch (err: any) {
    console.error("getRequiredLevel error:", err);
    res.status(500).json({ error: "Failed to get required approval level", details: err.message });
  }
};

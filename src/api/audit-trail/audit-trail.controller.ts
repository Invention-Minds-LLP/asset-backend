import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// ---------------------------------------------------------------------------
// Helper function – importable by other controllers to log actions
// ---------------------------------------------------------------------------
export const logAction = async (params: {
  entityType: string;
  entityId: number;
  action: string;
  description?: string;
  oldValue?: string;
  newValue?: string;
  performedBy?: string;
  performedById?: number;
  ipAddress?: string;
  userAgent?: string;
}) => {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        description: params.description ?? null,
        oldValue: params.oldValue ?? null,
        newValue: params.newValue ?? null,
        performedBy: params.performedBy ?? null,
        performedById: params.performedById ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (error) {
    // Logging should never break the main flow – swallow & print
    console.error("Failed to write audit log:", error);
  }
};

// ---------------------------------------------------------------------------
// GET /  –  paginated & filtered list
// ---------------------------------------------------------------------------
export const getAuditLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      entityType,
      entityId,
      action,
      performedById,
      dateFrom,
      dateTo,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(parseInt(page || "1", 10), 1);
    const limitNum = Math.max(parseInt(limit || "20", 10), 1);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (entityType) {
      where.entityType = entityType;
    }
    if (entityId) {
      where.entityId = Number(entityId);
    }
    if (action) {
      where.action = action;
    }
    if (performedById) {
      where.performedById = Number(performedById);
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
    ]);

    res.json({
      data: logs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
};

// ---------------------------------------------------------------------------
// GET /:entityType/:entityId  –  all logs for a specific entity
// ---------------------------------------------------------------------------
export const getAuditLogsByEntity = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entityType, entityId } = req.params;

    const logs = await prisma.auditLog.findMany({
      where: {
        entityType,
        entityId: Number(entityId),
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(logs);
  } catch (error) {
    console.error("Error fetching audit logs by entity:", error);
    res.status(500).json({ error: "Failed to fetch audit logs for entity" });
  }
};

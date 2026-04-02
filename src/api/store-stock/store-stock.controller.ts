import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";

// ═══════════════════════════════════════════════════════════
// GET STOCK BY STORE
// ═══════════════════════════════════════════════════════════
export const getStockByStore = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = Number(req.params.storeId);

    const stock = await prisma.storeStockPosition.findMany({
      where: { storeId },
      orderBy: { id: "desc" },
    });

    // Enrich with item names
    const enriched = await Promise.all(
      stock.map(async (s) => {
        let itemName = "";
        if (s.itemType === "SPARE_PART" && s.sparePartId) {
          const sp = await prisma.sparePart.findUnique({
            where: { id: s.sparePartId },
            select: { name: true, partNumber: true },
          });
          itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
        } else if (s.itemType === "CONSUMABLE" && s.consumableId) {
          const c = await prisma.consumable.findUnique({
            where: { id: s.consumableId },
            select: { name: true },
          });
          itemName = c?.name ?? "";
        }
        return { ...s, itemName };
      })
    );

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET STOCK SUMMARY (aggregate across all stores)
// ═══════════════════════════════════════════════════════════
export const getStockSummary = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = await prisma.storeStockPosition.groupBy({
      by: ["itemType", "sparePartId", "consumableId"],
      _sum: {
        currentQty: true,
        reservedQty: true,
        availableQty: true,
      },
    });

    // Enrich with item names
    const enriched = await Promise.all(
      summary.map(async (s) => {
        let itemName = "";
        if (s.itemType === "SPARE_PART" && s.sparePartId) {
          const sp = await prisma.sparePart.findUnique({
            where: { id: s.sparePartId },
            select: { name: true, partNumber: true },
          });
          itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
        } else if (s.itemType === "CONSUMABLE" && s.consumableId) {
          const c = await prisma.consumable.findUnique({
            where: { id: s.consumableId },
            select: { name: true },
          });
          itemName = c?.name ?? "";
        }
        return {
          itemType: s.itemType,
          sparePartId: s.sparePartId,
          consumableId: s.consumableId,
          itemName,
          totalCurrentQty: s._sum.currentQty,
          totalReservedQty: s._sum.reservedQty,
          totalAvailableQty: s._sum.availableQty,
        };
      })
    );

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET LOW STOCK ALERTS
// ═══════════════════════════════════════════════════════════
export const getLowStockAlerts = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    // Prisma doesn't support field-to-field comparison directly, so filter in application code
    const allWithReorder = await prisma.storeStockPosition.findMany({
      where: { reorderLevel: { not: null } },
      include: {
        store: { select: { id: true, name: true } },
      },
    });

    const lowStock = allWithReorder.filter(
      (s) => s.reorderLevel && s.currentQty.lessThanOrEqualTo(s.reorderLevel)
    );

    // Enrich with names
    const enriched = await Promise.all(
      lowStock.map(async (s) => {
        let itemName = "";
        if (s.itemType === "SPARE_PART" && s.sparePartId) {
          const sp = await prisma.sparePart.findUnique({
            where: { id: s.sparePartId },
            select: { name: true, partNumber: true },
          });
          itemName = sp ? `${sp.name}${sp.partNumber ? ` (${sp.partNumber})` : ""}` : "";
        } else if (s.itemType === "CONSUMABLE" && s.consumableId) {
          const c = await prisma.consumable.findUnique({
            where: { id: s.consumableId },
            select: { name: true },
          });
          itemName = c?.name ?? "";
        }
        return { ...s, itemName };
      })
    );

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// ADJUST STOCK
// ═══════════════════════════════════════════════════════════
export const adjustStock = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = Number(req.params.storeId);
    const { itemType, sparePartId, consumableId, adjustmentQty, reason } = req.body;

    if (!itemType || adjustmentQty === undefined || adjustmentQty === null) {
      res.status(400).json({ message: "itemType and adjustmentQty are required" });
      return;
    }

    const adjQty = new Prisma.Decimal(adjustmentQty);

    const result = await prisma.$transaction(async (tx) => {
      // Find or create stock position
      const stockWhere: Prisma.StoreStockPositionWhereInput = {
        storeId,
        itemType,
        ...(itemType === "SPARE_PART" ? { sparePartId: Number(sparePartId) } : {}),
        ...(itemType === "CONSUMABLE" ? { consumableId: Number(consumableId) } : {}),
      };

      let stock = await tx.storeStockPosition.findFirst({ where: stockWhere });

      if (!stock) {
        // Negative adjustment with no existing stock not allowed
        if (adjQty.lessThan(0)) {
          throw new Error("Cannot apply negative adjustment: no stock position exists");
        }
        stock = await tx.storeStockPosition.create({
          data: {
            storeId,
            itemType,
            sparePartId: sparePartId ? Number(sparePartId) : null,
            consumableId: consumableId ? Number(consumableId) : null,
            currentQty: adjQty,
            availableQty: adjQty,
          },
        });
      } else {
        // Prevent going negative
        const newQty = stock.currentQty.add(adjQty);
        if (newQty.lessThan(0)) {
          throw new Error(
            `Adjustment would result in negative stock. Current: ${stock.currentQty}, Adjustment: ${adjQty}`
          );
        }

        stock = await tx.storeStockPosition.update({
          where: { id: stock.id },
          data: {
            currentQty: { increment: adjQty },
            availableQty: { increment: adjQty },
            lastUpdatedAt: new Date(),
          },
        });
      }

      // Create inventory transaction
      const invTx = await tx.inventoryTransaction.create({
        data: {
          type: "ADJUSTMENT",
          sparePartId: sparePartId ? Number(sparePartId) : null,
          consumableId: consumableId ? Number(consumableId) : null,
          quantity: adjQty,
          referenceType: "MANUAL",
          storeId,
          performedById: req.user?.employeeDbId ?? null,
          notes: reason || "Stock adjustment",
        },
      });

      return { stockPosition: stock, transaction: invTx };
    });

    res.json(result);
  } catch (e: any) {
    const statusCode = e.message?.includes("negative") ? 400 : 500;
    res.status(statusCode).json({ message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET STOCK MOVEMENTS
// ═══════════════════════════════════════════════════════════
export const getStockMovements = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = Number(req.params.storeId);
    const { page = "1", limit = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.InventoryTransactionWhereInput = { storeId };

    const [data, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          sparePart: { select: { id: true, name: true, partNumber: true } },
          consumable: { select: { id: true, name: true } },
          performedBy: { select: { id: true, employeeID: true, name: true } },
        },
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

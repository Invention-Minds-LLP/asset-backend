import { Request, Response } from "express";
import prisma from "../../prismaClient";

// ================= CREATE =================
export const createSparePart = async (req: Request, res: Response) => {
    try {
        const {
            name,
            partNumber,
            model,
            category,
            vendorId,
            stockQuantity,
            reorderLevel,
            cost
        } = req.body;

        if (!name) {
            res.status(400).json({ message: "Name is required" });
            return;
        }

        const spare = await prisma.sparePart.create({
            data: {
                name,
                partNumber: partNumber || null,
                model: model || null,
                category: category || null,
                vendorId: vendorId ? Number(vendorId) : null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: Number(reorderLevel || 0),
                cost: cost ? Number(cost) : null
            }
        });

        res.json(spare);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= GET ALL =================
export const getAllSpareParts = async (_: Request, res: Response) => {
    try {
        const list = await prisma.sparePart.findMany({
            orderBy: { id: "desc" },
            include: {
                vendor: true
            }
        });

        res.json(list);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= UPDATE =================
export const updateSparePart = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        const {
            name,
            partNumber,
            model,
            category,
            vendorId,
            stockQuantity,
            reorderLevel,
            cost
        } = req.body;

        if (stockQuantity < 0) {
            res.status(400).json({ message: "Stock cannot be negative" });
            return;
        }

        const updated = await prisma.sparePart.update({
            where: { id },
            data: {
                name,
                partNumber: partNumber || null,
                model: model || null,
                category: category || null,
                vendorId: vendorId ? Number(vendorId) : null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: Number(reorderLevel || 0),
                cost: cost ? Number(cost) : null
            }
        });

        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= DELETE =================
export const deleteSparePart = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        const usage = await prisma.sparePartUsage.findFirst({
            where: { sparePartId: id }
        });

        if (usage) {
            res.status(400).json({
                message: "Cannot delete spare part. It is already used in maintenance."
            });
            return;
        }

        await prisma.sparePart.delete({
            where: { id }
        });

        res.json({ message: "Deleted successfully" });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};


// ================= CREATE =================
export const createConsumable = async (req: Request, res: Response) => {
    try {
        const { name, unit, stockQuantity, reorderLevel } = req.body;

        if (!name) {
            res.status(400).json({ message: "Name is required" });
            return;
        }

        const consumable = await prisma.consumable.create({
            data: {
                name,
                unit: unit || null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: reorderLevel ? Number(reorderLevel) : null
            }
        });

        res.json(consumable);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= GET ALL =================
export const getAllConsumables = async (_: Request, res: Response) => {
    try {
        const list = await prisma.consumable.findMany({
            orderBy: { id: "desc" }
        });

        res.json(list);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= UPDATE =================
export const updateConsumable = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        const { name, unit, stockQuantity, reorderLevel } = req.body;

        const updated = await prisma.consumable.update({
            where: { id },
            data: {
                name,
                unit: unit || null,
                stockQuantity: Number(stockQuantity || 0),
                reorderLevel: reorderLevel ? Number(reorderLevel) : null
            }
        });

        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};

// ================= DELETE =================
export const deleteConsumable = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        await prisma.consumable.delete({
            where: { id }
        });

        res.json({ message: "Deleted successfully" });
    } catch (e: any) {
        res.status(500).json({ message: e.message });
    }
};
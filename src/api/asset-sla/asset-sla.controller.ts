import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const createAssetSlaMatrix = async (req: Request, res: Response) => {
    try {
        const {
            assetCategoryId,
            slaCategory,
            level,
            responseTimeValue,
            responseTimeUnit,
            resolutionTimeValue,
            resolutionTimeUnit,
            isActive
        } = req.body;

        if (
            !assetCategoryId ||
            !slaCategory ||
            !level ||
            responseTimeValue == null ||
            !responseTimeUnit ||
            resolutionTimeValue == null ||
            !resolutionTimeUnit
        ) {
            res.status(400).json({ message: "All required fields must be provided" });
            return;
        }

        const created = await prisma.assetSlaMatrix.create({
            data: {
                assetCategoryId: Number(assetCategoryId),
                slaCategory,
                level,
                responseTimeValue: Number(responseTimeValue),
                responseTimeUnit,
                resolutionTimeValue: Number(resolutionTimeValue),
                resolutionTimeUnit,
                isActive: isActive ?? true
            }
        });

        res.status(201).json(created);
    } catch (err: any) {
        console.error("createAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to create SLA matrix",
            error: err.message
        });
    }
};

export const getAllAssetSlaMatrix = async (_req: Request, res: Response) => {
    try {
        const rows = await prisma.assetSlaMatrix.findMany({
            include: {
                assetCategory: true
            },
            orderBy: [
                { assetCategoryId: "asc" },
                { slaCategory: "asc" },
                { level: "asc" }
            ]
        });

        res.json(rows);
    } catch (err: any) {
        console.error("getAllAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to fetch SLA matrix",
            error: err.message
        });
    }
};

export const getAssetSlaMatrixByCategory = async (req: Request, res: Response) => {
    try {
        const assetCategoryId = Number(req.params.assetCategoryId);

        const rows = await prisma.assetSlaMatrix.findMany({
            where: {
                assetCategoryId,
                isActive: true
            },
            orderBy: [
                { slaCategory: "asc" },
                { level: "asc" }
            ]
        });

        res.json(rows);
    } catch (err: any) {
        console.error("getAssetSlaMatrixByCategory error:", err);
        res.status(500).json({
            message: "Failed to fetch category SLA matrix",
            error: err.message
        });
    }
};

export const getAssetSlaMatrixByCategoryAndSla = async (req: Request, res: Response) => {
    try {
        const assetCategoryId = Number(req.params.assetCategoryId);
        const slaCategory = req.params.slaCategory as "LOW" | "MEDIUM" | "HIGH";

        if (Number.isNaN(assetCategoryId)) {
            res.status(400).json({ message: "Invalid assetCategoryId" });
            return;
        }

        const rows = await prisma.assetSlaMatrix.findMany({
            where: {
                assetCategoryId,
                slaCategory,
                isActive: true
            },
            orderBy: {
                level: "asc"
            }
        });

        res.json(rows);
    } catch (err: any) {
        console.error("getAssetSlaMatrixByCategoryAndSla error:", err);
        res.status(500).json({
            message: "Failed to fetch SLA matrix by category and SLA",
            error: err.message
        });
    }
};

export const updateAssetSlaMatrix = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const {
            responseTimeValue,
            responseTimeUnit,
            resolutionTimeValue,
            resolutionTimeUnit,
            isActive
        } = req.body;

        const updated = await prisma.assetSlaMatrix.update({
            where: { id },
            data: {
                responseTimeValue: responseTimeValue != null ? Number(responseTimeValue) : undefined,
                responseTimeUnit: responseTimeUnit ?? undefined,
                resolutionTimeValue: resolutionTimeValue != null ? Number(resolutionTimeValue) : undefined,
                resolutionTimeUnit: resolutionTimeUnit ?? undefined,
                isActive: isActive ?? undefined
            }
        });

        res.json(updated);
    } catch (err: any) {
        console.error("updateAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to update SLA matrix",
            error: err.message
        });
    }
};

export const deleteAssetSlaMatrix = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);

        await prisma.assetSlaMatrix.delete({
            where: { id }
        });

        res.status(204).send();
    } catch (err: any) {
        console.error("deleteAssetSlaMatrix error:", err);
        res.status(500).json({
            message: "Failed to delete SLA matrix",
            error: err.message
        });
    }
};
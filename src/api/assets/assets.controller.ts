import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllAssets = async (req: Request, res: Response) => {
    const assets = await prisma.asset.findMany(
        {
            include: { assetCategory: true, vendor: true, department: true, allottedTo: true }
        });
    res.json(assets);
};

export const getAssetById = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const asset = await prisma.asset.findUnique(
        {
            where: { id },
            include: {
                assetCategory: true,
                vendor: true,
                department: true,
                allottedTo: true
            }
        });

    if (!asset) {
        res.status(404).json({ message: "Asset not found" });
        return;
    }
    res.json(asset);
};

export const createAsset = async (req: Request, res: Response) => {
    // 1️⃣ Determine the financial year (e.g., FY2025-26)
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEndYear = fyStartYear + 1;
    const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, '0')}`;

    // 2️⃣ Find the latest asset ID in this FY
    const latestAsset = await prisma.asset.findFirst({
        where: {
            assetId: {
                startsWith: `AST-${fyString}`
            }
        },
        orderBy: {
            id: 'desc'
        }
    });

    // 3️⃣ Extract last sequence number or start at 0
    let nextNumber = 1;
    if (latestAsset) {
        const parts = latestAsset.assetId.split('-');
        const lastSeq = parseInt(parts[3], 10);
        nextNumber = lastSeq + 1;
    }

    // 4️⃣ Generate asset ID
    const assetId = `AST-${fyString}-${nextNumber.toString().padStart(3, '0')}`;
    const asset = await prisma.asset.create({
        data: {
            ...req.body,     // spread your request data
            assetId,         // include your generated assetId
        }
    });
    res.status(201).json(asset);
};

export const updateAsset = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const asset = await prisma.asset.update(
        {
            where: { id },
            data: req.body
        }
    );
    res.json(asset);
};

export const deleteAsset = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await prisma.asset.delete(
        { where: { id } }
    );
    res.status(204).send();
};

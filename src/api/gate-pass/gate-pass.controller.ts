import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Generate unique gate pass number: GP-YYYYMMDD-NNNN
async function generateGatePassNo(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.gatePass.count({
    where: { gatePassNo: { startsWith: `GP-${dateStr}` } },
  });
  const seq = String(count + 1).padStart(4, "0");
  return `GP-${dateStr}-${seq}`;
}

export const createGatePass = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      type,
      assetId,
      description,
      quantity,
      issuedTo,
      purpose,
      expectedReturnDate,
      courierDetails,
      vehicleNo,
      approvedBy,
      issuedBy,
      reason,
    } = req.body;

    if (!type || !issuedTo || !purpose) {
      res.status(400).json({ message: "type, issuedTo and purpose are required" });
      return;
    }

    const gatePassNo = await generateGatePassNo();

    const gatePass = await prisma.gatePass.create({
      data: {
        gatePassNo,
        type,
        status: "ISSUED",
        assetId: assetId ? Number(assetId) : undefined,
        description,
        quantity: quantity ? Number(quantity) : undefined,
        issuedTo,
        purpose,
        expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : undefined,
        courierDetails,
        vehicleNo,
        approvedBy,
        issuedBy,
        reason,
      },
      include: { asset: { select: { assetId: true, assetName: true } } },
    });

    res.status(201).json(gatePass);
  } catch (error) {
    console.error("createGatePass error:", error);
    res.status(500).json({ message: "Failed to create gate pass" });
  }
};

export const getAllGatePasses = async (req: Request, res: Response) => {
  try {
    const { status, type, assetId } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (type) where.type = String(type);
    if (assetId) where.assetId = Number(assetId);

    const gatePasses = await prisma.gatePass.findMany({
      where,
      include: { asset: { select: { assetId: true, assetName: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(gatePasses);
  } catch (error) {
    console.error("getAllGatePasses error:", error);
    res.status(500).json({ message: "Failed to fetch gate passes" });
  }
};

export const getGatePassById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const gatePass = await prisma.gatePass.findUnique({
      where: { id },
      include: { asset: { select: { assetId: true, assetName: true, assetType: true } } },
    });

    if (!gatePass) {
      res.status(404).json({ message: "Gate pass not found" });
      return;
    }

    res.json(gatePass);
  } catch (error) {
    console.error("getGatePassById error:", error);
    res.status(500).json({ message: "Failed to fetch gate pass" });
  }
};

export const updateGatePass = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.gatePass.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Gate pass not found" });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: req.body,
      include: { asset: { select: { assetId: true, assetName: true } } },
    });

    res.json(updated);
  } catch (error) {
    console.error("updateGatePass error:", error);
    res.status(500).json({ message: "Failed to update gate pass" });
  }
};

export const updateGatePassStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status, reason } = req.body;

    const validStatuses = ["ISSUED", "RETURNED", "CLOSED", "CANCELLED"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ message: `status must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    const existing = await prisma.gatePass.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Gate pass not found" });
      return;
    }

    const updated = await prisma.gatePass.update({
      where: { id },
      data: { status, reason: reason ?? existing.reason },
    });

    res.json(updated);
  } catch (error) {
    console.error("updateGatePassStatus error:", error);
    res.status(500).json({ message: "Failed to update gate pass status" });
  }
};

export const deleteGatePass = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.gatePass.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Gate pass not found" });
      return;
    }
    await prisma.gatePass.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteGatePass error:", error);
    res.status(500).json({ message: "Failed to delete gate pass" });
  }
};

export const getGatePassesByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const gatePasses = await prisma.gatePass.findMany({
      where: { assetId },
      orderBy: { createdAt: "desc" },
    });
    res.json(gatePasses);
  } catch (error) {
    console.error("getGatePassesByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch gate passes" });
  }
};

export const getOverdueGatePasses = async (req: Request, res: Response) => {
  try {
    const overdue = await prisma.gatePass.findMany({
      where: {
        type: "RETURNABLE",
        status: "ISSUED",
        expectedReturnDate: { lt: new Date() },
      },
      include: { asset: { select: { assetId: true, assetName: true } } },
      orderBy: { expectedReturnDate: "asc" },
    });
    res.json(overdue);
  } catch (error) {
    console.error("getOverdueGatePasses error:", error);
    res.status(500).json({ message: "Failed to fetch overdue gate passes" });
  }
};

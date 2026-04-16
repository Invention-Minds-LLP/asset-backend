import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

export const getAllRca = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rcas = await prisma.rootCauseAnalysis.findMany({
      include: {
        fiveWhys: { orderBy: { whyNumber: "asc" } },
        sixMItems: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: rcas });
  } catch (error) {
    console.error("getAllRca error:", error);
    res.status(500).json({ message: "Failed to fetch RCAs" });
  }
};

interface FiveWhyInput {
  whyNumber: number;
  question: string;
  answer: string;
}

interface SixMItemInput {
  category: string;
  cause: string;
  isRoot?: boolean;
}

interface CreateRcaBody {
  ticketId: number;
  workOrderId?: number;
  framework: "FIVE_WHYS" | "SIX_M" | "COMBINED";
  performedById?: number;
  fiveWhys?: FiveWhyInput[];
  sixMItems?: SixMItemInput[];
}

interface UpdateRcaBody {
  status?: string;
  summary?: string;
  conclusion?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  performedAt?: string;
  fiveWhys?: FiveWhyInput[];
  sixMItems?: SixMItemInput[];
}

export const getRcaByTicket = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);

    const rcas = await prisma.rootCauseAnalysis.findMany({
      where: { ticketId },
      include: {
        fiveWhys: { orderBy: { whyNumber: "asc" } },
        sixMItems: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(rcas);
  } catch (error) {
    console.error("getRcaByTicket error:", error);
    res.status(500).json({ message: "Failed to fetch RCAs for ticket" });
  }
};

export const getRcaById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    const rca = await prisma.rootCauseAnalysis.findUnique({
      where: { id },
      include: {
        fiveWhys: { orderBy: { whyNumber: "asc" } },
        sixMItems: true,
      },
    });

    if (!rca) {
      res.status(404).json({ message: "RCA not found" });
      return;
    }

    res.json(rca);
  } catch (error) {
    console.error("getRcaById error:", error);
    res.status(500).json({ message: "Failed to fetch RCA" });
  }
};

export const createRca = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as CreateRcaBody;

    if (!body.ticketId || !body.framework) {
      res.status(400).json({ message: "Fields 'ticketId' and 'framework' are required" });
      return;
    }

    const validFrameworks = ["FIVE_WHYS", "SIX_M", "COMBINED"];
    if (!validFrameworks.includes(body.framework)) {
      res.status(400).json({ message: `Invalid framework. Must be one of: ${validFrameworks.join(", ")}` });
      return;
    }

    // Validate fiveWhys required for FIVE_WHYS or COMBINED
    if (
      (body.framework === "FIVE_WHYS" || body.framework === "COMBINED") &&
      (!body.fiveWhys || body.fiveWhys.length === 0)
    ) {
      res.status(400).json({ message: "fiveWhys array is required for FIVE_WHYS or COMBINED framework" });
      return;
    }

    // Validate sixMItems required for SIX_M or COMBINED
    if (
      (body.framework === "SIX_M" || body.framework === "COMBINED") &&
      (!body.sixMItems || body.sixMItems.length === 0)
    ) {
      res.status(400).json({ message: "sixMItems array is required for SIX_M or COMBINED framework" });
      return;
    }

    const rca = await prisma.$transaction(async (tx) => {
      const created = await tx.rootCauseAnalysis.create({
        data: {
          ticketId: body.ticketId,
          workOrderId: body.workOrderId,
          framework: body.framework,
          performedById: body.performedById,
          status: "DRAFT",
        },
      });

      if (body.fiveWhys && body.fiveWhys.length > 0) {
        await tx.rcaFiveWhy.createMany({
          data: body.fiveWhys.map((fw) => ({
            rcaId: created.id,
            whyNumber: fw.whyNumber,
            question: fw.question,
            answer: fw.answer,
          })),
        });
      }

      if (body.sixMItems && body.sixMItems.length > 0) {
        await tx.rcaSixMItem.createMany({
          data: body.sixMItems.map((item) => ({
            rcaId: created.id,
            category: item.category,
            cause: item.cause,
            isRoot: item.isRoot ?? false,
          })),
        });
      }

      return tx.rootCauseAnalysis.findUnique({
        where: { id: created.id },
        include: {
          fiveWhys: { orderBy: { whyNumber: "asc" } },
          sixMItems: true,
        },
      });
    });

    res.status(201).json(rca);
  } catch (error) {
    console.error("createRca error:", error);
    res.status(500).json({ message: "Failed to create RCA" });
  }
};

export const updateRca = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body as UpdateRcaBody;

    const existing = await prisma.rootCauseAnalysis.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "RCA not found" });
      return;
    }

    const rca = await prisma.$transaction(async (tx) => {
      await tx.rootCauseAnalysis.update({
        where: { id },
        data: {
          status: body.status,
          summary: body.summary,
          conclusion: body.conclusion,
          correctiveAction: body.correctiveAction,
          preventiveAction: body.preventiveAction,
          performedAt: body.performedAt ? new Date(body.performedAt) : undefined,
        },
      });

      // Replace fiveWhys if provided
      if (body.fiveWhys) {
        await tx.rcaFiveWhy.deleteMany({ where: { rcaId: id } });
        if (body.fiveWhys.length > 0) {
          await tx.rcaFiveWhy.createMany({
            data: body.fiveWhys.map((fw) => ({
              rcaId: id,
              whyNumber: fw.whyNumber,
              question: fw.question,
              answer: fw.answer,
            })),
          });
        }
      }

      // Replace sixMItems if provided
      if (body.sixMItems) {
        await tx.rcaSixMItem.deleteMany({ where: { rcaId: id } });
        if (body.sixMItems.length > 0) {
          await tx.rcaSixMItem.createMany({
            data: body.sixMItems.map((item) => ({
              rcaId: id,
              category: item.category,
              cause: item.cause,
              isRoot: item.isRoot ?? false,
            })),
          });
        }
      }

      return tx.rootCauseAnalysis.findUnique({
        where: { id },
        include: {
          fiveWhys: { orderBy: { whyNumber: "asc" } },
          sixMItems: true,
        },
      });
    });

    res.json(rca);
  } catch (error) {
    console.error("updateRca error:", error);
    res.status(500).json({ message: "Failed to update RCA" });
  }
};

export const deleteRca = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    const existing = await prisma.rootCauseAnalysis.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "RCA not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.rcaFiveWhy.deleteMany({ where: { rcaId: id } });
      await tx.rcaSixMItem.deleteMany({ where: { rcaId: id } });
      await tx.rootCauseAnalysis.delete({ where: { id } });
    });

    res.json({ message: "RCA deleted successfully" });
  } catch (error) {
    console.error("deleteRca error:", error);
    res.status(500).json({ message: "Failed to delete RCA" });
  }
};

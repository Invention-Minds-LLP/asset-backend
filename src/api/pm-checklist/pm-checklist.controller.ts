import { Request, Response } from "express";
import prisma from "../../prismaClient";

function mustUser(req: any) {
  if (!req.user?.employeeDbId) throw new Error("Unauthorized");
  return req.user;
}

/** =========================
 * 1. Create Checklist Template
 * ========================= */
export const createTemplate = async (req: any, res: Response) => {
  try {
    mustUser(req);

    const { name, description, assetCategoryId, assetId } = req.body;

    if (!name) {
       res.status(400).json({ message: "name required" });
       return;
    }

    const template = await prisma.preventiveChecklistTemplate.create({
      data: {
        name,
        description,
        assetCategoryId: assetCategoryId ?? null,
        assetId: assetId ?? null,
      },
    });

    res.status(201).json(template);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

/** =========================
 * 2. Add Items to Template
 * ========================= */
export const addChecklistItems = async (req: any, res: Response) => {
  try {
    mustUser(req);

    const templateId = Number(req.params.templateId);
    const { items } = req.body;

    /**
     * items = [
     *   { title: "Check battery", description: "...", sortOrder: 1 },
     * ]
     */

    if (!items || !Array.isArray(items)) {
       res.status(400).json({ message: "items array required" });
       return;
    }

    const created = await prisma.$transaction(
      items.map((item: any, index: number) =>
        prisma.preventiveChecklistItem.create({
          data: {
            templateId,
            title: item.title,
            description: item.description,
            sortOrder: item.sortOrder ?? index,
            isRequired: item.isRequired ?? true,
          },
        })
      )
    );

    res.json(created);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

/** =========================
 * 3. Get Templates
 * ========================= */
export const getTemplates = async (_req: Request, res: Response) => {
  const data = await prisma.preventiveChecklistTemplate.findMany({
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  res.json(data);
};

/** =========================
 * 4. Create Checklist Run (Assign to Asset)
 * ========================= */
export const createChecklistRun = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);

    const { assetId, templateId, scheduledDue } = req.body;

    if (!assetId || !templateId || !scheduledDue) {
       res.status(400).json({ message: "Missing required fields" });
       return;
    }

    const run = await prisma.preventiveChecklistRun.create({
      data: {
        assetId,
        templateId,
        scheduledDue: new Date(scheduledDue),
        status: "DUE",
        createdAt: new Date(),
      },
    });

    res.status(201).json(run);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

/** =========================
 * 5. Submit Checklist Results
 * ========================= */
export const submitChecklistRun = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);

    const runId = Number(req.params.runId);
    const { results } = req.body;

    /**
     * results = [
     *   { itemId: 1, result: "PASS", remarks: "...", photoProof: "url" }
     * ]
     */

    if (!results || !Array.isArray(results)) {
       res.status(400).json({ message: "results array required" });
        return;
    }

    const run = await prisma.preventiveChecklistRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
       res.status(404).json({ message: "Run not found" });
        return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 1️⃣ Save results
      for (const r of results) {
        await tx.preventiveChecklistResultRow.create({
          data: {
            runId,
            itemId: r.itemId,
            result: r.result,
            remarks: r.remarks ?? null,
            photoProof: r.photoProof ?? null,
          },
        });
      }

      // 2️⃣ Update run status
      const updatedRun = await tx.preventiveChecklistRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          performedAt: new Date(),
          performedById: user.employeeDbId,
        },
      });

      return updatedRun;
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

/** =========================
 * 6. Get Runs by Asset
 * ========================= */
export const getRunsByAsset = async (req: Request, res: Response) => {
  const assetId = Number(req.params.assetId);

  const runs = await prisma.preventiveChecklistRun.findMany({
    where: { assetId },
    include: {
      template: true,
      results: {
        include: {
          item: true,
        },
      },
    },
    orderBy: { scheduledDue: "desc" },
  });

  res.json(runs);
};

/** =========================
 * 7. Get Single Run
 * ========================= */
export const getRunById = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const run = await prisma.preventiveChecklistRun.findUnique({
    where: { id },
    include: {
      template: {
        include: { items: true },
      },
      results: true,
    },
  });

  if (!run) {
     res.status(404).json({ message: "Run not found" });
     return;
  }

  res.json(run);
};
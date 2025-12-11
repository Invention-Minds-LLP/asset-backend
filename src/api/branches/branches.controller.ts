import { Request, Response } from "express";
import prisma from "../../prismaClient";

// ------------------------------------------------------
// GET ALL BRANCHES
// ------------------------------------------------------
export const getBranches = async (req: Request, res: Response) => {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { name: "asc" },
    });

    res.json(branches);
  } catch (err) {
    console.error("Error fetching branches:", err);
    res.status(500).json({ message: "Failed to fetch branches" });
  }
};

// ------------------------------------------------------
// CREATE BRANCH
// ------------------------------------------------------
export const createBranch = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
       res.status(400).json({ message: "Branch name is required" });
       return;
    }

    // Prevent duplicates
    const exists = await prisma.branch.findUnique({
      where: { name },
    });

    if (exists) {
       res.status(400).json({ message: "Branch already exists" });
       return;
    }

    const branch = await prisma.branch.create({
      data: { name },
    });

    res.status(201).json(branch);
  } catch (err) {
    console.error("Error creating branch:", err);
    res.status(500).json({ message: "Failed to create branch" });
  }
};

// ------------------------------------------------------
// UPDATE BRANCH
// ------------------------------------------------------
export const updateBranch = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body;

    if (!name || !name.trim()) {
       res.status(400).json({ message: "Branch name is required" });
       return;
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: { name },
    });

    res.json(branch);
  } catch (err) {
    console.error("Error updating branch:", err);
    res.status(500).json({ message: "Failed to update branch" });
  }
};

// ------------------------------------------------------
// DELETE BRANCH (ONLY IF NO ASSET LOCATIONS/TRANSFERS ATTACHED)
// ------------------------------------------------------
export const deleteBranch = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Check if branch is in use
    const usage = await prisma.assetLocation.findFirst({
      where: { branchId: id },
    });

    if (usage) {
       res.status(400).json({
        message: "Branch is linked to assets. Cannot delete.",
      });
      return;
    }

    await prisma.branch.delete({ where: { id } });

    res.json({ message: "Branch deleted successfully" });
  } catch (err) {
    console.error("Error deleting branch:", err);
    res.status(500).json({ message: "Failed to delete branch" });
  }
};

import { Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// External auditor CRUD. The auditor's details are SNAPSHOTTED into
// AssetAuditor rows when an audit is created (see asset-audit.controller),
// so updates here do NOT rewrite history on past audits.

// GET /api/external-auditors?status=ACTIVE
export const listExternalAuditors = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, search } = req.query;

    const where: any = {};
    if (status) where.status = String(status).toUpperCase();
    if (search) {
      const s = String(search);
      where.OR = [
        { email: { contains: s } },
        { name: { contains: s } },
        { organization: { contains: s } },
      ];
    }

    const auditors = await prisma.externalAuditor.findMany({
      where,
      orderBy: { name: "asc" },
    });
    res.json(auditors);
  } catch (error: any) {
    console.error("listExternalAuditors error:", error);
    res.status(500).json({ message: "Failed to load external auditors" });
  }
};

// GET /api/external-auditors/:id
export const getExternalAuditor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid id" });
      return;
    }
    const auditor = await prisma.externalAuditor.findUnique({ where: { id } });
    if (!auditor) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json(auditor);
  } catch (error: any) {
    console.error("getExternalAuditor error:", error);
    res.status(500).json({ message: "Failed to load external auditor" });
  }
};

// POST /api/external-auditors
// Body: { email, name, organization?, phone? }
export const createExternalAuditor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, name, organization, phone } = req.body || {};
    const addedById = req.user?.userId;

    if (!email || !name) {
      res.status(400).json({ message: "Email and name are required" });
      return;
    }
    if (!String(email).includes("@")) {
      res.status(400).json({ message: "Invalid email" });
      return;
    }
    if (!addedById) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const auditor = await prisma.externalAuditor.create({
      data: {
        email: String(email).trim().toLowerCase(),
        name: String(name).trim(),
        organization: organization ? String(organization).trim() : null,
        phone: phone ? String(phone).trim() : null,
        addedById,
      },
    });
    res.status(201).json(auditor);
  } catch (error: any) {
    if (error?.code === "P2002") {
      // Unique constraint on email — surface as 409 so the admin UI can show
      // "this email is already registered" instead of a generic 500.
      res.status(409).json({ message: "An external auditor with this email already exists" });
      return;
    }
    console.error("createExternalAuditor error:", error);
    res.status(500).json({ message: "Failed to create external auditor" });
  }
};

// PUT /api/external-auditors/:id
// Body: any subset of { name, organization, phone, status }
// Email is NOT updatable — it's the login identifier and historical audits
// point to it. To change the email, deactivate this record and add a new one.
export const updateExternalAuditor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid id" });
      return;
    }
    const { name, organization, phone, status } = req.body || {};

    const data: any = {};
    if (name !== undefined) data.name = String(name).trim();
    if (organization !== undefined) data.organization = organization ? String(organization).trim() : null;
    if (phone !== undefined) data.phone = phone ? String(phone).trim() : null;
    if (status !== undefined) {
      const s = String(status).toUpperCase();
      if (!["ACTIVE", "INACTIVE"].includes(s)) {
        res.status(400).json({ message: "status must be ACTIVE or INACTIVE" });
        return;
      }
      data.status = s;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ message: "Nothing to update" });
      return;
    }

    const auditor = await prisma.externalAuditor.update({ where: { id }, data });
    res.json(auditor);
  } catch (error: any) {
    if (error?.code === "P2025") {
      res.status(404).json({ message: "Not found" });
      return;
    }
    console.error("updateExternalAuditor error:", error);
    res.status(500).json({ message: "Failed to update external auditor" });
  }
};

// DELETE /api/external-auditors/:id
// Soft delete — flips status to INACTIVE. Historical audit assignments remain
// intact; the auditor just can't log in (Batch D will check status).
export const deactivateExternalAuditor = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid id" });
      return;
    }
    const auditor = await prisma.externalAuditor.update({
      where: { id },
      data: { status: "INACTIVE" },
    });
    res.json(auditor);
  } catch (error: any) {
    if (error?.code === "P2025") {
      res.status(404).json({ message: "Not found" });
      return;
    }
    console.error("deactivateExternalAuditor error:", error);
    res.status(500).json({ message: "Failed to deactivate external auditor" });
  }
};

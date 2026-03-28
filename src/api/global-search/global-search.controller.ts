import { Request, Response } from "express";
import prisma from "../../prismaClient";

// ─── Global Search across assets, tickets, employees ─────────────────────────
export const globalSearch = async (req: Request, res: Response) => {
  try {
    const { q, limit = "5" } = req.query;

    if (!q || String(q).trim().length < 2) {
      res.json({ assets: [], tickets: [], employees: [], vendors: [] });
      return;
    }

    const query = String(q).trim();
    const take = Math.min(parseInt(String(limit)), 20);

    const [assets, tickets, employees, vendors] = await Promise.all([
      prisma.asset.findMany({
        where: {
          OR: [
            { assetId: { contains: query } },
            { assetName: { contains: query } },
            { serialNumber: { contains: query } },
            { manufacturer: { contains: query } },
            { modelNumber: { contains: query } },
          ],
        },
        select: {
          id: true,
          assetId: true,
          assetName: true,
          serialNumber: true,
          status: true,
          department: { select: { name: true } },
        },
        take,
      }),
      prisma.ticket.findMany({
        where: {
          OR: [
            { ticketId: { contains: query } },
            { detailedDesc: { contains: query } },
            { issueType: { contains: query } },
          ],
        },
        select: {
          id: true,
          ticketId: true,
          issueType: true,
          status: true,
          priority: true,
          asset: { select: { assetId: true, assetName: true } },
        },
        take,
      }),
      prisma.employee.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { employeeID: { contains: query } },
            { email: { contains: query } },
            { designation: { contains: query } },
          ],
        },
        select: {
          id: true,
          name: true,
          employeeID: true,
          email: true,
          designation: true,
          department: { select: { name: true } },
          isActive: true,
        },
        take,
      }),
      prisma.vendor.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { contact: { contains: query } },
            { email: { contains: query } },
            { gstNumber: { contains: query } },
          ],
        },
        select: {
          id: true,
          name: true,
          vendorType: true,
          contact: true,
          email: true,
          isActive: true,
        },
        take,
      }),
    ]);

    res.json({
      assets: assets.map((a) => ({ ...a, type: "asset" })),
      tickets: tickets.map((t) => ({ ...t, type: "ticket" })),
      employees: employees.map((e) => ({ ...e, type: "employee" })),
      vendors: vendors.map((v) => ({ ...v, type: "vendor" })),
      totalResults: assets.length + tickets.length + employees.length + vendors.length,
    });
  } catch (error) {
    console.error("globalSearch error:", error);
    res.status(500).json({ message: "Failed to perform search" });
  }
};

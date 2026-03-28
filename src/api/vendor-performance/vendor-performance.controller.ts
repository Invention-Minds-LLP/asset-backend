import { Request, Response } from "express";
import prisma from "../../prismaClient";

// ─── Vendor Performance Dashboard ────────────────────────────────────────────
export const getVendorPerformance = async (req: Request, res: Response) => {
  try {
    const { vendorId, dateFrom, dateTo } = req.query;

    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = new Date(String(dateFrom));
    if (dateTo) dateFilter.lte = new Date(String(dateTo));

    const vendors = await prisma.vendor.findMany({
      where: {
        isActive: true,
        ...(vendorId ? { id: Number(vendorId) } : {}),
      },
      select: {
        id: true,
        name: true,
        contact: true,
        email: true,
        vendorType: true,
        rating: true,
        serviceContracts: {
          select: {
            id: true,
            contractType: true,
            status: true,
            cost: true,
            visitsPerYear: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });

    const performanceData = await Promise.all(
      vendors.map(async (vendor) => {
        // Tickets resolved by this vendor's assets
        const ticketWhere: any = {
          asset: { vendorId: vendor.id },
          status: { in: ["RESOLVED", "CLOSED"] },
        };
        if (dateFrom || dateTo) ticketWhere.createdAt = dateFilter;

        const resolvedTickets = await prisma.ticket.findMany({
          where: ticketWhere,
          select: {
            id: true,
            createdAt: true,
            slaResolvedAt: true,
            slaBreached: true,
            serviceCost: true,
            partsCost: true,
            totalCost: true,
          },
        });

        // Calculate response time (avg days from created to resolved)
        let totalResponseDays = 0;
        let resolvedCount = 0;
        let slaBreachCount = 0;
        let totalCost = 0;

        for (const t of resolvedTickets) {
          if (t.slaResolvedAt) {
            const days = (new Date(t.slaResolvedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
            totalResponseDays += days;
            resolvedCount++;
          }
          if (t.slaBreached) slaBreachCount++;
          totalCost += Number(t.totalCost || 0);
        }

        const activeContracts = vendor.serviceContracts.filter((c) => c.status === "ACTIVE").length;
        const totalContractValue = vendor.serviceContracts.reduce((sum, c) => sum + Number(c.cost || 0), 0);

        return {
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorType: vendor.vendorType,
          contact: vendor.contact,
          email: vendor.email,
          currentRating: vendor.rating,
          activeContracts,
          totalContractValue,
          totalTicketsResolved: resolvedCount,
          avgResponseDays: resolvedCount > 0 ? Number((totalResponseDays / resolvedCount).toFixed(1)) : null,
          slaBreachCount,
          slaComplianceRate: resolvedTickets.length > 0
            ? Number((((resolvedTickets.length - slaBreachCount) / resolvedTickets.length) * 100).toFixed(1))
            : null,
          totalMaintenanceCost: Number(totalCost.toFixed(2)),
        };
      })
    );

    res.json(performanceData);
  } catch (error) {
    console.error("getVendorPerformance error:", error);
    res.status(500).json({ message: "Failed to fetch vendor performance" });
  }
};

// ─── Update Vendor Rating ────────────────────────────────────────────────────
export const updateVendorRating = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      res.status(400).json({ message: "Rating must be between 1 and 5" });
      return;
    }

    const vendor = await prisma.vendor.update({
      where: { id },
      data: { rating },
    });

    res.json(vendor);
  } catch (error) {
    console.error("updateVendorRating error:", error);
    res.status(500).json({ message: "Failed to update vendor rating" });
  }
};

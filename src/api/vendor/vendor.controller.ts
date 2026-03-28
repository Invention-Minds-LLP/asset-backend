import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllVendors = async (req: Request, res: Response) => {
  try {
    const { includeInactive, search, page, limit: lim, exportCsv } = req.query;

    const where: any = {};
    if (includeInactive !== "true") where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { contact: { contains: String(search) } },
        { email: { contains: String(search) } },
        { gstNumber: { contains: String(search) } },
      ];
    }

    if (page && lim) {
      const skip = (parseInt(String(page)) - 1) * parseInt(String(lim));
      const take = parseInt(String(lim));
      const [total, vendors] = await Promise.all([
        prisma.vendor.count({ where }),
        prisma.vendor.findMany({ where, orderBy: { name: "asc" }, skip, take }),
      ]);

      if (exportCsv === "true") {
        const csvRows = vendors.map((v: any) => ({
          Name: v.name, Contact: v.contact, Email: v.email || "", VendorType: v.vendorType || "",
          GST: v.gstNumber || "", PAN: v.panNumber || "", Rating: v.rating || "", Active: v.isActive ? "Yes" : "No",
        }));
        const headers = Object.keys(csvRows[0] || {}).join(",");
        const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=vendors.csv");
        res.send(headers + "\n" + rows);
        return;
      }

      res.json({ data: vendors, total, page: parseInt(String(page)), limit: take });
      return;
    }

    const vendors = await prisma.vendor.findMany({ where, orderBy: { name: "asc" } });
    res.json(vendors);
  } catch (error) {
    console.error("getAllVendors error:", error);
    res.status(500).json({ message: "Failed to fetch vendors" });
  }
};

export const createVendor = async (req: Request, res: Response) => {
  const vendor = await prisma.vendor.create({ data: req.body });
   res.status(201).json(vendor);
};

export const deleteVendor = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    // Soft delete
    await prisma.vendor.update({ where: { id }, data: { isActive: false } });
    res.json({ message: "Vendor deactivated" });
  } catch (error) {
    console.error("deleteVendor error:", error);
    res.status(500).json({ message: "Failed to delete vendor" });
  }
};

export const updateVendor = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updatedVendor = await prisma.vendor.update({
      where: { id },
      data: req.body, // update only the fields sent in request body
    });
    res.json(updatedVendor);
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: 'Failed to update vendor.' });
  }
};
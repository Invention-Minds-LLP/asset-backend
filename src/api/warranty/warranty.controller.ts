import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { requireAssetByAssetId } from "../../utilis/asset";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

function parseDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// GET /warranties/
// export const getAllWarranties = async (req: Request, res: Response) => {
//   try {
//     const { status, isActive, search, page = "1", limit = "25", exportCsv, expiringDays } = req.query;

//     const where: any = {};
//     if (isActive !== undefined) where.isActive = isActive === "true";
//     if (search) {
//       where.OR = [
//         { warrantyProvider: { contains: String(search) } },
//         { warrantyReference: { contains: String(search) } },
//         { asset: { assetName: { contains: String(search) } } },
//         { asset: { assetId: { contains: String(search) } } },
//       ];
//     }

//     // Filter for expiring soon
//     if (expiringDays) {
//       const now = new Date();
//       const future = new Date();
//       future.setDate(now.getDate() + Number(expiringDays));
//       where.isActive = true;
//       where.isUnderWarranty = true;
//       where.warrantyEnd = { gte: now, lte: future };
//     }

//     // Filter by warranty status (active/expired based on dates)
//     if (status === "ACTIVE") {
//       where.isActive = true;
//       where.isUnderWarranty = true;
//       where.warrantyEnd = { gte: new Date() };
//     } else if (status === "EXPIRED") {
//       where.OR = [
//         { isActive: false },
//         { warrantyEnd: { lt: new Date() } },
//       ];
//     }

//     const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
//     const take = parseInt(String(limit));

//     const [total, warranties] = await Promise.all([
//       prisma.warranty.count({ where }),
//       prisma.warranty.findMany({
//         where,
//         include: { asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true, departmentId: true } }, vendor: true },
//         orderBy: { warrantyEnd: "asc" },
//         ...(exportCsv !== "true" ? { skip, take } : {}),
//       }),
//     ]);

//     if (exportCsv === "true") {
//       const csvRows = warranties.map((w: any) => ({
//         AssetId: w.asset?.assetId || "",
//         AssetName: w.asset?.assetName || "",
//         WarrantyType: w.warrantyType || "",
//         Provider: w.warrantyProvider || "",
//         Vendor: w.vendor?.name || "",
//         Start: w.warrantyStart ? new Date(w.warrantyStart).toISOString().split("T")[0] : "",
//         End: w.warrantyEnd ? new Date(w.warrantyEnd).toISOString().split("T")[0] : "",
//         UnderWarranty: w.isUnderWarranty ? "Yes" : "No",
//         Active: w.isActive ? "Yes" : "No",
//         Reference: w.warrantyReference || "",
//       }));

//       const headers = Object.keys(csvRows[0] || {}).join(",");
//       const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
//       res.setHeader("Content-Type", "text/csv");
//       res.setHeader("Content-Disposition", "attachment; filename=warranties.csv");
//       res.send(headers + "\n" + rows);
//       return;
//     }

//     res.json({ data: warranties, total, page: parseInt(String(page)), limit: take });
//   } catch (e: any) {
//     res.status(500).json({ message: e.message });
//   }
// };
export const getAllWarranties = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, isActive, search, page = "1", limit = "25", exportCsv, expiringDays } = req.query;

    // Department scoping: non-admin sees only their department's assets
    let scopedAssetIds: number[] | undefined;
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      scopedAssetIds = deptAssets.map(a => a.id);
    }

    const where: any = {
      AND: []
    };

    if (scopedAssetIds) {
      where.AND.push({ assetId: { in: scopedAssetIds } });
    }

    if (isActive !== undefined) {
      where.AND.push({ isActive: isActive === "true" });
    }

    if (search) {
      where.AND.push({
        OR: [
          { warrantyProvider: { contains: String(search) } },
          { warrantyReference: { contains: String(search) } },
          { asset: { assetName: { contains: String(search) } } },
          { asset: { assetId: { contains: String(search) } } },
        ]
      });
    }

    // Expiring within custom number of days
    if (expiringDays) {
      const now = new Date();
      const future = new Date();
      future.setDate(now.getDate() + Number(expiringDays));

      where.AND.push(
        { isActive: true },
        { isUnderWarranty: true },
        { warrantyEnd: { gte: now, lte: future } }
      );
    }

    // Status filters
    if (status === "ACTIVE") {
      where.AND.push(
        { isActive: true },
        { isUnderWarranty: true },
        { warrantyEnd: { gte: new Date() } }
      );
    } else if (status === "EXPIRED") {
      where.AND.push({
        OR: [
          { isActive: false },
          { warrantyEnd: { lt: new Date() } }
        ]
      });
    } else if (status === "EXPIRING_SOON") {
      const now = new Date();
      const future = new Date();
      future.setDate(now.getDate() + 30);

      where.AND.push(
        { isActive: true },
        { isUnderWarranty: true },
        { warrantyEnd: { gte: now, lte: future } }
      );
    }

    if (where.AND.length === 0) {
      delete where.AND;
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, warranties] = await Promise.all([
      prisma.warranty.count({ where }),
      prisma.warranty.findMany({
        where,
        include: {
          asset: {
            select: {
              id: true,
              assetId: true,
              assetName: true,
              serialNumber: true,
              departmentId: true
            }
          },
          vendor: true
        },
        orderBy: { warrantyEnd: "asc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = warranties.map((w: any) => ({
        AssetId: w.asset?.assetId || "",
        AssetName: w.asset?.assetName || "",
        WarrantyType: w.warrantyType || "",
        Provider: w.warrantyProvider || "",
        Vendor: w.vendor?.name || "",
        Start: w.warrantyStart ? new Date(w.warrantyStart).toISOString().split("T")[0] : "",
        End: w.warrantyEnd ? new Date(w.warrantyEnd).toISOString().split("T")[0] : "",
        UnderWarranty: w.isUnderWarranty ? "Yes" : "No",
        Active: w.isActive ? "Yes" : "No",
        Reference: w.warrantyReference || "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=warranties.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: warranties, total, page: parseInt(String(page)), limit: take });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// GET /warranties/:id
export const getWarrantyById = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const warranty = await prisma.warranty.findUnique({
    where: { id },
    include: { asset: true },
  });
  if (!warranty) {
    res.status(404).json({ message: "Warranty not found" });
    return
  }
  res.json(warranty);
};

// POST /warranties/
// export const createWarranty = async (req: Request, res: Response) => {
//   const warranty = await prisma.warranty.create({
//     data: {
//       warrantyStart: new Date(req.body.warrantyStart),
//       warrantyEnd: new Date(req.body.warrantyEnd),
//       isUnderWarranty: req.body.isUnderWarranty,
//       amcActive: req.body.amcActive,
//       amcVendor: req.body.amcVendor,
//       amcStart: req.body.amcStart ? new Date(req.body.amcStart) : null,
//       amcEnd: req.body.amcEnd ? new Date(req.body.amcEnd) : null,
//       amcVisitsDue: req.body.amcVisitsDue ? Number(req.body.amcVisitsDue) : null,
//       lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
//       nextVisitDue: req.body.nextVisitDue ? new Date(req.body.nextVisitDue) : null,
//       serviceReport: req.body.serviceReport ?? null,

//       asset: {
//         connect: {
//           assetId: req.body.assetId,
//         },
//       },
//     },
//   });
//    res.status(201).json(warranty);
// };

export const createWarranty = async (req: Request, res: Response) => {
  try {
    const {
      assetId,
      warrantyStart,
      warrantyEnd,
      isUnderWarranty,
      warrantyType,
      warrantyProvider,
      vendorId,
      warrantyReference,
      coverageDetails,
      exclusions,
      supportContact,
      supportEmail,
      termsUrl,
      remarks,
    } = req.body;

    if (!assetId || typeof isUnderWarranty !== "boolean") {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    const asset = await requireAssetByAssetId(assetId);

    let start: Date | null = null;
    let end: Date | null = null;

    if (isUnderWarranty) {
      if (!warrantyStart || !warrantyEnd) {
        res.status(400).json({ message: "Warranty start and end are required when under warranty" });
        return;
      }

      start = new Date(warrantyStart);
      end = new Date(warrantyEnd);

      if (end <= start) {
        res.status(400).json({ message: "Warranty end must be after start" });
        return;
      }
    }

    // Optional safety: allow only one active warranty
    const existingActive = await prisma.warranty.findFirst({
      where: {
        assetId: asset.id,
        isActive: true,
      },
    });

    if (existingActive) {
      res.status(409).json({
        message:
          "An active warranty already exists for this asset. Use renewal API or update existing warranty.",
      });
      return;
    }

    const warranty = await prisma.warranty.create({
      data: {
        assetId: asset.id,
        warrantyStart: start ?? new Date(),
        warrantyEnd: end ?? new Date(),
        isUnderWarranty,
        isActive: true,
        warrantyType: warrantyType || null,
        warrantyProvider: warrantyProvider || null,
        vendorId: vendorId ? Number(vendorId) : null,
        warrantyReference: warrantyReference || null,
        coverageDetails: coverageDetails || null,
        exclusions: exclusions || null,
        supportContact: supportContact || null,
        supportEmail: supportEmail || null,
        termsUrl: termsUrl || null,
        remarks: remarks || null,
      },
    });

    // Notify department HODs about new warranty
    const hodIds = await getDepartmentHODs(asset.departmentId);
    if (hodIds.length) {
      notify({
        type: "WARRANTY",
        title: "New Warranty Created",
        message: `Warranty created for asset ${asset.assetName || asset.assetId}`,
        recipientIds: hodIds,
        assetId: asset.id,
        createdById: (req as any).user?.employeeDbId,
      });
    }

    res.status(201).json(warranty);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// PUT /warranties/:id
// export const updateWarranty = async (req: Request, res: Response) => {
//   const id = parseInt(req.params.id);
//   const warranty = await prisma.warranty.update({
//     where: { id },
//     data: {
//       warrantyStart: new Date(req.body.warrantyStart),
//       warrantyEnd: new Date(req.body.warrantyEnd),
//       isUnderWarranty: req.body.isUnderWarranty,
//       amcActive: req.body.amcActive,
//       amcVendor: req.body.amcVendor,
//       amcStart: req.body.amcStart ? new Date(req.body.amcStart) : null,
//       amcEnd: req.body.amcEnd ? new Date(req.body.amcEnd) : null,
//       amcVisitsDue: req.body.amcVisitsDue ? Number(req.body.amcVisitsDue) : null,
//       lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
//       nextVisitDue: req.body.nextVisitDue ? new Date(req.body.nextVisitDue) : null,
//       serviceReport: req.body.serviceReport ?? null,
//     },
//   });
//  res.json(warranty);
// };
export const updateWarranty = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.warranty.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Warranty not found" });
      return;
    }

    const {
      warrantyStart,
      warrantyEnd,
      isUnderWarranty,
      warrantyType,
      warrantyProvider,
      vendorId,
      warrantyReference,
      coverageDetails,
      exclusions,
      supportContact,
      supportEmail,
      termsUrl,
      remarks,
    } = req.body;

    const data: any = {};

    if (typeof isUnderWarranty === "boolean") data.isUnderWarranty = isUnderWarranty;
    if (warrantyStart) data.warrantyStart = new Date(warrantyStart);
    if (warrantyEnd) data.warrantyEnd = new Date(warrantyEnd);

    if ("warrantyType" in req.body) data.warrantyType = warrantyType || null;
    if ("warrantyProvider" in req.body) data.warrantyProvider = warrantyProvider || null;
    if ("vendorId" in req.body) data.vendorId = vendorId ? Number(vendorId) : null;
    if ("warrantyReference" in req.body) data.warrantyReference = warrantyReference || null;
    if ("coverageDetails" in req.body) data.coverageDetails = coverageDetails || null;
    if ("exclusions" in req.body) data.exclusions = exclusions || null;
    if ("supportContact" in req.body) data.supportContact = supportContact || null;
    if ("supportEmail" in req.body) data.supportEmail = supportEmail || null;
    if ("termsUrl" in req.body) data.termsUrl = termsUrl || null;
    if ("remarks" in req.body) data.remarks = remarks || null;

    const finalStart = data.warrantyStart ?? existing.warrantyStart;
    const finalEnd = data.warrantyEnd ?? existing.warrantyEnd;
    const finalIsUnderWarranty = data.isUnderWarranty ?? existing.isUnderWarranty;

    if (finalIsUnderWarranty && finalEnd <= finalStart) {
      res.status(400).json({ message: "Warranty end must be after start" });
      return;
    }
    // prevent multiple active warranties for same asset when manually setting active=true
    if (data.isActive === true && existing.isActive !== true) {
      const otherActive = await prisma.warranty.findFirst({
        where: {
          assetId: existing.assetId,
          isActive: true,
          id: { not: existing.id },
        },
      });

      if (otherActive) {
        res.status(409).json({
          message: "Another active warranty already exists for this asset",
        });
        return;
      }
    }

    const warranty = await prisma.warranty.update({
      where: { id },
      data,
    });

    res.json(warranty);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// DELETE /warranties/:id
export const deleteWarranty = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.warranty.delete({
    where: { id },
  });
  res.status(204).send();
};

export const getWarrantyByAssetId = async (req: Request, res: Response) => {
  try {
    const assetId = req.params.assetId;

    const asset = await prisma.asset.findUnique({ where: { assetId } });
    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const warranty = await prisma.warranty.findFirst({
      where: {
        assetId: asset.id,
        isActive: true,
      },
      include: { asset: true, vendor: true },
      orderBy: { createdAt: "desc" },
    });

    if (!warranty) {
      res.status(404).json({ message: "Warranty not found for given assetId" });
      return;
    }

    res.json(warranty);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// POST /warranties/asset/:assetId/renew
export const renewWarranty = async (req: Request, res: Response) => {
  try {
    const assetCode = req.params.assetId;

    const {
      warrantyStart,
      warrantyEnd,
      isUnderWarranty,
      warrantyType,
      warrantyProvider,
      vendorId,
      warrantyReference,
      coverageDetails,
      exclusions,
      supportContact,
      supportEmail,
      termsUrl,
      remarks,
    } = req.body;

    if (typeof isUnderWarranty !== "boolean") {
      res.status(400).json({ message: "isUnderWarranty is required" });
      return;
    }

    const asset = await requireAssetByAssetId(assetCode);

    let start: Date | null = null;
    let end: Date | null = null;

    if (isUnderWarranty) {
      start = parseDate(warrantyStart);
      end = parseDate(warrantyEnd);

      if (!start || !end) {
        res.status(400).json({
          message: "Warranty start and end are required when under warranty",
        });
        return;
      }

      if (end <= start) {
        res.status(400).json({ message: "Warranty end must be after start" });
        return;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.warranty.updateMany({
        where: {
          assetId: asset.id,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      const newWarranty = await tx.warranty.create({
        data: {
          assetId: asset.id,
          warrantyStart: start ?? new Date(),
          warrantyEnd: end ?? new Date(),
          isUnderWarranty,
          isActive: true,

          warrantyType: warrantyType || null,
          warrantyProvider: warrantyProvider || null,
          vendorId: vendorId ? Number(vendorId) : null,
          warrantyReference: warrantyReference || null,
          coverageDetails: coverageDetails || null,
          exclusions: exclusions || null,
          supportContact: supportContact || null,
          supportEmail: supportEmail || null,
          termsUrl: termsUrl || null,
          remarks: remarks || null,
        },
        include: { asset: true, vendor: true },
      });

      return newWarranty;
    });

    // Notify department HODs + admins about warranty renewal
    const hodIds = await getDepartmentHODs(asset.departmentId);
    const adminIds = await getAdminIds();
    const recipientIds = [...new Set([...hodIds, ...adminIds])];
    if (recipientIds.length) {
      notify({
        type: "WARRANTY",
        title: "Warranty Renewed",
        message: `Warranty renewed for asset ${asset.assetName || assetCode}`,
        recipientIds,
        assetId: asset.id,
        createdById: (req as any).user?.employeeDbId,
      });
    }

    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};


// GET /warranties/stats
export const getWarrantyStats = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);
    const sixtyDays = new Date();
    sixtyDays.setDate(now.getDate() + 60);

    // Department scoping
    let scope: any = {};
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({ where: { departmentId: Number(user.departmentId) }, select: { id: true } });
      scope = { assetId: { in: deptAssets.map(a => a.id) } };
    }

    const [total, active, expired, expiring30, expiring60] = await Promise.all([
      prisma.warranty.count({ where: { isActive: true, ...scope } }),
      prisma.warranty.count({ where: { isActive: true, isUnderWarranty: true, warrantyEnd: { gte: now }, ...scope } }),
      prisma.warranty.count({ where: { isActive: true, warrantyEnd: { lt: now }, ...scope } }),
      prisma.warranty.count({ where: { isActive: true, isUnderWarranty: true, warrantyEnd: { gte: now, lte: thirtyDays }, ...scope } }),
      prisma.warranty.count({ where: { isActive: true, isUnderWarranty: true, warrantyEnd: { gte: now, lte: sixtyDays }, ...scope } }),
    ]);

    res.json({ total, active, expired, expiring30, expiring60 });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

export const getWarrantyHistoryByAssetId = async (req: Request, res: Response) => {
  try {
    const assetCode = req.params.assetId;

    const asset = await prisma.asset.findUnique({ where: { assetId: assetCode } });
    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const history = await prisma.warranty.findMany({
      where: {
        assetId: asset.id,
      },
      include: {
        asset: true,
        vendor: true,
      },
      orderBy: [
        { isActive: "desc" },
        { warrantyEnd: "desc" },
        { createdAt: "desc" },
      ],
    });

    res.json(history);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};
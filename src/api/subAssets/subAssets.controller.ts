import { Request, Response } from "express";
import prisma from "../../prismaClient";

/**
 * GET /assets/:assetId/children
 * assetId = alphanumeric Asset.assetId (string)
 */
export const getSubAssetsByAssetId = async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const parent = await prisma.asset.findUnique({
      where: { assetId },
      select: { id: true, assetId: true, assetName: true },
    });

    if (!parent) {
      res.status(404).json({ message: "Parent asset not found" });
      return;
    }

    const children = await prisma.asset.findMany({
      where: { parentAssetId: parent.id },
      orderBy: { id: "desc" },
      select: {
        id: true,
        assetId: true,
        assetName: true,
        serialNumber: true,
        status: true,
        assetType: true,
        sourceType: true,
        modeOfProcurement: true,
        workingCondition: true,
        referenceCode: true,
      },
    });

    res.json({ parent, children });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to load sub-assets" });
  }
};

/**
 * PATCH /assets/:childAssetId/link-parent
 * childAssetId = child Asset.assetId (string)
 * body: { parentAssetId: string | null }   // parent Asset.assetId or null to detach
 */
export const linkOrDetachParent = async (req: Request, res: Response) => {
  try {
    const { childAssetId } = req.params;
    const { parentAssetId } = req.body as { parentAssetId: string | null };

    const child = await prisma.asset.findUnique({
      where: { assetId: childAssetId },
      select: { id: true, assetId: true, parentAssetId: true },
    });

    if (!child) {
      res.status(404).json({ message: "Child asset not found" });
      return;
    }

    // DETACH
    if (!parentAssetId) {
      const updated = await prisma.asset.update({
        where: { id: child.id },
        data: {
          parentAssetId: null,
        },
        select: {
          assetId: true,
          parentAssetId: true,
          sourceType: true,
          status: true,
        },
      });

      res.json({ message: "Detached from parent", updated });
      return;
    }

    const parent = await prisma.asset.findUnique({
      where: { assetId: parentAssetId },
      select: { id: true, assetId: true },
    });

    if (!parent) {
      res.status(404).json({ message: "Parent asset not found" });
      return;
    }

    if (parent.id === child.id) {
      res.status(400).json({ message: "Asset cannot be parent of itself" });
      return;
    }

    const isCycle = await isDescendant(parent.id, child.id);
    if (isCycle) {
      res.status(400).json({ message: "Invalid move: would create a cycle" });
      return;
    }

    const updated = await prisma.asset.update({
      where: { id: child.id },
      data: {
        parentAssetId: parent.id,
        sourceType: "INVENTORY",
      },
      select: {
        assetId: true,
        parentAssetId: true,
        sourceType: true,
        status: true,
      },
    });

    res.json({ message: "Parent linked", updated });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to link parent" });
  }
};
/**
 * GET /assets/:assetId/tree
 * Returns nested tree under given root assetId
 */
export const getAssetTree = async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const root = await prisma.asset.findUnique({
      where: { assetId },
      select: { id: true, assetId: true, assetName: true, status: true },
    });

    if (!root) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const tree = await buildTree(root.id);
    res.json({ root, tree });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to build tree" });
  }
};

/**
 * GET /assets/parent-options?q=...&excludeAssetId=...
 * For dropdown search
 */
export const getParentOptions = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const excludeAssetId = String(req.query.excludeAssetId || "").trim();

    const exclude = excludeAssetId
      ? await prisma.asset.findUnique({ where: { assetId: excludeAssetId }, select: { id: true } })
      : null;

    const list = await prisma.asset.findMany({
      where: {
        ...(exclude?.id ? { id: { not: exclude.id } } : {}),
        ...(q
          ? {
            OR: [
              { assetId: { contains: q } },
              { assetName: { contains: q } },
              { serialNumber: { contains: q } },
            ],
          }
          : {}),
      },
      take: 50,
      orderBy: { id: "desc" },
      select: { assetId: true, assetName: true, id: true },
    });

    res.json(
      list.map((a) => ({
        label: `${a.assetName} (${a.assetId})`,
        value: a.assetId,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to load parent options" });
  }
};

/** ---------- helpers ---------- **/

async function buildTree(parentDbId: number): Promise<any[]> {
  const children = await prisma.asset.findMany({
    where: { parentAssetId: parentDbId },
    orderBy: { id: "asc" },
    select: { id: true, assetId: true, assetName: true, status: true },
  });

  const result: any[] = [];
  for (const c of children) {
    result.push({
      ...c,
      children: await buildTree(c.id),
    });
  }
  return result;
}

async function isDescendant(candidateParentId: number, childId: number): Promise<boolean> {
  // candidateParentId should NOT be inside child's subtree
  const stack: number[] = [childId];

  while (stack.length) {
    const current = stack.pop()!;
    const kids = await prisma.asset.findMany({
      where: { parentAssetId: current },
      select: { id: true },
    });
    for (const k of kids) {
      if (k.id === candidateParentId) return true;
      stack.push(k.id);
    }
  }
  return false;
}
// export const createSubAsset = async (req: Request, res: Response) => {
//   try {
//     const { parentAssetId } = req.params;
//     const {
//       assetName,
//       assetType,
//       assetCategoryId,
//       serialNumber,
//       modeOfProcurement,
//       vendorId,
//       departmentId,
//       status,
//       inheritFromParent,
//     } = req.body;

//     if (!assetName || !assetType || !assetCategoryId || !serialNumber) {
//       res.status(400).json({ message: "Missing required fields" });
//       return;
//     }

//     const parent = await prisma.asset.findUnique({
//       where: { assetId: parentAssetId },
//       select: {
//         id: true,
//         assetId: true,
//         vendorId: true,
//         departmentId: true,
//         assetCategoryId: true,
//         assetType: true,
//       },
//     });

//     if (!parent) {
//       res.status(404).json({ message: "Parent asset not found" });
//       return;
//     }

//     // ✅ Prevent duplicate serialNumber (unique in schema)
//     const existingSerial = await prisma.asset.findUnique({
//       where: { serialNumber },
//       select: { id: true },
//     });
//     if (existingSerial) {
//       res.status(400).json({ message: "Serial number already exists" });
//       return;
//     }

//     // ✅ Generate Asset.assetId like your createAsset() does (AST-FYxxxx-xx-001)
//     const now = new Date();
//     const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
//     const fyEnd = fyStart + 1;
//     const fyStr = `FY${fyStart}-${String(fyEnd % 100).padStart(2, "0")}`;

//     const latest = await prisma.asset.findFirst({
//       where: { assetId: { startsWith: `AST-${fyStr}` } },
//       orderBy: { id: "desc" },
//       select: { assetId: true },
//     });

//     let next = 1;
//     if (latest?.assetId) {
//       next = parseInt(latest.assetId.split("-")[3], 10) + 1;
//     }
//     const newAssetId = `AST-${fyStr}-${String(next).padStart(3, "0")}`;

//     const useInherit = inheritFromParent !== false; // default true

//     const child = await prisma.asset.create({
//       data: {
//         assetId: newAssetId,
//         assetName,
//         assetType,
//         assetCategoryId: Number(assetCategoryId),
//         serialNumber,
//         modeOfProcurement: modeOfProcurement || "PURCHASE",
//         status: status || "PENDING_COMPLETION",

//         // ✅ important: link parent
//         parentAssetId: parent.id,

//         // optional: inherit vendor/department from parent
//         vendorId: useInherit ? parent.vendorId : (vendorId != null ? Number(vendorId) : null),
//         departmentId: useInherit ? parent.departmentId : (departmentId != null ? Number(departmentId) : null),
//       },
//       include: {
//         parentAsset: { select: { assetId: true, assetName: true } },
//       },
//     });

//     res.status(201).json(child);
//   } catch (e: any) {
//     console.error(e);
//     res.status(500).json({ message: e.message || "Failed to create sub asset" });
//   }
// };


// export const createSubAsset = async (req: Request, res: Response) => {
//   try {
//     const { parentAssetId } = req.params;

//     const {
//       sourceType,
//       sparePartId,
//       quantity,

//       assetName,
//       assetType,
//       assetCategoryId,
//       serialNumber,
//       referenceCode,
//       modeOfProcurement,
//       vendorId,
//       departmentId,
//       status,
//       inheritFromParent,

//       invoiceNumber,
//       purchaseDate,
//       purchaseOrderNo,
//       purchaseOrderDate,
//       purchaseCost,

//       donorName,
//       donationDate,
//       assetCondition,
//       estimatedValue,

//       leaseStartDate,
//       leaseEndDate,
//       leaseAmount,

//       rentalStartDate,
//       rentalEndDate,
//       rentalAmount,

//       workingCondition,
//       remarks,
//       sourceReference
//     } = req.body;

//     if (!sourceType || !["NEW", "INVENTORY_SPARE"].includes(sourceType)) {
//       res.status(400).json({ message: "Invalid source type" });
//       return;
//     }

//     if (!assetName || !assetType || !assetCategoryId || !serialNumber || !status) {
//       res.status(400).json({ message: "Missing required fields" });
//       return;
//     }

//     const parent = await prisma.asset.findUnique({
//       where: { assetId: parentAssetId },
//       select: {
//         id: true,
//         assetId: true,
//         vendorId: true,
//         departmentId: true,
//         assetCategoryId: true,
//         assetType: true,
//       },
//     });

//     if (!parent) {
//       res.status(404).json({ message: "Parent asset not found" });
//       return;
//     }

//     const existingSerial = await prisma.asset.findUnique({
//       where: { serialNumber },
//       select: { id: true },
//     });

//     if (existingSerial) {
//       res.status(400).json({ message: "Serial number already exists" });
//       return;
//     }

//     if (referenceCode) {
//       const existingRef = await prisma.asset.findUnique({
//         where: { referenceCode },
//         select: { id: true },
//       });

//       if (existingRef) {
//         res.status(400).json({ message: "Reference code already exists" });
//         return;
//       }
//     }

//     const useInherit = inheritFromParent !== false;
//     const newAssetId = await generateSubAssetId(parent);

//     // INVENTORY SPARE FLOW
//     if (sourceType === "INVENTORY_SPARE") {
//       if (!sparePartId) {
//         res.status(400).json({ message: "Spare part is required" });
//         return;
//       }

//       const qty = Number(quantity || 1);
//       if (qty <= 0) {
//         res.status(400).json({ message: "Quantity must be greater than 0" });
//         return;
//       }

//       const spare = await prisma.sparePart.findUnique({
//         where: { id: Number(sparePartId) },
//         select: {
//           id: true,
//           name: true,
//           vendorId: true,
//           stockQuantity: true,
//         },
//       });

//       if (!spare) {
//         res.status(404).json({ message: "Spare part not found" });
//         return;
//       }

//       if (spare.stockQuantity < qty) {
//         res.status(400).json({ message: "Insufficient spare stock" });
//         return;
//       }

//       const result = await prisma.$transaction(async (tx) => {
//         const child = await tx.asset.create({
//           data: {
//             assetId: newAssetId,
//             assetName,
//             assetType,
//             assetCategoryId: Number(assetCategoryId),
//             serialNumber,
//             referenceCode: referenceCode || null,
//             sourceType: "INVENTORY_SPARE",
//             sourceReference: sourceReference || null,
//             remarks: remarks || null,
//             status,
//             modeOfProcurement: "PURCHASE",
//             parentAssetId: parent.id,

//             vendorId: useInherit
//               ? parent.vendorId
//               : (vendorId != null ? Number(vendorId) : spare.vendorId),

//             departmentId: useInherit
//               ? parent.departmentId
//               : (departmentId != null ? Number(departmentId) : null),

//             workingCondition: workingCondition || null,
//           },
//           include: {
//             parentAsset: {
//               select: {
//                 assetId: true,
//                 assetName: true,
//               },
//             },
//           },
//         });

//         await tx.sparePart.update({
//           where: { id: spare.id },
//           data: {
//             stockQuantity: {
//               decrement: qty,
//             },
//           },
//         });

//         await tx.inventoryTransaction.create({
//           data: {
//             type: "OUT",
//             sparePartId: spare.id,
//             quantity: qty,
//             referenceType: "SUB_ASSET",
//             referenceId: child.id,
//             notes: `Converted to sub-asset ${child.assetId} under parent ${parent.assetId}`,
//           },
//         });

//         return child;
//       });

//       res.status(201).json(result);
//       return;
//     }

//     // NEW FLOW
//     if (!modeOfProcurement) {
//       res.status(400).json({ message: "Mode of procurement is required" });
//       return;
//     }

//     if (modeOfProcurement === "PURCHASE") {
//       if (!invoiceNumber || !purchaseDate || purchaseCost == null) {
//         res.status(400).json({ message: "Purchase details are required" });
//         return;
//       }
//     }

//     if (modeOfProcurement === "DONATION") {
//       if (!donorName || !donationDate || !assetCondition) {
//         res.status(400).json({ message: "Donation details are required" });
//         return;
//       }
//     }

//     if (modeOfProcurement === "LEASE") {
//       if (!leaseStartDate || !leaseEndDate) {
//         res.status(400).json({ message: "Lease details are required" });
//         return;
//       }
//     }

//     if (modeOfProcurement === "RENTAL") {
//       if (!rentalStartDate || !rentalEndDate) {
//         res.status(400).json({ message: "Rental details are required" });
//         return;
//       }
//     }

//     const child = await prisma.asset.create({
//       data: {
//         assetId: newAssetId,
//         assetName,
//         assetType,
//         assetCategoryId: Number(assetCategoryId),
//         serialNumber,
//         referenceCode: referenceCode || null,
//         sourceType: "NEW",
//         sourceReference: sourceReference || null,
//         remarks: remarks || null,
//         modeOfProcurement,
//         status,
//         parentAssetId: parent.id,

//         vendorId: useInherit ? parent.vendorId : (vendorId != null ? Number(vendorId) : null),
//         departmentId: useInherit ? parent.departmentId : (departmentId != null ? Number(departmentId) : null),

//         invoiceNumber: invoiceNumber || null,
//         purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
//         purchaseOrderNo: purchaseOrderNo || null,
//         purchaseOrderDate: purchaseOrderDate ? new Date(purchaseOrderDate) : null,
//         purchaseCost: purchaseCost != null ? Number(purchaseCost) : null,

//         donorName: donorName || null,
//         donationDate: donationDate ? new Date(donationDate) : null,
//         assetCondition: assetCondition || null,
//         estimatedValue: estimatedValue != null ? Number(estimatedValue) : null,

//         leaseStartDate: leaseStartDate ? new Date(leaseStartDate) : null,
//         leaseEndDate: leaseEndDate ? new Date(leaseEndDate) : null,
//         leaseAmount: leaseAmount != null ? Number(leaseAmount) : null,

//         rentalStartDate: rentalStartDate ? new Date(rentalStartDate) : null,
//         rentalEndDate: rentalEndDate ? new Date(rentalEndDate) : null,
//         rentalAmount: rentalAmount != null ? Number(rentalAmount) : null,

//         workingCondition: workingCondition || null,
//       },
//       include: {
//         parentAsset: {
//           select: {
//             assetId: true,
//             assetName: true,
//           },
//         },
//       },
//     });

//     res.status(201).json(child);
//   } catch (e: any) {
//     console.error(e);
//     res.status(500).json({ message: e.message || "Failed to create sub asset" });
//   }
// };
import { Prisma } from "@prisma/client";

export const createSubAsset = async (req: Request, res: Response) => {
  try {
    const { parentAssetId } = req.params;
    const {
      sourceType,
      sparePartId,
      quantity,
      assetName,
      assetType,
      assetCategoryId,
      serialNumber,
      referenceCode,
      modeOfProcurement,
      vendorId,
      departmentId,
      status,
      inheritFromParent,
      invoiceNumber,
      purchaseDate,
      purchaseOrderNo,
      purchaseOrderDate,
      purchaseCost,
      donorName,
      donationDate,
      assetCondition,
      estimatedValue,
      leaseStartDate,
      leaseEndDate,
      leaseAmount,
      rentalStartDate,
      rentalEndDate,
      rentalAmount,
      workingCondition,
      remarks,
      sourceReference
    } = req.body;

    if (!sourceType || !["NEW", "INVENTORY_SPARE"].includes(sourceType)) {
      res.status(400).json({ message: "Invalid source type" });
      return;
    }

    if (!assetName || !assetType || !assetCategoryId || !serialNumber || !status) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    const parent = await prisma.asset.findUnique({
      where: { assetId: parentAssetId },
      select: {
        id: true,
        assetId: true,
        vendorId: true,
        departmentId: true,
      },
    });

    if (!parent) {
      res.status(404).json({ message: "Parent asset not found" });
      return;
    }

    const useInherit = inheritFromParent !== false;
    const newAssetId = await generateSubAssetId(parent);

    if (sourceType === "INVENTORY_SPARE") {
      if (!sparePartId) {
        res.status(400).json({ message: "Spare part is required" });
        return;
      }

      const qty = Number(quantity || 1);
      if (qty <= 0) {
        res.status(400).json({ message: "Quantity must be greater than 0" });
        return;
      }

      const spare = await prisma.sparePart.findUnique({
        where: { id: Number(sparePartId) },
        select: {
          id: true,
          name: true,
          vendorId: true,
          stockQuantity: true,
        },
      });

      if (!spare) {
        res.status(404).json({ message: "Spare part not found" });
        return;
      }

      if (spare.stockQuantity < qty) {
        res.status(400).json({ message: "Insufficient spare stock" });
        return;
      }

      let child: any = null;

      try {
        child = await prisma.asset.create({
          data: {
            assetId: newAssetId,
            assetName,
            assetType,
            assetCategoryId: Number(assetCategoryId),
            serialNumber,
            referenceCode: referenceCode || null,
            sourceType: "INVENTORY_SPARE",
            sourceReference: sourceReference || null,
            remarks: remarks || null,
            status,
            modeOfProcurement: "PURCHASE",
            parentAssetId: parent.id,
            vendorId: useInherit
              ? parent.vendorId
              : (vendorId != null ? Number(vendorId) : spare.vendorId),
            departmentId: useInherit
              ? parent.departmentId
              : (departmentId != null ? Number(departmentId) : null),
            workingCondition: workingCondition || null,
          },
          include: {
            parentAsset: {
              select: {
                assetId: true,
                assetName: true,
              },
            },
          },
        });

        await prisma.sparePart.update({
          where: { id: spare.id },
          data: {
            stockQuantity: {
              decrement: qty,
            },
          },
        });

        await prisma.inventoryTransaction.create({
          data: {
            type: "OUT",
            sparePartId: spare.id,
            quantity: qty,
            referenceType: "SUB_ASSET",
            referenceId: child.id,
            notes: `Converted to sub-asset ${child.assetId} under parent ${parent.assetId}`,
          },
        });

        res.status(201).json(child);
        return;
      } catch (e) {
        // best-effort rollback since you're avoiding DB transactions
        if (child?.id) {
          try {
            await prisma.asset.delete({
              where: { id: child.id },
            });
          } catch (rollbackErr) {
            console.error("Manual rollback failed:", rollbackErr);
          }
        }

        throw e;
      }
    }

    // NEW flow
    if (!modeOfProcurement) {
      res.status(400).json({ message: "Mode of procurement is required" });
      return;
    }

    if (modeOfProcurement === "PURCHASE") {
      if (!invoiceNumber || !purchaseDate || purchaseCost == null) {
        res.status(400).json({ message: "Purchase details are required" });
        return;
      }
    }

    if (modeOfProcurement === "DONATION") {
      if (!donorName || !donationDate || !assetCondition) {
        res.status(400).json({ message: "Donation details are required" });
        return;
      }
    }

    if (modeOfProcurement === "LEASE") {
      if (!leaseStartDate || !leaseEndDate) {
        res.status(400).json({ message: "Lease details are required" });
        return;
      }
    }

    if (modeOfProcurement === "RENTAL") {
      if (!rentalStartDate || !rentalEndDate) {
        res.status(400).json({ message: "Rental details are required" });
        return;
      }
    }

    const child = await prisma.asset.create({
      data: {
        assetId: newAssetId,
        assetName,
        assetType,
        assetCategoryId: Number(assetCategoryId),
        serialNumber,
        referenceCode: referenceCode || null,
        sourceType: "NEW",
        sourceReference: sourceReference || null,
        remarks: remarks || null,
        modeOfProcurement,
        status,
        parentAssetId: parent.id,
        vendorId: useInherit ? parent.vendorId : (vendorId != null ? Number(vendorId) : null),
        departmentId: useInherit ? parent.departmentId : (departmentId != null ? Number(departmentId) : null),
        invoiceNumber: invoiceNumber || null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        purchaseOrderNo: purchaseOrderNo || null,
        purchaseOrderDate: purchaseOrderDate ? new Date(purchaseOrderDate) : null,
        purchaseCost: purchaseCost != null ? Number(purchaseCost) : null,
        donorName: donorName || null,
        donationDate: donationDate ? new Date(donationDate) : null,
        assetCondition: assetCondition || null,
        estimatedValue: estimatedValue != null ? Number(estimatedValue) : null,
        leaseStartDate: leaseStartDate ? new Date(leaseStartDate) : null,
        leaseEndDate: leaseEndDate ? new Date(leaseEndDate) : null,
        leaseAmount: leaseAmount != null ? Number(leaseAmount) : null,
        rentalStartDate: rentalStartDate ? new Date(rentalStartDate) : null,
        rentalEndDate: rentalEndDate ? new Date(rentalEndDate) : null,
        rentalAmount: rentalAmount != null ? Number(rentalAmount) : null,
        workingCondition: workingCondition || null,
      },
      include: {
        parentAsset: {
          select: {
            assetId: true,
            assetName: true,
          },
        },
      },
    });

    res.status(201).json(child);
    return;
  } catch (e: any) {
    console.error(e);

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        res.status(409).json({
          message: "Duplicate serial number, reference code, or asset id",
          meta: e.meta,
        });
        return;
      }
    }

    res.status(500).json({
      message: e.message || "Failed to create sub asset",
    });
    return;
  }
};
export const getSparePartOptions = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();

    const list = await prisma.sparePart.findMany({
      where: {
        ...(q
          ? {
            OR: [
              { name: { contains: q } },
              { partNumber: { contains: q } },
              { model: { contains: q } },
            ],
          }
          : {}),
        stockQuantity: { gt: 0 },
      },
      take: 50,
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        partNumber: true,
        model: true,
        stockQuantity: true,
      },
    });

    res.json(
      list.map((s) => ({
        label: `${s.name}${s.partNumber ? ` (${s.partNumber})` : ""}${s.model ? ` - ${s.model}` : ""} | Stock: ${s.stockQuantity}`,
        value: s.id,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to load spare parts" });
  }
};

async function generateSubAssetId(parentAsset: { id: number; assetId: string }): Promise<string> {
  const existingSubAssets = await prisma.asset.findMany({
    where: {
      parentAssetId: parentAsset.id
    },
    select: {
      assetId: true
    }
  });

  let maxSeq = 0;
  const prefix = `${parentAsset.assetId}-`;

  for (const item of existingSubAssets) {
    // only consider IDs that actually belong to this parent's generated sub-asset series
    if (!item.assetId.startsWith(prefix)) continue;

    const suffix = item.assetId.slice(prefix.length);

    // only accept exact 3-digit suffix like 001, 002
    if (/^\d{3}$/.test(suffix)) {
      const num = Number(suffix);
      if (num > maxSeq) maxSeq = num;
    }
  }

  const next = String(maxSeq + 1).padStart(3, "0");
  return `${parentAsset.assetId}-${next}`;
}
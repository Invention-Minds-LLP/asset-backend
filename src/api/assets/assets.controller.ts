import { Request, Response } from "express";
import prisma from "../../prismaClient";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { Client } from "basic-ftp";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { generateAssetId, generateLegacyAssetId } from "../../utilis/assetIdGenerator";


const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
};


// export const getAllAssets = async (req: Request, res: Response) => {
//   const assets = await prisma.asset.findMany(
//     {
//       include: { assetCategory: true, vendor: true, department: true, allottedTo: true }
//     });
//   res.json(assets);
// };
export const getAllAssets = async (req: Request, res: Response) => {
  try {
    const user = req.user as any; // from auth middleware

    const role = user?.role;
    const departmentId = user?.departmentId;
    const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;

    let where: any = {};

    // Check if user belongs to Store department → sees all assets
    let isStoreDept = false;
    if (departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: Number(departmentId) }, select: { name: true } });
      if (dept?.name?.toUpperCase().includes('STORE')) isStoreDept = true;
    }

    if (role === 'ADMIN' || role === 'CEO_COO' || role === 'FINANCE' || role === 'OPERATIONS' || isStoreDept) {
      where = {};
    } else if (role === 'HOD') {
      where = {
        departmentId: Number(departmentId)
      };
    } else if (role === 'SUPERVISOR') {
      where = {
        supervisorId: Number(employeeDbId)
      };
    } else {
      // EXECUTIVE — see assets in their department
      where = departmentId
        ? { departmentId: Number(departmentId) }
        : { allottedToId: Number(employeeDbId) };
    }

    const assets = await prisma.asset.findMany({
      where,
      include: {
        assetCategory: true,
        vendor: true,
        department: true,
        allottedTo: true,
        supervisor: true
      }
    });

    res.json(assets);
  } catch (error) {
    console.error('getAllAssets error:', error);
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
};

// GET /assets/all-dropdown — lightweight list of ALL assets for dropdowns (ticket form, etc.)
export const getAllAssetsForDropdown = async (_req: Request, res: Response) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { status: { notIn: ["DISPOSED", "SCRAPPED", "IN_STORE", "RETIRED", "CONDEMNED", "REJECTED"] } },
      select: {
        id: true,
        assetId: true,
        assetName: true,
        serialNumber: true,
        status: true,
        departmentId: true,
        department: { select: { name: true } },
        assetCategory: { select: { name: true } },
        currentLocation: true,
      },
      orderBy: { assetName: "asc" },
    });
    res.json(assets);
  } catch (error) {
    console.error("getAllAssetsForDropdown error:", error);
    res.status(500).json({ message: "Failed to fetch assets" });
  }
};

export const getAssetById = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const asset = await prisma.asset.findUnique(
    {
      where: { id },
      include: {
        assetCategory: true,
        vendor: true,
        department: true,
        allottedTo: true
      }
    });

  if (!asset) {
    res.status(404).json({ message: "Asset not found" });
    return;
  }
  res.json(asset);
};

// export const createAsset = async (req: Request, res: Response) => {
//     // 1️⃣ Determine the financial year (e.g., FY2025-26)
//     const now = new Date();
//     const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
//     const fyEndYear = fyStartYear + 1;
//     const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, '0')}`;

//     // 2️⃣ Find the latest asset ID in this FY
//     const latestAsset = await prisma.asset.findFirst({
//         where: {
//             assetId: {
//                 startsWith: `AST-${fyString}`
//             }
//         },
//         orderBy: {
//             id: 'desc'
//         }
//     });

//     // 3️⃣ Extract last sequence number or start at 0
//     let nextNumber = 1;
//     if (latestAsset) {
//         const parts = latestAsset.assetId.split('-');
//         const lastSeq = parseInt(parts[3], 10);
//         nextNumber = lastSeq + 1;
//     }

//     // 4️⃣ Generate asset ID
//     const assetId = `AST-${fyString}-${nextNumber.toString().padStart(3, '0')}`;
//     const {
//         assetCategoryId,
//         vendorId,
//         departmentId,
//         allottedToId,
//         ...rest
//       } = req.body;

//       const asset = await prisma.asset.create({
//         data: {
//           ...rest,
//           assetId,  // generated assetId
//           assetCategory: { connect: { id: assetCategoryId } },
//           vendor: { connect: { id: vendorId } },
//           department: { connect: { id: departmentId } },
//           allottedTo: { connect: { id: allottedToId } },
//         }
//       });

//     res.status(201).json(asset);
// };

export const createAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = req.body;

    // ── 7-year lifetime guard ────────────────────────────────────────────────
    if (data.expectedLifetime && data.expectedLifetimeUnit) {
      let lifetimeYears = Number(data.expectedLifetime);
      if (data.expectedLifetimeUnit === "MONTHS") lifetimeYears = lifetimeYears / 12;
      if (lifetimeYears > 7) {
        res.status(400).json({ message: "Asset expected lifetime cannot exceed 7 years as per hospital policy." });
        return;
      }
    }

    // ── Asset ID — legacy assets get a legacy ID immediately; others get TEMP ──
    const newAssetId = data.isLegacyAsset === true || data.isLegacyAsset === 'true'
      ? await generateLegacyAssetId(data.purchaseDate ?? null, undefined, data.assetCategoryId ? Number(data.assetCategoryId) : null)
      : `TEMP-${Date.now()}`;

    // Auto-assign supervisor for department
    // let supervisorId: number | null = null;
    // if (data.departmentId) {
    //   const supervisor = await prisma.employee.findFirst({
    //     where: { departmentId: Number(data.departmentId), role: "SUPERVISOR" },
    //   });
    //   supervisorId = supervisor?.id ?? null;
    // }

    // For DONATION / LEASE / RENTAL, inspection checklist must be completed first
    const requiresInspection = ["DONATION", "LEASE", "RENTAL"].includes(data.modeOfProcurement || "PURCHASE");
    if (requiresInspection) {
      if (!data.physicalInspectionStatus) {
        res.status(400).json({ message: "Physical inspection status is required for Donation, Lease, and Rental assets." });
        return;
      }
      if (!data.functionalInspectionStatus) {
        res.status(400).json({ message: "Functional inspection status is required for Donation, Lease, and Rental assets." });
        return;
      }
    }

    const asset = await prisma.asset.create({
      data: {
        assetId: newAssetId,
        assetName: data.assetName,
        assetType: data.assetType,
        assetNature: data.assetNature ?? "TANGIBLE",
        intangibleSubType: data.intangibleSubType ?? null,
        usefulLifeYears: data.usefulLifeYears ? Number(data.usefulLifeYears) : null,
        amortizationMethod: data.amortizationMethod ?? null,
        amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
        residualValuePercent: data.residualValuePercent ? Number(data.residualValuePercent) : null,
        assetCategoryId: data.assetCategoryId,
        rfidCode: data.rfidCode && String(data.rfidCode).trim() !== "" ? String(data.rfidCode).trim() : null,
        referenceCode: data.referenceCode ? String(data.referenceCode).trim() : null,
        serialNumber: data.serialNumber,
        assetPhoto: data.assetPhoto ?? null,
        modeOfProcurement: data.modeOfProcurement ?? "PURCHASE",
        serviceCoverageType: data.serviceCoverageType ?? null,

        // PURCHASE
        invoiceNumber: data.invoiceNumber,
        purchaseOrderNo: data.purchaseOrderNo,
        purchaseOrderDate: data.purchaseOrderDate ? new Date(data.purchaseOrderDate) : null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        purchaseCost: data.purchaseCost,
        purchaseVoucherNo: data.purchaseVoucherNo ?? null,
        purchaseVoucherDate: data.purchaseVoucherDate ? new Date(data.purchaseVoucherDate) : null,
        purchaseVoucherId: data.purchaseVoucherId ? Number(data.purchaseVoucherId) : null,
        vendorId: data.vendorId,

        // DONATION
        donorName: data.donorName,
        donationDate: data.donationDate ? new Date(data.donationDate) : null,
        assetCondition: data.assetCondition,
        estimatedValue: data.estimatedValue,
        donationDocument: data.donationDocument,

        // LEASE
        leaseStartDate: data.leaseStartDate ? new Date(data.leaseStartDate) : null,
        leaseEndDate: data.leaseEndDate ? new Date(data.leaseEndDate) : null,
        leaseAmount: data.leaseAmount,
        leaseRenewalDate: data.leaseRenewalDate ? new Date(data.leaseRenewalDate) : null,
        leaseContractDoc: data.leaseContractDoc,

        // RENTAL
        rentalStartDate: data.rentalStartDate ? new Date(data.rentalStartDate) : null,
        rentalEndDate: data.rentalEndDate ? new Date(data.rentalEndDate) : null,
        rentalAmount: data.rentalAmount,
        rentalAgreementDoc: data.rentalAgreementDoc,

        // Inspection (for Donation / Lease / Rental)
        inspectionDoneBy: data.inspectionDoneBy ?? null,
        inspectionCondition: data.inspectionCondition ?? null,
        inspectionRemark: data.inspectionRemark ?? null,
        physicalInspectionStatus: data.physicalInspectionStatus ?? null,
        physicalInspectionDate: data.physicalInspectionDate ? new Date(data.physicalInspectionDate) : null,
        functionalInspectionStatus: data.functionalInspectionStatus ?? null,
        functionalInspectionDate: data.functionalInspectionDate ? new Date(data.functionalInspectionDate) : null,
        functionalTestNotes: data.functionalTestNotes ?? null,

        // GRN
        grnNumber: data.grnNumber,
        grnDate: data.grnDate ? new Date(data.grnDate) : null,
        grnValue: data.grnValue,
        inspectionStatus: data.inspectionStatus,

        departmentId: data.departmentId ? Number(data.departmentId) : null,
        // supervisorId: supervisorId,
        expectedLifetime: data.expectedLifetime ? Number(data.expectedLifetime) : null,
        expectedLifetimeUnit: data.expectedLifetimeUnit ?? null,

        // ── Legacy onboarding fields ──────────────────────────────────────────
        isLegacyAsset: data.isLegacyAsset ? true : false,
        dataAvailableSince: data.dataAvailableSince ? new Date(data.dataAvailableSince) : null,
        historicalMaintenanceCost: data.historicalMaintenanceCost ? String(data.historicalMaintenanceCost) : null,
        historicalSparePartsCost: data.historicalSparePartsCost ? String(data.historicalSparePartsCost) : null,
        historicalOtherCost: data.historicalOtherCost ? String(data.historicalOtherCost) : null,
        historicalCostAsOf: data.historicalCostAsOf ? new Date(data.historicalCostAsOf) : null,
        historicalCostNote: data.historicalCostNote ?? null,

        // ── Asset Pool linkage ────────────────────────────────────────────────
        assetPoolId: data.assetPoolId ? Number(data.assetPoolId) : null,
        financialYearAdded: data.financialYearAdded ?? null,

        status: "IN_STORE",
      } as any
    });

    logAction({ entityType: "ASSET", entityId: asset.id, action: "CREATE", description: `Asset ${asset.assetId} created`, newValue: JSON.stringify(asset), performedById: (req as any).user?.employeeDbId });

    // ── Pool linkage post-processing ─────────────────────────────────────────
    if (data.assetPoolId) {
      const poolId = Number(data.assetPoolId);

      // 1. Update pool status (PARTIAL / COMPLETE)
      const pool = await prisma.assetPool.findUnique({ where: { id: poolId } });
      if (pool) {
        const linkedCount = await prisma.asset.count({ where: { assetPoolId: poolId } });
        const remaining = pool.originalQuantity - linkedCount;
        await prisma.assetPool.update({
          where: { id: poolId },
          data: { status: remaining <= 0 ? "COMPLETE" : "PARTIAL" },
        });
      }

      // 2. Auto-create depreciation with proportional opening balance if:
      //    - asset has purchaseCost
      //    - pool has a FA schedule uploaded
      //    - no depreciation record exists yet
      //    - req.body.autoProportionalDep === true (frontend opt-in) OR depreciationMethod provided
      const shouldAutoDep = data.autoProportionalDep || data.depreciationMethod;
      if (shouldAutoDep && data.purchaseCost) {
        const existingDep = await prisma.assetDepreciation.findUnique({ where: { assetId: asset.id } });
        if (!existingDep) {
          const schedules = await prisma.assetPoolDepreciationSchedule.findMany({
            where: { poolId },
            orderBy: { financialYearEnd: "desc" },
            take: 1,
          });
          const latestSched = schedules[0] ?? null;

          if (latestSched) {
            const assetCost      = Number(data.purchaseCost);
            const poolGross      = Number(latestSched.closingGrossBlock);
            const poolAccDep     = Number(latestSched.closingAccumulatedDep);
            const shareRatio     = poolGross > 0 ? assetCost / poolGross : 0;
            const openingAccDep  = Math.round(poolAccDep * shareRatio);
            const openingBV      = Math.max(0, assetCost - openingAccDep);
            const depMethod      = data.depreciationMethod || "SL";
            const depRate        = data.depreciationRate ?? Number(latestSched.depreciationRate);
            const depStart       = data.depreciationStart
              ? new Date(data.depreciationStart)
              : (data.purchaseDate ? new Date(data.purchaseDate) : new Date(latestSched.financialYearEnd));

            await prisma.assetDepreciation.create({
              data: {
                assetId:                asset.id,
                depreciationMethod:     depMethod,
                depreciationRate:       String(depRate),
                expectedLifeYears:      data.expectedLifeYears ? Number(data.expectedLifeYears) : 10,
                depreciationStart:      depStart,
                depreciationFrequency:  data.depreciationFrequency || "YEARLY",
                salvageValue:           null,
                accumulatedDepreciation: String(openingAccDep),
                currentBookValue:       String(openingBV),
                lastCalculatedAt:       null,
                roundOff:               false,
                decimalPlaces:          2,
                isActive:               true,
                createdById:            (req as any).user?.employeeDbId ?? null,
              },
            });
          }
        }
      }
    }

    // Reload asset with depreciation if auto-created
    const finalAsset = await prisma.asset.findUnique({
      where: { id: asset.id },
      include: { depreciation: true },
    });

    res.status(201).json(finalAsset);
    return;

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating asset" });
  }
};

// ── HOD Approve / Reject Asset (issues the real Asset ID on approval) ─────────
export const hodApproveAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { action, remarks } = req.body; // action: APPROVED | REJECTED
    const user = req.user as any;

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) { res.status(404).json({ message: "Asset not found" }); return; }
    if ((asset as any).hodApprovalStatus !== "PENDING") {
      res.status(400).json({ message: "Asset is not pending HOD approval" }); return;
    }

    if (action === "APPROVED") {
      // Now generate the real Asset ID
      const newAssetId = await generateAssetId((asset as any).modeOfProcurement || "PURCHASE", undefined, { categoryId: (asset as any).assetCategoryId });

      // Auto-assign supervisor for location
      let supervisorId = (asset as any).supervisorId;
      if (!supervisorId && asset.departmentId) {
        const supervisor = await prisma.employee.findFirst({
          where: { departmentId: asset.departmentId, role: "SUPERVISOR" }
        });
        supervisorId = supervisor?.id ?? null;
      }

      const updated = await prisma.asset.update({
        where: { id },
        data: {
          assetId: newAssetId,
          hodApprovalStatus: "APPROVED",
          hodApprovalById: user?.employeeDbId ?? null,
          hodApprovalAt: new Date(),
          hodApprovalRemarks: remarks ?? null,
          supervisorId,
          status: "IN_STORE",
        } as any
      });

      res.json({ message: "Asset approved and Asset ID issued", asset: updated });
    } else {
      const updated = await prisma.asset.update({
        where: { id },
        data: {
          hodApprovalStatus: "REJECTED",
          hodApprovalById: user?.employeeDbId ?? null,
          hodApprovalAt: new Date(),
          hodApprovalRemarks: remarks ?? null,
          status: "REJECTED",
        } as any
      });
      res.json({ message: "Asset rejected", asset: updated });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to process HOD approval" });
  }
};
// export const completeAssetDetails = async (req: AuthenticatedRequest, res: Response) => {
//   try {

//     if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
//       res.status(403).json({ message: "Only department users can complete assets" });
//       return
//     }

//     const id = parseInt(req.params.id);
//     const data = req.body;

//     const updated = await prisma.asset.update({
//       where: { id },
//       data: {
//         departmentId: data.departmentId,
//         allottedToId: data.allottedToId,
//         rfidCode: data.rfidCode,
//         slaExpectedValue: data.slaExpectedValue,
//         slaExpectedUnit: data.slaExpectedUnit,
//         slaDetails: data.slaDetails,
//         expectedLifetime: data.expectedLifetime,
//         expectedLifetimeUnit: data.expectedLifetimeUnit,
//         status: "ACTIVE"
//       }
//     });

//     // Also create a location history entry
//     await prisma.assetLocation.create({
//       data: {
//         assetId: id,
//         branchId: data.branchId,
//         block: data.block,
//         floor: data.floor,
//         room: data.room,
//         employeeResponsibleId: data.employeeResponsibleId,
//         isActive: true
//       }
//     });

//     res.json(updated);
//     return

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Error completing asset details" });
//     return
//   }
// };
// export const adminUpdateAsset = async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     if (req.user.role !== "superadmin") {
//       res.status(403).json({ message: "Admins only" });
//       return;
//     }

//     const id = parseInt(req.params.id);
//     const data = req.body;

//     const updated = await prisma.asset.update({
//       where: { id },
//       data
//     });

//     res.json(updated);
//     return;

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Admin update failed" });
//     return
//   }
// };

// export const updateAsset = async (req: Request, res: Response) => {
//   const id = parseInt(req.params.id);

//   const {
//     assetId,
//     assetName,
//     assetType,
//     serialNumber,
//     purchaseDate,
//     rfidCode,
//     currentLocation,
//     status,
//     assetCategoryId,
//     vendorId,
//     departmentId,
//     allottedToId,
//     expectedLifetime,
//     expectedLifetimeUnit,
//     slaExpectedValue,
//     slaExpectedUnit
//   } = req.body;

//   const asset = await prisma.asset.update({
//     where: { id },
//     data: {
//       assetId,
//       assetName,
//       assetType,
//       serialNumber,
//       purchaseDate,
//       rfidCode,
//       currentLocation,
//       status,
//       expectedLifetime,
//       expectedLifetimeUnit,
//       slaExpectedValue,
//       slaExpectedUnit,
//       assetCategory: {
//         connect: { id: assetCategoryId },
//       },
//       vendor: {
//         connect: { id: vendorId },
//       },
//       department: {
//         connect: { id: departmentId },
//       },
//       allottedTo: {
//         connect: { id: allottedToId },
//       },
//     },
//     include: {
//       assetCategory: true,
//       vendor: true,
//       department: true,
//       allottedTo: true,
//     },
//   });

//   res.json(asset);
// };
export const updateAsset = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = req.body;

    const updateData: any = {
      assetName: data.assetName,
      assetType: data.assetType,
      assetNature: data.assetNature ?? "TANGIBLE",
      // Intangible-specific
      intangibleSubType: data.intangibleSubType ?? null,
      usefulLifeYears: data.usefulLifeYears ? Number(data.usefulLifeYears) : null,
      amortizationMethod: data.amortizationMethod ?? null,
      amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
      residualValuePercent: data.residualValuePercent ? Number(data.residualValuePercent) : null,
      referenceCode: data.referenceCode ? String(data.referenceCode).trim() : null,
      serialNumber: data.serialNumber,
      assetPhoto: data.assetPhoto,
      rfidCode: data.rfidCode,
      modeOfProcurement: data.modeOfProcurement,

      // GRN
      grnNumber: data.grnNumber,
      grnDate: data.grnDate ? new Date(data.grnDate) : null,
      grnValue: data.grnValue ? Number(data.grnValue) : null,
      inspectionStatus: data.inspectionStatus,
      inspectionRemarks: data.inspectionRemarks,

      // Lifetime
      expectedLifetime: data.expectedLifetime ? Number(data.expectedLifetime) : null,
      expectedLifetimeUnit: data.expectedLifetimeUnit || null,

      slaCategory: data.slaCategory || null,


      // SLA
      slaExpectedValue: data.slaExpectedValue ? Number(data.slaExpectedValue) : null,
      slaExpectedUnit: data.slaExpectedUnit || null,
      slaResolutionValue: data.slaResolutionValue ? Number(data.slaResolutionValue) : null,
      slaResolutionUnit: data.slaResolutionUnit || null,
      // slaDetails: data.slaDetails,

      status: data.status,

      // ── Legacy onboarding fields ──────────────────────────────────────────
      isLegacyAsset: data.isLegacyAsset ? true : false,
      dataAvailableSince: data.dataAvailableSince ? new Date(data.dataAvailableSince) : null,
      historicalMaintenanceCost: data.historicalMaintenanceCost != null ? String(data.historicalMaintenanceCost) : null,
      historicalSparePartsCost: data.historicalSparePartsCost != null ? String(data.historicalSparePartsCost) : null,
      historicalOtherCost: data.historicalOtherCost != null ? String(data.historicalOtherCost) : null,
      historicalCostAsOf: data.historicalCostAsOf ? new Date(data.historicalCostAsOf) : null,
      historicalCostNote: data.historicalCostNote ?? null,
    };

    // ---------------------------
    // CATEGORY (SAFE CONNECT)
    // ---------------------------
    if (data.assetCategoryId) {
      updateData.assetCategory = {
        connect: { id: Number(data.assetCategoryId) }
      };
    }

    // ---------------------------
    // VENDOR (SAFE CONNECT)
    // ---------------------------
    if (data.vendorId) {
      updateData.vendor = {
        connect: { id: Number(data.vendorId) }
      };
    }

    // ---------------------------
    // DEPARTMENT
    // ---------------------------
    if (data.departmentId) {
      updateData.department = {
        connect: { id: Number(data.departmentId) }
      };
    }

    // ---------------------------
    // ALLOTTED TO
    // ---------------------------
    if (data.allottedToId) {
      updateData.allottedTo = {
        connect: { id: Number(data.allottedToId) }
      };
    }
    if (data.supervisorId) {
      updateData.supervisor = {
        connect: { id: Number(data.supervisorId) }
      };
    }

    // ---------------------------
    // MODE-BASED FIELDS
    // ---------------------------
    if (data.modeOfProcurement === "PURCHASE") {
      Object.assign(updateData, {
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        invoiceNumber: data.invoiceNumber,
        purchaseOrderNo: data.purchaseOrderNo,
        purchaseOrderDate: data.purchaseOrderDate ? new Date(data.purchaseOrderDate) : null,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        purchaseCost: data.purchaseCost ? Number(data.purchaseCost) : null,
        purchaseVoucherNo: data.purchaseVoucherNo ?? null,
        purchaseVoucherDate: data.purchaseVoucherDate ? new Date(data.purchaseVoucherDate) : null,
        purchaseVoucherId: data.purchaseVoucherId ? Number(data.purchaseVoucherId) : null,
      });
    }

    if (data.modeOfProcurement === "DONATION") {
      Object.assign(updateData, {
        donorName: data.donorName,
        donationDate: data.donationDate ? new Date(data.donationDate) : null,
        assetCondition: data.assetCondition,
        estimatedValue: data.estimatedValue ? Number(data.estimatedValue) : null,
        donationDocument: data.donationDocument,
      });
    }

    if (data.modeOfProcurement === "LEASE") {
      Object.assign(updateData, {
        leaseStartDate: data.leaseStartDate ? new Date(data.leaseStartDate) : null,
        leaseEndDate: data.leaseEndDate ? new Date(data.leaseEndDate) : null,
        leaseAmount: data.leaseAmount ? Number(data.leaseAmount) : null,
        leaseRenewalDate: data.leaseRenewalDate ? new Date(data.leaseRenewalDate) : null,
        leaseContractDoc: data.leaseContractDoc
      });
    }

    if (data.modeOfProcurement === "RENTAL") {
      Object.assign(updateData, {
        rentalStartDate: data.rentalStartDate ? new Date(data.rentalStartDate) : null,
        rentalEndDate: data.rentalEndDate ? new Date(data.rentalEndDate) : null,
        rentalAmount: data.rentalAmount ? Number(data.rentalAmount) : null,
        rentalAgreementDoc: data.rentalAgreementDoc
      });
    }

    const updated = await prisma.asset.update({
      where: { id },
      data: updateData,
      include: {
        assetCategory: true,
        vendor: true,
        department: true,
        allottedTo: true,
      },
    });

    logAction({ entityType: "ASSET", entityId: id, action: "UPDATE", description: `Asset updated`, performedById: (req as any).user?.employeeDbId });

    res.json(updated);

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Asset update error", error: err.message });
  }
};


export const deleteAsset = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.asset.delete(
    { where: { id } }
  );
  logAction({ entityType: "ASSET", entityId: id, action: "DELETE", description: `Asset deleted`, performedById: (req as any).user?.employeeDbId });
  res.status(204).send();
};

export const getAssetByAssetId = async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const asset = await prisma.asset.findFirst({
      where: { assetId },
      include: {
        depreciation: true,
        insurance: true,

        // ✅ CURRENT LOCATION ONLY
        locations: {
          where: { isActive: true },
          take: 1,
          include: {
            branch: true,
            employeeResponsible: true
          }
        },

        // ✅ TRANSFER HISTORY (latest first)
        transfers: {
          orderBy: { transferDate: "desc" },
          include: {
            fromBranch: true,
            toBranch: true
          }
        }
      }
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return
    }

    res.json(asset);
  } catch (err) {
    console.error("getAssetByAssetId error:", err);
    res.status(500).json({ message: "Error fetching asset" });
  }
};


const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}
async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
  const client = new Client();
  client.ftp.verbose = true;

  try {
    await client.access(FTP_CONFIG);

    console.log("Connected to FTP server for asset image upload");

    const remoteDir = path.dirname(remoteFilePath);
    await client.ensureDir(remoteDir);

    await client.uploadFrom(localFilePath, remoteFilePath);
    console.log(`Uploaded asset image to: ${remoteFilePath}`);

    await client.close();

    const fileName = path.basename(remoteFilePath);
    return `https://smartassets.inventionminds.com/assets_images/${fileName}`;
  } catch (error) {
    console.error("FTP upload error:", error);
    throw new Error("FTP upload failed");
  }
}

export const uploadAssetImage = async (req: Request, res: Response) => {
  try {
    const assetId = req.params.assetId;
    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: false,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Formidable parse error:", err);
        res.status(500).json({ error: err.message });
        return
      }

      if (!files.file || files.file.length === 0) {
        res.status(400).json({ error: "No image file uploaded." });
        return
      }

      const file = files.file[0];
      const tempFilePath = file.filepath;
      const originalFileName = file.originalFilename || `asset-${Date.now()}.jpg`;

      if (!fs.existsSync(tempFilePath)) {
        res.status(500).json({ error: "Temporary image file not found." });
        return
      }

      const remoteFilePath = `/public_html/smartassets/assets_images/${originalFileName}`;

      let fileUrl: string;
      try {
        fileUrl = await uploadToFTP(tempFilePath, remoteFilePath);
        console.log("Asset image uploaded successfully:", fileUrl);
        await prisma.asset.update({
          where: { assetId: assetId.toString() },
          data: { assetPhoto: fileUrl },
        });
      } catch (uploadErr) {
        console.error("Asset image upload failed:", uploadErr);
        res.status(500).json({ error: "Asset image upload failed." });
        return
      }

      console.log("Uploaded asset image URL:", fileUrl);

      // Delete local temp file
      fs.unlinkSync(tempFilePath);

      res.json({ url: fileUrl });
      return
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: (error as Error).message });
    return
  }
};
export const updateAssetAssignment = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { departmentId, supervisorId, allottedToId } = req.body;

    if (!id) {
      res.status(400).json({ message: "Asset ID required" });
    }

    const updateData: any = {};

    if (departmentId !== undefined) {
      updateData.department = { connect: { id: Number(departmentId) } };
    }

    if (supervisorId !== undefined) {
      updateData.supervisor = { connect: { id: Number(supervisorId) } };
    }

    if (allottedToId !== undefined) {
      updateData.allottedTo = { connect: { id: Number(allottedToId) } };
    }

    updateData.status = 'active'
    const updated = await prisma.asset.update({
      where: { id },
      data: updateData,
      include: {
        department: true,
        supervisor: true,
        allottedTo: true,
      }
    });

    res.json(updated);
  } catch (err) {
    console.error("Assignment update error:", err);
    res.status(500).json({ message: "Failed to update assignment" });
  }
};
export const createAssetSpecification = async (req: Request, res: Response) => {
  try {
    const {
      assetId,
      key,
      value,
      specificationGroup,
      valueType,
      unit,
      sortOrder,
      isMandatory,
      source,
      remarks,
    } = req.body;

    if (!assetId || !key || !value) {
      res.status(400).json({ message: "assetId, key and value are required" });
      return;
    }

    const spec = await prisma.assetSpecification.create({
      data: {
        assetId: Number(assetId),
        key: String(key).trim(),
        value: String(value).trim(),
        specificationGroup: specificationGroup || null,
        valueType: valueType || null,
        unit: unit || null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        isMandatory: !!isMandatory,
        source: source || null,
        remarks: remarks || null,
      }
    });

    res.status(201).json(spec);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Failed to create specification", error: err.message });
  }
};

export const getAssetSpecifications = async (req: Request, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);

    const specs = await prisma.assetSpecification.findMany({
      where: { assetId },
      orderBy: [
        { sortOrder: 'asc' },
        { id: 'asc' }
      ]
    });

    res.json(specs);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch specifications", error: err.message });
  }
};

export const updateAssetSpecification = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      key,
      value,
      specificationGroup,
      valueType,
      unit,
      sortOrder,
      isMandatory,
      source,
      remarks,
    } = req.body;

    const existing = await prisma.assetSpecification.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Specification not found" });
      return;
    }

    const updated = await prisma.assetSpecification.update({
      where: { id },
      data: {
        key: key ? String(key).trim() : existing.key,
        value: value ? String(value).trim() : existing.value,
        specificationGroup: specificationGroup || null,
        valueType: valueType || null,
        unit: unit || null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        isMandatory: !!isMandatory,
        source: source || null,
        remarks: remarks || null,
      }
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Failed to update specification", error: err.message });
  }
};

export const getAssetScanDetails = async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    if (!assetId || !String(assetId).trim()) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }

    const asset = await prisma.asset.findFirst({
      where: {
        assetId: String(assetId).trim()
      },
      include: {
        // master relations
        assetCategory: true,
        vendor: true,
        department: true,
        targetDepartment: true,
        supervisor: true,
        allottedTo: true,
        employee: true,

        // core details
        depreciation: true,
        warranties: {
          include: {
            vendor: true
          }
        },
        insurance: {
          include: {
            claims: true
          },
          orderBy: {
            createdAt: "desc"
          }
        },

        // specifications
        specifications: {
          orderBy: [
            { specificationGroup: "asc" },
            { sortOrder: "asc" },
            { id: "asc" }
          ]
        },

        // location
        locations: {
          where: { isActive: true },
          include: {
            branch: true,
            employeeResponsible: true
          },
          orderBy: {
            createdAt: "desc"
          }
        },

        // transfer history
        transfers: {
          include: {
            fromBranch: true,
            toBranch: true
          },
          orderBy: {
            transferDate: "desc"
          }
        },

        // assignments
        assignments: {
          include: {
            assignedTo: true,
            assignedBy: true,
            employee: true,
            assetAssignmentHistories: {
              include: {
                performedBy: true
              },
              orderBy: {
                createdAt: "desc"
              }
            }
          },
          orderBy: {
            assignedAt: "desc"
          }
        },

        // tickets
        tickets: {
          include: {
            raisedBy: true,
            assignedTo: true,
            assignedBy: true,
            department: true,
            owningDepartment: true,
            statusHistory: {
              orderBy: {
                changedAt: "desc"
              }
            },
            ticketAssignmentHistories: {
              include: {
                fromEmployee: true,
                toEmployee: true,
                performedBy: true
              },
              orderBy: {
                createdAt: "desc"
              }
            },
            ticketTransferHistories: {
              include: {
                fromDepartment: true,
                toDepartment: true,
                vendor: true,
                requestedBy: true,
                approvedBy: true
              },
              orderBy: {
                createdAt: "desc"
              }
            },
            sparePartUsages: {
              include: {
                sparePart: true,
                usedBy: true
              },
              orderBy: {
                usedAt: "desc"
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        },

        // maintenance / service
        maintenanceHistory: {
          include: {
            serviceContract: {
              include: {
                vendor: true
              }
            },
            ticket: true,
            preventiveChecklistRuns: {
              include: {
                template: true,
                performedBy: true,
                results: {
                  include: {
                    item: true
                  }
                }
              },
              orderBy: {
                createdAt: "desc"
              }
            },
            pmChecklistRuns: {
              include: {
                template: true,
                results: {
                  include: {
                    item: true
                  }
                }
              },
              orderBy: {
                createdAt: "desc"
              }
            }
          },
          orderBy: {
            actualDoneAt: "desc"
          }
        },

        maintenanceSchedules: {
          where: { isActive: true },
          orderBy: {
            nextDueAt: "asc"
          }
        },

        // service contracts
        serviceContracts: {
          include: {
            vendor: true,
            maintenanceHistories: true
          },
          orderBy: {
            createdAt: "desc"
          }
        },

        // documents
        serviceDocuments: {
          include: {
            uploadedBy: true
          },
          orderBy: {
            uploadedAt: "desc"
          }
        },

        // calibration
        calibrationSchedules: {
          include: {
            vendor: true,
            histories: {
              orderBy: {
                calibratedAt: "desc"
              }
            }
          },
          orderBy: {
            nextDueAt: "asc"
          }
        },

        calibrationHistory: {
          include: {
            vendor: true,
            schedule: true,
            createdBy: true
          },
          orderBy: {
            calibratedAt: "desc"
          }
        },

        // checklist templates / runs
        preventiveChecklistTemplates: {
          include: {
            items: {
              orderBy: {
                sortOrder: "asc"
              }
            }
          }
        },
        preventiveChecklistRuns: {
          include: {
            template: true,
            performedBy: true,
            results: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            scheduledDue: "desc"
          }
        },

        pmChecklistTemplates: {
          include: {
            items: {
              orderBy: {
                sortOrder: "asc"
              }
            }
          }
        },
        pmChecklistRuns: {
          include: {
            template: true,
            maintenanceHistory: true,
            results: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            scheduledDue: "desc"
          }
        },

        acknowledgementTemplates: {
          include: {
            items: {
              orderBy: {
                sortOrder: "asc"
              }
            }
          }
        },
        acknowledgementRuns: {
          include: {
            template: true,
            assignedTo: true,
            rows: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        },

        supportMatrixes: {
          include: {
            employee: true
          },
          orderBy: {
            levelNo: "asc"
          }
        },

        sparePartUsages: {
          include: {
            sparePart: true,
            usedBy: true,
            ticket: true
          },
          orderBy: {
            usedAt: "desc"
          }
        },

        scanLogs: {
          include: {
            scannedBy: true
          },
          orderBy: {
            scannedAt: "desc"
          },
          take: 20
        },

        qrScans: {
          include: {
            scannedBy: true
          },
          orderBy: {
            scannedAt: "desc"
          },
          take: 20
        },

        gatePasses: {
          orderBy: {
            createdAt: "desc"
          }
        },
        depreciationLogs: {
          include: {
            doneBy: true
          },
          orderBy: {
            periodEnd: "desc"
          }
        },

        insuranceClaims: {
          include: {
            insurance: true
          },
          orderBy: {
            claimDate: "desc"
          }
        }
      }
    });

    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }

    const response = {
      masterDetails: {
        id: asset.id,
        assetId: asset.assetId,
        assetName: asset.assetName,
        assetType: asset.assetType,
        serialNumber: asset.serialNumber,
        referenceCode: asset.referenceCode,
        modeOfProcurement: asset.modeOfProcurement,
        status: asset.status,
        assetPhoto: asset.assetPhoto,
        currentLocation: asset.currentLocation,
        fromLocation: asset.fromLocation,
        toLocation: asset.toLocation,
        rfidCode: asset.rfidCode,
        qrCode: asset.qrCode,
        qrGeneratedAt: asset.qrGeneratedAt,
        qrLabelPrinted: asset.qrLabelPrinted,
        purchaseDate: asset.purchaseDate,
        purchaseCost: asset.purchaseCost,
        installedAt: asset.installedAt,
        criticalityLevel: asset.criticalityLevel,
        riskClass: asset.riskClass,
        workingCondition: asset.workingCondition,
        healthScore: asset.healthScore,
        lastInspectionDate: asset.lastInspectionDate,
        slaExpectedValue: asset.slaExpectedValue,
        slaExpectedUnit: asset.slaExpectedUnit,
        slaResolutionValue: asset.slaResolutionValue,
        slaResolutionUnit: asset.slaResolutionUnit,
        slaNextDueAt: asset.slaNextDueAt,
        slaBreached: asset.slaBreached,
        lastSlaServiceDate: asset.lastSlaServiceDate,
        expectedLifetime: asset.expectedLifetime,
        expectedLifetimeUnit: asset.expectedLifetimeUnit,
        retiredDate: asset.retiredDate,
        retiredReason: asset.retiredReason,
        retiredBy: asset.retiredBy,
        specificationSummary: asset.specificationSummary,
        organogramNotes: asset.organogramNotes,
        ticketHierarchyNotes: asset.ticketHierarchyNotes,
        pmFormatNotes: asset.pmFormatNotes,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,

        assetCategory: asset.assetCategory,
        vendor: asset.vendor,
        department: asset.department,
        targetDepartment: asset.targetDepartment,
        supervisor: asset.supervisor,
        allottedTo: asset.allottedTo,
        employee: asset.employee
      },

      procurementDetails: {
        invoiceNumber: asset.invoiceNumber,
        purchaseOrderNo: asset.purchaseOrderNo,
        purchaseOrderDate: asset.purchaseOrderDate,
        deliveryDate: asset.deliveryDate,
        donorName: asset.donorName,
        donationDate: asset.donationDate,
        assetCondition: asset.assetCondition,
        estimatedValue: asset.estimatedValue,
        donationDocument: asset.donationDocument,
        leaseStartDate: asset.leaseStartDate,
        leaseEndDate: asset.leaseEndDate,
        leaseAmount: asset.leaseAmount,
        leaseRenewalDate: asset.leaseRenewalDate,
        leaseContractDoc: asset.leaseContractDoc,
        rentalStartDate: asset.rentalStartDate,
        rentalEndDate: asset.rentalEndDate,
        rentalAmount: asset.rentalAmount,
        rentalAgreementDoc: asset.rentalAgreementDoc,
        grnNumber: asset.grnNumber,
        grnDate: asset.grnDate,
        grnValue: asset.grnValue,
        inspectionStatus: asset.inspectionStatus,
        inspectionRemarks: asset.inspectionRemarks
      },

      specifications: asset.specifications,
      depreciation: asset.depreciation,
      depreciationLogs: asset.depreciationLogs,
      warranty: asset.warranties,
      insurance: asset.insurance,
      insuranceClaims: asset.insuranceClaims,
      currentLocations: asset.locations,
      transferHistory: asset.transfers,
      assignments: asset.assignments,
      tickets: asset.tickets,
      maintenanceHistory: asset.maintenanceHistory,
      maintenanceSchedules: asset.maintenanceSchedules,
      serviceContracts: asset.serviceContracts,
      documents: asset.serviceDocuments,
      calibrationSchedules: asset.calibrationSchedules,
      calibrationHistory: asset.calibrationHistory,
      preventiveChecklistTemplates: asset.preventiveChecklistTemplates,
      preventiveChecklistRuns: asset.preventiveChecklistRuns,
      pmChecklistTemplates: asset.pmChecklistTemplates,
      pmChecklistRuns: asset.pmChecklistRuns,
      acknowledgementTemplates: asset.acknowledgementTemplates,
      acknowledgementRuns: asset.acknowledgementRuns,
      supportMatrixes: asset.supportMatrixes,
      sparePartUsages: asset.sparePartUsages,
      qrScans: asset.qrScans,
      scanLogs: asset.scanLogs,
      gatePasses: asset.gatePasses,
    };

    res.json({
      success: true,
      message: "Asset scan details fetched successfully",
      data: response
    });
  } catch (err: any) {
    console.error("getAssetScanDetails error:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching asset scan details",
      error: err.message
    });
  }
};
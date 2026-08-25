import { Request, Response } from "express";
import prisma from "../../prismaClient";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { saveAndGetUrl, uniqueFileName } from "../../lib/fileStorage";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logAction } from "../audit-trail/audit-trail.controller";
import { generateAssetId, generateLegacyAssetId, generateStoreAssetId } from "../../utilis/assetIdGenerator";
import { manualAssetAllowed } from "../../utilis/procurementControlsHelper";
import { getResponsibleDepartmentIds } from "../../utilis/departmentScopeHelper";


// Asset images live under uploads/assets_images (src/lib/fileStorage.ts).


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
    const targetDepartmentId = user?.departmentId;
    const exportCsv = (req.query as any).exportCsv;

    let where: any = {};

    // Check if user belongs to Store department → sees all assets
    let isStoreDept = false;
    if (departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: Number(departmentId) }, select: { name: true } });
      if (dept?.name?.toUpperCase().includes('STORE')) isStoreDept = true;
    }

    if (role === 'ADMIN' || role === 'CEO_COO' || role === 'FINANCE' || role === 'CFO' || role === 'OPERATIONS' || isStoreDept) {
      where = {};
    } else if (role === 'HOD') {
      // An HOD can answer for several departments. An asset sits in exactly one
      // of them, so this stays a plain IN — no asset is shared between HODs.
      where = {
        departmentId: { in: await getResponsibleDepartmentIds(user, { includeSupervised: false }) }
      }
    } else if (role === 'SUPERVISOR') {
      where = {
        OR: [
          { supervisorId: Number(employeeDbId) },
          { supervisors: { some: { employeeId: Number(employeeDbId), isActive: true } } },
        ],
      };
    } else {
      // EXECUTIVE — see assets in their department(s)
      where = departmentId
        ? { departmentId: { in: await getResponsibleDepartmentIds(user, { includeSupervised: false }) } }
        : { allottedToId: Number(employeeDbId) };
    }

    // Optional filters (e.g. Store screen asking "which assets are parked in store X")
    const { currentStoreId, status, branchId } = req.query;
    if (currentStoreId) where.currentStoreId = Number(currentStoreId);
    if (status) where.status = String(status);
    // Branch scoping via the denormalized current-branch cache (see schema note).
    if (branchId) where.currentBranchId = Number(branchId);

    // Sub-assets/components (parentAssetId set) belong under their parent's expand
    // row, not as standalone entries — exclude them unless explicitly requested.
    if (req.query.includeSubAssets !== "true") where.parentAssetId = null;

    // Slim payload: only the columns the list/export actually use. Avoids
    // pulling every Asset column (incl. Text blobs, qrCode, assetPhoto of
    // unshown rows) plus full related records for ~4k rows.
    const assets = await prisma.asset.findMany({
      where,
      select: {
        id: true,
        assetId: true,
        storeAssetId: true,
        referenceCode: true,
        assetName: true,
        assetType: true,
        status: true,
        assetPhoto: true,
        hodApprovalStatus: true,
        manufacturer: true,
        modelNumber: true,
        assetCategory: { select: { name: true } },
        department: { select: { name: true } },
        allottedTo: { select: { name: true } },
        currentBranch: { select: { name: true } },
        currentStore: { select: { name: true } },
        _count: { select: { subAssets: true } }, // sub-asset count for the Sub-Assets screen badge
      },
    });

    if (exportCsv === "true") {
      console.log("dowloading");
      const csvRows = assets.map((a: any) => ({
        Asset_ID: a.assetId || "",
        AssetStorID: a.storeAssetId || "",
        AssetRefCode: a.referenceCode || "",
        AssetName: a.assetName || "",
        Department: a.department?.name || "",
        AssetType: a.assetType || "",
        AssetCategory: a.assetCategory?.name || "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment: filename=assets.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json(assets);
  } catch (error) {
    console.error('getAllAssets error:', error);
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
};

// Role-based visibility scope for assets. Mirrors getAllAssets' inline logic so
// the new paginated endpoint stays in sync without touching the legacy one.
async function buildAssetAccessWhere(user: any): Promise<any> {
  const role = user?.role;
  const departmentId = user?.departmentId;
  const employeeDbId = user?.employeeDbId || user?.employeeId || user?.id;

  let isStoreDept = false;
  if (departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: Number(departmentId) }, select: { name: true } });
    if (dept?.name?.toUpperCase().includes('STORE')) isStoreDept = true;
  }

  if (role === 'ADMIN' || role === 'CEO_COO' || role === 'FINANCE' || role === 'OPERATIONS' || isStoreDept) {
    return {};
  } else if (role === 'HOD') {
    return { departmentId: { in: await getResponsibleDepartmentIds(user, { includeSupervised: false }) } };
  } else if (role === 'SUPERVISOR') {
    return {
      OR: [
        { supervisorId: Number(employeeDbId) },
        { supervisors: { some: { employeeId: Number(employeeDbId), isActive: true } } },
      ],
    };
  } else {
    // EXECUTIVE — department assets, else own allotted
    return departmentId
      ? { departmentId: { in: await getResponsibleDepartmentIds(user, { includeSupervised: false }) } }
      : { allottedToId: Number(employeeDbId) };
  }
}

// GET /assets/paginated — server-side pagination + search for the master table.
// Returns { data, total, activeCount, page, limit }. Separate from getAllAssets
// so the 16 array-consuming callers of GET /assets are unaffected.
export const getAssetsPaginated = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 10));
    const search = (req.query.search ? String(req.query.search) : '').trim();
    const filterField = String(req.query.filterField || 'assetName');

    const accessWhere = await buildAssetAccessWhere(user);

    // Parity with getAllAssets' optional store/status/branch filters.
    const where: any = { ...accessWhere };
    const { currentStoreId, status, branchId } = req.query;
    if (currentStoreId) where.currentStoreId = Number(currentStoreId);
    if (status) where.status = String(status);
    if (branchId) where.currentBranchId = Number(branchId);

    // Exclude sub-assets/components — they belong under their parent, not the main list.
    if (req.query.includeSubAssets !== "true") where.parentAssetId = null;

    // Plain String columns → substring match.
    const STRING_FIELDS = [
      'assetName', 'assetId', 'assetType', 'serialNumber', 'referenceCode', 'storeAssetId',
      'manufacturer', 'modelNumber', 'invoiceNumber', 'purchaseOrderNo', 'currentLocation',
      'status', 'modeOfProcurement', 'physicalCondition', 'workingCondition',
      'warrantyStatus', 'disposalMethod', 'criticalityLevel',
    ];
    // To-one relations → substring match on the related row's name.
    const RELATION_FIELDS: Record<string, string> = {
      categoryName: 'assetCategory',
      'assetCategory?.name': 'assetCategory',
      department: 'department',
      targetDepartment: 'targetDepartment',
      vendor: 'vendor',
      allottedTo: 'allottedTo',
      supervisor: 'supervisor',
      currentStore: 'currentStore',
    };

    // Apply one (field → value) filter onto `target`. `allowNameFallback` keeps the
    // legacy single-search behaviour of defaulting an unknown field to assetName;
    // per-column header filters pass false so an unknown field is simply ignored.
    const applyFieldFilter = (target: any, field: string, rawValue: string, allowNameFallback: boolean) => {
      const v = String(rawValue ?? '').trim();
      if (!v) return;
      if (field === 'assetNature') {
        // Real enum — must be an exact, valid value or the filter is ignored.
        const up = v.toUpperCase();
        if (up === 'TANGIBLE' || up === 'INTANGIBLE') target.assetNature = up;
      } else if (RELATION_FIELDS[field]) {
        target[RELATION_FIELDS[field]] = { name: { contains: v } };
      } else if (STRING_FIELDS.includes(field)) {
        target[field] = { contains: v };
      } else if (allowNameFallback) {
        target.assetName = { contains: v };
      }
    };

    // Search is layered on top of the access scope (MySQL collation = case-insensitive).
    const searchWhere: any = { ...where };

    // Legacy single-field search (search box + field dropdown).
    if (search) applyFieldFilter(searchWhere, filterField, search, true);

    // Per-column header filters → JSON map { filterField: value }, AND-combined.
    if (req.query.filters) {
      try {
        const parsed = JSON.parse(String(req.query.filters));
        if (parsed && typeof parsed === 'object') {
          for (const [field, val] of Object.entries(parsed)) {
            applyFieldFilter(searchWhere, field, val as string, false);
          }
        }
      } catch { /* malformed filters param → ignore */ }
    }

    const select = {
      id: true,
      assetId: true,
      storeAssetId: true,
      referenceCode: true,
      assetName: true,
      assetType: true,
      status: true,
      assetPhoto: true,
      hodApprovalStatus: true,
      // Extra fields so departments can add these to their table layout.
      serialNumber: true,
      manufacturer: true,
      modelNumber: true,
      purchaseDate: true,
      purchaseCost: true,
      currentLocation: true,
      criticalityLevel: true,
      warrantyStatus: true,
      workingCondition: true,
      installedAt: true,
      // QR sticker confirmation — drives the lockable toggle in the master table.
      qrStickered: true,
      qrStickeredAt: true,
      qrStickeredRemarks: true,
      qrStickeredBy: { select: { name: true } },
      assetCategory: { select: { name: true } },
      department: { select: { name: true } },
      targetDepartment: { select: { name: true } },
      vendor: { select: { name: true } },
      allottedTo: { select: { name: true } },
      supervisor: { select: { name: true } },
      assetSubType: { select: { name: true } },
      currentBranch: { select: { name: true } },
    } as const;

    const [data, total, activeCount] = await Promise.all([
      prisma.asset.findMany({
        where: searchWhere,
        select,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.asset.count({ where: searchWhere }),
      // Scope-wide active count (independent of search) for the summary card.
      prisma.asset.count({ where: { ...where, status: 'ACTIVE' } }),
    ]);

    res.json({ data, total, activeCount, page, limit });
  } catch (error) {
    console.error('getAssetsPaginated error:', error);
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
};

// GET /assets/all-dropdown — lightweight list of ALL assets for dropdowns (ticket form, etc.)
export const getAllAssetsForDropdown = async (_req: Request, res: Response) => {
  try {
    const where: any = { status: { notIn: ["DISPOSED", "SCRAPPED", "IN_STORE", "RETIRED", "CONDEMNED", "REJECTED"] } };
    if (_req.query.branchId) where.currentBranchId = Number(_req.query.branchId);
    const assets = await prisma.asset.findMany({
      where,
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

// GET /assets/ticket-options — asset picker for the ticket form, role-scoped.
// Mirrors the mobile raise-ticket rule (mobile-auth.controller getMyAssets),
// plus a department scope for HOD:
//   HOD                    → assets owned by their department (departmentId)
//                             OR handed over to it (targetDepartmentId) —
//                             see the HOD_SOURCE/HOD_TARGET assignment flow
//   other management roles → every asset
//   SUPERVISOR              → assets they supervise (primary or shift-wise) or hold
//   everyone else           → assets allotted to them
// Kept separate from /all-dropdown, which finance/disposal screens still use
// unscoped.
const TICKET_ALL_ASSETS_ROLES = ["ADMIN", "FINANCE", "CFO", "OPERATIONS", "CEO", "COO", "CEO_COO"];

export const getTicketAssetOptions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;
    if (!user?.employeeDbId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const role = String(user.role || "").toUpperCase();
    const empId = Number(user.employeeDbId);

    let ownerWhere: any = {};
    if (role === "HOD" || role === "SUPERVISOR") {
      const me = await prisma.employee.findUnique({ where: { id: empId }, select: { departmentId: true } });
      const deptId = me?.departmentId ?? null;

      if (role === "HOD") {
        if (!deptId) {
          res.json([]);
          return;
        }
        ownerWhere = { OR: [{ departmentId: deptId }, { targetDepartmentId: deptId }] };
      } else {
        // Supervisors see what they personally supervise or hold, PLUS everything
        // sitting in their department. The department clause is what covers common
        // assets — shared equipment with no end user allotted, worked by whichever
        // supervisor is on shift — without attaching every supervisor to every asset.
        const or: any[] = [
          { supervisorId: empId },
          { supervisors: { some: { employeeId: empId, isActive: true } } },
          { allottedToId: empId },
        ];
        if (deptId) or.push({ departmentId: deptId }, { targetDepartmentId: deptId });
        ownerWhere = { OR: or };
      }
    } else if (!TICKET_ALL_ASSETS_ROLES.includes(role)) {
      ownerWhere = { allottedToId: empId };
    }

    const where: any = {
      ...ownerWhere,
      status: { notIn: ["DISPOSED", "SCRAPPED", "IN_STORE", "RETIRED", "CONDEMNED", "REJECTED"] },
    };
    if (req.query.branchId) where.currentBranchId = Number(req.query.branchId);

    const assets = await prisma.asset.findMany({
      where,
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
    console.error("getTicketAssetOptions error:", error);
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

    // ── Procurement provenance ───────────────────────────────────────────────
    // A tenant that buys everything through this system can insist an asset
    // trace back to a receipt. Otherwise an asset appears in the register with
    // no order, no invoice and no vendor behind it — and reconciling the
    // register to the books becomes guesswork.
    //
    // Legacy assets are exempt by definition: they pre-date the system, which
    // is the whole reason the legacy flag exists.
    const isLegacyForProvenance = data.isLegacyAsset === true || data.isLegacyAsset === "true";
    if (!isLegacyForProvenance && !data.goodsReceiptId && !(await manualAssetAllowed())) {
      res.status(403).json({
        message:
          "This tenant requires every asset to come from a goods receipt. " +
          "Receive it against its purchase order, or mark it as a legacy asset if it pre-dates the system. " +
          "(MANUAL_ASSET_WITHOUT_PROCUREMENT in Configuration controls this.)",
      });
      return;
    }

    // ── 7-year lifetime guard ────────────────────────────────────────────────
    if (data.expectedLifetime && data.expectedLifetimeUnit) {
      let lifetimeYears = Number(data.expectedLifetime);
      if (data.expectedLifetimeUnit === "MONTHS") lifetimeYears = lifetimeYears / 12;
      if (lifetimeYears > 7) {
        res.status(400).json({ message: "Asset expected lifetime cannot exceed 7 years as per hospital policy." });
        return;
      }
    }

    // ── Serial-number requirement (driven by category.serialRequired) ────────
    const categoryIdNum = data.assetCategoryId ? Number(data.assetCategoryId) : null;
    let categoryRecord: { serialRequired: boolean; name: string } | null = null;
    if (categoryIdNum) {
      categoryRecord = await prisma.assetCategory.findUnique({
        where: { id: categoryIdNum },
        select: { serialRequired: true, name: true },
      });
    }
    const serialProvided = data.serialNumber && String(data.serialNumber).trim() !== "";
    const isLegacy = data.isLegacyAsset === true || data.isLegacyAsset === 'true';
    if (categoryRecord?.serialRequired && !serialProvided && !isLegacy) {
      res.status(400).json({
        message: `Serial Number is required for category "${categoryRecord.name}".`,
      });
      return;
    }

    // ── Asset ID — legacy assets get a legacy ID immediately; others get TEMP ──
    const newAssetId = isLegacy
      ? await generateLegacyAssetId(data.purchaseDate ?? null, undefined, categoryIdNum)
      : `TEMP-${Date.now()}`;

    // Permanent stores reference (always generated on create, separate from assetId)
    const newStoreAssetId = await generateStoreAssetId(categoryIdNum);

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
        storeAssetId: newStoreAssetId,
        assetName: data.assetName,
        assetType: data.assetType,
        assetNature: data.assetNature ?? "TANGIBLE",
        intangibleSubType: data.intangibleSubType ?? null,
        usefulLifeYears: data.usefulLifeYears ? Number(data.usefulLifeYears) : null,
        amortizationMethod: data.amortizationMethod ?? null,
        amortizationStartDate: data.amortizationStartDate ? new Date(data.amortizationStartDate) : null,
        residualValuePercent: data.residualValuePercent ? Number(data.residualValuePercent) : null,
        assetCategoryId: data.assetCategoryId,
        assetSubTypeId: data.assetSubTypeId ? Number(data.assetSubTypeId) : null,
        rfidCode: data.rfidCode && String(data.rfidCode).trim() !== "" ? String(data.rfidCode).trim() : null,
        referenceCode: data.referenceCode ? String(data.referenceCode).trim() : null,
        serialNumber: serialProvided ? String(data.serialNumber).trim() : null,
        assetPhoto: data.assetPhoto ?? null,
        modeOfProcurement: data.modeOfProcurement ?? "PURCHASE",
        serviceCoverageType: data.serviceCoverageType ?? null,

        // Make/model
        manufacturer: data.manufacturer ?? null,
        modelNumber: data.modelNumber ?? null,

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

        // Revenue log applicability — drives visibility of revenue tracking sections
        isRevenueLogApplicable: data.isRevenueLogApplicable ? true : false,

        // ── Asset Pool linkage ────────────────────────────────────────────────
        assetPoolId: data.assetPoolId ? Number(data.assetPoolId) : null,
        financialYearAdded: data.financialYearAdded ?? null,

        status: "IN_STORE",
        currentStoreId: data.currentStoreId ? Number(data.currentStoreId) : null,
        currentStoreSince: data.currentStoreId ? new Date() : null,
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
            const assetCost = Number(data.purchaseCost);
            const poolGross = Number(latestSched.closingGrossBlock);
            const poolAccDep = Number(latestSched.closingAccumulatedDep);
            const shareRatio = poolGross > 0 ? assetCost / poolGross : 0;
            const openingAccDep = Math.round(poolAccDep * shareRatio);
            const openingBV = Math.max(0, assetCost - openingAccDep);
            const depMethod = data.depreciationMethod || "SL";
            const depRate = data.depreciationRate ?? Number(latestSched.depreciationRate);
            const depStart = data.depreciationStart
              ? new Date(data.depreciationStart)
              : (data.purchaseDate ? new Date(data.purchaseDate) : new Date(latestSched.financialYearEnd));

            await prisma.assetDepreciation.create({
              data: {
                assetId: asset.id,
                depreciationMethod: depMethod,
                depreciationRate: String(depRate),
                expectedLifeYears: data.expectedLifeYears ? Number(data.expectedLifeYears) : 10,
                depreciationStart: depStart,
                depreciationFrequency: data.depreciationFrequency || "YEARLY",
                salvageValue: null,
                accumulatedDepreciation: String(openingAccDep),
                currentBookValue: String(openingBV),
                lastCalculatedAt: null,
                roundOff: false,
                decimalPlaces: 2,
                isActive: true,
                createdById: (req as any).user?.employeeDbId ?? null,
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

    // ── Serial-number requirement (driven by category.serialRequired) ────────
    // Resolve the effective category: payload value if provided, otherwise the asset's existing category.
    let effectiveCategoryId: number | null = data.assetCategoryId ? Number(data.assetCategoryId) : null;
    if (!effectiveCategoryId) {
      const existing = await prisma.asset.findUnique({
        where: { id },
        select: { assetCategoryId: true, isLegacyAsset: true },
      });
      effectiveCategoryId = existing?.assetCategoryId ?? null;
    }
    let serialRequiredCategory: { serialRequired: boolean; name: string } | null = null;
    if (effectiveCategoryId) {
      serialRequiredCategory = await prisma.assetCategory.findUnique({
        where: { id: effectiveCategoryId },
        select: { serialRequired: true, name: true },
      });
    }
    const serialProvided = data.serialNumber !== undefined && data.serialNumber !== null && String(data.serialNumber).trim() !== "";
    const isLegacy = data.isLegacyAsset === true || data.isLegacyAsset === 'true';
    if (
      serialRequiredCategory?.serialRequired &&
      data.serialNumber !== undefined &&
      !serialProvided &&
      !isLegacy
    ) {
      res.status(400).json({
        message: `Serial Number is required for category "${serialRequiredCategory.name}".`,
      });
      return;
    }

    // ── Uniqueness pre-check (serialNumber / referenceCode are @unique on Asset) ──
    // Sub-assets, GRN-accepted units and work-order replacements are rows in the same
    // table, so a serial the user types may already sit on a record that never shows
    // up in the asset list. Name the clashing asset instead of letting Prisma throw
    // an opaque P2002 that the form reports as a bare "Failed to save".
    const referenceProvided = data.referenceCode !== undefined && data.referenceCode !== null && String(data.referenceCode).trim() !== "";
    if (serialProvided) {
      const serial = String(data.serialNumber).trim();
      const clash = await prisma.asset.findFirst({
        where: { serialNumber: serial, NOT: { id } },
        select: { assetId: true },
      });
      if (clash) {
        res.status(400).json({ message: `Serial number "${serial}" already belongs to asset ${clash.assetId}` });
        return;
      }
    }
    if (referenceProvided) {
      const reference = String(data.referenceCode).trim();
      const clash = await prisma.asset.findFirst({
        where: { referenceCode: reference, NOT: { id } },
        select: { assetId: true },
      });
      if (clash) {
        res.status(400).json({ message: `Reference code "${reference}" already belongs to asset ${clash.assetId}` });
        return;
      }
    }

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
      assetPhoto: data.assetPhoto,
      rfidCode: data.rfidCode,
      manufacturer: data.manufacturer ?? null,
      modelNumber: data.modelNumber ?? null,
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
      slaMode: data.slaMode || "CATEGORY",
      slaLevel: data.slaLevel || null,


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

      // Revenue log applicability
      isRevenueLogApplicable: data.isRevenueLogApplicable ? true : false,
    };

    // Unique identifiers are written only when the key is present in the body —
    // a partial PUT (section saves, voucher patches) that omits them must not blank
    // the stored values. Same guard as purchaseVoucherNo below.
    if (Object.prototype.hasOwnProperty.call(data, "serialNumber")) {
      updateData.serialNumber = serialProvided ? String(data.serialNumber).trim() : null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "referenceCode")) {
      updateData.referenceCode = referenceProvided ? String(data.referenceCode).trim() : null;
    }

    // ---------------------------
    // CATEGORY (SAFE CONNECT)
    // ---------------------------
    if (data.assetCategoryId) {
      updateData.assetCategory = {
        connect: { id: Number(data.assetCategoryId) }
      };
    }

    // ---------------------------
    // SUB-TYPE (optional; empty clears it)
    // ---------------------------
    if ("assetSubTypeId" in data) {
      updateData.assetSubType = data.assetSubTypeId
        ? { connect: { id: Number(data.assetSubTypeId) } }
        : { disconnect: true };
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

    // Voucher Details — patchable from the Depreciation tab even when the
    // procurement-mode block below isn't triggered. Only writes if the field is
    // present in the request body so we don't blank existing values on partial patches.
    if (Object.prototype.hasOwnProperty.call(data, "purchaseVoucherNo")) {
      updateData.purchaseVoucherNo = data.purchaseVoucherNo ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "purchaseVoucherDate")) {
      updateData.purchaseVoucherDate = data.purchaseVoucherDate ? new Date(data.purchaseVoucherDate) : null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "purchaseVoucherId")) {
      updateData.purchaseVoucherId = data.purchaseVoucherId ? Number(data.purchaseVoucherId) : null;
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

    // ── Mint permanent stores reference on first completion of a GRN skeleton ──
    // GRN-created assets start with no storeAssetId; the first time a stores user
    // fills in the asset's basic details we mint it. Never overwrite an existing one.
    const existingStoreRef = await prisma.asset.findUnique({
      where: { id },
      select: { storeAssetId: true },
    });
    if (!existingStoreRef?.storeAssetId) {
      updateData.storeAssetId = await generateStoreAssetId(effectiveCategoryId);
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
    // Unique-constraint violation — name the field rather than returning a bare 500.
    // MySQL reports meta.target as the constraint name (asset_serialNumber_key), so
    // match on substring rather than expecting a field list.
    if (err?.code === "P2002") {
      const target = Array.isArray(err?.meta?.target)
        ? err.meta.target.join(",")
        : String(err?.meta?.target ?? "");
      const label = /serialNumber/i.test(target) ? "serial number"
        : /referenceCode/i.test(target) ? "reference code"
          : /storeAssetId/i.test(target) ? "stores reference"
            : /assetId/i.test(target) ? "asset ID"
              : "value";
      res.status(409).json({ message: `Another asset already uses this ${label}.` });
      return;
    }
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
// Stored on the server's disk now (src/lib/fileStorage.ts), served from /uploads.
async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
  return saveAndGetUrl(localFilePath, remoteFilePath);
}

// Targeted update of make/model only — used from the Specifications tab so
// non-basic-details users (maintenance) can set them without touching other fields.
export const updateAssetMakeModel = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { manufacturer, modelNumber } = req.body;
    const data: any = {
      manufacturer: manufacturer ? String(manufacturer).trim() : null,
      modelNumber: modelNumber ? String(modelNumber).trim() : null,
    };
    // Sub-type is edited alongside make/model in the Specifications tab.
    if ("assetSubTypeId" in req.body) {
      data.assetSubTypeId = req.body.assetSubTypeId ? Number(req.body.assetSubTypeId) : null;
    }
    const updated = await prisma.asset.update({
      where: { id },
      data,
      select: { id: true, manufacturer: true, modelNumber: true, assetSubTypeId: true },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to update make/model" });
  }
};

// ─── Asset supervisors (many; supports shift-wise duty) ───────────────────────
// The set lives in AssetSupervisor; the primary is mirrored on Asset.supervisorId
// so the handover flow and default ticket routing keep working unchanged.
export const getAssetSupervisors = async (req: Request, res: Response) => {
  try {
    const assetId = Number(req.params.id);
    const rows = await prisma.assetSupervisor.findMany({
      where: { assetId, isActive: true },
      include: {
        employee: { select: { id: true, name: true, employeeID: true, role: true, departmentId: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
    });
    res.json(rows);
  } catch (e: any) {
    console.error("getAssetSupervisors error:", e);
    res.status(500).json({ message: "Failed to fetch supervisors" });
  }
};

// Replace the full supervisor set for an asset.
// Body: { supervisors: [{ employeeId, isPrimary? }] }
export const setAssetSupervisors = async (req: Request, res: Response) => {
  try {
    const assetId = Number(req.params.id);
    const createdById = (req as any).user?.employeeDbId ?? null;

    const raw = Array.isArray(req.body?.supervisors) ? req.body.supervisors : [];
    const seen = new Set<number>();
    const items: { employeeId: number; isPrimary: boolean }[] = [];
    for (const s of raw) {
      const employeeId = Number(s?.employeeId);
      if (!employeeId || seen.has(employeeId)) continue;
      seen.add(employeeId);
      items.push({ employeeId, isPrimary: !!s?.isPrimary });
    }

    // Exactly one primary when the list is non-empty (default to the first).
    const primaryId = items.find((i) => i.isPrimary)?.employeeId ?? items[0]?.employeeId ?? null;

    await prisma.$transaction(async (tx) => {
      if (items.length === 0) {
        await tx.assetSupervisor.deleteMany({ where: { assetId } });
      } else {
        await tx.assetSupervisor.deleteMany({
          where: { assetId, employeeId: { notIn: items.map((i) => i.employeeId) } },
        });
        for (const it of items) {
          await tx.assetSupervisor.upsert({
            where: { assetId_employeeId: { assetId, employeeId: it.employeeId } },
            update: { isPrimary: it.employeeId === primaryId, isActive: true },
            create: {
              assetId,
              employeeId: it.employeeId,
              isPrimary: it.employeeId === primaryId,
              isActive: true,
              createdById,
            },
          });
        }
      }
      // Keep the single FK in sync with the primary.
      await tx.asset.update({ where: { id: assetId }, data: { supervisorId: primaryId } });
    });

    res.json({ message: "Supervisors updated", primarySupervisorId: primaryId });
  } catch (e: any) {
    console.error("setAssetSupervisors error:", e);
    res.status(500).json({ message: e.message || "Failed to update supervisors" });
  }
};

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

      const remoteFilePath = `assets_images/${uniqueFileName(originalFileName)}`;

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

      // The temp file is gone already — saveLocal() moves it into storage and
      // unlinks it. Deleting it again here threw ENOENT out of this callback.

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

    // Assignment alone no longer activates the asset — it stays IN_STORE until the
    // end user acknowledges or the installed date is reached.
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

// Public, lightweight lookup for the QR scan landing — returns only what's
// shown before login (name + asset code). The full getAssetScanDetails below
// is auth-gated; this one intentionally is not.
export const getAssetScanSummary = async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    if (!assetId || !String(assetId).trim()) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }

    const asset = await prisma.asset.findFirst({
      where: { assetId: String(assetId).trim() },
      select: { id: true, assetId: true, assetName: true },
    });

    if (!asset) {
      res.status(404).json({ success: false, message: "Asset not found" });
      return;
    }

    res.json({
      success: true,
      message: "Asset summary fetched successfully",
      data: asset,
    });
  } catch (err: any) {
    console.error("getAssetScanSummary error:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching asset summary",
      error: err.message,
    });
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

// ── QR sticker confirmation ────────────────────────────────────────────────
// Records that the printed QR label was physically stuck on the equipment.
// Separate from qrLabelPrinted (set automatically by the bulk-print endpoint):
// printing a sheet of labels says nothing about them reaching the asset.
//
// Marking is one-way by design — the toggle locks in the UI and the API rejects
// a second mark — so the confirmation can't be flipped casually. Replacing a
// damaged sticker needs an explicit unlock from a management role, which is
// recorded in the audit trail with a reason.
const QR_STICKER_UNLOCK_ROLES = ["ADMIN", "CEO_COO", "OPERATIONS"];

// POST /assets/:id/qr-sticker
export const markAssetQrStickered = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { stickeredAt, stickeredById, remarks } = req.body;
    const user = req.user as any;

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { id: true, assetId: true, assetName: true, qrStickered: true },
    });
    if (!asset) { res.status(404).json({ message: "Asset not found" }); return; }

    if (asset.qrStickered) {
      res.status(400).json({ message: "QR sticker is already confirmed for this asset" });
      return;
    }

    // Who did the stickering — usually the logged-in user, but a technician can
    // be credited instead. Falls back to the caller when nothing is sent.
    const byId = stickeredById ? Number(stickeredById) : (user?.employeeDbId ?? null);
    if (byId) {
      const employee = await prisma.employee.findUnique({ where: { id: byId }, select: { id: true } });
      if (!employee) { res.status(400).json({ message: "stickeredById is not a valid employee" }); return; }
    }

    const when = stickeredAt ? new Date(stickeredAt) : new Date();
    if (isNaN(when.getTime())) { res.status(400).json({ message: "stickeredAt is not a valid date" }); return; }

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        qrStickered: true,
        qrStickeredAt: when,
        qrStickeredById: byId,
        qrStickeredRemarks: remarks ?? null,
      },
      select: {
        id: true,
        qrStickered: true,
        qrStickeredAt: true,
        qrStickeredRemarks: true,
        qrStickeredBy: { select: { id: true, name: true } },
      },
    });

    logAction({
      entityType: "ASSET",
      entityId: id,
      action: "STATUS_CHANGE",
      description: `QR sticker confirmed for ${asset.assetId || `asset #${id}`}${remarks ? ` — ${remarks}` : ""}`,
      newValue: JSON.stringify({ qrStickered: true, qrStickeredAt: when, qrStickeredById: byId }),
      performedById: user?.employeeDbId ?? null,
      performedBy: user?.name ?? user?.employeeID ?? null,
    });

    res.json({ message: "QR sticker confirmed", asset: updated });
  } catch (err) {
    console.error("markAssetQrStickered error:", err);
    res.status(500).json({ message: "Failed to confirm QR sticker" });
  }
};

// DELETE /assets/:id/qr-sticker — management-only unlock (e.g. sticker damaged,
// asset re-labelled). Clears the confirmation so it can be marked again; the old
// values are kept in the audit trail rather than on the row.
export const unlockAssetQrSticker = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body ?? {};
    const user = req.user as any;

    if (!QR_STICKER_UNLOCK_ROLES.includes(user?.role ?? "")) {
      res.status(403).json({ message: "Only management can unlock a QR sticker confirmation" });
      return;
    }

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ message: "A reason is required to unlock the QR sticker confirmation" });
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: {
        id: true, assetId: true, qrStickered: true, qrStickeredAt: true,
        qrStickeredById: true, qrStickeredRemarks: true,
      },
    });
    if (!asset) { res.status(404).json({ message: "Asset not found" }); return; }
    if (!asset.qrStickered) { res.status(400).json({ message: "QR sticker is not confirmed for this asset" }); return; }

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        qrStickered: false,
        qrStickeredAt: null,
        qrStickeredById: null,
        qrStickeredRemarks: null,
      },
      select: { id: true, qrStickered: true },
    });

    logAction({
      entityType: "ASSET",
      entityId: id,
      action: "STATUS_CHANGE",
      description: `QR sticker confirmation unlocked for ${asset.assetId || `asset #${id}`} — ${String(reason).trim()}`,
      oldValue: JSON.stringify({
        qrStickered: true,
        qrStickeredAt: asset.qrStickeredAt,
        qrStickeredById: asset.qrStickeredById,
        qrStickeredRemarks: asset.qrStickeredRemarks,
      }),
      newValue: JSON.stringify({ qrStickered: false }),
      performedById: user?.employeeDbId ?? null,
      performedBy: user?.name ?? user?.employeeID ?? null,
    });

    res.json({ message: "QR sticker confirmation unlocked", asset: updated });
  } catch (err) {
    console.error("unlockAssetQrSticker error:", err);
    res.status(500).json({ message: "Failed to unlock QR sticker confirmation" });
  }
};

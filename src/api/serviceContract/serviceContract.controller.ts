import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { requireAssetByAssetId } from "../../utilis/asset";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

function mustUser(req: any) {
  if (!req.user?.employeeDbId) throw new Error("Unauthorized");
  return req.user;
}

export const createServiceContract = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);

    const {
      assetId,       // ✅ STRING (Asset.assetId)
      vendorId,
      contractType,  // AMC | CMC
      startDate,
      endDate,
      cost,
      includesParts,
      includesLabor,
      visitsPerYear,
      document,
      terms,
      reason,
      currency,
      contractNumber,
      // Vendor SLA commitments
      vendorResponseValue,
      vendorResponseUnit,
      vendorResolutionValue,
      vendorResolutionUnit,
      // Split visit counts
      regularVisitsPerYear,
      emergencyVisitsPerYear,
    } = req.body;

    if (!assetId || !contractType || !startDate || !endDate) {
       res.status(400).json({ message: "Missing required fields" });
       return;
    }

    if (!["AMC", "CMC"].includes(contractType)) {
       res.status(400).json({ message: "contractType must be AMC or CMC" });
       return;
    }

    const asset = await requireAssetByAssetId(assetId);

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end <= start) {
      res.status(400).json({ message: "End date must be after start date" });
      return;
    } 

    // ❗ prevent overlap
    const overlapping = await prisma.serviceContract.findFirst({
      where: {
        assetId: asset.id,
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlapping) {
       res.status(400).json({ message: "Contract dates overlap with existing contract" });
       return;
    }

    // ❗ prevent contract starting during active warranty (optional business rule)
    const warrantyConflict = await prisma.warranty.findFirst({
      where: {
        assetId: asset.id,
        isUnderWarranty: true,
        warrantyEnd: { gte: start },
      },
    });
    if (warrantyConflict) {
       res.status(400).json({
        message: "Warranty still active. Contract should start after warranty ends",
      });
      return;
    }

    const contract = await prisma.serviceContract.create({
      data: {
        assetId: asset.id,
        vendorId: vendorId ?? null,
        contractType,
        contractNumber: contractNumber ?? null,
        startDate: start,
        endDate: end,
        includesParts: includesParts ?? null,
        includesLabor: includesLabor ?? null,
        visitsPerYear: visitsPerYear ?? null,
        regularVisitsPerYear: regularVisitsPerYear != null ? Number(regularVisitsPerYear) : null,
        emergencyVisitsPerYear: emergencyVisitsPerYear != null ? Number(emergencyVisitsPerYear) : null,
        cost: cost ?? null,
        currency: currency ?? null,
        document: document ?? null,
        terms: terms ?? null,
        status: "ACTIVE",
        createdBy: user.employeeID,
        reason: reason || null,
        vendorResponseValue: vendorResponseValue != null ? Number(vendorResponseValue) : null,
        vendorResponseUnit: vendorResponseUnit ?? null,
        vendorResolutionValue: vendorResolutionValue != null ? Number(vendorResolutionValue) : null,
        vendorResolutionUnit: vendorResolutionUnit ?? null,
      } as any,
    });

    // Fire-and-forget: notify admins about new service contract
    getAdminIds().then(adminIds =>
      notify({
        type: "AMC_CMC_EXPIRY",
        title: "New Service Contract Created",
        message: `${contract.contractType} contract created for asset ${asset.assetName}`,
        recipientIds: adminIds,
        createdById: user.employeeDbId,
      })
    ).catch(() => {});

    // 🔔 Notify HOD (kept from your logic)
    if (asset.departmentId) {
      const hod = await prisma.employee.findFirst({
        where: { departmentId: asset.departmentId, role: "HOD" },
      });

      if (hod) {
        const notif = await prisma.notification.create({
          data: {
            type: "AMC_CMC_EXPIRY",
            title: "New Service Contract Created",
            message: `${contract.contractType} contract created for asset ${asset.assetName}`,
            assetId: asset.id,
            createdById: user.employeeDbId,
          },
        });

        await prisma.notificationRecipient.create({
          data: {
            notificationId: notif.id,
            employeeId: hod.id,
          },
        });
      }
    }

    res.status(201).json(contract);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

export const updateServiceContract = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.serviceContract.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Service contract not found" });
      return;
    }

    const {
      vendorId,
      contractType,
      contractNumber,
      startDate,
      endDate,
      includesParts,
      includesLabor,
      visitsPerYear,
      cost,
      currency,
      terms,
      status,
      reason,
      createdBy,
    } = req.body;

    const data: any = {};

    if ("vendorId" in req.body) data.vendorId = vendorId ? Number(vendorId) : null;
    if ("contractType" in req.body) data.contractType = contractType;
    if ("contractNumber" in req.body) data.contractNumber = contractNumber || null;
    if ("startDate" in req.body) data.startDate = startDate ? new Date(startDate) : null;
    if ("endDate" in req.body) data.endDate = endDate ? new Date(endDate) : null;
    if ("includesParts" in req.body) data.includesParts = typeof includesParts === "boolean" ? includesParts : null;
    if ("includesLabor" in req.body) data.includesLabor = typeof includesLabor === "boolean" ? includesLabor : null;
    if ("visitsPerYear" in req.body) data.visitsPerYear = visitsPerYear ? Number(visitsPerYear) : null;
    if ("cost" in req.body) data.cost = cost !== null && cost !== undefined ? Number(cost) : null;
    if ("currency" in req.body) data.currency = currency || null;
    if ("terms" in req.body) data.terms = terms || null;
    if ("status" in req.body) data.status = status || null;
    if ("reason" in req.body) data.reason = reason || null;
    if ("createdBy" in req.body) data.createdBy = createdBy || null;
    if ("vendorResponseValue" in req.body) data.vendorResponseValue = req.body.vendorResponseValue != null ? Number(req.body.vendorResponseValue) : null;
    if ("vendorResponseUnit" in req.body) data.vendorResponseUnit = req.body.vendorResponseUnit || null;
    if ("vendorResolutionValue" in req.body) data.vendorResolutionValue = req.body.vendorResolutionValue != null ? Number(req.body.vendorResolutionValue) : null;
    if ("vendorResolutionUnit" in req.body) data.vendorResolutionUnit = req.body.vendorResolutionUnit || null;
    if ("regularVisitsPerYear" in req.body) data.regularVisitsPerYear = req.body.regularVisitsPerYear != null ? Number(req.body.regularVisitsPerYear) : null;
    if ("emergencyVisitsPerYear" in req.body) data.emergencyVisitsPerYear = req.body.emergencyVisitsPerYear != null ? Number(req.body.emergencyVisitsPerYear) : null;

    const finalStart = data.startDate ?? existing.startDate;
    const finalEnd = data.endDate ?? existing.endDate;

    if (finalStart && finalEnd && finalEnd <= finalStart) {
      res.status(400).json({ message: "Contract end must be after start date" });
      return;
    }

    const contract = await prisma.serviceContract.update({
      where: { id },
      data,
      include: { vendor: true },
    });

    res.json(contract);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// GET /service-contracts/asset/:assetId   (assetId is STRING)
export const getContractsByAsset = async (req: Request, res: Response) => {
  const assetId = req.params.assetId;

  const asset = await prisma.asset.findUnique({ where: { assetId } });
  if (!asset) {
    res.status(404).json({ message: "Asset not found" });
    return;
  } 

  const contracts = await prisma.serviceContract.findMany({
    where: { assetId: asset.id },
    orderBy: { startDate: "desc" },
    include: { vendor: true },
  });

  res.json(contracts);
};

// GET /service-contracts/all (standalone page with filters, pagination, CSV)
export const getAllServiceContracts = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, contractType, vendorId, search, page = "1", limit = "25", exportCsv, expiringDays } = req.query;

    // Department scoping: non-admin sees only their department's assets
    let scopedAssetIds: number[] | undefined;
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      scopedAssetIds = deptAssets.map(a => a.id);
    }

    const where: any = {};
    if (scopedAssetIds) {
      where.assetId = { in: scopedAssetIds };
    }
    if (status) where.status = String(status);
    if (contractType) where.contractType = String(contractType);
    if (vendorId) where.vendorId = Number(vendorId);
    if (search) {
      where.OR = [
        { contractNumber: { contains: String(search) } },
        { asset: { assetName: { contains: String(search) } } },
        { asset: { assetId: { contains: String(search) } } },
        { vendor: { name: { contains: String(search) } } },
      ];
    }
    if (expiringDays) {
      const now = new Date();
      const future = new Date();
      future.setDate(now.getDate() + Number(expiringDays));
      where.status = "ACTIVE";
      where.endDate = { gte: now, lte: future };
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, contracts] = await Promise.all([
      prisma.serviceContract.count({ where }),
      prisma.serviceContract.findMany({
        where,
        include: {
          asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true } },
          vendor: { select: { id: true, name: true, contact: true } },
        },
        orderBy: { endDate: "asc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = contracts.map((c: any) => ({
        ContractNumber: c.contractNumber || "",
        Type: c.contractType || "",
        AssetId: c.asset?.assetId || "",
        AssetName: c.asset?.assetName || "",
        Vendor: c.vendor?.name || "",
        StartDate: c.startDate ? new Date(c.startDate).toISOString().split("T")[0] : "",
        EndDate: c.endDate ? new Date(c.endDate).toISOString().split("T")[0] : "",
        Cost: c.cost ? Number(c.cost) : "",
        Status: c.status || "",
        IncludesParts: c.includesParts ? "Yes" : "No",
        IncludesLabor: c.includesLabor ? "Yes" : "No",
        VisitsPerYear: c.visitsPerYear || "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=service-contracts.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: contracts, total, page: parseInt(String(page)), limit: take });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

// GET /service-contracts/stats
export const getServiceContractStats = async (_req: Request, res: Response) => {
  try {
    const user = (_req as any).user;
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);

    // Department scoping
    let scope: any = {};
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({ where: { departmentId: Number(user.departmentId) }, select: { id: true } });
      scope = { assetId: { in: deptAssets.map(a => a.id) } };
    }

    const [total, active, expired, expiring30, amcCount, cmcCount] = await Promise.all([
      prisma.serviceContract.count({ where: { ...scope } }),
      prisma.serviceContract.count({ where: { status: "ACTIVE", ...scope } }),
      prisma.serviceContract.count({ where: { status: "EXPIRED", ...scope } }),
      prisma.serviceContract.count({ where: { status: "ACTIVE", endDate: { gte: now, lte: thirtyDays }, ...scope } }),
      prisma.serviceContract.count({ where: { contractType: "AMC", status: "ACTIVE", ...scope } }),
      prisma.serviceContract.count({ where: { contractType: "CMC", status: "ACTIVE", ...scope } }),
    ]);

    res.json({ total, active, expired, expiring30, amcCount, cmcCount });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

export const expireContracts = async (_req: Request, res: Response) => {
  const now = new Date();

  const expired = await prisma.serviceContract.updateMany({
    where: {
      endDate: { lt: now },
      status: "ACTIVE",
    },
    data: { status: "EXPIRED" },
  });

  res.json({ message: "Contracts expired successfully", count: expired.count });
};

import formidable from "formidable";
import fs from "fs";
import path from "path";
import { Client } from "basic-ftp";

const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
};
const PUBLIC_CONTRACT_DOC_BASE =
  process.env.PUBLIC_CONTRACT_DOC_BASE ||
  "https://smartassets.inventionminds.com/contract_docs";

const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) fs.mkdirSync(TEMP_FOLDER, { recursive: true });

async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
  const client = new Client();
  client.ftp.verbose = false;
  await client.access(FTP_CONFIG);
  await client.ensureDir(path.dirname(remoteFilePath));
  await client.uploadFrom(localFilePath, remoteFilePath);
  await client.close();
  return `${PUBLIC_CONTRACT_DOC_BASE}/${path.basename(remoteFilePath)}`;
}

// POST /service-contracts/upload-doc
export const uploadContractDocument = async (req: Request, res: Response) => {
  const form = formidable({ uploadDir: TEMP_FOLDER, keepExtensions: true, multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "File parsing failed." });

    const assetId = fields.assetId?.[0] || "asset";
    const fileArr: any = (files as any).file;

    if (!fileArr?.[0]) return res.status(400).json({ error: "No file uploaded" });

    const file = fileArr[0];
    const tempPath = file.filepath;
    const ext = path.extname(file.originalFilename || ".pdf");
    const safeName = `contract-${assetId}-${Date.now()}${ext}`;

    try {
      const remoteFilePath = `/public_html/smartassets/contract_docs/${safeName}`;
      const url = await uploadToFTP(tempPath, remoteFilePath);
      fs.unlinkSync(tempPath);
      res.json({ url });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "FTP upload failed" });
    }
  });
};

// ── Service Visit Logging ─────────────────────────────────────────────────────

// POST /service-contracts/:contractId/visits
// Log a service visit (PM or Repair) with chargeable rules:
//   - No active warranty + no active contract → chargeable
//   - Amount ≤ 1000 → direct approval (auto-approved)
//   - Amount > 1000 → needs manager approval (chargeApprovalStatus = PENDING)
export const logServiceVisit = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const contractId = Number(req.params.contractId);

    const contract = await prisma.serviceContract.findUnique({
      where: { id: contractId },
      include: { asset: true },
    });
    if (!contract) {
      res.status(404).json({ message: "Service contract not found" });
      return;
    }

    const {
      visitType,   // PREVENTIVE_MAINTENANCE | REPAIR
      visitDate,
      visitedById,
      workDone,
      partsReplaced,
      outcome,
      chargeAmount,
    } = req.body;

    if (!visitType || !visitDate) {
      res.status(400).json({ message: "visitType and visitDate are required" });
      return;
    }
    if (!["PREVENTIVE_MAINTENANCE", "REPAIR"].includes(visitType)) {
      res.status(400).json({ message: "visitType must be PREVENTIVE_MAINTENANCE or REPAIR" });
      return;
    }

    const assetId = contract.assetId;
    const now = new Date();

    // Chargeable determination
    const hasActiveWarranty = await prisma.warranty.findFirst({
      where: { assetId, isUnderWarranty: true, warrantyEnd: { gte: now } },
    });
    const hasActiveContract = await prisma.serviceContract.findFirst({
      where: { assetId, status: "ACTIVE", endDate: { gte: now } },
    });

    let isChargeable = false;
    let chargeableReason: string | null = null;
    let chargeApprovalStatus: string | null = null;
    const amount = chargeAmount != null ? Number(chargeAmount) : null;

    if (!hasActiveWarranty && !hasActiveContract) {
      isChargeable = true;
      chargeableReason = "NO_WARRANTY_OR_CONTRACT";
    }

    // If chargeable: ≤1000 auto-approved, >1000 needs approval
    if (isChargeable && amount != null) {
      chargeApprovalStatus = amount <= 1000 ? "APPROVED" : "PENDING";
    }

    const visit = await (prisma as any).serviceVisit.create({
      data: {
        serviceContractId: contractId,
        assetId,
        visitType,
        visitDate: new Date(visitDate),
        visitedById: visitedById ? Number(visitedById) : null,
        workDone: workDone ?? null,
        partsReplaced: partsReplaced ?? null,
        outcome: outcome ?? null,
        isChargeable,
        chargeableReason,
        chargeAmount: amount,
        chargeApprovalStatus,
        createdById: user.employeeDbId,
      },
    });

    // Fire-and-forget: notify admins about service visit logged
    getAdminIds().then(adminIds =>
      notify({
        type: "AMC_CMC_EXPIRY",
        title: "Service Visit Logged",
        message: `${visitType} visit logged for asset ${contract.asset.assetName} under contract #${contractId}`,
        recipientIds: adminIds,
        createdById: user.employeeDbId,
      })
    ).catch(() => {});

    // If charge > 1000, notify HOD/manager
    if (isChargeable && amount != null && amount > 1000 && contract.asset.departmentId) {
      const hod = await prisma.employee.findFirst({
        where: { departmentId: contract.asset.departmentId, role: "HOD" },
        select: { id: true },
      });
      if (hod) {
        const notif = await prisma.notification.create({
          data: {
            type: "OTHER",
            title: `Chargeable Service Visit — Approval Required`,
            message: `Service visit for asset ${contract.asset.assetName} is chargeable ₹${amount}. Approval needed.`,
            priority: "HIGH",
            assetId,
            dedupeKey: `SVC_VISIT_CHARGE_${visit.id}`,
            createdById: user.employeeDbId,
          },
        });
        await prisma.notificationRecipient.create({
          data: { notificationId: notif.id, employeeId: hod.id },
        });
      }
    }

    res.status(201).json(visit);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to log service visit" });
  }
};

// GET /service-contracts/:contractId/visits
export const getServiceVisits = async (req: any, res: Response) => {
  try {
    const contractId = Number(req.params.contractId);
    const visits = await (prisma as any).serviceVisit.findMany({
      where: { serviceContractId: contractId },
      include: {
        visitedBy: { select: { id: true, name: true } },
        chargeApprovedBy: { select: { id: true, name: true } },
      },
      orderBy: { visitDate: "desc" },
    });
    res.json(visits);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to fetch visits" });
  }
};

// PATCH /service-contracts/visits/:visitId/approve-charge
export const approveVisitCharge = async (req: any, res: Response) => {
  try {
    const user = mustUser(req);
    const visitId = Number(req.params.visitId);
    const { decision, remarks } = req.body; // APPROVED | REJECTED

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
      return;
    }

    const visit = await (prisma as any).serviceVisit.findUnique({ where: { id: visitId } });
    if (!visit) {
      res.status(404).json({ message: "Service visit not found" });
      return;
    }
    if (visit.chargeApprovalStatus !== "PENDING") {
      res.status(400).json({ message: "Charge approval not pending" });
      return;
    }

    const updated = await (prisma as any).serviceVisit.update({
      where: { id: visitId },
      data: {
        chargeApprovalStatus: decision,
        chargeApprovedById: user.employeeDbId,
        chargeApprovedAt: new Date(),
      },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to approve charge" });
  }
};
import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

export const addInsurancePolicy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
    //    res.status(403).json({ message: "Not allowed" });
    //    return;
    // }

    const {
      assetId,
      provider,
      policyNumber,
      coverageAmount,
      premiumAmount,
      startDate,
      endDate,
      notes,
      policyType,
      renewalReminderDays
    } = req.body;

    const today = new Date();

    const policyStatus =
      endDate && new Date(endDate) < today ? "EXPIRED" : "ACTIVE";

    const insurance = await prisma.assetInsurance.create({
      data: {
        assetId: Number(assetId),
        provider,
        policyNumber,
        coverageAmount: coverageAmount ? parseFloat(coverageAmount) : null,
        premiumAmount: premiumAmount ? parseFloat(premiumAmount) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: true,
        policyStatus,
        notes,
        policyType: policyType,
        renewalReminderDays: renewalReminderDays
      }
    });

    // Fire-and-forget: notify admins about new insurance policy
    getAdminIds().then(adminIds =>
      notify({
        type: "INSURANCE",
        title: "Insurance Policy Created",
        message: `Insurance policy "${policyNumber}" created for asset #${assetId}`,
        recipientIds: adminIds,
        createdById: (req as any).user?.employeeDbId,
      })
    ).catch(() => {});

    res.status(201).json(insurance);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add insurance policy" });
    return
  }
};
export const updateInsurancePolicy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // if (req.user.role !== "superadmin") {
    //    res.status(403).json({ message: "Admins only" });
    //    return
    // }

    const id = Number(req.params.id);
    const data = req.body;

    const today = new Date();

    const policyStatus =
      data.endDate && new Date(data.endDate) < today ? "EXPIRED" : "ACTIVE";

    const updated = await prisma.assetInsurance.update({
      where: { id },
      data: {
        provider: data.provider,
        policyNumber: data.policyNumber,
        coverageAmount: data.coverageAmount ? parseFloat(data.coverageAmount) : null,
        premiumAmount: data.premiumAmount ? parseFloat(data.premiumAmount) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        policyStatus,
        isActive: data.isActive ?? true,
        notes: data.notes,
        policyType: data.policyType,
        renewalReminderDays: data.renewalReminderDays
      }
    });

    res.json(updated);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update insurance" });
  }
};
export const getInsuranceHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.id);

    // const asset = await prisma.asset.findUnique({
    //   where: { id: assetId }
    // })

    // if (!asset) {
    //   res.status(400).json({ message: "Asset is not found" });
    //   return
    // }

    const history = await prisma.assetInsurance.findMany({
      where: { assetId },
      orderBy: { id: "desc" }
    });


    res.json(history);
    return

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching insurance history" });
  }
};
export const markInsuranceExpired = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const today = new Date();

    const expiredPolicies = await prisma.assetInsurance.updateMany({
      where: {
        endDate: { lt: today },
        isActive: true
      },
      data: {
        isActive: false,
        policyStatus: 'EXPIRED'
      }
    });

    res.json({
      message: "Expired policies updated",
      total: expiredPolicies.count
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to expire policies" });
  }
};
export const uploadInsuranceDocument = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const filePath = `/uploads/insurance/${req.file.filename}`;

    const updated = await prisma.assetInsurance.update({
      where: { id },
      data: { document: filePath }
    });

    res.json({
      message: "Insurance document uploaded",
      file: filePath
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });

  }
};
export const renewInsurancePolicy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      assetId,
      provider,
      policyNumber,
      coverageAmount,
      premiumAmount,
      startDate,
      endDate,
      notes,
      policyType,
      renewalReminderDays
    } = req.body;

    if (!assetId || !policyNumber || !startDate || !endDate) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end <= start) {
      res.status(400).json({ message: 'End date must be after start date' });
      return;
    }

    // 1️⃣ deactivate current active policy (do NOT force expired)
    await prisma.assetInsurance.updateMany({
      where: {
        assetId: Number(assetId),
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    // 2️⃣ create new policy
    const today = new Date();
    const policyStatus = end < today ? 'EXPIRED' : 'ACTIVE';

    const newPolicy = await prisma.assetInsurance.create({
      data: {
        assetId: Number(assetId),
        provider,
        policyNumber,
        coverageAmount: coverageAmount ? parseFloat(coverageAmount) : null,
        premiumAmount: premiumAmount ? parseFloat(premiumAmount) : null,
        startDate: start,
        endDate: end,
        isActive: true,
        policyStatus,
        notes,
        policyType,
        renewalReminderDays: renewalReminderDays ?? 30
      }
    });

    res.json({
      message: 'Policy renewed successfully',
      data: newPolicy
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Renewal failed' });
  }
};
export const createInsuranceClaim = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assetId, insuranceId, claimNumber, claimDate, claimAmount, reason } = req.body;


    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!assetId || !insuranceId || !claimNumber || !claimDate || claimAmount == null) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    const amount = typeof claimAmount === "string" ? parseFloat(claimAmount) : Number(claimAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ message: "Invalid claim amount" });
      return;
    }

    // Ensure insurance belongs to asset
    const policy = await prisma.assetInsurance.findFirst({
      where: { id: Number(insuranceId), assetId: Number(assetId) }
    });

    if (!policy) {
      res.status(400).json({ message: "Invalid insuranceId for this asset" });
      return;
    }

    const claim = await prisma.insuranceClaim.create({
      data: {
        assetId: Number(assetId),
        insuranceId: Number(insuranceId),
        claimNumber: String(claimNumber).trim(),
        claimDate: new Date(claimDate),
        claimAmount: amount,
        claimStatus: "SUBMITTED",
        reason,
        claimedBy: req.user.employeeDbId?.toString()
      }
    });

    // Fire-and-forget: notify admins about new insurance claim
    getAdminIds().then(adminIds =>
      notify({
        type: "INSURANCE",
        title: "Insurance Claim Filed",
        message: `Claim "${claimNumber}" filed for policy #${insuranceId} (₹${amount})`,
        recipientIds: adminIds,
        createdById: req.user?.employeeDbId,
      })
    ).catch(() => {});

    res.status(201).json(claim);
    return;

  } catch (err: any) {
    // Prisma unique constraint for (insuranceId, claimNumber)
    if (err?.code === "P2002") {
      res.status(409).json({ message: "Claim Number already exists for this policy" });
      return;
    }
    console.error(err);
    res.status(500).json({ message: "Claim failed" });
    return;
  }
};
export const updateClaimStatus = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const updated = await prisma.insuranceClaim.update({
    where: { id },
    data: {
      claimStatus: req.body.status, // APPROVED / REJECTED / SETTLED
      approvedAmount: req.body.approvedAmount,
      settledAt: req.body.settledAt ? new Date(req.body.settledAt) : null
    }
  });

  res.json(updated);
};
export const getClaimsByAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.assetId);

    const claims = await prisma.insuranceClaim.findMany({
      where: { assetId },
      orderBy: { createdAt: "desc" },
      include: {
        insurance: true // optional (good for UI)
      }
    });

    res.json(claims);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch claims" });
  }
};

// ─── Get All Insurance Policies (standalone page) ─────────────────────────────
export const getAllInsurancePolicies = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, assetId, provider, page = "1", limit = "25", search, exportCsv } = req.query;

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
    if (status) where.policyStatus = String(status);
    if (assetId) where.assetId = Number(assetId);
    if (provider) where.provider = { contains: String(provider) };
    if (search) {
      where.OR = [
        { policyNumber: { contains: String(search) } },
        { provider: { contains: String(search) } },
        { asset: { assetName: { contains: String(search) } } },
      ];
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, policies] = await Promise.all([
      prisma.assetInsurance.count({ where }),
      prisma.assetInsurance.findMany({
        where,
        include: {
          asset: { select: { id: true, assetId: true, assetName: true, serialNumber: true } },
          claims: true,
        },
        orderBy: { createdAt: "desc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = policies.map((p: any) => ({
        PolicyNumber: p.policyNumber || "",
        Provider: p.provider || "",
        AssetId: p.asset?.assetId || "",
        AssetName: p.asset?.assetName || "",
        PolicyType: p.policyType || "",
        Status: p.policyStatus || "",
        CoverageAmount: p.coverageAmount ? Number(p.coverageAmount) : "",
        PremiumAmount: p.premiumAmount ? Number(p.premiumAmount) : "",
        StartDate: p.startDate ? new Date(p.startDate).toISOString().split("T")[0] : "",
        EndDate: p.endDate ? new Date(p.endDate).toISOString().split("T")[0] : "",
        ClaimsCount: p.claims?.length || 0,
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=insurance-policies.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: policies, total, page: parseInt(String(page)), limit: take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch insurance policies" });
  }
};

// ─── Get All Insurance Claims (standalone page) ──────────────────────────────
export const getAllInsuranceClaims = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, assetId, page = "1", limit = "25", search, exportCsv } = req.query;

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
    if (status) where.claimStatus = String(status);
    if (assetId) where.assetId = Number(assetId);
    if (search) {
      where.OR = [
        { claimNumber: { contains: String(search) } },
        { reason: { contains: String(search) } },
        { asset: { assetName: { contains: String(search) } } },
      ];
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, claims] = await Promise.all([
      prisma.insuranceClaim.count({ where }),
      prisma.insuranceClaim.findMany({
        where,
        include: {
          asset: { select: { id: true, assetId: true, assetName: true } },
          insurance: { select: { id: true, policyNumber: true, provider: true } },
        },
        orderBy: { createdAt: "desc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = claims.map((c: any) => ({
        ClaimNumber: c.claimNumber || "",
        AssetId: c.asset?.assetId || "",
        AssetName: c.asset?.assetName || "",
        PolicyNumber: c.insurance?.policyNumber || "",
        Provider: c.insurance?.provider || "",
        ClaimDate: c.claimDate ? new Date(c.claimDate).toISOString().split("T")[0] : "",
        ClaimAmount: c.claimAmount ? Number(c.claimAmount) : "",
        ApprovedAmount: c.approvedAmount ? Number(c.approvedAmount) : "",
        Status: c.claimStatus || "",
        Reason: c.reason || "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=insurance-claims.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: claims, total, page: parseInt(String(page)), limit: take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch insurance claims" });
  }
};

// ─── Insurance Dashboard Stats ───────────────────────────────────────────────
export const getInsuranceStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user as any;

    // Department scoping
    let scope: any = {};
    let claimScope: any = {};
    if (user?.role !== "ADMIN" && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({ where: { departmentId: Number(user.departmentId) }, select: { id: true } });
      const ids = deptAssets.map(a => a.id);
      scope = { assetId: { in: ids } };
      claimScope = { assetId: { in: ids } };
    }

    const [totalPolicies, activePolicies, expiredPolicies, totalClaims, pendingClaims, approvedClaims, settledClaims] = await Promise.all([
      prisma.assetInsurance.count({ where: { ...scope } }),
      prisma.assetInsurance.count({ where: { policyStatus: "ACTIVE", ...scope } }),
      prisma.assetInsurance.count({ where: { policyStatus: "EXPIRED", ...scope } }),
      prisma.insuranceClaim.count({ where: { ...claimScope } }),
      prisma.insuranceClaim.count({ where: { claimStatus: "SUBMITTED", ...claimScope } }),
      prisma.insuranceClaim.count({ where: { claimStatus: "APPROVED", ...claimScope } }),
      prisma.insuranceClaim.count({ where: { claimStatus: "SETTLED", ...claimScope } }),
    ]);

    // Expiring soon (within 30 days)
    const now = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(now.getDate() + 30);

    const expiringSoon = await prisma.assetInsurance.count({
      where: {
        policyStatus: "ACTIVE",
        endDate: { gte: now, lte: thirtyDaysLater },
        ...scope,
      },
    });

    res.json({
      totalPolicies,
      activePolicies,
      expiredPolicies,
      expiringSoon,
      totalClaims,
      pendingClaims,
      approvedClaims,
      settledClaims,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch insurance stats" });
  }
};
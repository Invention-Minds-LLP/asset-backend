import { Request, Response } from "express";
import prisma from "../../prismaClient";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { Client } from "basic-ftp";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";


const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
};


export const getAllAssets = async (req: Request, res: Response) => {
  const assets = await prisma.asset.findMany(
    {
      include: { assetCategory: true, vendor: true, department: true, allottedTo: true }
    });
  res.json(assets);
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
    // if (req.user.role !== "store_user" && req.user.role !== "superadmin") {
    //   res.status(403).json({ message: "Only store users can create assets" });
    //   return
    // }

    // Financial Year ID (AST-FY2025-26-001)
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEnd = fyStart + 1;
    const fyStr = `FY${fyStart}-${(fyEnd % 100).toString().padStart(2, "0")}`;

    const latest = await prisma.asset.findFirst({
      where: { assetId: { startsWith: `AST-${fyStr}` } },
      orderBy: { id: "desc" }
    });

    let next = 1;
    if (latest) {
      next = parseInt(latest.assetId.split("-")[3], 10) + 1;
    }

    const assetId = `AST-${fyStr}-${next.toString().padStart(3, "0")}`;

    const data = req.body;

    const asset = await prisma.asset.create({
      data: {
        assetId,
        assetName: data.assetName,
        assetType: data.assetType,
        assetCategoryId: data.assetCategoryId,

        rfidCode: data.rfidCode ?? null,
        serialNumber: data.serialNumber,
        assetPhoto: data.assetPhoto ?? null,

        modeOfProcurement: data.modeOfProcurement,

        // PURCHASE
        invoiceNumber: data.invoiceNumber,
        purchaseOrderNo: data.purchaseOrderNo,
        purchaseOrderDate: data.purchaseOrderDate ? new Date(data.purchaseOrderDate) : null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        purchaseCost: data.purchaseCost,
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

        // GRN
        grnNumber: data.grnNumber,
        grnDate: data.grnDate ? new Date(data.grnDate) : null,
        grnValue: data.grnValue,
        inspectionStatus: data.inspectionStatus,
        inspectionRemarks: data.inspectionRemarks,

        status: "PENDING_COMPLETION"
      }
    });

    res.status(201).json(asset);
    return;

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating asset" });
  }
};
export const completeAssetDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user.role !== "department_user" && req.user.role !== "superadmin") {
      res.status(403).json({ message: "Only department users can complete assets" });
      return
    }

    const id = parseInt(req.params.id);
    const data = req.body;

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        departmentId: data.departmentId,
        allottedToId: data.allottedToId,
        rfidCode: data.rfidCode,
        slaExpectedValue: data.slaExpectedValue,
        slaExpectedUnit: data.slaExpectedUnit,
        slaDetails: data.slaDetails,
        expectedLifetime: data.expectedLifetime,
        expectedLifetimeUnit: data.expectedLifetimeUnit,
        status: "ACTIVE"
      }
    });

    // Also create a location history entry
    await prisma.assetLocation.create({
      data: {
        assetId: id,
        branchId: data.branchId,
        block: data.block,
        floor: data.floor,
        room: data.room,
        employeeResponsibleId: data.employeeResponsibleId,
        isActive: true
      }
    });

    res.json(updated);
    return

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error completing asset details" });
    return
  }
};
export const adminUpdateAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user.role !== "superadmin") {
      res.status(403).json({ message: "Admins only" });
      return;
    }

    const id = parseInt(req.params.id);
    const data = req.body;

    const updated = await prisma.asset.update({
      where: { id },
      data
    });

    res.json(updated);
    return;

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Admin update failed" });
    return
  }
};

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

      // SLA
      slaExpectedValue: data.slaExpectedValue ? Number(data.slaExpectedValue) : null,
      slaExpectedUnit: data.slaExpectedUnit || null,
      // slaDetails: data.slaDetails,

      status: data.status,
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
        purchaseCost: data.purchaseCost ? Number(data.purchaseCost) : null
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

    res.json(updated);

  } catch (err:any) {
    console.error(err);
    res.status(500).json({ message: "Asset update error", error: err.message });
  }
};


export const deleteAsset = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.asset.delete(
    { where: { id } }
  );
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

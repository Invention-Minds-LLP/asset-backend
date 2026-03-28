import { Request, Response } from "express";
import prisma from "../../prismaClient";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { Client } from "basic-ftp";

/**
 * ✅ env based
 * PUBLIC_MAINT_REPORT_BASE=https://smartassets.inventionminds.com/maintenance_reports
 */
// const FTP_CONFIG = {
//   host: process.env.FTP_HOST || "",
//   user: process.env.FTP_USER || "",
//   password: process.env.FTP_PASSWORD || "",
//   secure: (process.env.FTP_SECURE || "false") === "true",
// };
const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
};

const PUBLIC_MAINT_REPORT_BASE =
  process.env.PUBLIC_MAINT_REPORT_BASE ||
  "https://smartassets.inventionminds.com/maintenance_reports";

export const getMaintenanceHistory = async (req: Request, res: Response) => {
  const history = await prisma.maintenanceHistory.findMany({
    include: { asset: true, ticket: true },
    orderBy: { id: "desc" },
  });
  res.json(history);
};

export const createMaintenanceRecord = async (req: any, res: Response) => {
  try {
    // ✅ basic safe create: you can restrict fields as needed
    const record = await prisma.maintenanceHistory.create({ data: req.body });
    res.status(201).json(record);
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to create record" });
  }
};

export const getMaintenanceHistoryByAsset = async (req: Request, res: Response) => {
  const assetId = req.params.assetId; // ✅ STRING

  try {
    const asset = await prisma.asset.findUnique({ where: { assetId } });
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const history = await prisma.maintenanceHistory.findMany({
      where: { assetId: asset.id },
      orderBy: { actualDoneAt: "desc" },
      include: { serviceContract: true },
    });

    res.status(200).json(history);
  } catch (error) {
    console.error("Error fetching maintenance history:", error);
    res.status(500).json({ error: "Failed to fetch history." });
  }
};
const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) fs.mkdirSync(TEMP_FOLDER, { recursive: true });

async function uploadToFTP(localFilePath: string, remoteFilePath: string): Promise<string> {
  const client = new Client();
  client.ftp.verbose = false;

  try {
    await client.access(FTP_CONFIG);

    const remoteDir = path.dirname(remoteFilePath);
    await client.ensureDir(remoteDir);

    await client.uploadFrom(localFilePath, remoteFilePath);
    await client.close();

    const fileName = path.basename(remoteFilePath);
    return `${PUBLIC_MAINT_REPORT_BASE}/${fileName}`;
  } catch (error) {
    console.error("FTP upload error:", error);
    throw new Error("FTP upload failed");
  }
}

export const uploadMaintenanceReport = async (req: Request, res: Response) => {
  const form = formidable({
    uploadDir: TEMP_FOLDER,
    keepExtensions: true,
    multiples: false,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: "File parsing failed." });
      return;
    }

    const assetId = fields.assetId?.[0];
    const scheduledDue = fields.scheduledDue?.[0];
    const actualDoneAt = fields.actualDoneAt?.[0];
    const wasLate = fields.wasLate?.[0] === "true";
    const performedBy = fields.performedBy?.[0];
    const notes = fields.notes?.[0] || null;
    const ticketId = fields.ticketId?.[0] || null; // optional link to ticket
    const serviceContractId = fields.serviceContractId?.[0] || null;

    if (!assetId || !scheduledDue || !actualDoneAt || !performedBy) {
      res.status(400).json({ error: "Required fields are missing." });
      return;
    }

    let fileUrl: string | null = null;

    const fileArr: any = (files as any).file;
    if (fileArr && fileArr[0]) {
      const file = fileArr[0];
      const tempPath = file.filepath;
      const originalFileName = file.originalFilename || `maintenance-${Date.now()}.pdf`;

      try {
        const remoteFilePath = `/public_html/smartassets/maintenance_reports/${originalFileName}`;
        fileUrl = await uploadToFTP(tempPath, remoteFilePath);
        fs.unlinkSync(tempPath);
      } catch (e) {
        res.status(500).json({ error: "FTP upload failed." });
        return;
      }
    }

    try {
      const asset = await prisma.asset.findUnique({ where: { assetId } });
      if (!asset) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
      // ✅ validate contract belongs to same asset (if provided)
      let contractIdInt: number | null = null;
      if (serviceContractId) {
        contractIdInt = Number(serviceContractId);
        if (Number.isNaN(contractIdInt)) {
           res.status(400).json({ error: "Invalid serviceContractId" });
           return;
        }

        const contract = await prisma.serviceContract.findUnique({ where: { id: contractIdInt } });
        if (!contract || contract.assetId !== asset.id) {
           res.status(400).json({ error: "Contract does not belong to this asset" });
           return;
        }
      }
      const saved = await prisma.maintenanceHistory.create({
        data: {
          assetId: asset.id,
          serviceContractId: contractIdInt,
          scheduledDue: new Date(scheduledDue),
          actualDoneAt: new Date(actualDoneAt),
          wasLate,
          performedBy,
          notes,
          serviceReport: fileUrl,
          ticketId: ticketId ? parseInt(ticketId) : null,
        },
      });

      res.status(200).json(saved);
      return;
    } catch (e) {
      console.error("DB save error:", e);
      res.status(500).json({ error: "Failed to save maintenance history" });
      return;
    }
  });
};
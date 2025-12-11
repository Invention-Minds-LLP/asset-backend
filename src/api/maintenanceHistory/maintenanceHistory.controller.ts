import { Request, Response } from "express";
import prisma from "../../prismaClient";
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

export const getMaintenanceHistory = async (req: Request, res: Response) => {
  const history = await prisma.maintenanceHistory.findMany({ include: { asset: true } });
  res.json(history);
};

export const createMaintenanceRecord = async (req: Request, res: Response) => {
  const record = await prisma.maintenanceHistory.create({ data: req.body });
  res.status(201).json(record);
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
    return `https://smartassets.inventionminds.com/maintenance_reports/${fileName}`;
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
      return res.status(500).json({ error: 'File parsing failed.' });
    }

    const assetId = fields.assetId?.[0];
    const scheduledDue = fields.scheduledDue?.[0];
    const actualDoneAt = fields.actualDoneAt?.[0];
    const wasLate = fields.wasLate?.[0] === 'true';
    const performedBy = fields.performedBy?.[0];
    const notes = fields.notes?.[0] || null;

    console.log('Raw assetId:', fields.assetId);
    console.log('Type of assetId:', typeof fields.assetId);
    console.log('First element:', fields.assetId?.[0]);

    if (!assetId || !scheduledDue || !actualDoneAt || !performedBy) {
      res.status(400).json({ error: 'Required fields are missing.' });
      return;
    }

    console.log('Asset ID:', parseInt(assetId));

    let fileUrl: string | null = null;

    if (files.file && files.file[0]) {
      const file = files.file[0];
      const tempPath = file.filepath;
      const originalFileName = file.originalFilename || `maintenance-${Date.now()}.pdf`;

      try {
        const remoteFilePath = `/public_html/smartassets/maintenance_reports/${originalFileName}`;
        fileUrl = await uploadToFTP(tempPath, remoteFilePath);
        fs.unlinkSync(tempPath); // cleanup
      } catch (err) {
        return res.status(500).json({ error: 'FTP upload failed.' });
      }
    }

    try {
      const saved = await prisma.maintenanceHistory.create({
        data: {
          assetId: parseInt(assetId),
          scheduledDue: new Date(scheduledDue),
          actualDoneAt: new Date(actualDoneAt),
          wasLate,
          performedBy,
          notes,
          serviceReport: fileUrl,
        },
      });

      return res.status(200).json(saved);
    } catch (err) {
      console.error('DB save error:', err);
      return res.status(500).json({ error: 'Failed to save maintenance history' });
    }
  });
};
// GET /api/maintenance-history/:assetId
export const getMaintenanceHistoryByAsset = async (req: Request, res: Response) => {
  const assetId = req.params.assetId;

  try {
    const history = await prisma.maintenanceHistory.findMany({
      where: { assetId: parseInt(assetId) },
      orderBy: { actualDoneAt: 'desc' },
    });

    return res.status(200).json(history);
  } catch (error) {
    console.error('Error fetching maintenance history:', error);
    return res.status(500).json({ error: 'Failed to fetch history.' });
  }
};

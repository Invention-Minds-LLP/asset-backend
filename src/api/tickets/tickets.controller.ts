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

export const getAllTickets = async (req: Request, res: Response) => {
  const tickets = await prisma.ticket.findMany({ include: { asset: true, department: true } });
   res.json(tickets);
};

export const getTicketById = async (req: Request, res: Response) => {
  const ticketId = req.params.ticketId;
  const ticket = await prisma.ticket.findUnique({ where: { ticketId }, include: { asset: true, department: true } });
  if (!ticket) {
    res.status(404).json({ message: "Ticket not found" });
    return;
  }
   res.json(ticket);
};

export const createTicket = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Determine the financial year
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEndYear = fyStartYear + 1;
    const fyString = `FY${fyStartYear}-${(fyEndYear % 100).toString().padStart(2, '0')}`;

    // 2️⃣ Find the latest ticket in this FY
    const latestTicket = await prisma.ticket.findFirst({
      where: {
        ticketId: {
          startsWith: `TKT-${fyString}`,
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    // 3️⃣ Extract the last sequence number or start at 1
    let nextNumber = 1;
    if (latestTicket) {
      const parts = latestTicket.ticketId.split('-');
      const lastSeq = parseInt(parts[3], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }

    // 4️⃣ Generate the ticket ID
    const ticketId = `TKT-${fyString}-${nextNumber.toString().padStart(3, '0')}`;

    // 5️⃣ Create the ticket
    // const ticket = await prisma.ticket.create({
    //   data: {
    //     ...req.body,
    //     ticketId,
    //   },
    // });
    const result = await prisma.$transaction(async (prisma) => {
      const ticket = await prisma.ticket.create({
        data: {
          ...req.body,
          ticketId,
        },
      });

      await prisma.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          status: ticket.status,
          changedBy: ticket.raisedBy,
        },
      });

      return ticket;
    });
    const ticket = result;

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ message: 'Failed to create ticket' });
  }
};


export const updateTicket = async (req: Request, res: Response) => {
  try{
    const id = parseInt(req.params.id);
    const { updatedBy, ...ticketData } = req.body;
    const existingTicket = await prisma.ticket.findUnique({ where: { id } });
    if (!existingTicket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
  
    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: ticketData,
    });
  
    // If status changed, create a status history record
    if (ticketData.status && ticketData.status !== existingTicket.status) {
      await prisma.ticketStatusHistory.create({
        data: {
          ticketId: updatedTicket.id,
          status: ticketData.status,
          changedBy: updatedBy || 'system', // You should pass 'updatedBy' in the request
        },
      });
    }
  
     res.json(updatedTicket);
  }
  catch (error) {
    console.error('Error updating ticket:', error);
     res.status(500).json({ message: 'Failed to update ticket' });
  }
};

export const deleteTicket = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.ticket.delete({ where: { id } });
   res.status(204).send();
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
    return `https://smartassets.inventionminds.com/ticket_images/${fileName}`;
  } catch (error) {
    console.error("FTP upload error:", error);
    throw new Error("FTP upload failed");
  }
}
export const uploadTicketImage = async (req: Request, res: Response) => {
  try {
      const ticketId = req.params.ticketId;
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
      const originalFileName = file.originalFilename || `ticket-${Date.now()}.jpg`;

      if (!fs.existsSync(tempFilePath)) {
         res.status(500).json({ error: "Temporary image file not found." });
         return
      }

      const remoteFilePath = `/public_html/smartassets/ticket_images/${originalFileName}`;

      let fileUrl: string;
      try {
        fileUrl = await uploadToFTP(tempFilePath, remoteFilePath);
        console.log("Asset image uploaded successfully:", fileUrl);
        await prisma.ticket.update({
          where: { ticketId: ticketId },
          data: { photoOfIssue: fileUrl },
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
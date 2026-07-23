/**
 * Generate a printable Gate Pass PDF (security-friendly format).
 *
 * Layout:
 *  ┌─────────────────────────────────────────────────────┐
 *  │  ORG NAME           GATE PASS               [QR]    │
 *  │  GP-20260429-0001                                   │
 *  │  Type: RETURNABLE        Status: APPROVED           │
 *  │  Issued To: ...          Vehicle: ABC-1234          │
 *  │  Purpose: ...                                       │
 *  │  Expected Return: 2026-05-05                        │
 *  │  ───────────────────────────────────────────────    │
 *  │  Items                                              │
 *  │  # | Asset ID | Asset Name | Qty | Remarks          │
 *  │  ───────────────────────────────────────────────    │
 *  │  Approved By: <emp name>      Date: ...             │
 *  │  Requested By: <emp name>     Date: ...             │
 *  │  Security Out: ____________   Date: ___________     │
 *  │  Security In:  ____________   Date: ___________     │
 *  └─────────────────────────────────────────────────────┘
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { Response } from "express";

type GatePassForPdf = {
  id: number;
  gatePassNo: string;
  type: string;
  status: string;
  approvalStatus: string;
  issuedTo: string;
  purpose: string;
  expectedReturnDate: Date | null;
  vehicleNo: string | null;
  vehicleType: string | null;
  courierDetails: string | null;
  reason: string | null;
  approvalRemarks: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  gatedOutAt: Date | null;
  gatedInAt: Date | null;
  requestedBy: { name: string | null } | null;
  approvedByEmployee: { name: string | null } | null;
  gatedOutBy: { name: string | null } | null;
  gatedInBy: { name: string | null } | null;
  items: Array<{
    quantity: number;
    remarks: string | null;
    description: string | null;
    make: string | null;
    model: string | null;
    asset: { assetId: string; assetName: string; serialNumber: string | null } | null;
  }>;
};

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export async function streamGatePassPdf(gp: GatePassForPdf, res: Response): Promise<void> {
  const orgName = process.env.HOSPITAL_NAME || process.env.ORG_NAME || "Smart Assets";

  const qrPayload = JSON.stringify({ gatePassNo: gp.gatePassNo, id: gp.id });
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 120, margin: 0 });
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

  const doc = new PDFDocument({ size: "A4", margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${gp.gatePassNo}.pdf"`);
  doc.pipe(res);

  // Header band
  doc.rect(40, 40, 515, 60).fill("#1e3a8a");
  doc.fillColor("white").fontSize(16).font("Helvetica-Bold").text(orgName, 55, 55);
  doc.fontSize(11).font("Helvetica").text("GATE PASS", 55, 78);
  doc.fontSize(10).font("Helvetica-Bold").text(gp.gatePassNo, 55, 92);

  // QR top-right
  doc.image(qrBuffer, 470, 45, { width: 70, height: 70 });

  doc.fillColor("black").y = 115;

  // Type & status banner
  doc.moveDown(0.6);
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#475569")
    .text(`Type: `, { continued: true }).font("Helvetica").fillColor("black").text(gp.type, { continued: true });
  doc.font("Helvetica-Bold").fillColor("#475569")
    .text(`     Status: `, { continued: true }).font("Helvetica").fillColor("black").text(gp.status, { continued: true });
  doc.font("Helvetica-Bold").fillColor("#475569")
    .text(`     Approval: `, { continued: true }).font("Helvetica").fillColor(approvalColor(gp.approvalStatus)).text(gp.approvalStatus);

  doc.fillColor("black").moveDown(0.6);

  // Two-column meta block
  const left = 55, right = 305;
  const yMeta = doc.y;
  metaPair(doc, "Issued To", gp.issuedTo, left, yMeta);
  metaPair(doc, "Vehicle", gp.vehicleNo ? `${gp.vehicleNo} (${gp.vehicleType || "—"})` : "—", right, yMeta);

  metaPair(doc, "Purpose", gp.purpose, left, doc.y);
  metaPair(doc, "Expected Return", fmt(gp.expectedReturnDate), right, doc.y - 14);

  if (gp.courierDetails) metaPair(doc, "Courier", gp.courierDetails, left, doc.y);
  if (gp.reason) metaPair(doc, "Reason", gp.reason, left, doc.y);

  doc.moveDown(0.5);
  hr(doc);

  // Items table
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e3a8a").text("Items").fillColor("black").moveDown(0.4);

  drawItemsTable(doc, gp.items);

  doc.moveDown(0.8);
  hr(doc);

  // Sign-off block
  const signY = doc.y + 5;
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#1e3a8a").text("Sign-off", left, signY).fillColor("black").moveDown(0.4);

  doc.fontSize(9).font("Helvetica");
  signLine(doc, "Requested By", gp.requestedBy?.name, gp.createdAt);
  signLine(doc, "Approved By (HOD)", gp.approvedByEmployee?.name, gp.approvedAt);
  if (gp.approvalRemarks) doc.fontSize(8).fillColor("#64748b").text(`HOD remarks: ${gp.approvalRemarks}`).fillColor("black").fontSize(9);
  if (gp.rejectionReason) doc.fontSize(8).fillColor("#dc2626").text(`Rejection reason: ${gp.rejectionReason}`).fillColor("black").fontSize(9);
  signLine(doc, "Security — Out", gp.gatedOutBy?.name, gp.gatedOutAt);
  signLine(doc, "Security — In", gp.gatedInBy?.name, gp.gatedInAt);

  // Footer
  const footY = 800;
  doc.fontSize(7).fillColor("#94a3b8").font("Helvetica")
    .text(`Generated on ${new Date().toLocaleString("en-IN")} • This pass is invalid without HOD approval and security gate-out signature`, 40, footY, { width: 515, align: "center" });

  doc.end();
}

function approvalColor(status: string): string {
  if (status === "APPROVED" || status === "AUTO_APPROVED") return "#16a34a";
  if (status === "REJECTED") return "#dc2626";
  return "#f59e0b";
}

function metaPair(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number) {
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text(label.toUpperCase(), x, y, { width: 240 });
  doc.fontSize(10).font("Helvetica").fillColor("black").text(value || "—", x, y + 10, { width: 240 });
  doc.y = y + 28;
}

function hr(doc: PDFKit.PDFDocument) {
  doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.y += 6;
}

function drawItemsTable(doc: PDFKit.PDFDocument, items: GatePassForPdf["items"]) {
  const cols = [
    { label: "#",         x: 45,  w: 25 },
    { label: "Asset ID",  x: 75,  w: 130 },
    { label: "Asset Name",x: 210, w: 175 },
    { label: "Serial No", x: 390, w: 90 },
    { label: "Qty",       x: 485, w: 30 },
    { label: "Remarks",   x: 520, w: 35 },
  ];

  const headerY = doc.y;
  doc.rect(40, headerY - 2, 515, 16).fill("#f1f5f9");
  doc.fillColor("#475569").fontSize(8).font("Helvetica-Bold");
  for (const c of cols) doc.text(c.label, c.x, headerY + 2, { width: c.w });
  doc.y = headerY + 16;

  doc.fillColor("black").fontSize(9).font("Helvetica");
  items.forEach((it, idx) => {
    const rowY = doc.y + 2;
    // Non-asset items (spares / surgical equipment) fall back to their free-text
    // description + make/model so the pass is still identifiable.
    const makeModel = [it.make, it.model].filter(Boolean).join(" ");
    const name = it.asset?.assetName || it.description || "—";
    doc.text(String(idx + 1), cols[0].x, rowY, { width: cols[0].w });
    doc.text(it.asset?.assetId || (makeModel || "—"), cols[1].x, rowY, { width: cols[1].w });
    doc.text(makeModel && it.asset ? `${name} (${makeModel})` : name, cols[2].x, rowY, { width: cols[2].w });
    doc.text(it.asset?.serialNumber || "—", cols[3].x, rowY, { width: cols[3].w });
    doc.text(String(it.quantity ?? 1), cols[4].x, rowY, { width: cols[4].w });
    doc.text(it.remarks || "", cols[5].x, rowY, { width: cols[5].w });
    doc.y = rowY + 14;
    doc.strokeColor("#e2e8f0").lineWidth(0.3).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  });
}

function signLine(doc: PDFKit.PDFDocument, label: string, name: string | null | undefined, when: Date | null) {
  const y = doc.y + 4;
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#475569").text(label, 55, y, { width: 130 });
  doc.fontSize(9).font("Helvetica").fillColor("black").text(name || "____________________", 195, y, { width: 200 });
  doc.fontSize(9).font("Helvetica").fillColor("black").text(fmt(when), 410, y, { width: 140 });
  doc.y = y + 14;
}

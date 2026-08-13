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
  carriedBy: string | null;
  employeeCode: string | null;
  employeeContact: string | null;
  processDept: string | null;
  toAddress: string | null;
  reason: string | null;
  approvalRemarks: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  gatedOutAt: Date | null;
  gatedInAt: Date | null;
  requestedBy: { name: string | null } | null;
  approvedByEmployee: { name: string | null } | null;
  opsApprovedBy?: { name: string | null } | null;
  opsApprovedAt?: Date | null;
  opsApprovalRemarks?: string | null;
  securityClearedBy?: { name: string | null } | null;
  securityClearedAt?: Date | null;
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

/**
 * What the QR actually encodes.
 *
 * It used to be a JSON blob — which a phone camera can only display as raw text,
 * so a guard scanning a parcel saw {"gatePassNo":"GP-…","id":42} and nothing
 * else. Assets already moved to a deep link for exactly this reason (see
 * quick-actions.ts → qrUrlFor); this brings gate passes in line.
 *
 * `baseUrl` is the origin of the request that asked for the PDF, NOT a
 * configured domain. deploy/nginx-smartassets.conf serves the SPA and the API
 * from one origin and documents why a fixed public URL is wrong here: staff
 * inside reach the server by LAN IP and outsiders by domain, so a baked-in
 * domain hands LAN users a host their network may not resolve. Whoever printed
 * the label was on a host that works for them; the QR keeps them on it.
 */
function scanUrl(baseUrl: string, gatePassNo: string): string {
  const base = (baseUrl || "").replace(/\/+$/, "");
  return `${base}/gate-pass/scan/${encodeURIComponent(gatePassNo)}`;
}

export async function streamGatePassPdf(gp: GatePassForPdf, res: Response, baseUrl = ""): Promise<void> {
  const orgName = process.env.HOSPITAL_NAME || process.env.ORG_NAME || "Smart Assets";
  // Company identity for the printed pass — constant per deployment (env-driven).
  // Tolerate the label being typed into the value ("GSTIN:29AAATR1234A1Z5"),
  // which otherwise prints as "GSTIN: GSTIN:29AAATR1234A1Z5" — the heading
  // below already supplies the label.
  const orgGstin = (process.env.ORG_GSTIN || process.env.COMPANY_GSTIN || "")
    .trim()
    .replace(/^gstin\s*[:\-]?\s*/i, "");
  const orgAddress = process.env.ORG_ADDRESS || process.env.COMPANY_ADDRESS || "";

  const qrDataUrl = await QRCode.toDataURL(scanUrl(baseUrl, gp.gatePassNo), { width: 120, margin: 0 });
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

  // Company identity (From / GSTIN) — env-driven, constant per deployment.
  if (orgAddress || orgGstin) {
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text("FROM", 55, doc.y, { width: 500 });
    if (orgAddress) doc.fontSize(9).font("Helvetica").fillColor("black").text(orgAddress, 55, doc.y, { width: 500 });
    if (orgGstin) doc.fontSize(9).font("Helvetica-Bold").fillColor("#475569").text(`GSTIN: `, { continued: true }).font("Helvetica").fillColor("black").text(orgGstin);
    doc.moveDown(0.4);
  }

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

  const rowPurpose = doc.y;
  metaPair(doc, "Purpose", gp.purpose, left, rowPurpose);
  metaPair(doc, "Expected Return", fmt(gp.expectedReturnDate), right, rowPurpose);

  // Employee / movement details (from the physical gate-pass form)
  if (gp.carriedBy || gp.employeeCode) {
    const r = doc.y;
    metaPair(doc, "Carried By", gp.carriedBy || "—", left, r);
    metaPair(doc, "Employee ID", gp.employeeCode || "—", right, r);
  }
  if (gp.processDept || gp.employeeContact) {
    const r = doc.y;
    metaPair(doc, "Process / Dept", gp.processDept || "—", left, r);
    metaPair(doc, "Employee Contact", gp.employeeContact || "—", right, r);
  }
  if (gp.toAddress) metaPair(doc, "To (Destination)", gp.toAddress, left, doc.y);

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
  // Stage two — the signature that actually clears the pass for the gate.
  signLine(doc, "Approved By (Operations)", gp.opsApprovedBy?.name, gp.opsApprovedAt ?? null);
  if (gp.opsApprovalRemarks) doc.fontSize(8).fillColor("#64748b").text(`Operations remarks: ${gp.opsApprovalRemarks}`).fillColor("black").fontSize(9);
  if (gp.rejectionReason) doc.fontSize(8).fillColor("#dc2626").text(`Rejection reason: ${gp.rejectionReason}`).fillColor("black").fontSize(9);
  signLine(doc, "Security — Cleared", gp.securityClearedBy?.name, gp.securityClearedAt ?? null);
  signLine(doc, "Security — Out", gp.gatedOutBy?.name, gp.gatedOutAt);
  signLine(doc, "Security — In", gp.gatedInBy?.name, gp.gatedInAt);

  // Footer — derived from the page box, not a magic number.
  //
  // This was hardcoded to y=800. A4 is 842pt tall with a 40pt margin, so the
  // printable area ends at 802; a 7pt line starting at 800 crosses that
  // boundary and pdfkit answers by starting a NEW PAGE, stranding the footer
  // alone on a second sheet. Every gate pass printed as two pages because of it.
  //
  // lineBreak:false keeps a long generated-on string on one line, so the same
  // overflow can't come back through wrapping.
  const footY = doc.page.height - doc.page.margins.bottom - 12;
  doc.fontSize(7).fillColor("#94a3b8").font("Helvetica")
    .text(`Generated on ${new Date().toLocaleString("en-IN")} • This pass is invalid without department + Operations approval and a security gate-out signature`,
      40, footY, { width: 515, align: "center", lineBreak: false });

  doc.end();
}

/**
 * Compact stick-on label for the parcel / asset — 4×6in (288×432pt), the common
 * thermal label size. Deliberately NOT the A4 pass: this is what a security
 * executive prints and sticks, so it carries only what identifies the parcel at
 * a glance (QR, number, type, destination, items) and none of the approval,
 * vehicle or company-financial detail on the full pass.
 */
export async function streamGatePassLabel(gp: GatePassForPdf, res: Response, baseUrl = ""): Promise<void> {
  const orgName = process.env.HOSPITAL_NAME || process.env.ORG_NAME || "Smart Assets";

  const qrDataUrl = await QRCode.toDataURL(scanUrl(baseUrl, gp.gatePassNo), { width: 260, margin: 0 });
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

  const W = 288, H = 432, M = 14;
  // margin 0, not M: pdfkit starts a new page as soon as text crosses the bottom
  // margin, and a sticker that runs to a second page is useless. Positions are
  // placed manually against M instead, and every block below is height-bounded.
  const doc = new PDFDocument({ size: [W, H], margin: 0 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${gp.gatePassNo}-label.pdf"`);
  doc.pipe(res);

  // Outer cut border
  doc.rect(4, 4, W - 8, H - 8).lineWidth(1).strokeColor("#0f172a").stroke();

  // Header
  doc.rect(4, 4, W - 8, 34).fill("#1e3a8a");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(11).text(orgName, M, 12, { width: W - M * 2 });
  doc.font("Helvetica").fontSize(8).text("GATE PASS — ITEM LABEL", M, 25, { width: W - M * 2 });

  // Pass number, the thing anyone reads first
  doc.fillColor("black").font("Helvetica-Bold").fontSize(17)
    .text(gp.gatePassNo, M, 48, { width: W - M * 2, align: "center" });

  // Type strip — RETURNABLE vs NON-RETURNABLE decides whether the gate expects
  // it back, so it gets a full-width colour band rather than a line of text.
  const returnable = gp.type === "RETURNABLE";
  doc.rect(M, 72, W - M * 2, 20).fill(returnable ? "#0369a1" : "#b45309");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(10)
    .text(returnable ? "RETURNABLE" : "NON-RETURNABLE", M, 78, { width: W - M * 2, align: "center" });

  // QR, centred and large enough to scan off a parcel
  doc.image(qrBuffer, (W - 118) / 2, 100, { width: 118, height: 118 });

  doc.fillColor("black");
  const CW = W - M * 2;              // content width
  const FOOTER_Y = H - 20;           // reserved footer strip
  const BODY_BOTTOM = FOOTER_Y - 6;  // nothing may be drawn past this
  let y = 228;

  // Each meta value is clamped to two lines and ellipsised, so a long address
  // can't push the item list off the sticker.
  const line = (label: string, value: string) => {
    const text = value || "—";
    const maxH = 24;
    if (y + 9 + 12 > BODY_BOTTOM) return;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#64748b").text(label.toUpperCase(), M, y, { width: CW });
    doc.font("Helvetica").fontSize(9.5).fillColor("black")
      .text(text, M, y + 9, { width: CW, height: maxH, ellipsis: true });
    y = y + 9 + Math.min(maxH, Math.max(12, doc.heightOfString(text, { width: CW }))) + 4;
  };

  line("Issued To", gp.issuedTo);
  if (gp.toAddress) line("Destination", gp.toAddress);
  if (returnable && gp.expectedReturnDate) {
    line("Expected Return", new Date(gp.expectedReturnDate).toLocaleDateString("en-IN", { dateStyle: "medium" }));
  }
  if (gp.carriedBy) line("Carried By", gp.carriedBy);

  // Items
  doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(M, y).lineTo(W - M, y).stroke();
  y += 6;
  const totalQty = gp.items.reduce((sum, it) => sum + (it.quantity ?? 1), 0);
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#64748b")
    .text(`ITEMS (${gp.items.length} line${gp.items.length > 1 ? "s" : ""}, qty ${totalQty})`, M, y, { width: CW });
  y += 11;

  // Draw items until the remaining space runs out rather than to a fixed count:
  // how many fit depends on how much the meta block above consumed. One line
  // each, ellipsised, so a long description can't wrap into the footer.
  const LINE_H = 11;
  const OVERFLOW_H = 10;
  doc.font("Helvetica").fontSize(8.5).fillColor("black");
  let shown = 0;
  for (const it of gp.items) {
    const remaining = gp.items.length - shown;
    // Keep room for the "+N more" line if this isn't the last item.
    const reserve = remaining > 1 ? OVERFLOW_H : 0;
    if (y + LINE_H + reserve > BODY_BOTTOM) break;

    const makeModel = [it.make, it.model].filter(Boolean).join(" ");
    const name = it.asset?.assetName || it.description || makeModel || "—";
    const code = it.asset?.assetId ? `${it.asset.assetId} · ` : "";
    const text = `• ${code}${name}${(it.quantity ?? 1) > 1 ? ` × ${it.quantity}` : ""}`;
    doc.text(text, M, y, { width: CW, height: LINE_H, ellipsis: true, lineBreak: false });
    y += LINE_H;
    shown++;
  }
  if (shown < gp.items.length) {
    doc.fillColor("#64748b").fontSize(7.5)
      .text(`+ ${gp.items.length - shown} more — scan QR for the full list`,
        M, y, { width: CW, height: OVERFLOW_H, ellipsis: true, lineBreak: false });
  }

  // Footer
  doc.fontSize(6.5).fillColor("#64748b").font("Helvetica")
    .text("Do not remove this label. Present the gate pass at the security desk.",
      M, FOOTER_Y, { width: CW, align: "center", height: 10, ellipsis: true, lineBreak: false });

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
  // Widths rebalanced for the codes this system actually issues:
  // AST-RP-PUR-FUR-FY2021-22-00474 and SN-1783158229526-546 both need real
  // room. Remarks previously had 35pt, which fitted about four characters.
  const cols = [
    { label: "#",          x: 45,  w: 20 },
    { label: "Asset ID",   x: 68,  w: 132 },
    { label: "Asset Name", x: 203, w: 128 },
    { label: "Serial No",  x: 334, w: 108 },
    { label: "Qty",        x: 445, w: 24 },
    { label: "Remarks",    x: 472, w: 78 },
  ];

  const drawHeader = () => {
    const headerY = doc.y;
    doc.rect(40, headerY - 2, 515, 16).fill("#f1f5f9");
    doc.fillColor("#475569").fontSize(8).font("Helvetica-Bold");
    for (const c of cols) doc.text(c.label, c.x, headerY + 2, { width: c.w });
    doc.y = headerY + 16;
    doc.fillColor("black").fontSize(9).font("Helvetica");
  };

  drawHeader();

  // Leave room for the footer strip so a long table never collides with it.
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 26;

  items.forEach((it, idx) => {
    // Non-asset items (spares / surgical equipment) fall back to their free-text
    // description + make/model so the pass is still identifiable.
    const makeModel = [it.make, it.model].filter(Boolean).join(" ");
    const name = it.asset?.assetName || it.description || "—";
    const cells = [
      String(idx + 1),
      it.asset?.assetId || (makeModel || "—"),
      makeModel && it.asset ? `${name} (${makeModel})` : name,
      it.asset?.serialNumber || "—",
      String(it.quantity ?? 1),
      it.remarks || "",
    ];

    // Measure before drawing. The row height used to be a flat 14pt, so a value
    // that wrapped to two lines (long asset IDs and serials both do) overran it
    // and the row separator was stroked straight through the second line.
    doc.fontSize(9).font("Helvetica");
    const rowH = Math.max(
      14,
      ...cells.map((t, i) => doc.heightOfString(t || " ", { width: cols[i].w }))
    ) + 4;

    if (doc.y + rowH > bottomLimit) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeader();
    }

    const rowY = doc.y + 2;
    doc.fillColor("black").fontSize(9).font("Helvetica");
    cells.forEach((t, i) => doc.text(t, cols[i].x, rowY, { width: cols[i].w }));

    doc.y = rowY + rowH;
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

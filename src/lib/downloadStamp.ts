// DPDP download footer. Every file that leaves the system carries a unique
// reference so a leaked copy can be traced to the person, moment and download:
//
//   SA-<employeeID>-<yyyyMMdd>-<HHmmss>-<NNNN>      (IST; NNNN = their Nth download)
//
// stampFile() writes it into the file itself, by type:
//   xlsx  → a footer row under every sheet + the printed page footer
//   csv   → a trailing line
//   pdf   → a line up the right margin of every page (pdf-lib)
//   html  → a fixed footer bar (screen + print)
//   xml   → a trailing comment (Tally import still parses)
// Anything else is returned unchanged.

import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export interface DownloadStamp {
  refCode: string;
  downloadNo: number;
  employeeID: string;
  name: string | null;
  at: Date;
}

const IST = "Asia/Kolkata";

function istParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export function buildRefCode(employeeID: string, downloadNo: number, at: Date): string {
  const p = istParts(at);
  const emp = String(employeeID || "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "");
  return `SA-${emp}-${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}-${String(downloadNo).padStart(4, "0")}`;
}

export function footerText(s: DownloadStamp): string {
  const p = istParts(s.at);
  const who = s.name ? `${s.name} (${s.employeeID})` : s.employeeID;
  return `Downloaded by ${who} on ${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second} IST | ` +
    `Download #${s.downloadNo} | Ref ${s.refCode} | Confidential - tracked under DPDP Act`;
}

// pdf-lib's standard fonts are WinAnsi only; names in other scripts would throw.
const ascii = (t: string) => t.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?");

async function stampXlsx(buf: Buffer, text: string, refCode: string, footerRow: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  // Always: file properties + printed page footer. Excel header/footer codes
  // need '&' doubled.
  wb.description = text;
  wb.keywords = refCode;
  const printFooter = `&L&8${text.replace(/&/g, "&&")}`;
  wb.eachSheet((ws) => {
    ws.headerFooter = { ...(ws.headerFooter || {}), oddFooter: printFooter, evenFooter: printFooter };
    // Visible row under the data — skipped for import templates, where an
    // extra row would be read back as data on upload.
    if (footerRow) {
      ws.addRow([]);
      const row = ws.addRow([text]);
      row.getCell(1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Drawn vertically up the right margin, on a white strip: the bottom edge is
// taken by hospital letterhead artwork (address/web/phone) on gate passes, and
// a line there was unreadable over it. The right margin is blank on every
// layout we generate.
async function stampPdf(buf: Buffer, text: string): Promise<Buffer> {
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const safe = ascii(text);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    let size = 6.5;
    while (size > 4 && font.widthOfTextAtSize(safe, size) > height - 40) size -= 0.5;
    const len = font.widthOfTextAtSize(safe, size);
    const y = (height - len) / 2;
    const x = width - 6; // baseline; rotated glyphs sit just left of it
    page.drawRectangle({ x: x - size - 2.5, y: y - 4, width: size + 5, height: len + 8, color: rgb(1, 1, 1), opacity: 0.9 });
    page.drawText(safe, { x, y, size, font, color: rgb(0.28, 0.33, 0.41), rotate: degrees(90) });
  }
  return Buffer.from(await pdf.save());
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function stampHtml(buf: Buffer, text: string): Buffer {
  const html = buf.toString("utf8");
  const bar =
    `<div style="position:fixed;left:0;right:0;bottom:0;padding:3px 10px;font:9px Arial,sans-serif;` +
    `color:#64748b;background:#fff;border-top:1px solid #e2e8f0;z-index:99999">${escHtml(text)}</div>` +
    `<style>@media print{body{padding-bottom:18px}}</style>`;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return Buffer.from(i >= 0 ? html.slice(0, i) + bar + html.slice(i) : html + bar, "utf8");
}

function stampCsv(buf: Buffer, text: string): Buffer {
  const body = buf.toString("utf8");
  const nl = body.includes("\r\n") ? "\r\n" : "\n";
  const sep = body.endsWith("\n") ? "" : nl;
  return Buffer.from(`${body}${sep}${nl}"${text.replace(/"/g, '""')}"${nl}`, "utf8");
}

function stampXml(buf: Buffer, text: string): Buffer {
  const body = buf.toString("utf8");
  return Buffer.from(`${body.replace(/\s*$/, "")}\n<!-- ${text.replace(/--/g, "- -")} -->\n`, "utf8");
}

/** Returns the file with the footer written in; unknown types pass through. */
export async function stampFile(
  buf: Buffer,
  contentType: string,
  stamp: DownloadStamp,
  opts: { footerRow?: boolean } = {}
): Promise<Buffer> {
  const ct = contentType.toLowerCase();
  const text = footerText(stamp);
  if (ct.includes("spreadsheetml")) return stampXlsx(buf, text, stamp.refCode, opts.footerRow !== false);
  if (ct.includes("application/pdf")) return stampPdf(buf, text);
  if (ct.includes("text/html")) return stampHtml(buf, text);
  if (ct.includes("csv") || ct.includes("text/plain")) return stampCsv(buf, text);
  if (ct.includes("xml")) return stampXml(buf, text);
  return buf;
}

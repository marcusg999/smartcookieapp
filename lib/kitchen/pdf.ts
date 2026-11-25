import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import PDFDocument from "pdfkit";

import type { CookRow, KitchenSettings, Label } from "./logic";

/**
 * Printable PDFs for the kitchen (pdfkit, standard fonts). Streams are left
 * uncompressed so the files stay searchable and testable; they're small.
 */

// Label sheets, in points (72 per inch), Letter paper.
export const SHEETS = {
  // Avery 5163: 2 × 5 labels, 4" × 2".
  avery_5163: { cols: 2, rows: 5, w: 288, h: 144, left: 11.25, top: 36, gapX: 13.5, gapY: 0 },
  // Avery 5164: 2 × 3 labels, 4" × 3⅓".
  avery_5164: { cols: 2, rows: 3, w: 288, h: 240, left: 11.25, top: 36, gapX: 13.5, gapY: 0 },
} as const;

const RED = "#b3132b";
const INK = "#1f1d1a";

/** The standard PDF fonts only know Latin-1 (WinAnsi): map the rest. */
export function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

let logoCache: Buffer | null = null;
async function logo(): Promise<Buffer | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = await readFile(path.join(process.cwd(), "public/icons/icon-192.png"));
  } catch {
    logoCache = null;
  }
  return logoCache;
}

const fmtDay = (iso: string) =>
  iso
    ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
        new Date(`${iso}T12:00:00Z`),
      )
    : "";

/** Meal labels on Avery sheets. One label per meal. */
export async function labelsPdf(labels: Label[], sheetName: KitchenSettings["label_sheet"], title: string): Promise<Buffer> {
  const sheet = SHEETS[sheetName];
  const doc = new PDFDocument({ size: "LETTER", margin: 0, compress: false, autoFirstPage: false, info: { Title: title } });
  const done = collect(doc);
  const img = await logo();
  const perPage = sheet.cols * sheet.rows;
  const tall = sheet.h > 200;
  labels.forEach((label, i) => {
    if (i % perPage === 0) doc.addPage({ size: "LETTER", margin: 0 });
    const slot = i % perPage;
    const x = sheet.left + (slot % sheet.cols) * (sheet.w + sheet.gapX);
    const y = sheet.top + Math.floor(slot / sheet.cols) * (sheet.h + sheet.gapY);
    const pad = 9;
    const w = sheet.w - pad * 2;
    let cy = y + pad;
    if (label.severe) {
      doc.save().lineWidth(3).strokeColor(RED).rect(x + 2, y + 2, sheet.w - 4, sheet.h - 4).stroke().restore();
    }
    if (img) doc.image(img, x + sheet.w - pad - 22, cy, { width: 22, height: 22 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(tall ? 17 : 13);
    doc.text(pdfText(label.name), x + pad, cy, { width: w - 26, lineBreak: false, ellipsis: true });
    cy += tall ? 20 : 16;
    doc.font("Helvetica").fontSize(8).text(pdfText(label.place), x + pad, cy, { width: w - 26, lineBreak: false, ellipsis: true });
    cy += 12;
    doc.font("Helvetica-Bold").fontSize(tall ? 13 : 10.5).text(pdfText(label.meal), x + pad, cy, { width: w, lineBreak: false, ellipsis: true });
    cy += tall ? 17 : 14;
    doc.font("Helvetica").fontSize(7.5).text(pdfText(`Delivered ${fmtDay(label.deliveryDate)}  |  Use by ${fmtDay(label.useBy)}`), x + pad, cy, {
      width: w,
      lineBreak: false,
    });
    cy += 11;
    // Allergen line: a red warning mark + CONTAINS list (CLAUDE.md §6: red).
    if (label.contains.length || label.mayContain.length) {
      doc.save().fillColor(RED).polygon([x + pad, cy + 7], [x + pad + 4, cy], [x + pad + 8, cy + 7]).fill().restore();
      const text = [
        label.contains.length ? `CONTAINS: ${label.contains.join(", ")}` : "",
        label.mayContain.length ? `MAY CONTAIN: ${label.mayContain.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("   ");
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(7.5).text(pdfText(text), x + pad + 11, cy, { width: w - 11, lineBreak: false, ellipsis: true });
    } else {
      doc.fillColor(INK).font("Helvetica").fontSize(7.5).text("CONTAINS: none of the listed allergens", x + pad, cy, { width: w, lineBreak: false });
    }
    cy += 11;
    if (label.preparedSafeFor.length) {
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(8);
      doc.text(pdfText(`PREPARED ALLERGY-SAFE FOR: ${label.preparedSafeFor.join(", ")}`), x + pad, cy, { width: w, lineBreak: false, ellipsis: true });
      cy += 11;
    }
    if (label.severe) {
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(7.5).text("SEVERE ALLERGY - CHECK BEFORE SERVING", x + pad, cy, { width: w, lineBreak: false });
      cy += 10;
    }
    if (label.reheat && cy < y + sheet.h - pad - 8) {
      doc.fillColor(INK).font("Helvetica-Oblique").fontSize(7).text(pdfText(label.reheat), x + pad, cy, {
        width: w,
        height: y + sheet.h - pad - cy,
        ellipsis: true,
      });
    }
  });
  if (labels.length === 0) {
    doc.addPage({ size: "LETTER", margin: 54 });
    doc.font("Helvetica").fontSize(14).text("No labels for this selection.");
  }
  doc.end();
  return done;
}

/** Cook list, one section per delivery day, large type for the counter. */
export async function cookListPdf(rows: CookRow[], title: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 54, left: 54, right: 54 }, compress: false, info: { Title: title } });
  const done = collect(doc);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(pdfText(title));
  doc.moveDown(0.5);
  const days = [...new Set(rows.map((r) => r.date))];
  for (const day of days) {
    if (doc.y > 640) doc.addPage();
    doc.moveDown(0.6).font("Helvetica-Bold").fontSize(16).fillColor(INK).text(pdfText(fmtDay(day)));
    doc.moveDown(0.2);
    for (const r of rows.filter((x) => x.date === day)) {
      if (doc.y > 700) doc.addPage();
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(pdfText(r.item), 54, y, { width: 300 });
      doc.font("Helvetica-Bold").fontSize(13).text(String(r.total), 360, y, { width: 50, align: "right" });
      doc.font("Helvetica").fontSize(11).text(`${r.standard} std`, 420, y + 1, { width: 70, align: "right" });
      if (r.modifications.length) {
        doc.fillColor(RED).font("Helvetica-Bold").fontSize(11);
        doc.text(pdfText(r.modifications.map((m) => `${m.count} ${m.label}`).join(", ")), 72, doc.y + 2, { width: 450 });
        doc.fillColor(INK);
      }
      doc.moveDown(0.4);
    }
  }
  if (rows.length === 0) doc.font("Helvetica").fontSize(14).text("Nothing to cook for this week yet.");
  doc.end();
  return done;
}

import { strToU8, zipSync } from "fflate";
import template from "./template.json";
import type { Inspection, Motor, Status } from "./types";

// Fills the registered ISO check sheet (template/checksheet-motor-original.docx).
// One Word table per sheet; each sheet holds 30 inspections of one motor.

export const ROWS_PER_SHEET = 30;

export interface SheetData {
  motor: Motor;
  rows: Inspection[]; // at most 30, in sheet order
  approval?: { engineer: string; approved_on: string } | null;
}

const T = template as {
  head: string;
  table: string;
  sep: string;
  tail: string;
  parts: Record<string, string>;
};

const FONT = '<w:rFonts w:ascii="Angsana New" w:eastAsia="Calibri" w:hAnsi="Angsana New" w:cs="Angsana New"/>';

const SYMBOL: Record<Status, string> = { ok: "√", bad: "X", fixed: "Ⓧ" };
const OVERALL_TEXT: Record<Status, string> = {
  ok: "",
  bad: "มีสิ่งผิดปกติ",
  fixed: "มีสิ่งผิดปกติแก้ไขแล้ว",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(text: string, opts: { size?: number; center?: boolean } = {}): string {
  if (!text) return "";
  const size = opts.size ?? 22;
  return `<w:r><w:rPr>${FONT}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return String(Math.round(v * 100) / 100);
}

function spec(v: number): string {
  return v ? String(v) : "-";
}

/** 'YYYY-MM-DD...' -> 'dd/mm/yy' (fits the narrow ว/ด/ป column) */
function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/** 'อธิวัฒน์ สุวรรณไตรย์' -> 'อธิวัฒน์ ส.' so the narrow ผู้ตรวจเช็ค column stays one line */
export function shortName(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  if (!last) return first ?? "";
  const initial = /^[เแโใไ]/.test(last) ? last.slice(0, 2) : last[0];
  return `${first} ${initial}.`;
}

function remarkFor(i: Inspection): string {
  const parts: string[] = [];
  if (OVERALL_TEXT[i.overall]) parts.push(OVERALL_TEXT[i.overall]);
  if (i.cleanliness_note) parts.push(`ความสะอาด: ${i.cleanliness_note}`);
  if (i.vibration_note) parts.push(`การสั่น: ${i.vibration_note}`);
  if (i.remark) parts.push(i.remark);
  return parts.join(" / ");
}

function cellsFor(i: Inspection): string[] {
  return [
    SYMBOL[i.cleanliness],
    SYMBOL[i.vibration],
    num(i.temp),
    num(i.l1),
    num(i.l2),
    num(i.l3),
    num(i.pressure),
    num(i.level),
    shortName(i.inspector),
    shortDate(i.inspected_at),
    remarkFor(i),
  ];
}

function renderTable(sheet: SheetData): string {
  const m = sheet.motor;
  const values: Record<string, string> = {
    TAG: esc(m.tag),
    DESC: esc(m.description || "-"),
    BRAND: esc(m.brand || "-"),
    TYPE: esc(m.type || "-"),
    KW: spec(m.kw),
    VOLT: spec(m.volt),
    AMP: spec(m.amp),
    RPM: spec(m.rpm),
    CONN: esc(m.connection || "-"),
    PLANT: esc(m.plant),
    ENG_NAME: sheet.approval ? run(sheet.approval.engineer) : "",
    ENG_DATE: sheet.approval
      ? run(shortDate(sheet.approval.approved_on))
      : run("......./......../........"),
  };
  sheet.rows.slice(0, ROWS_PER_SHEET).forEach((ins, idx) => {
    cellsFor(ins).forEach((text, c) => {
      // inspector name and remarks are long; shrink a little so rows keep their height
      const size = c === 8 ? 18 : c === 10 ? 18 : 22;
      values[`R${idx + 1}C${c + 1}`] = run(text, { size });
    });
  });
  return T.table.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export function buildDocx(sheets: SheetData[], title: string): Uint8Array {
  const body = sheets.map(renderTable).join(T.sep);
  const documentXml = T.head + body + T.tail;
  const files: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(T.parts)) {
    let c = content;
    if (name === "docProps/core.xml") {
      c = c.replace(/<dc:title>.*?<\/dc:title>|<dc:title\/>/, `<dc:title>${esc(title)}</dc:title>`);
    }
    files[name] = strToU8(c);
  }
  files["word/document.xml"] = strToU8(documentXml);
  return zipSync(files, { level: 6 });
}

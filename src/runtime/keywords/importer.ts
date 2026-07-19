import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type {
  KeywordImportFormat,
  KeywordImportRow,
  KeywordParsedFile,
  KeywordRejectedRow,
} from "./contracts.js";

const REQUIRED_HEADERS = ["seed_keyword", "keyword"] as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function unzipOfficeEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const buffer = Buffer.from(bytes);
  const entries = new Map<string, Uint8Array>();
  for (let offset = 0; offset + 46 <= buffer.length; ) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("INVALID_XLSX_ZIP");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
    if (!content) throw new Error("UNSUPPORTED_XLSX_COMPRESSION");
    entries.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXlsxRecords(bytes: Uint8Array): string[][] {
  const entries = unzipOfficeEntries(bytes);
  const sheet = entries.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("XLSX_SHEET_NOT_FOUND");
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString() ?? "";
  const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml([...match[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")),
  );
  const xml = sheet.toString();
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1]!;
      const ref = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? "A";
      let column = 0;
      for (const char of ref) column = column * 26 + char.charCodeAt(0) - 64;
      const body = cellMatch[2]!;
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        ?? /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body)?.[1]
        ?? "";
      const value = /\bt="s"/.test(attributes) ? (shared[Number(raw)] ?? "") : decodeXml(raw);
      cells[column - 1] = value;
    }
    rows.push(cells.map((value) => value ?? ""));
  }
  return rows;
}

function validateRecords(records: readonly string[][]): {
  rows: KeywordImportRow[];
  rejected: KeywordRejectedRow[];
} {
  const header = records[0]?.map((value) => value.trim().toLowerCase()) ?? [];
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required)) throw new Error(`MISSING_REQUIRED_HEADER:${required}`);
  }
  const at = (row: readonly string[], name: string): string => row[header.indexOf(name)]?.trim() ?? "";
  const rows: KeywordImportRow[] = [];
  const rejected: KeywordRejectedRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const row = records[index]!;
    if (row.every((value) => !value?.trim())) continue;
    const sourceRow = index + 1;
    const seedKeyword = at(row, "seed_keyword");
    const keyword = at(row, "keyword");
    const demandText = at(row, "demand_value");
    const observedAtText = at(row, "observed_at");
    if (!seedKeyword) rejected.push({ sourceRow, code: "MISSING_SEED" });
    else if (!keyword) rejected.push({ sourceRow, code: "MISSING_KEYWORD" });
    else if (demandText && (!Number.isFinite(Number(demandText)) || Number(demandText) < 0)) {
      rejected.push({ sourceRow, code: "INVALID_DEMAND" });
    } else if (observedAtText && Number.isNaN(Date.parse(observedAtText))) {
      rejected.push({ sourceRow, code: "INVALID_DATE" });
    } else {
      rows.push({
        sourceRow,
        seedKeyword,
        keyword,
        ...(demandText ? { demandValue: Number(demandText) } : {}),
        ...(observedAtText ? { observedAt: new Date(observedAtText).toISOString() } : {}),
      });
    }
  }
  return { rows, rejected };
}

export function detectKeywordImportFormat(fileName: string): KeywordImportFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".xlsx")) return "XLSX";
  throw new Error("UNSUPPORTED_KEYWORD_IMPORT_FORMAT");
}

export function parseKeywordImport(fileName: string, bytes: Uint8Array): KeywordParsedFile {
  const format = detectKeywordImportFormat(fileName);
  const records = format === "CSV"
    ? parseCsvRecords(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""))
    : parseXlsxRecords(bytes);
  const parsed = validateRecords(records);
  return { format, sourceHash: sha256(bytes), ...parsed };
}

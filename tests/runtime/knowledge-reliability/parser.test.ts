/**
 * Tests for KNOWLEDGE_INGESTION_RELIABILITY_V1 (Agent F) — the reliable KnowledgeParser.
 *
 * Reliability guarantees exercised here:
 *   - TXT / MARKDOWN / URL(HTML bytes) / DOCX(real mammoth + real fixture) happy paths,
 *   - the REAL unpdf PDF path against a REAL committed reportlab fixture (extracts non-empty
 *     text; NOT stubbed) — the checkpoint's load-bearing assertion,
 *   - a blank (no-text) but valid PDF -> EMPTY_CONTENT (real unpdf extraction of ""),
 *   - a corrupt PDF -> PARSE_FAILED (real unpdf throws InvalidPDFException),
 *   - an encrypted/password-protected PDF -> ENCRYPTED_DOCUMENT (a real PasswordException-shaped
 *     error driven through the real classifier via the injectable extractor seam),
 *   - an empty file -> EMPTY_CONTENT,
 *   - oversized bytes -> FILE_TOO_LARGE,
 *   - a MIME/extension mismatch -> handled (warning, content-type wins),
 *   - an unsupported type (xlsx / image) -> UNSUPPORTED_FILE_TYPE (OCR never attempted).
 *
 * All results are the typed KnowledgeResult; the parser never throws.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  MIME_EXTENSION_MISMATCH_WARNING,
  ReliableKnowledgeParser,
  isEncryptedPdfError,
  type KnowledgeErrorCode,
  type PdfTextExtractor,
} from "../../../src/runtime/knowledge/parsers/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const bytesOf = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));
const readFixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(fixturesDir, name)));

/** Assert failure and narrow to the error, with a helpful message on the happy branch. */
function expectError<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: KnowledgeErrorCode } },
  code: KnowledgeErrorCode,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected failure ${code} but parse succeeded`);
  expect(result.error.code).toBe(code);
}

// ---------------------------------------------------------------------------
// Text formats (happy paths)
// ---------------------------------------------------------------------------

describe("ReliableKnowledgeParser — text formats", () => {
  const parser = new ReliableKnowledgeParser();

  it("decodes TXT bytes as UTF-8", async () => {
    const res = await parser.parse({
      filename: "notes.txt",
      contentType: "text/plain; charset=utf-8",
      bytes: bytesOf("Acme ships worldwide. Café ☕ open 24/7."),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.format).toBe("TXT");
    expect(res.value.text).toBe("Acme ships worldwide. Café ☕ open 24/7.");
    expect(res.value.warnings).toEqual([]);
  });

  it("keeps MARKDOWN raw (markup preserved verbatim)", async () => {
    const md = "# Title\n\n- one\n- two\n\n**bold** and `code`";
    const res = await parser.parse({
      filename: "readme.md",
      contentType: "text/markdown",
      bytes: bytesOf(md),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.format).toBe("MARKDOWN");
    expect(res.value.text).toBe(md);
  });

  it("strips HTML to text for a URL document (already-fetched bytes)", async () => {
    const html =
      "<html><head><title>x</title><style>.a{color:red}</style>" +
      "<script>alert(1)</script></head><body>" +
      "<h1>Company&nbsp;Overview</h1><p>We sell &amp; ship widgets.</p>" +
      "<div>Line&#65;</div></body></html>";
    const res = await parser.parse({
      contentType: "text/html; charset=utf-8",
      bytes: bytesOf(html),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.format).toBe("URL");
    expect(res.value.text).toBe("Company Overview\nWe sell & ship widgets.\nLineA");
    expect(res.value.text).not.toMatch(/alert|color:red/);
  });

  it("extracts raw text from a REAL .docx via real mammoth + real fixture", async () => {
    const res = await parser.parse({
      filename: "sample.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: readFixture("sample.docx"),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.format).toBe("DOCX");
    expect(res.value.text).toContain("Hello DOCX from geoplane reliability");
  });
});

// ---------------------------------------------------------------------------
// PDF via REAL unpdf (the checkpoint's load-bearing path)
// ---------------------------------------------------------------------------

describe("ReliableKnowledgeParser — PDF via real unpdf", () => {
  it("extracts non-empty text from a REAL committed PDF fixture (unpdf, not stubbed)", async () => {
    const parser = new ReliableKnowledgeParser(); // real unpdf extractor
    const res = await parser.parse({
      filename: "sample.pdf",
      contentType: "application/pdf",
      bytes: readFixture("sample.pdf"),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`real PDF extraction failed: ${res.error.code} ${res.error.message}`);
    expect(res.value.format).toBe("PDF");
    expect(res.value.text.trim().length).toBeGreaterThan(0);
    expect(res.value.text).toContain("Hello PDF");
  });

  it("classifies a corrupt PDF as PARSE_FAILED (real unpdf throws)", async () => {
    const parser = new ReliableKnowledgeParser();
    const corrupt = bytesOf("%PDF-1.4\nthis is not a real pdf body at all\n%%EOF");
    const res = await parser.parse({
      filename: "broken.pdf",
      contentType: "application/pdf",
      bytes: corrupt,
    });
    expectError(res, "PARSE_FAILED");
  });

  it("classifies a valid but text-free PDF as EMPTY_CONTENT (real unpdf extracts \"\")", async () => {
    const parser = new ReliableKnowledgeParser();
    const res = await parser.parse({
      filename: "blank.pdf",
      contentType: "application/pdf",
      bytes: readFixture("blank.pdf"),
    });
    expectError(res, "EMPTY_CONTENT");
  });

  it("classifies a password-protected PDF as ENCRYPTED_DOCUMENT", async () => {
    // Drive the REAL classifier with a genuine PasswordException-shaped error (pdf.js sets
    // .name === "PasswordException", .code === 1 == NEED_PASSWORD). No encrypted binary needed.
    const passwordException = Object.assign(
      new Error("No password given"),
      { name: "PasswordException", code: 1 },
    );
    const encryptedExtractor: PdfTextExtractor = async () => {
      throw passwordException;
    };
    const parser = new ReliableKnowledgeParser({ pdfExtractor: encryptedExtractor });
    const res = await parser.parse({
      filename: "locked.pdf",
      contentType: "application/pdf",
      bytes: bytesOf("%PDF-1.4 (encrypted)"),
    });
    expectError(res, "ENCRYPTED_DOCUMENT");
    // And the classifier recognises the raw error directly.
    expect(isEncryptedPdfError(passwordException)).toBe(true);
    expect(isEncryptedPdfError(new Error("Invalid PDF structure."))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reliability gates: size, emptiness, mismatch, unsupported
// ---------------------------------------------------------------------------

describe("ReliableKnowledgeParser — reliability gates", () => {
  const parser = new ReliableKnowledgeParser();

  it("rejects oversized bytes as FILE_TOO_LARGE before parsing", async () => {
    const oversized = new Uint8Array(MAX_KNOWLEDGE_FILE_BYTES + 1); // one byte over the limit
    const res = await parser.parse({
      filename: "huge.txt",
      contentType: "text/plain",
      bytes: oversized,
    });
    expectError(res, "FILE_TOO_LARGE");
  });

  it("accepts bytes exactly at the size limit", async () => {
    // A buffer full of spaces would be EMPTY_CONTENT; use printable content padded to the limit.
    const filler = new Uint8Array(MAX_KNOWLEDGE_FILE_BYTES).fill(0x61); // 'a'
    const res = await parser.parse({
      filename: "atlimit.txt",
      contentType: "text/plain",
      bytes: filler,
    });
    expect(res.ok).toBe(true);
  });

  it("classifies an empty file as EMPTY_CONTENT", async () => {
    const res = await parser.parse({
      filename: "empty.txt",
      contentType: "text/plain",
      bytes: new Uint8Array(0),
    });
    expectError(res, "EMPTY_CONTENT");
  });

  it("classifies a whitespace-only file as EMPTY_CONTENT", async () => {
    const res = await parser.parse({
      filename: "blank.txt",
      contentType: "text/plain",
      bytes: bytesOf("   \n\t  \r\n "),
    });
    expectError(res, "EMPTY_CONTENT");
  });

  it("handles a MIME/extension mismatch: content-type wins, mismatch warned", async () => {
    // Declared PDF content-type, but a .txt filename. Content-type wins (format PDF),
    // and the mismatch is surfaced as a warning rather than silently mis-parsing.
    const res = await parser.parse({
      filename: "report.txt",
      contentType: "application/pdf",
      bytes: readFixture("sample.pdf"),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.format).toBe("PDF");
    expect(
      res.value.warnings.some((w) => w.startsWith(MIME_EXTENSION_MISMATCH_WARNING)),
    ).toBe(true);
  });

  it("does not warn when MIME and extension agree", async () => {
    const res = await parser.parse({
      filename: "notes.txt",
      contentType: "text/plain",
      bytes: bytesOf("plain content"),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings).toEqual([]);
  });

  it("rejects a spreadsheet as UNSUPPORTED_FILE_TYPE", async () => {
    const res = await parser.parse({
      filename: "data.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: bytesOf("PK"),
    });
    expectError(res, "UNSUPPORTED_FILE_TYPE");
  });

  it("rejects an image as UNSUPPORTED_FILE_TYPE (OCR out of scope, never attempted)", async () => {
    const res = await parser.parse({
      filename: "scan.png",
      contentType: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    expectError(res, "UNSUPPORTED_FILE_TYPE");
  });

  it("rejects an unknown binary type as UNSUPPORTED_FILE_TYPE", async () => {
    const res = await parser.parse({
      filename: "installer.exe",
      contentType: "application/x-msdownload",
      bytes: new Uint8Array([0x4d, 0x5a]),
    });
    expectError(res, "UNSUPPORTED_FILE_TYPE");
  });
});

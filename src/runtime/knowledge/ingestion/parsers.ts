/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md (chain step 1,
 *   "Knowledge package / enterprise knowledge base ingestion"), ../entities.ts /
 *   ../ports.ts (the versioned persistence these parsers feed), migrations/0002.
 * reconstruction_reason: KNOWLEDGE_FILE_INGESTION_V1 checkpoint - turn uploaded source
 *   bytes into plain extracted text plus a detected format, so ingestion-service.ts can
 *   append it as an append-only knowledge_version. Parsing is deliberately side-effect
 *   free and NETWORK free: a URL document is ingested by handing this module the ALREADY
 *   fetched HTML bytes (the caller owns any network I/O), never a live URL.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Scope: TXT, MARKDOWN, DOCX (mammoth), PDF (pdf-parse) and URL (HTML bytes -> text).
 *   OCR (scanned images) and spreadsheets (Excel) are explicitly OUT OF SCOPE: they raise
 *   UnsupportedKnowledgeFormatError so the ingestion service can SKIP + warn rather than
 *   block a bulk upload. This module never persists anything and holds no secrets.
 */
import mammoth from "mammoth";
// IMPORTANT: import the inner module, not the package root. pdf-parse's index.js runs a
// debug block when `module.parent` is undefined (which it is under ESM) and crashes.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** The five in-scope extracted-content formats. */
export type KnowledgeParseFormat = "TXT" | "MARKDOWN" | "DOCX" | "PDF" | "URL";

export interface KnowledgeParseInput {
  /** Original filename, if known - used as a fallback for format detection. */
  readonly filename?: string;
  /** MIME type as reported by the upload (e.g. "text/plain", may carry ";charset="). */
  readonly contentType: string;
  /** The raw source bytes. For a URL document these are the fetched HTML bytes. */
  readonly bytes: Buffer;
}

export interface KnowledgeParseResult {
  /** The extracted plain text (UTF-8). Never null; empty string is valid. */
  readonly text: string;
  readonly format: KnowledgeParseFormat;
  /** Non-fatal notes (e.g. mammoth conversion messages). Empty when clean. */
  readonly warnings: string[];
}

/** The abstraction the ingestion service depends on. */
export interface KnowledgeParser {
  parse(input: KnowledgeParseInput): Promise<KnowledgeParseResult>;
}

export type UnsupportedFormatReason =
  | "OCR_OUT_OF_SCOPE"
  | "SPREADSHEET_OUT_OF_SCOPE"
  | "UNKNOWN_FORMAT";

/**
 * Raised for out-of-scope inputs (scanned images needing OCR, Excel spreadsheets, or a
 * format we don't recognise). The ingestion service catches this and records a warning +
 * skips the file, so one unsupported item never blocks the rest of an upload.
 */
export class UnsupportedKnowledgeFormatError extends Error {
  readonly reason: UnsupportedFormatReason;
  constructor(message: string, reason: UnsupportedFormatReason) {
    super(message);
    this.name = "UnsupportedKnowledgeFormatError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Extractor seams (real libs by default; injectable for deterministic tests)
// ---------------------------------------------------------------------------

/** DOCX text extractor. Default delegates to mammoth.extractRawText. */
export type DocxExtractor = (
  bytes: Buffer,
) => Promise<{ value: string; messages: ReadonlyArray<{ message: string }> }>;

/** PDF text extractor. Default delegates to pdf-parse. */
export type PdfExtractor = (bytes: Buffer) => Promise<{ text: string }>;

const defaultDocxExtractor: DocxExtractor = (bytes) =>
  mammoth.extractRawText({ buffer: bytes });

const defaultPdfExtractor: PdfExtractor = (bytes) => pdfParse(bytes);

export interface DefaultKnowledgeParserDeps {
  readonly docxExtractor?: DocxExtractor;
  readonly pdfExtractor?: PdfExtractor;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Lower-cased MIME essence (the part before any ";charset=" etc.). */
function mimeEssence(contentType: string): string {
  const semi = contentType.indexOf(";");
  const head = semi === -1 ? contentType : contentType.slice(0, semi);
  return head.trim().toLowerCase();
}

/** Lower-cased file extension WITHOUT the dot, or "" when there is none. */
function extensionOf(filename: string | undefined): string {
  if (!filename) return "";
  const dot = filename.lastIndexOf(".");
  if (dot === -1 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

const OOXML_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OOXML_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Decide the format from contentType first, then filename extension. Raises
 * UnsupportedKnowledgeFormatError for OCR (images), spreadsheets, and anything unknown.
 */
export function detectKnowledgeFormat(
  input: KnowledgeParseInput,
): KnowledgeParseFormat {
  const mime = mimeEssence(input.contentType);
  const ext = extensionOf(input.filename);

  // Out-of-scope: spreadsheets.
  if (
    mime === OOXML_XLSX ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv"
  ) {
    throw new UnsupportedKnowledgeFormatError(
      `Spreadsheet input (mime="${mime}", ext="${ext}") is out of scope for knowledge ingestion`,
      "SPREADSHEET_OUT_OF_SCOPE",
    );
  }

  // Out-of-scope: images -> would need OCR.
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "tiff", "bmp"].includes(ext)) {
    throw new UnsupportedKnowledgeFormatError(
      `Image input (mime="${mime}", ext="${ext}") requires OCR, which is out of scope`,
      "OCR_OUT_OF_SCOPE",
    );
  }

  // In-scope formats. contentType wins; extension is the fallback.
  if (mime === OOXML_DOCX || ext === "docx") return "DOCX";
  if (mime === "application/pdf" || ext === "pdf") return "PDF";
  if (mime === "text/html" || mime === "application/xhtml+xml" || ext === "html" || ext === "htm") {
    return "URL";
  }
  if (mime === "text/markdown" || mime === "text/x-markdown" || ext === "md" || ext === "markdown") {
    return "MARKDOWN";
  }
  if (mime === "text/plain" || ext === "txt" || ext === "text") return "TXT";

  throw new UnsupportedKnowledgeFormatError(
    `Unrecognised knowledge input (mime="${mime}", ext="${ext}")`,
    "UNKNOWN_FORMAT",
  );
}

// ---------------------------------------------------------------------------
// HTML -> text (URL documents; caller supplies already-fetched HTML bytes)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    const mapped = NAMED_ENTITIES[body.toLowerCase()];
    return mapped ?? whole;
  });
}

/**
 * Strip HTML markup to readable plain text. Drops <script>/<style> content entirely,
 * turns block-ish tags into line breaks, removes remaining tags, decodes basic entities
 * and collapses runs of whitespace. Deliberately small - not a full HTML renderer.
 */
export function htmlToText(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(script|style|title|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Block boundaries -> newlines so words don't run together.
  out = out.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|br)\s*>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out);
  // Normalise whitespace: collapse spaces/tabs, trim each line, drop empty lines.
  const lines = out
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The default parser
// ---------------------------------------------------------------------------

export class DefaultKnowledgeParser implements KnowledgeParser {
  private readonly docxExtractor: DocxExtractor;
  private readonly pdfExtractor: PdfExtractor;

  constructor(deps: DefaultKnowledgeParserDeps = {}) {
    this.docxExtractor = deps.docxExtractor ?? defaultDocxExtractor;
    this.pdfExtractor = deps.pdfExtractor ?? defaultPdfExtractor;
  }

  async parse(input: KnowledgeParseInput): Promise<KnowledgeParseResult> {
    const format = detectKnowledgeFormat(input);
    switch (format) {
      case "TXT":
        return { text: input.bytes.toString("utf8"), format, warnings: [] };
      case "MARKDOWN":
        // Keep the raw markdown text verbatim - downstream may want the markup.
        return { text: input.bytes.toString("utf8"), format, warnings: [] };
      case "URL":
        return {
          text: htmlToText(input.bytes.toString("utf8")),
          format,
          warnings: [],
        };
      case "DOCX": {
        const result = await this.docxExtractor(input.bytes);
        return {
          text: result.value,
          format,
          warnings: result.messages.map((m) => m.message),
        };
      }
      case "PDF": {
        const result = await this.pdfExtractor(input.bytes);
        // pdf-parse already concatenates page text; trim trailing form feeds/space.
        return { text: result.text.replace(/\s+$/g, ""), format, warnings: [] };
      }
      default: {
        // Exhaustiveness guard: KnowledgeParseFormat is fully handled above.
        const never: never = format;
        throw new Error(`Unhandled knowledge format: ${String(never)}`);
      }
    }
  }
}

/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: D2's ../ingestion/parsers.ts (format set, HTML->text behaviour and
 *   the mammoth/pdf extractor seams, preserved so Agent A can rewire the ingestion service to
 *   this reliable layer), the frozen KNOWLEDGE_INGESTION_RELIABILITY_V1 checkpoint spec,
 *   ./errors.ts, ./format-detection.ts, ./pdf-extractor.ts.
 * reconstruction_reason: KNOWLEDGE_INGESTION_RELIABILITY_V1 - the reliable KnowledgeParser.
 *   parse({filename?, contentType, bytes}) turns uploaded source bytes (or already-fetched HTML
 *   bytes for a URL document) into {text, format, warnings}, returning a typed KnowledgeResult
 *   rather than throwing. It enforces, in order: a max file-size limit (FILE_TOO_LARGE), format
 *   detection + MIME/extension cross-check (UNSUPPORTED_FILE_TYPE / mismatch warning), format
 *   extraction (DOCX via mammoth, PDF via unpdf -> PARSE_FAILED / ENCRYPTED_DOCUMENT), and a
 *   shared empty-text guard (EMPTY_CONTENT). It performs NO network I/O and holds no secrets;
 *   URL documents are handed already-fetched HTML bytes by the download helper.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import mammoth from "mammoth";
import { err, ok, type KnowledgeResult } from "./errors.js";
import {
  detectFormat,
  type KnowledgeFormat,
} from "./format-detection.js";
import {
  extractPdf,
  unpdfTextExtractor,
  type PdfTextExtractor,
} from "./pdf-extractor.js";

export type { KnowledgeFormat } from "./format-detection.js";

/** Maximum accepted source size (20 MiB). Bytes above this are rejected before any parsing. */
export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024;

/** The reliable parser's input. Mirrors D2's KnowledgeParseInput so the seam is drop-in. */
export interface KnowledgeParseInput {
  /** Original filename, if known - used as a format cross-check/fallback. */
  readonly filename?: string;
  /** MIME type as reported by the upload/download (may carry ";charset="). */
  readonly contentType: string;
  /** Raw source bytes. For a URL document these are the already-fetched HTML bytes. */
  readonly bytes: Uint8Array;
}

/** The reliable parser's success payload. */
export interface KnowledgeParseResult {
  /** Extracted plain text (UTF-8). Guaranteed non-empty (whitespace-only fails EMPTY_CONTENT). */
  readonly text: string;
  readonly format: KnowledgeFormat;
  /** Non-fatal notes (mammoth messages, MIME/extension mismatch, ...). Empty when clean. */
  readonly warnings: readonly string[];
}

/** DOCX text extractor seam. Default delegates to mammoth.extractRawText. */
export type DocxTextExtractor = (
  bytes: Uint8Array,
) => Promise<{ value: string; messages: ReadonlyArray<{ message: string }> }>;

const defaultDocxExtractor: DocxTextExtractor = (bytes) =>
  // mammoth accepts a Node Buffer; normalise the Uint8Array so callers may pass either.
  mammoth.extractRawText({ buffer: Buffer.from(bytes) });

export interface ReliableKnowledgeParserDeps {
  readonly docxExtractor?: DocxTextExtractor;
  readonly pdfExtractor?: PdfTextExtractor;
}

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
 * Strip HTML markup to readable plain text. Drops <script>/<style>/<title>/<head>, turns
 * block-ish tags into line breaks, removes remaining tags, decodes basic entities and collapses
 * whitespace. Deliberately small - not a full HTML renderer. (Behaviour mirrors D2's htmlToText.)
 */
export function htmlToText(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(script|style|title|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|br)\s*>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out);
  const lines = out
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

function utf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The reliable KnowledgeParser. `parse` never throws: every outcome is a typed KnowledgeResult
 * whose failure branch carries one KnowledgeErrorCode.
 */
export interface KnowledgeParser {
  parse(input: KnowledgeParseInput): Promise<KnowledgeResult<KnowledgeParseResult>>;
}

export class ReliableKnowledgeParser implements KnowledgeParser {
  private readonly docxExtractor: DocxTextExtractor;
  private readonly pdfExtractor: PdfTextExtractor;

  constructor(deps: ReliableKnowledgeParserDeps = {}) {
    this.docxExtractor = deps.docxExtractor ?? defaultDocxExtractor;
    this.pdfExtractor = deps.pdfExtractor ?? unpdfTextExtractor;
  }

  async parse(
    input: KnowledgeParseInput,
  ): Promise<KnowledgeResult<KnowledgeParseResult>> {
    // Gate 1: size. Reject oversized bytes before doing any work.
    if (input.bytes.byteLength > MAX_KNOWLEDGE_FILE_BYTES) {
      return err(
        "FILE_TOO_LARGE",
        `Source is ${input.bytes.byteLength} bytes, over the ${MAX_KNOWLEDGE_FILE_BYTES}-byte limit`,
      );
    }

    // Gate 2: format detection + MIME/extension cross-check.
    const detected = detectFormat(input.contentType, input.filename);
    if (!detected.ok) return detected;
    const { format, warnings: detectWarnings } = detected.value;

    // Gate 3: extraction (format-specific).
    const extracted = await this.extractText(format, input.bytes);
    if (!extracted.ok) return extracted;

    const warnings = [...detectWarnings, ...extracted.value.warnings];
    const text = extracted.value.text;

    // Gate 4: emptiness (uniform across formats). Whitespace-only counts as empty.
    if (text.trim().length === 0) {
      return err(
        "EMPTY_CONTENT",
        `No extractable text in the ${format} source`,
      );
    }

    return ok({ text, format, warnings });
  }

  /** Format-specific extraction. Returns raw text + per-extractor warnings (no emptiness check). */
  private async extractText(
    format: KnowledgeFormat,
    bytes: Uint8Array,
  ): Promise<KnowledgeResult<{ text: string; warnings: readonly string[] }>> {
    switch (format) {
      case "TXT":
        return ok({ text: utf8(bytes), warnings: [] });
      case "MARKDOWN":
        // Keep raw markdown verbatim - downstream may want the markup.
        return ok({ text: utf8(bytes), warnings: [] });
      case "URL":
        return ok({ text: htmlToText(utf8(bytes)), warnings: [] });
      case "DOCX":
        return this.extractDocx(bytes);
      case "PDF":
        return this.extractPdfText(bytes);
      default: {
        // Exhaustiveness guard: KnowledgeFormat is fully handled above.
        const never: never = format;
        return err("UNSUPPORTED_FILE_TYPE", `Unhandled knowledge format: ${String(never)}`);
      }
    }
  }

  private async extractDocx(
    bytes: Uint8Array,
  ): Promise<KnowledgeResult<{ text: string; warnings: readonly string[] }>> {
    try {
      const result = await this.docxExtractor(bytes);
      return ok({
        text: result.value,
        warnings: result.messages.map((m) => m.message),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err("PARSE_FAILED", `DOCX could not be parsed: ${detail}`, cause);
    }
  }

  private async extractPdfText(
    bytes: Uint8Array,
  ): Promise<KnowledgeResult<{ text: string; warnings: readonly string[] }>> {
    const result = await extractPdf(bytes, this.pdfExtractor);
    if (!result.ok) return result;
    // pdf.js already concatenates page text; trim trailing form-feeds/space.
    return ok({ text: result.value.text.replace(/\s+$/g, ""), warnings: [] });
  }
}
